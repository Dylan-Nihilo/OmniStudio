"""JojoKey adapter: routing, reference roles, and the two-line split.

The parts worth pinning are the ones a wrong guess would break silently rather than loudly:
an i2v request that sends its storyboard frame as a reference instead of the first frame
still produces a video, just not the shot that was drawn; a CN-line request that skips asset
registration is rejected upstream; and a result left as a URL stops working 23 hours later.
"""

from __future__ import annotations

import threading
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Dict, List

import pytest

from src.apps.comic_gen.models import VideoTask
from src.apps.comic_gen.pipeline import ComicGenPipeline
from src.models.jojokey import JojoKeyVideoModel
from src.utils.endpoints import get_provider_base_url
from src.utils.model_catalog import load_generated_model_catalog
from src.utils.provider_registry import get_default_provider_registry


class _Response:
    def __init__(self, status_code: int = 200, payload: Dict[str, Any] | None = None,
                 content: bytes = b""):
        self.status_code = status_code
        self._payload = payload or {}
        self.content = content
        self.text = str(self._payload)

    def json(self) -> Dict[str, Any]:
        return self._payload

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise AssertionError(f"unexpected raise_for_status at {self.status_code}")


class _Recorder:
    """Stand-in for `requests`, scripting submit -> poll -> download."""

    def __init__(self, *, poll_statuses: List[Dict[str, Any]] | None = None,
                 submit_id: str = "cnv_1", asset_prefix: str = "asset://asset_"):
        self.posts: List[Dict[str, Any]] = []
        self.gets: List[str] = []
        self._poll_statuses = poll_statuses or [{"status": "succeeded",
                                                 "video_url": "https://cdn.example.cn/out.mp4"}]
        self._submit_id = submit_id
        self._asset_prefix = asset_prefix
        self._asset_seq = 0

    def post(self, url, headers=None, json=None, timeout=None):
        self.posts.append({"url": url, "headers": dict(headers or {}), "json": json})
        if "/assets/from-url" in url:
            self._asset_seq += 1
            return _Response(payload={"id": f"cnasset_{self._asset_seq}",
                                      "asset_url": f"{self._asset_prefix}{self._asset_seq}",
                                      "sync_status": 2, "ready": True})
        return _Response(payload={"id": self._submit_id, "status": "queued"})

    def get(self, url, headers=None, timeout=None):
        self.gets.append(url)
        if url.startswith("https://cdn."):
            return _Response(content=b"MP4BYTES")
        if "/assets/" in url:
            return _Response(payload={"id": url.rsplit("/", 1)[-1], "sync_status": 2, "ready": True})
        polls = [get for get in self.gets if "/videos/" in get]
        payload = self._poll_statuses[min(len(polls) - 1, len(self._poll_statuses) - 1)]
        return _Response(payload={"id": self._submit_id, **payload})


@pytest.fixture
def recorder(monkeypatch):
    rec = _Recorder()
    monkeypatch.setattr("src.models.jojokey.requests", rec)
    monkeypatch.setattr("src.models.jojokey.time.sleep", lambda _: None)
    monkeypatch.setenv("JOJOKEY_API_KEY", "sk-test")
    # Media resolution and OSS are covered by their own tests; here a ref is already a URL.
    monkeypatch.setattr("src.models.jojokey.OSSImageUploader", lambda *a, **k: object())
    monkeypatch.setattr(
        "src.models.jojokey.resolve_media_inputs",
        lambda refs, **kwargs: [type("R", (), {"value": ref})() for ref in refs],
    )
    return rec


def _submit_body(rec: _Recorder) -> Dict[str, Any]:
    return next(post["json"] for post in rec.posts if "/videos" in post["url"])


def _roles(body: Dict[str, Any]) -> List[str]:
    return [block["role"] for block in body["content"] if block["type"] == "image_url"]


def test_missing_key_is_refused_before_any_request(monkeypatch):
    monkeypatch.setenv("JOJOKEY_API_KEY", "")
    with pytest.raises(ValueError, match="JOJOKEY_API_KEY"):
        JojoKeyVideoModel({}).generate("a shot", "/tmp/out.mp4", model="seedance-2.0-i2v")


