from __future__ import annotations

import pytest

from tests.test_source_domain import source_client


def observe_response(client, monkeypatch, path):
    """Observe actual ASGI response delivery, including before background work."""
    delivered = []
    app = client._transport.app

    async def observed_app(scope, receive, send):
        async def observed_send(message):
            await send(message)
            if (scope.get("path") == path and message["type"] == "http.response.body"
                    and not message.get("more_body", False)):
                delivered.append(True)

        await app(scope, receive, observed_send)

    monkeypatch.setattr(client._transport, "app", observed_app)
    return delivered


@pytest.mark.parametrize("suffix", ["analysis/batch", "chapters/analysis/batch", "retry"])
def test_analysis_response_is_delivered_before_model_execution(source_client, monkeypatch, suffix):
    client, pipeline = source_client
    source = client.post("/sources", json={"title": "后台分析"}).json()
    client.post(f"/sources/{source['id']}/chapters", json={
        "chapter_number": 1, "title": "第一章", "content": "她打开密信。",
    })
    path = f"/sources/{source['id']}/{suffix}"
    if suffix == "retry":
        def fail(title, content):
            raise RuntimeError("provider unavailable")
        monkeypatch.setattr(pipeline, "analyze_source_chapter_events", fail)
        batch = client.post(f"/sources/{source['id']}/analysis/batch").json()
        path = f"/sources/{source['id']}/analysis/batches/{batch['id']}/retry"

    delivered = observe_response(client, monkeypatch, path)
    observed = []

    def analyze(title, content):
        observed.append(bool(delivered))
        return [{"event_type": "action", "description": "她打开密信"}]

    monkeypatch.setattr(pipeline, "analyze_source_chapter_events", analyze)
    response = client.post(path)
    assert response.status_code == (200 if suffix == "retry" else 201), response.text
    assert observed == [True], "model work must start after the response body is sent"
    queued = response.json()
    assert queued["status"] == "processing"
    assert queued["job_id"] and queued["job_item_id"]
    completed = client.get(f"/sources/{source['id']}/analysis/batches/{queued['id']}").json()
    assert completed["status"] == "succeeded"
    assert completed["succeeded"] == 1
    assert completed["items"][0]["analysis_id"]


def test_partial_batch_can_retry_different_chapters_in_successive_requests(source_client, monkeypatch):
    client, pipeline = source_client
    source = client.post("/sources", json={"title": "逐章重试"}).json()
    chapters = [client.post(f"/sources/{source['id']}/chapters", json={
        "chapter_number": number, "title": f"第{number}章", "content": "正文",
    }).json() for number in (1, 2)]

    def fail(title, content):
        raise RuntimeError("provider unavailable")

    monkeypatch.setattr(pipeline, "analyze_source_chapter_events", fail)
    batch = client.post(f"/sources/{source['id']}/analysis/batch").json()
    monkeypatch.setattr(pipeline, "analyze_source_chapter_events",
                        lambda title, content: [{"event_type": "action", "description": title}])
    for chapter in chapters:
        response = client.post(f"/sources/{source['id']}/analysis/batches/{batch['id']}/retry",
                               json={"chapter_ids": [chapter["id"]]})
        assert response.status_code == 200, response.text
        assert response.json()["status"] == "processing"
    completed = client.get(f"/sources/{source['id']}/analysis/batches/{batch['id']}").json()
    assert completed["succeeded"] == 2
    assert completed["failed"] == 0
