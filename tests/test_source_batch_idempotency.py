from __future__ import annotations

from tests.test_source_domain import source_client


def test_source_batch_request_is_idempotent_for_same_chapters(source_client, monkeypatch):
    client, pipeline = source_client
    source = client.post("/sources", json={"title": "幂等批量来源"}).json()
    chapter = client.post(
        f"/sources/{source['id']}/chapters",
        json={"chapter_number": 1, "title": "第一章", "content": "正文"},
    ).json()
    monkeypatch.setattr(
        pipeline,
        "analyze_source_chapter_events",
        lambda title, content: [{"event_type": "action", "description": "完成"}],
    )

    first = client.post(
        f"/sources/{source['id']}/analysis/batch",
        json={"chapter_ids": [chapter["id"]]},
        headers={"Idempotency-Key": "source-batch-same-input"},
    )
    second = client.post(
        f"/sources/{source['id']}/analysis/batch",
        json={"chapter_ids": [chapter["id"]]},
        headers={"Idempotency-Key": "source-batch-same-input"},
    )

    assert first.status_code == 201, first.text
    assert second.status_code == 200, second.text
    assert second.json()["id"] == first.json()["id"]
    assert second.json()["job_item_id"] == first.json()["job_item_id"]