def test_i2v_sends_the_storyboard_frame_as_the_first_frame(recorder, tmp_path):
    JojoKeyVideoModel({}).generate(
        "the character looks up", str(tmp_path / "out.mp4"),
        img_url="https://oss.example.cn/frame.png",
        model="seedance-2.0-i2v", generation_mode="i2v", resolution="720p", duration=5)
    body = _submit_body(recorder)
    assert _roles(body) == ["first_frame"]
    assert body["model"] == "video-cn-2.0-pro"      # 卓越 tier, CN line, straight off the catalog


def test_r2v_sends_every_image_as_its_own_reference_block(recorder, tmp_path):
    JojoKeyVideoModel({}).generate(
        "use image 1 for the character", str(tmp_path / "out.mp4"),
        img_url="https://oss.example.cn/a.png",
        model="seedance-2.0-r2v", generation_mode="r2v",
        ref_image_urls=["https://oss.example.cn/b.png", "https://oss.example.cn/c.png"],
        resolution="720p")
    body = _submit_body(recorder)
    # Upstream rejects first_frame mixed with reference_image, and refuses several URLs in one
    # field, so all three have to arrive as separate reference_image blocks.
    assert _roles(body) == ["reference_image"] * 3
    assert "first_frame" not in _roles(body)
    assert all(len(block["image_url"]) == 1 for block in body["content"]
               if block["type"] == "image_url")


def test_several_images_are_multi_reference_even_when_the_caller_said_i2v(recorder, tmp_path):
    """Dropping the extra references would be worse than honouring the mode they imply."""
    JojoKeyVideoModel({}).generate(
        "two references", str(tmp_path / "out.mp4"),
        img_url="https://oss.example.cn/a.png",
        model="seedance-2.0-i2v", generation_mode="i2v",
        ref_image_urls=["https://oss.example.cn/b.png"], resolution="720p")
    assert _roles(_submit_body(recorder)) == ["reference_image"] * 2


def test_cn_line_registers_assets_before_submitting(recorder, tmp_path):
    JojoKeyVideoModel({}).generate(
        "a shot", str(tmp_path / "out.mp4"), img_url="https://oss.example.cn/frame.png",
        model="seedance-2.5-i2v", generation_mode="i2v", resolution="720p",
        idempotency_key="job-42")
    registrations = [post for post in recorder.posts if "/assets/from-url" in post["url"]]
    assert len(registrations) == 1
    assert registrations[0]["json"]["asset_type"] == 1          # 1 = image
    # content[] must carry the asset handle, not the raw URL the CN line will not accept.
    body = _submit_body(recorder)
    assert body["content"][1]["image_url"]["url"].startswith("asset://")
    assert body["model"] == "video-cn-2.5"
    submit = next(post for post in recorder.posts if "/videos" in post["url"])
    assert submit["headers"]["Idempotency-Key"] == "job-42"


def test_an_unsynced_asset_is_waited_on_before_submitting(monkeypatch, tmp_path):
    """Registration is asynchronous. Submitting against an asset that still reads
    sync_status 1 is rejected as InvalidVideoCnAsset, which is what happened in production
    the first time round."""
    class _SlowSync(_Recorder):
        def __init__(self):
            super().__init__()
            self.checks = 0

        def post(self, url, headers=None, json=None, timeout=None):
            if "/assets/from-url" in url:
                self.posts.append({"url": url, "headers": dict(headers or {}), "json": json})
                return _Response(payload={"id": "cnasset_1", "asset_url": "asset://a1",
                                          "sync_status": 1, "ready": False})
            return super().post(url, headers=headers, json=json, timeout=timeout)

        def get(self, url, headers=None, timeout=None):
            if "/assets/" in url:
                self.checks += 1
                self.gets.append(url)
                ready = self.checks >= 2
                return _Response(payload={"id": "cnasset_1", "ready": ready,
                                          "sync_status": 2 if ready else 1})
            return super().get(url, headers=headers, timeout=timeout)

    rec = _SlowSync()
    monkeypatch.setattr("src.models.jojokey.requests", rec)
    monkeypatch.setattr("src.models.jojokey.time.sleep", lambda _: None)
    monkeypatch.setenv("JOJOKEY_API_KEY", "sk-test")
    monkeypatch.setattr("src.models.jojokey.OSSImageUploader", lambda *a, **k: object())
    JojoKeyVideoModel({}).generate(
        "a shot", str(tmp_path / "out.mp4"), img_url="https://oss.example.cn/frame.png",
        model="seedance-2.0-i2v", generation_mode="i2v", resolution="720p")
    assert rec.checks == 2
    assert _submit_body(rec)["content"][1]["image_url"]["url"] == "asset://a1"


