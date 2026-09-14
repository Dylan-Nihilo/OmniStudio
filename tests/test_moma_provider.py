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
from src.apps.comic_gen.models import VideoTask
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
        {"type": "image_url", "image_url": {"url": "https://example.com/ref.png"}, "role": "reference_image"},
        {"type": "video_url", "video_url": {"url": "https://example.com/ref.mp4"}, "role": "reference_video"},
        {"type": "audio_url", "audio_url": {"url": "https://example.com/ref.mp3"}, "role": "reference_audio"},
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
        {"type": "image_url", "image_url": {"url": "https://example.com/ref-1.png"}, "role": "reference_image"},
        {"type": "image_url", "image_url": {"url": "https://example.com/ref-2.png"}, "role": "reference_image"},
        {"type": "video_url", "video_url": {"url": "https://example.com/ref-1.mp4"}, "role": "reference_video"},
        {"type": "audio_url", "audio_url": {"url": "https://example.com/ref-1.mp3"}, "role": "reference_audio"},
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


def test_pipeline_can_execute_a_legacy_moma_task(monkeypatch):
    monkeypatch.setattr("src.apps.comic_gen.pipeline.resolve_provider_backend", lambda _: "moma")
    task = VideoTask(
        id="task-minimax",
        project_id="script-1",
        image_url="",
        prompt="demo",
        model="minimax/minimax-h3",
        last_frame_url="https://example.com/end.png",
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
    assert calls["kwargs"]["last_frame_url"] == "https://example.com/end.png"


def test_pipeline_keeps_minimax_for_direct_r2v_and_forwards_reference_images(monkeypatch):
    monkeypatch.setattr("src.apps.comic_gen.pipeline.resolve_provider_backend", lambda _: "moma")
    task = VideoTask(
        id="task-minimax-r2v",
        project_id="script-1",
        image_url="",
        prompt="demo",
        model="minimax/minimax-h3",
        generation_mode="r2v",
        audio_mode="driven",
        audio_url="audio/target-dialogue.mp3",
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
    assert calls["kwargs"]["audio_urls"] == ["audio/target-dialogue.mp3"]
    assert calls["kwargs"]["image_urls"] == [
        "https://example.com/character.png",
        "https://example.com/scene.png",
    ]
    assert calls["kwargs"]["video_urls"] == []
    assert calls["kwargs"]["generation_mode"] == "r2v"


def test_create_video_task_does_not_replace_multimodal_minimax_with_wan():
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline._save_lock = threading.RLock()
    script = SimpleNamespace(
        id="script-1",
        frames=[SimpleNamespace(id="frame-1", dialogue="", dialogue_structured=None, prompt_mode="complete")],
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


@pytest.mark.parametrize("mode,role", [("i2v", "first_frame"), ("r2v", "reference_image")])
def test_moma_single_image_role_matches_generation_mode(mode, role):
    payload = MomaVideoModel({})._build_payload(
        "demo", "minimax/minimax-h3", image_url="data:image/png;base64,eA==", generation_mode=mode,
    )
    assert payload["content"][1] == {
        "type": "image_url", "image_url": {"url": "data:image/png;base64,eA=="}, "role": role,
    }


def test_moma_first_and_last_frame_media_preserve_roles():
    model = MomaVideoModel({})
    kwargs = model._resolve_media_kwargs("minimax/minimax-h3", {
        "image_url": "https://example.com/start.png",
        "last_frame_url": "https://example.com/end.png", "generation_mode": "i2v",
    })
    payload = model._build_payload("move", "minimax/minimax-h3", **kwargs)
    assert [(item["role"], item["image_url"]["url"]) for item in payload["content"][1:]] == [
        ("first_frame", "https://example.com/start.png"),
        ("last_frame", "https://example.com/end.png"),
    ]
    with pytest.raises(ValueError, match="cannot mix"):
        model._build_payload("move", "minimax/minimax-h3", **kwargs, audio_url="https://example.com/voice.wav")


def test_last_frame_is_snapshotted_and_retained_on_retry(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    image = tmp_path / "output" / "end.png"
    image.parent.mkdir()
    image.write_bytes(b"original ending image")
    script = SimpleNamespace(id="script-1", frames=[], video_tasks=[])
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline._save_lock = threading.RLock()
    pipeline.get_script = lambda _: script
    pipeline._save_data = lambda: None
    pipeline.create_video_task("script-1", "https://example.com/start.png", "move",
        model="minimax/minimax-h3", audio_mode="native", last_frame_url="end.png")
    task = script.video_tasks[0]
    image.write_bytes(b"edited later")
    assert Path("output", task.last_frame_url).read_bytes() == b"original ending image"
    task.status = "failed"
    retried, created = pipeline.retry_video_task("script-1", task.id)
    assert created and retried.last_frame_url == task.last_frame_url
    with pytest.raises(ValueError, match="does not exist"):
        pipeline.create_video_task("script-1", "https://example.com/start.png", "move",
            model="minimax/minimax-h3", last_frame_url="missing.png")
    with pytest.raises(ValueError, match="no reference media"):
        pipeline.create_video_task("script-1", "https://example.com/start.png", "move",
            model="minimax/minimax-h3", last_frame_url="end.png", reference_image_urls=["extra.png"])
