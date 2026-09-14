"""MOMA adapter unit tests.

No catalog family routes to MOMA any more — MiniMax H3 moved to the JojoKey relay, which is
the only route we hold a working credential for. The adapter is kept because the gateway
itself still exists and the account may come back; these tests describe its payload and
error handling, and the routing coverage lives in tests/test_jojokey_provider.py.
"""

import threading
from pathlib import Path
from types import SimpleNamespace

import pytest
import requests

from src.apps.comic_gen.pipeline import ComicGenPipeline
from src.models.moma import MomaVideoModel


class _FakeResponse:
    def __init__(self, status_code, payload=None, content=b""):
        self.status_code = status_code
        self._payload = payload or {}
        self.content = content
        self.text = str(self._payload)

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}: {self.text}")

    def json(self):
        return self._payload


def test_moma_adapter_submits_and_polls_with_model_header(monkeypatch, tmp_path):
    calls = []

    def fake_post(url, headers=None, json=None, timeout=None):
        calls.append(("post", url, headers, json, timeout))
        return _FakeResponse(200, {"task_id": "task-1"})

    def fake_get(url, headers=None, timeout=None):
        calls.append(("get", url, headers, None, timeout))
        if url.endswith("/task-1"):
            return _FakeResponse(
                200,
                {"task": {"status": "SUCCEEDED", "content": {"url": "https://cdn.example/out.mp4"}}},
            )
        return _FakeResponse(200, content=b"video-bytes")

    monkeypatch.setattr("src.models.moma.requests.post", fake_post)
    monkeypatch.setattr("src.models.moma.requests.get", fake_get)
    monkeypatch.setattr("src.models.moma.time.sleep", lambda _: None)

    output_path = tmp_path / "nested" / "out.mp4"
    model = MomaVideoModel({"api_key": "test-key"})
    result_path, elapsed = model.generate(
        prompt="A space opera trailer",
        output_path=str(output_path),
        model="minimax/minimax-h3",
        resolution="2K",
        duration=5,
        ratio="16:9",
    )

    assert result_path == str(output_path)
    assert elapsed >= 0
    assert output_path.read_bytes() == b"video-bytes"
    assert calls[0][0] == "post"
    assert calls[0][1] == "https://moma.cmecloud.cn/v1/videos"
    assert calls[0][2]["Authorization"] == "Bearer test-key"
    assert calls[0][3] == {
        "model": "minimax/minimax-h3",
        "content": [{"type": "text", "text": "A space opera trailer"}],
        "resolution": "2K",
        "duration": 5,
        "ratio": "16:9",
    }
    assert calls[1][2]["X-Model-Name"] == "minimax/minimax-h3"


def test_moma_payload_appends_multimodal_content_items():
    model = MomaVideoModel({"api_key": "test-key"})

    payload = model._build_payload(
        "demo",
        "minimax/minimax-h3",
        image_url="https://example.com/ref.png",
        video_url="https://example.com/ref.mp4",
        audio_url="https://example.com/ref.mp3",
    )

    assert payload["content"] == [
        {"type": "text", "text": "demo"},
        {"type": "image_url", "image_url": "https://example.com/ref.png"},
        {"type": "video_url", "video_url": "https://example.com/ref.mp4"},
        {"type": "audio_url", "audio_url": "https://example.com/ref.mp3"},
    ]


def test_moma_payload_accepts_multiple_items_of_each_media_type():
    model = MomaVideoModel({"api_key": "test-key"})

    payload = model._build_payload(
        "demo",
        "minimax/minimax-h3",
        image_urls=["https://example.com/ref-1.png", "https://example.com/ref-2.png"],
        video_urls=["https://example.com/ref-1.mp4"],
        audio_urls=["https://example.com/ref-1.mp3"],
    )

    assert payload["content"] == [
        {"type": "text", "text": "demo"},
        {"type": "image_url", "image_url": "https://example.com/ref-1.png"},
        {"type": "image_url", "image_url": "https://example.com/ref-2.png"},
        {"type": "video_url", "video_url": "https://example.com/ref-1.mp4"},
        {"type": "audio_url", "audio_url": "https://example.com/ref-1.mp3"},
    ]


def test_moma_adapter_rejects_missing_api_key(monkeypatch, tmp_path):
    monkeypatch.delenv("MOMA_API_KEY", raising=False)
    model = MomaVideoModel({})

    with pytest.raises(ValueError, match="MOMA_API_KEY"):
        model.generate("demo", str(tmp_path / "out.mp4"))


def test_moma_adapter_surfaces_submit_error_body(monkeypatch, tmp_path):
    class ErrorResponse:
        status_code = 400
        text = '{"code":"InvalidParameter","message":"resolution is not supported"}'

        def raise_for_status(self):
            raise requests.HTTPError(
                "400 Client Error: Bad Request for url: https://moma.cmecloud.cn/v1/videos"
            )

    monkeypatch.setattr("src.models.moma.requests.post", lambda *args, **kwargs: ErrorResponse())
    model = MomaVideoModel({"api_key": "test-key"})

    with pytest.raises(RuntimeError, match="resolution is not supported"):
        model.generate(
            "demo",
            str(tmp_path / "out.mp4"),
            model="minimax/minimax-h3",
            resolution="2K",
            duration=5,
            ratio="16:9",
        )


def test_create_video_task_does_not_replace_multimodal_minimax_with_wan():
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline._save_lock = threading.RLock()
    script = SimpleNamespace(
        id="script-1",
        frames=[SimpleNamespace(id="frame-1", dialogue="", dialogue_structured=None)],
        video_tasks=[],
    )
    pipeline.get_script = lambda script_id: script if script_id == "script-1" else None
    pipeline._save_data = lambda: None

    _, task_id = pipeline.create_video_task(
        script_id="script-1",
        image_url="",
        prompt="demo",
        model="minimax/minimax-h3",
        frame_id="frame-1",
        generation_mode="r2v",
        reference_image_urls=["https://example.com/character.png"],
    )

    task = next(item for item in script.video_tasks if item.id == task_id)
    assert task.model == "minimax/minimax-h3"