def test_an_asset_that_never_syncs_says_why(monkeypatch, tmp_path):
    class _NeverSync(_Recorder):
        def post(self, url, headers=None, json=None, timeout=None):
            if "/assets/from-url" in url:
                return _Response(payload={"id": "cnasset_1", "asset_url": "asset://a1",
                                          "sync_status": 1, "ready": False})
            return super().post(url, headers=headers, json=json, timeout=timeout)

        def get(self, url, headers=None, timeout=None):
            if "/assets/" in url:
                return _Response(payload={"id": "cnasset_1", "sync_status": 1, "ready": False})
            return super().get(url, headers=headers, timeout=timeout)

    monkeypatch.setattr("src.models.jojokey.requests", _NeverSync())
    monkeypatch.setattr("src.models.jojokey.time.sleep", lambda _: None)
    monkeypatch.setenv("JOJOKEY_API_KEY", "sk-test")
    monkeypatch.setenv("JOJOKEY_ASSET_SYNC_SECONDS", "6")
    monkeypatch.setattr("src.models.jojokey.OSSImageUploader", lambda *a, **k: object())
    with pytest.raises(RuntimeError, match="reachable from inside China"):
        JojoKeyVideoModel({}).generate(
            "a shot", str(tmp_path / "out.mp4"), img_url="https://oss.example.cn/frame.png",
            model="seedance-2.0-i2v", generation_mode="i2v", resolution="720p")


def test_a_reference_reused_across_jobs_is_registered_once(recorder, tmp_path):
    """Registration is billed per asset, so a storyboard that points many shots at the same
    character reference must not pay for it once per shot."""
    model = JojoKeyVideoModel({})
    for shot in range(3):
        model.generate("a shot", str(tmp_path / f"out{shot}.mp4"),
                       img_url="https://oss.example.cn/character.png",
                       model="seedance-2.0-i2v", generation_mode="i2v", resolution="720p")
    registrations = [post for post in recorder.posts if "/assets/from-url" in post["url"]]
    assert len(registrations) == 1
    # The key must not carry anything job-specific, or the vendor would bill each retry.
    assert "omni-asset:image:" in registrations[0]["headers"]["Idempotency-Key"]


def test_overseas_line_passes_urls_straight_through(recorder, tmp_path):
    JojoKeyVideoModel({}).generate(
        "a shot", str(tmp_path / "out.mp4"), img_url="https://oss.example.com/frame.png",
        model="seedance-2.0-i2v", line="overseas", generation_mode="i2v", resolution="720p")
    assert not [post for post in recorder.posts if "/assets/from-url" in post["url"]]
    body = _submit_body(recorder)
    assert body["content"][1]["image_url"]["url"] == "https://oss.example.com/frame.png"
    assert body["model"] == "video-pro"
    # A bare face URL is likelier to trip upstream privacy checks without pre-registration.
    assert body["metadata"]["audit_image"] is True
    assert "/video-cn/" not in next(post["url"] for post in recorder.posts if "/videos" in post["url"])


