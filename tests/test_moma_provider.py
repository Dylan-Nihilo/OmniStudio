import threading
from pathlib import Path
from types import SimpleNamespace

import pytest
import requests

from src.apps.comic_gen.models import VideoTask
from src.apps.comic_gen.pipeline import ComicGenPipeline
from src.models.moma import MomaVideoModel
from src.utils.endpoints import get_provider_base_url
from src.utils.model_catalog import build_provider_family_configs, load_generated_model_catalog
from src.utils.provider_registry import get_default_provider_registry


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


def test_moma_catalog_and_provider_routing():
    catalog = load_generated_model_catalog()
    model = catalog["models"]["minimax/minimax-h3"]

    assert model["family"] == "minimax"
    assert model["capabilities"] == ["i2v", "r2v", "t2v", "v2v"]
    assert model["ui"]["selection_group"] == "i2v"
    assert "video_sidebar" in model["ui"]["visible_in"]
    assert get_default_provider_registry().resolve_backend("minimax/minimax-h3") == "moma"
    assert get_provider_base_url("MOMA") == "https://moma.cmecloud.cn/v1"


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


def test_pipeline_routes_minimax_to_moma_adapter(monkeypatch):
    task = VideoTask(
        id="task-minimax",
        project_id="script-1",
        image_url="",
        prompt="demo",
        model="minimax/minimax-h3",
    )
    calls = {}

    class FakeMomaModel:
        def __init__(self, config):
            calls["config"] = config

        def generate(self, **kwargs):
            calls["kwargs"] = kwargs
            return kwargs["output_path"], 0.0

    monkeypatch.setattr("src.models.moma.MomaVideoModel", FakeMomaModel)
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline._save_lock = threading.RLock()
    pipeline.scripts = {
        "script-1": SimpleNamespace(
            id="script-1",
            video_tasks=[task],
            frames=[],
            characters=[],
            scenes=[],
            props=[],
        )
    }
    pipeline._save_data = lambda: None
    pipeline._moma_video_model = None
    pipeline.get_script = lambda script_id: pipeline.scripts.get(script_id)

    pipeline.process_video_task("script-1", "task-minimax")

    assert task.status == "completed"
    assert calls["kwargs"]["model"] == "minimax/minimax-h3"


def test_pipeline_keeps_minimax_for_direct_r2v_and_forwards_reference_images(monkeypatch):
    task = VideoTask(
        id="task-minimax-r2v",
        project_id="script-1",
        image_url="",
        prompt="demo",
        model="minimax/minimax-h3",
        generation_mode="r2v",
        reference_image_urls=[
            "https://example.com/character.png",
            "https://example.com/scene.png",
        ],
    )
    calls = {}

    class FakeMomaModel:
        def __init__(self, config):
            pass

        def generate(self, **kwargs):
            calls["kwargs"] = kwargs
            return kwargs["output_path"], 0.0

    monkeypatch.setattr("src.models.moma.MomaVideoModel", FakeMomaModel)
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline._save_lock = threading.RLock()
    pipeline.scripts = {
        "script-1": SimpleNamespace(
            id="script-1",
            video_tasks=[task],
            frames=[],
            characters=[],
            scenes=[],
            props=[],
        )
    }
    pipeline._save_data = lambda: None
    pipeline._moma_video_model = None
    pipeline.get_script = lambda script_id: pipeline.scripts.get(script_id)

    pipeline.process_video_task("script-1", "task-minimax-r2v")

    assert task.status == "completed"
    assert calls["kwargs"]["image_urls"] == [
        "https://example.com/character.png",
        "https://example.com/scene.png",
    ]
    assert calls["kwargs"]["video_urls"] == []


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