@pytest.mark.parametrize("last_frame", [None, "https://oss.example.com/ending.png"])
def test_minimax_a_uses_its_own_flat_payload_not_seedance_content(recorder, tmp_path, last_frame):
    """minimax-A shares the endpoint but not the schema, and its contract says it rejects
    `content` and the other Seedance-only fields outright."""
    JojoKeyVideoModel({}).generate(
        "a shot", str(tmp_path / "out.mp4"), img_url="https://oss.example.com/frame.png",
        model="minimax/minimax-h3", generation_mode="i2v", resolution="960P",
        duration=5, ratio="16:9", last_frame=last_frame)
    body = _submit_body(recorder)
    assert "content" not in body and "metadata" not in body
    assert body["model"] == "minimax-A"
    assert body["mode"] == "keyframe"
    assert body["first_frame"] == "https://oss.example.com/frame.png"
    assert body.get("last_frame") == last_frame
    # It wants seconds/size, not the duration/resolution Seedance takes.
    assert body["seconds"] == 5 and body["size"] == "960P"
    assert "duration" not in body and "resolution" not in body


def test_minimax_a_reference_mode_sends_flat_image_arrays(recorder, tmp_path):
    JojoKeyVideoModel({}).generate(
        "use picture 1", str(tmp_path / "out.mp4"),
        model="minimax/minimax-h3", generation_mode="r2v", resolution="2K",
        ref_image_urls=["https://oss.example.com/a.png", "https://oss.example.com/b.png"])
    body = _submit_body(recorder)
    assert body["mode"] == "reference"
    assert body["images"] == ["https://oss.example.com/a.png", "https://oss.example.com/b.png"]
    assert "first_frame" not in body


def test_minimax_a_without_references_is_text_to_video(recorder, tmp_path):
    JojoKeyVideoModel({}).generate(
        "a shot", str(tmp_path / "out.mp4"),
        model="minimax/minimax-h3", generation_mode="t2v", resolution="720P")
    body = _submit_body(recorder)
    assert body["mode"] == "text"
    assert "first_frame" not in body and "images" not in body


def test_minimax_a_audio_driven_mode_keeps_the_storyboard_image(recorder, tmp_path):
    JojoKeyVideoModel({}).generate(
        "use this picture and voice", str(tmp_path / "out.mp4"),
        model="minimax/minimax-h3", generation_mode="i2v",
        img_url="https://oss.example.com/first.png", audio_url="https://oss.example.com/voice.mp3")
    body = _submit_body(recorder)
    assert body["mode"] == "reference"
    assert body["images"] == ["https://oss.example.com/first.png"]
    assert body["audios"] == ["https://oss.example.com/voice.mp3"]
    assert "first_frame" not in body


def test_the_video_is_downloaded_rather_than_stored_as_a_link(recorder, tmp_path):
    """The result URL stops working 23 hours after the task succeeds."""
    out = tmp_path / "nested" / "out.mp4"
    path, seconds = JojoKeyVideoModel({}).generate(
        "a shot", str(out), model="seedance-2.0-t2v", resolution="720p")
    assert Path(path).read_bytes() == b"MP4BYTES"
    assert seconds >= 0
    assert any(url.startswith("https://cdn.") for url in recorder.gets)


def test_polling_continues_until_the_task_leaves_the_queue(monkeypatch, tmp_path):
    rec = _Recorder(poll_statuses=[
        {"status": "queued"}, {"status": "running"},
        {"status": "succeeded", "video_url": "https://cdn.example.cn/out.mp4"},
    ])
    monkeypatch.setattr("src.models.jojokey.requests", rec)
    monkeypatch.setattr("src.models.jojokey.time.sleep", lambda _: None)
    monkeypatch.setenv("JOJOKEY_API_KEY", "sk-test")
    monkeypatch.setattr("src.models.jojokey.OSSImageUploader", lambda *a, **k: object())
    JojoKeyVideoModel({}).generate("a shot", str(tmp_path / "out.mp4"),
                                   model="seedance-2.0-t2v", resolution="720p")
    assert len([url for url in rec.gets if "/videos/" in url]) == 3


@pytest.mark.parametrize("status", ["failed", "cancelled", "expired"])
def test_a_terminal_failure_surfaces_the_upstream_explanation(monkeypatch, tmp_path, status):
    """The docs are explicit that a client must not show only the generic message."""
    rec = _Recorder(poll_statuses=[{"status": status, "error": {
        "code": "InputImageDimensionTooSmall",
        "message": "输入图片尺寸过小。",
        "source_message": "expected the height to be at least 300px",
        "suggestion": "请放大或更换该图片后重新提交。",
    }}])
    monkeypatch.setattr("src.models.jojokey.requests", rec)
    monkeypatch.setattr("src.models.jojokey.time.sleep", lambda _: None)
    monkeypatch.setenv("JOJOKEY_API_KEY", "sk-test")
    monkeypatch.setattr("src.models.jojokey.OSSImageUploader", lambda *a, **k: object())
    with pytest.raises(RuntimeError) as error:
        JojoKeyVideoModel({}).generate("a shot", str(tmp_path / "out.mp4"),
                                       model="seedance-2.0-t2v", resolution="720p")
    message = str(error.value)
    assert status in message
    assert "InputImageDimensionTooSmall" in message
    assert "at least 300px" in message
    assert "请放大或更换该图片后重新提交。" in message


def test_polling_gives_up_instead_of_hanging_forever(monkeypatch, tmp_path):
    rec = _Recorder(poll_statuses=[{"status": "running"}])
    monkeypatch.setattr("src.models.jojokey.requests", rec)
    monkeypatch.setattr("src.models.jojokey.time.sleep", lambda _: None)
    monkeypatch.setenv("JOJOKEY_API_KEY", "sk-test")
    monkeypatch.setenv("JOJOKEY_MAX_WAIT_SECONDS", "16")
    monkeypatch.setenv("JOJOKEY_POLL_INTERVAL_SECONDS", "8")
    monkeypatch.setattr("src.models.jojokey.OSSImageUploader", lambda *a, **k: object())
    with pytest.raises(RuntimeError, match="timed out after 16s"):
        JojoKeyVideoModel({}).generate("a shot", str(tmp_path / "out.mp4"),
                                       model="seedance-2.0-t2v", resolution="720p")


def test_an_unroutable_model_is_refused_with_a_pointer_to_the_catalog(recorder, tmp_path):
    with pytest.raises(ValueError, match="runtime.jojokey"):
        JojoKeyVideoModel({}).generate("a shot", str(tmp_path / "out.mp4"),
                                       model="not-a-real-model", resolution="720p")


def test_catalog_routes_both_families_to_jojokey():
    """Inherited from the MOMA tests this replaces: the catalog, not a prefix check in the
    pipeline, is what decides the backend, so the wiring has to be asserted on the catalog."""
    catalog = load_generated_model_catalog()
    registry = get_default_provider_registry()
    for model_id in ("minimax/minimax-h3", "seedance-2.0-i2v", "seedance-2.5-i2v"):
        assert registry.resolve_backend(model_id) == "jojokey", model_id
    minimax = catalog["models"]["minimax/minimax-h3"]
    assert minimax["capabilities"] == ["i2v", "r2v", "t2v", "v2v"]
    assert "video_sidebar" in minimax["ui"]["visible_in"]
    # minimax-A's own size names, used verbatim as both price key and upstream value.
    assert minimax["params"]["resolution"]["options"] == ["720P", "960P", "2K"]
    assert get_provider_base_url("JOJOKEY") == "https://video.jojokey.com/v1"


def _pipeline_with(task: VideoTask, monkeypatch) -> tuple[ComicGenPipeline, dict]:
    calls: dict = {}

    class FakeJojoKeyModel:
        def __init__(self, config):
            calls["config"] = config

        def generate(self, **kwargs):
            calls["kwargs"] = kwargs
            return kwargs["output_path"], 0.0

    monkeypatch.setattr("src.models.jojokey.JojoKeyVideoModel", FakeJojoKeyModel)
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline._save_lock = threading.RLock()
    pipeline.scripts = {"script-1": SimpleNamespace(
        id="script-1", video_tasks=[task], frames=[], characters=[], scenes=[], props=[])}
    pipeline._save_data = lambda: None
    pipeline._jojokey_video_model = None
    pipeline.get_script = lambda script_id: pipeline.scripts.get(script_id)
    return pipeline, calls


def test_pipeline_dispatches_a_seedance_task_to_jojokey(monkeypatch):
    task = VideoTask(id="task-seedance", project_id="script-1", image_url="",
                     prompt="demo", model="seedance-2.0-i2v")
    pipeline, calls = _pipeline_with(task, monkeypatch)
    pipeline.process_video_task("script-1", "task-seedance")
    assert task.status == "completed"
    assert calls["kwargs"]["model"] == "seedance-2.0-i2v"
    # The CN line dedupes on this, so a resubmitted task cannot be billed twice.
    assert calls["kwargs"]["idempotency_key"] == "task-seedance"


def test_pipeline_forwards_minimax_last_frame_to_the_active_provider(monkeypatch):
    task = VideoTask(id="task-minimax", project_id="script-1", image_url="https://example.com/first.png",
        last_frame_url="https://example.com/last.png", prompt="demo", model="minimax/minimax-h3")
    pipeline, calls = _pipeline_with(task, monkeypatch)
    monkeypatch.setattr(pipeline, "_download_temp_image", lambda _: "first-frame.png")
    pipeline.process_video_task("script-1", task.id)
    assert task.status == "completed"
    assert calls["kwargs"]["last_frame"] == task.last_frame_url


def test_pipeline_forwards_every_reference_image_for_a_direct_r2v_task(monkeypatch):
    task = VideoTask(id="task-r2v", project_id="script-1", image_url="", prompt="demo",
                     model="minimax/minimax-h3", generation_mode="r2v",
                     reference_image_urls=["https://example.com/character.png",
                                           "https://example.com/scene.png"])
    pipeline, calls = _pipeline_with(task, monkeypatch)
    pipeline.process_video_task("script-1", "task-r2v")
    assert task.status == "completed"
    assert calls["kwargs"]["ref_image_urls"] == ["https://example.com/character.png",
                                                 "https://example.com/scene.png"]
    assert calls["kwargs"]["generation_mode"] == "r2v"


class _CnDisabledRecorder(_Recorder):
    """Answers the CN line the way a disabled account does, and the overseas line normally."""

    def post(self, url, headers=None, json=None, timeout=None):
        if "/video-cn/" in url:
            self.posts.append({"url": url, "headers": dict(headers or {}), "json": json})
            return _Response(403, payload={"detail": {"error": {
                "code": "VideoCnBetaNotEnabled",
                "message": "JojoKey Video CN Beta 未对该账号开放"}}})
        return super().post(url, headers=headers, json=json, timeout=timeout)


def test_a_disabled_cn_line_falls_back_to_the_overseas_route(monkeypatch, tmp_path):
    """JojoKey enables the CN line per account, so a closed account 403s every call. Pinning
    Seedance to CN alone would mean no video at all until someone flips that switch."""
    rec = _CnDisabledRecorder()
    monkeypatch.setattr("src.models.jojokey.requests", rec)
    monkeypatch.setattr("src.models.jojokey.time.sleep", lambda _: None)
    monkeypatch.setenv("JOJOKEY_API_KEY", "sk-test")
    monkeypatch.setattr("src.models.jojokey.OSSImageUploader", lambda *a, **k: object())
    path, _ = JojoKeyVideoModel({}).generate(
        "a shot", str(tmp_path / "out.mp4"), model="seedance-2.0-mini-t2v", resolution="720p")
    assert Path(path).read_bytes() == b"MP4BYTES"
    submits = [post for post in rec.posts if post["url"].endswith("/videos")]
    # CN is tried first with its own id, then the retry uses the overseas id for that tier.
    assert [post["json"]["model"] for post in submits] == ["video-cn-2.0-mini", "video-mini"]
    assert submits[0]["url"].endswith("/video-cn/videos")
    assert not submits[1]["url"].endswith("/video-cn/videos")


def test_a_disabled_cn_line_is_still_an_error_when_there_is_nowhere_to_fall_back(monkeypatch, tmp_path):
    rec = _CnDisabledRecorder()
    monkeypatch.setattr("src.models.jojokey.requests", rec)
    monkeypatch.setattr("src.models.jojokey.time.sleep", lambda _: None)
    monkeypatch.setenv("JOJOKEY_API_KEY", "sk-test")
    monkeypatch.setattr("src.models.jojokey.OSSImageUploader", lambda *a, **k: object())
    with pytest.raises(RuntimeError, match="VideoCnBetaNotEnabled"):
        # A route given entirely by kwargs, with no catalog entry to supply an overseas id.
        JojoKeyVideoModel({}).generate(
            "a shot", str(tmp_path / "out.mp4"), model="not-in-the-catalog",
            line="cn", upstream_model="video-cn-2.0-mini", resolution="720p")


@pytest.mark.parametrize(
    "cn,usd,ready",
    [
        ({"enabled": False, "balance_cny": 1000.0}, 0.0, False),   # money, but the line is shut
        ({"enabled": True, "balance_cny": 0.0}, 0.0, False),       # open, but empty
        ({"enabled": True, "balance_cny": 1000.0}, 0.0, True),
        ({"enabled": False, "balance_cny": 0.0}, 12.5, True),      # overseas alone is enough
    ],
)
def test_account_status_reports_what_is_blocking(monkeypatch, cn, usd, ready):
    """`/v1/models` answers 200 for an account that cannot generate, so a green light there
    would be a lie. This is what the Settings connection test reports instead."""
    class _AccountRecorder(_Recorder):
        def get(self, url, headers=None, timeout=None):
            if url.endswith("/video-cn/me"):
                return _Response(payload={"currency": "CNY", **cn})
            if url.endswith("/me"):
                return _Response(payload={"spendable_usd": usd})
            return super().get(url, headers=headers, timeout=timeout)

    monkeypatch.setattr("src.models.jojokey.requests", _AccountRecorder())
    monkeypatch.setenv("JOJOKEY_API_KEY", "sk-test")
    status = JojoKeyVideoModel({}).account_status()
    assert status["ready"] is ready
    # A usable account reports nothing to fix, even about the line it is not using.
    assert bool(status["blockers"]) is not ready
    if not ready and not cn["enabled"]:
        assert any("未对该账号开放" in blocker for blocker in status["blockers"])


def test_every_tier_routes_to_a_distinct_upstream_model(recorder, tmp_path):
    """Three tiers that resolved to the same upstream model would price differently for
    identical output, which is the one way this ladder can be wrong and still work."""
    model = JojoKeyVideoModel({})
    routes = {tier: model._resolve_route(tier, {})
              for tier in ("seedance-2.0-mini-i2v", "seedance-2.0-fast-i2v", "seedance-2.0-i2v")}
    assert len(set(routes.values())) == 3, routes
    assert all(line == "cn" and dialect == "seedance" for line, _, dialect in routes.values())
    # MiniMax is the one family on the USD line, and the one that needs the other dialect.
    assert model._resolve_route("minimax/minimax-h3", {}) == ("overseas", "minimax-A", "minimax_a")


@pytest.mark.parametrize("key,expectation", [
    ("task-123", "task-123"),
    ("镜头一", None),                    # all non-ASCII: falls back to a bare hash
    ("shot-镜头一", None),                # mixed: keeps the ASCII run, appends a hash
])
def test_a_non_ascii_idempotency_key_does_not_lose_the_generation(recorder, tmp_path, key, expectation):
    """HTTP headers are latin-1, so a key with Chinese in it used to raise before the request
    left the process. The key is caller-supplied; losing a job to an encoding error is worse
    than reshaping the key."""
    JojoKeyVideoModel({}).generate(
        "a shot", str(tmp_path / f"out.mp4"), model="seedance-2.0-mini-t2v",
        resolution="720p", idempotency_key=key)
    sent = next(post["headers"]["Idempotency-Key"] for post in recorder.posts
                if post["url"].endswith("/videos"))
    assert sent.isascii() and sent
    if expectation:
        assert sent == expectation


def test_different_non_ascii_keys_stay_different(recorder, tmp_path):
    """Collapsing both to the same ASCII string would make two distinct jobs idempotent with
    each other, and the second would silently return the first one's video."""
    model = JojoKeyVideoModel({})
    keys = []
    for raw in ("镜头一", "镜头二"):
        model.generate("a shot", str(tmp_path / "out.mp4"), model="seedance-2.0-mini-t2v",
                       resolution="720p", idempotency_key=raw)
        keys.append(recorder.posts[-1]["headers"]["Idempotency-Key"])
    assert keys[0] != keys[1]


def test_a_local_storyboard_frame_is_uploaded_and_needs_no_object_storage(monkeypatch, tmp_path):
    """The reason this path exists.

    Registering a CN asset by URL needs a URL the vendor's upstream can fetch, which would
    have made our own object storage a hard prerequisite for every i2v and r2v shot — and
    production has none configured. Uploading the file sidesteps that: JojoKey stores it and
    hands back the handle.
    """
    frame = tmp_path / "frame.png"
    frame.write_bytes(b"\x89PNG\r\n\x1a\n" + b"0" * 64)

    class _UploadRecorder(_Recorder):
        def post(self, url, headers=None, json=None, timeout=None, files=None, data=None):
            if url.endswith("/video-cn/assets"):
                self.posts.append({"url": url, "headers": dict(headers or {}),
                                   "files": sorted((files or {}).keys()), "data": dict(data or {})})
                return _Response(payload={"id": "cnasset_1", "asset_url": "asset://uploaded",
                                          "sync_status": 2, "ready": True})
            return super().post(url, headers=headers, json=json, timeout=timeout)

    rec = _UploadRecorder()
    monkeypatch.setattr("src.models.jojokey.requests", rec)
    monkeypatch.setattr("src.models.jojokey.time.sleep", lambda _: None)
    monkeypatch.setenv("JOJOKEY_API_KEY", "sk-test")

    def _no_object_storage(*_args, **_kwargs):
        raise AssertionError("the CN line must not need our object storage for a local file")

    monkeypatch.setattr("src.models.jojokey.resolve_media_inputs", _no_object_storage)

    JojoKeyVideoModel({}).generate(
        "the character looks up", str(tmp_path / "out.mp4"), img_path=str(frame),
        model="seedance-2.0-i2v", generation_mode="i2v", resolution="720p")

    upload = next(post for post in rec.posts if post["url"].endswith("/video-cn/assets"))
    assert upload["files"] == ["file"]
    assert upload["data"]["asset_type"] == "1"                 # 1 = image
    # requests must set the multipart boundary itself, so we may not send a Content-Type.
    assert "Content-Type" not in upload["headers"]
    assert upload["headers"]["Idempotency-Key"].startswith("omni-asset:image:")
    assert _submit_body(rec)["content"][1]["image_url"]["url"] == "asset://uploaded"


def test_the_same_frame_is_uploaded_once_however_it_is_reached(monkeypatch, tmp_path):
    """Upload is billed per asset, and a storyboard points many shots at one reference. The
    key is a content hash, so two paths to the same bytes still pay once."""
    frame = tmp_path / "hero.png"
    frame.write_bytes(b"\x89PNG\r\n\x1a\n" + b"1" * 64)
    twin = tmp_path / "hero-copy.png"
    twin.write_bytes(frame.read_bytes())

    uploads: list[str] = []

    class _UploadRecorder(_Recorder):
        def post(self, url, headers=None, json=None, timeout=None, files=None, data=None):
            if url.endswith("/video-cn/assets"):
                uploads.append((headers or {}).get("Idempotency-Key", ""))
                return _Response(payload={"id": "a", "asset_url": "asset://uploaded",
                                          "sync_status": 2, "ready": True})
            return super().post(url, headers=headers, json=json, timeout=timeout)

    rec = _UploadRecorder()
    monkeypatch.setattr("src.models.jojokey.requests", rec)
    monkeypatch.setattr("src.models.jojokey.time.sleep", lambda _: None)
    monkeypatch.setenv("JOJOKEY_API_KEY", "sk-test")

    model = JojoKeyVideoModel({})
    for shot, path in enumerate((frame, twin, frame)):
        model.generate("a shot", str(tmp_path / f"out{shot}.mp4"), img_path=str(path),
                       model="seedance-2.0-i2v", generation_mode="i2v", resolution="720p")

    # Three shots, two distinct paths, one set of bytes: the vendor dedupes on the key.
    assert len(set(uploads)) == 1, uploads
