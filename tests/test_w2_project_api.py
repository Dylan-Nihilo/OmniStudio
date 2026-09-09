from __future__ import annotations

from pathlib import Path
import shutil
import subprocess
import wave
from unittest.mock import patch

import pytest

import src.apps.comic_gen.api as api_module
from src.apps.comic_gen.auth.service import AuthService
from src.apps.comic_gen.auth.settings import AuthSettings
from src.apps.comic_gen.models import Prop, VideoTask
from src.apps.comic_gen.pipeline import ComicGenPipeline
from src.storage.auth_repository import AuthRepository
from src.storage.errors import StorageError
from tests.auth_test_helpers import make_client


@pytest.fixture
def api_client(tmp_path, monkeypatch):
    """Run the real API against an isolated SQLite repository and auth service."""
    monkeypatch.chdir(tmp_path)
    with (
        patch("src.apps.comic_gen.pipeline.AssetGenerator"),
        patch("src.apps.comic_gen.pipeline.StoryboardGenerator"),
        patch("src.apps.comic_gen.pipeline.VideoGenerator"),
        patch("src.apps.comic_gen.pipeline.AudioGenerator"),
        patch("src.apps.comic_gen.pipeline.ExportManager"),
        patch.object(ComicGenPipeline, "_warmup_demucs_model", return_value=None),
    ):
        isolated_pipeline = ComicGenPipeline(
            config={
                "storage": {
                    "db_path": str(tmp_path / "omni_studio.db"),
                    "legacy_projects_path": str(tmp_path / "projects.json"),
                    "legacy_series_path": str(tmp_path / "series.json"),
                    "auto_migrate": False,
                    "migration_mode": "off",
                }
            }
        )

    settings = AuthSettings(
        signing_secret="test-signing-secret-012345678901234567890123456789",
        access_ttl_seconds=900,
        refresh_ttl_seconds=7 * 86400,
        cookie_secure=False,
        allowed_origins=("http://testserver",),
        app_env="test",
    )
    service = AuthService(AuthRepository(isolated_pipeline.storage_engine), settings)

    previous_pipeline = api_module.pipeline
    previous_media_root = api_module.MEDIA_PROJECT_ROOT
    previous_engine = api_module.app.state.storage_engine
    previous_service = api_module.app.state.auth_service
    previous_settings = api_module.app.state.auth_settings
    api_module.pipeline = isolated_pipeline
    api_module.MEDIA_PROJECT_ROOT = tmp_path.resolve()
    api_module.app.state.storage_engine = isolated_pipeline.storage_engine
    api_module.app.state.auth_service = service
    api_module.app.state.auth_settings = settings

    try:
        with make_client(api_module.app, local=True) as client:
            setup = client.post(
                "/auth/setup",
                json={
                    "username": "owner",
                    "email": "owner@example.com",
                    "password": "correct horse battery staple",
                },
            )
            assert setup.status_code == 201, setup.text
            yield client
    finally:
        api_module.pipeline = previous_pipeline
        api_module.MEDIA_PROJECT_ROOT = previous_media_root
        api_module.app.state.storage_engine = previous_engine
        api_module.app.state.auth_service = previous_service
        api_module.app.state.auth_settings = previous_settings
        isolated_pipeline.storage_engine.dispose()


def _create_project(client, title: str) -> dict:
    response = client.post(
        "/projects?skip_analysis=true",
        json={"title": title, "text": f"{title}正文"},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _create_series(client, title: str = "系列项目") -> dict:
    response = client.post("/series", json={"title": title})
    assert response.status_code == 200, response.text
    return response.json()


def test_sfx_preview_apply_and_revert_round_trip_over_http(api_client):
    project = _create_project(api_client, "SFX confirmation")
    route = f"/projects/{project['id']}"
    frame = api_client.post(route + "/frames", json={"action_description": "Door slams"}).json()["frames"][0]
    stored = api_module.pipeline.scripts[project["id"]].frames[0]
    stored.sfx_url = "audio/sfx-old.wav"
    stored.sfx_fingerprint = "old"

    def generate_preview(target):
        from src.apps.comic_gen.audio import _compute_sfx_fingerprint
        target.preview_sfx_url = "audio/sfx-preview.wav"
        target.preview_sfx_fingerprint = _compute_sfx_fingerprint(target.action_description, target.video_url)

    api_module.pipeline.audio_generator.generate_sfx_preview.side_effect = generate_preview
    api_module.pipeline._save_data()

    preview = api_client.post(route + f"/frames/{frame['id']}/sfx/preview")
    assert preview.status_code == 200, preview.text
    preview_frame = preview.json()["frames"][0]
    assert preview_frame["sfx_url"] == "audio/sfx-old.wav"
    assert preview_frame["preview_sfx_url"] == "audio/sfx-preview.wav"

    applied = api_client.post(route + f"/frames/{frame['id']}/sfx/apply")
    assert applied.status_code == 200, applied.text
    assert applied.json()["frames"][0]["sfx_url"] == "audio/sfx-preview.wav"
    assert applied.json()["frames"][0]["preview_sfx_url"] is None

    api_client.post(route + f"/frames/{frame['id']}/sfx/preview")
    reverted = api_client.delete(route + f"/frames/{frame['id']}/sfx/preview")
    assert reverted.status_code == 200, reverted.text
    assert reverted.json()["frames"][0]["sfx_url"] == "audio/sfx-preview.wav"
    assert reverted.json()["frames"][0]["preview_sfx_url"] is None


def test_video_export_request_persists_real_merge_settings(api_client):
    project = _create_project(api_client, "Export settings contract")
    script = api_module.pipeline.scripts[project["id"]]
    captured = {}

    def fake_merge(script_id):
        captured.update(api_module.pipeline.scripts[script_id].export_settings or {})
        api_module.pipeline.scripts[script_id].merged_video_url = "video/merged.mp4"
        return api_module.pipeline.scripts[script_id]

    with patch.object(api_module, "_create_production_item", return_value=None), patch.object(api_module.pipeline, "merge_videos", side_effect=fake_merge):
        response = api_client.post(f"/projects/{project['id']}/export", json={"resolution": "720p", "format": "mp4", "subtitles": "soft"})
    assert response.status_code == 200, response.text
    assert captured["resolution"] == "1280x720"
    assert captured["subtitles"] == "soft"


def test_merge_endpoint_rejects_failed_precheck_before_dispatch(api_client):
    project = _create_project(api_client, "Merge precheck guard")
    with patch.object(
        api_module.pipeline,
        "precheck_merge",
        return_value={
            "ok": False,
            "errors": ["not enough disk space"],
            "missing": [],
            "unreadable": [],
            "no_video_available": [],
            "disk": {"sufficient": False},
        },
    ), patch.object(api_module, "_create_production_item", return_value=None), patch.object(api_module.pipeline, "merge_videos") as merge:
        response = api_client.post(f"/projects/{project['id']}/merge")

    assert response.status_code == 400, response.text
    assert "precheck" in response.json()["detail"].lower()
    merge.assert_not_called()


@pytest.mark.parametrize("invalid", ["missing", "duplicate", "unknown"])
def test_reordering_frames_rejects_incomplete_or_repeated_ids_without_losing_shots(api_client, invalid):
    project = _create_project(api_client, "Storyboard order")
    route = f"/projects/{project['id']}"
    for text in ["First shot", "Second shot", "Third shot"]:
        response = api_client.post(route + "/frames", json={"action_description": text})
        assert response.status_code == 200, response.text
    before = api_client.get(route).json()["frames"]
    ids = [frame["id"] for frame in before]
    requested = {"missing": ids[:2], "duplicate": [ids[0], ids[0], ids[2]], "unknown": [ids[0], ids[1], "unknown-frame"]}[invalid]
    response = api_client.put(route + "/frames/reorder", json={"frame_ids": requested})
    assert response.status_code == 400, response.text
    assert api_client.get(route).json()["frames"] == before
    response = api_client.put(route + "/frames/reorder", json={"frame_ids": ids[::-1]})
    assert response.status_code == 200, response.text
    assert api_client.get(route).json()["frames"] == before[::-1]


@pytest.mark.parametrize("operation", ["add", "copy", "delete"])
def test_frame_structure_save_failure_preserves_memory_and_retry_round_trips(api_client, operation):
    project = _create_project(api_client, "Frame structure save recovery")
    route = f"/projects/{project['id']}"
    for text in ["First shot", "Second shot"]:
        assert api_client.post(route + "/frames", json={"action_description": text}).status_code == 200
    before = api_client.get(route).json()["frames"]
    first, second = [frame["id"] for frame in before]
    method = api_client.delete if operation == "delete" else api_client.post
    endpoint = route + {"add": "/frames", "copy": "/frames/copy", "delete": f"/frames/{first}"}[operation]
    kwargs = {} if operation == "delete" else {"json": {"insert_at": 1, **({"frame_id": first} if operation == "copy" else {"action_description": "Inserted shot"})}}
    with patch.object(api_module.pipeline.repository, "save_scripts", side_effect=StorageError("simulated write failure")):
        failed = method(endpoint, **kwargs)
    assert failed.status_code == 500, failed.text
    # Inspect memory before GET reloads it, so an unsuccessful write cannot leak into a later save.
    assert [frame.model_dump(mode="json") for frame in api_module.pipeline.scripts[project["id"]].frames] == before
    assert api_client.get(route).json()["frames"] == before
    response = method(endpoint, **kwargs)
    assert response.status_code == 200, response.text
    api_module.pipeline.scripts = api_module.pipeline.repository.load_scripts()
    saved = api_client.get(route).json()["frames"]
    assert saved == response.json()["frames"]
    if operation == "delete":
        assert [frame["id"] for frame in saved] == [second]
    else:
        assert len(saved) == 3 and saved[0] == before[0] and saved[2] == before[1]
        assert saved[1]["id"] not in [first, second]
        assert saved[1]["action_description"] == ("First shot" if operation == "copy" else "Inserted shot")


@pytest.mark.parametrize("operation", ["add", "copy", "delete"])
def test_frame_structure_rejects_invalid_targets_without_mutating_sequence(api_client, operation):
    project = _create_project(api_client, "Frame structure validation")
    route = f"/projects/{project['id']}"
    before = api_client.post(route + "/frames", json={"action_description": "Keep this shot"}).json()["frames"]
    if operation == "delete":
        response = api_client.delete(route + "/frames/unknown-frame")
        assert response.status_code == 404, response.text
    else:
        for position in [-1, 2]:
            payload = {"insert_at": position}
            if operation == "copy":
                payload["frame_id"] = before[0]["id"]
            response = api_client.post(route + ("/frames/copy" if operation == "copy" else "/frames"), json=payload)
            assert response.status_code == 400, response.text
    assert api_client.get(route).json()["frames"] == before


def test_copied_frame_keeps_content_and_media_without_borrowing_generation_jobs(api_client):
    from src.apps.comic_gen.models import GenerationStatus

    project = _create_project(api_client, "Copy generation ownership")
    route = f"/projects/{project['id']}"
    api_client.post(route + "/frames", json={"action_description": "Keep this shot"})
    source = api_module.pipeline.scripts[project["id"]].frames[0]
    source.t2i_image_urls = ["output/storyboard/existing.png"]
    source.audio_url = "output/audio/existing.wav"
    source.dialogue_snapshot_text = "A saved line"
    source.composition_data = {"layers": [{"label": "Original"}]}
    source.selected_video_id = source.final_take_id = "source-take"
    source.is_video_pinned = source.locked = True
    source.status = GenerationStatus.PROCESSING
    for channel in ["image", "audio", "dub"]:
        setattr(source, f"{channel}_generation_status", GenerationStatus.PROCESSING)
        setattr(source, f"{channel}_generation_id", f"source-{channel}")
        setattr(source, f"{channel}_error", "Old error")
    source.preview_video_url = "output/video/preview.mp4"
    source.preview_video_task_id = "source-take"
    source.dubbed_video_url = "output/video/applied.mp4"
    source.dubbed_video_task_id = "source-take"
    api_module.pipeline._save_data()
    before = api_client.get(route).json()["frames"][0]
    response = api_client.post(route + "/frames/copy", json={"frame_id": source.id})
    assert response.status_code == 200, response.text
    copied = response.json()["frames"][1]
    for channel in ["image", "audio", "dub"]:
        assert copied[f"{channel}_generation_status"] is None
        assert copied[f"{channel}_generation_id"] is None
        assert copied[f"{channel}_error"] is None
    assert copied["status"] == "pending"
    assert copied["selected_video_id"] is None and copied["final_take_id"] is None
    assert copied["is_video_pinned"] is False and copied["locked"] is False
    assert copied["preview_video_url"] is None and copied["dubbed_video_url"] is None
    for field in ["action_description", "composition_data", "t2i_image_urls", "audio_url", "dialogue_snapshot_text"]:
        assert copied[field] == before[field]
    original_model, copy_model = api_module.pipeline.scripts[project["id"]].frames
    copy_model.composition_data["layers"][0]["label"] = "Changed copy"
    assert original_model.composition_data["layers"][0]["label"] == "Original"
    restored = api_client.get(route).json()["frames"]
    assert restored[0] == before and restored[1] == copied


@pytest.fixture
def dub_project(api_client):
    from src.apps.comic_gen.audio import _compute_dialogue_hash
    from src.apps.comic_gen.models import Character
    from src.utils.system_check import get_ffmpeg_path

    project = _create_project(api_client, "Local dubbing")
    route = f"/projects/{project['id']}"
    frame = api_client.post(route + "/frames", json={"scene_id": "", "action_description": "Original"}).json()["frames"][0]
    video = Path("output/video/source.mp4")
    video.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([get_ffmpeg_path(), "-v", "error", "-f", "lavfi", "-i", "color=c=navy:s=160x90:r=10", "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(video)], check=True, capture_output=True)
    audio = Path("output/audio/voice.wav")
    audio.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(audio), "wb") as wav:
        wav.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
        wav.writeframes(b"\x10\x00" * 8000)
    shutil.copyfile(video, video.parent / "old-dub.mp4")
    script = api_module.pipeline.scripts[project["id"]]
    script.characters = [Character(id="speaker", name="Speaker", description="", voice_id="voice")]
    script.frames[0].character_ids = ["speaker"]
    script.frames[0].dialogue = "Current dialogue"
    script.frames[0].dialogue_voice_id = "voice"
    script.frames[0].dialogue_snapshot_text = "Current dialogue"
    script.frames[0].dialogue_text_hash = _compute_dialogue_hash("Current dialogue", "voice", None)
    script.frames[0].audio_url = "audio/voice.wav"
    script.frames[0].selected_video_id = "take"
    script.frames[0].dubbed_video_url = "video/old-dub.mp4"
    script.frames[0].dubbed_video_task_id = "take"
    script.video_tasks = [VideoTask(id="take", project_id=project["id"], frame_id=frame["id"], image_url="", prompt="Local video", status="completed", video_url="video/source.mp4", model="wan2.7-r2v")]
    api_module.pipeline._save_data()
    return route, frame["id"]


@pytest.mark.parametrize("cached_background", [False, True])
def test_dub_preview_survives_project_reads_and_keeps_media_through_apply_and_revert(api_client, dub_project, cached_background):
    from src.utils.system_check import get_ffprobe_path

    route, fid = dub_project
    if cached_background:
        frame = api_module.pipeline.scripts[route.split('/')[-1]].frames[0]
        frame.bg_audio_url = "audio/voice.wav"
        frame.bg_audio_source_video = "video/source.mp4"
        api_module.pipeline._save_data()
    original_run = subprocess.run
    def render_with_read(command, **kwargs):
        result = original_run(command, **kwargs)
        if str(command[-1]).endswith(".mp4") and "preview_" in str(command[-1]):
            assert api_client.get(route).json()["frames"][0]["dub_generation_status"] == "processing"
            assert api_client.post(route + f"/frames/{fid}/dub/preview", json={"video_task_id": "take"}).status_code == 409
            assert api_client.post(route + f"/frames/{fid}/dub/apply").status_code == 409
            api_client.post(route + "/frames/update", json={"frame_id": fid, "action_description": "Edited during preview"})
        return result

    with patch("src.apps.comic_gen.pipeline.subprocess.run", side_effect=render_with_read):
        response = api_client.post(route + f"/frames/{fid}/dub/preview", json={"video_task_id": "take", "offset_ms": 150})
    assert response.status_code == 200, response.text
    preview_url = response.json()["frames"][0]["preview_video_url"]
    assert preview_url
    api_module.pipeline.scripts = api_module.pipeline.repository.load_scripts()
    frame = api_client.get(route).json()["frames"][0]
    assert frame["preview_video_url"] == preview_url
    assert frame["action_description"] == "Edited during preview"
    assert frame["preview_audio_url"] == "audio/voice.wav"
    assert frame["preview_video_task_id"] == "take"
    assert frame["dubbed_video_task_id"] == "take"
    probe = original_run([get_ffprobe_path(), "-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", str(Path("output", preview_url))], capture_output=True, text=True, check=True)
    assert {"audio", "video"} <= set(probe.stdout.split())
    applied = api_client.post(route + f"/frames/{fid}/dub/apply")
    assert applied.status_code == 200, applied.text
    assert applied.json()["frames"][0]["dubbed_video_url"] == preview_url
    assert Path("output/video/old-dub.mp4").exists()
    reverted = api_client.delete(route + f"/frames/{fid}/dub")
    assert reverted.status_code == 200, reverted.text
    assert reverted.json()["frames"][0]["dubbed_video_url"] is None
    assert Path("output", preview_url).exists()


@pytest.mark.parametrize("operation", ["preview", "apply", "revert"])
def test_dub_storage_failure_keeps_selection_and_files_and_can_retry(api_client, dub_project, operation):
    route, fid = dub_project
    dub = route + f"/frames/{fid}/dub"
    assert api_client.post(dub + "/preview", json={"video_task_id": "take"}).status_code == 200
    previous = api_client.get(route).json()["frames"][0]
    save = api_module.pipeline._save_data
    failed = False
    def fail_once():
        nonlocal failed
        frame = api_module.pipeline.scripts[route.split('/')[-1]].frames[0]
        if not failed and (operation != "preview" or frame.preview_video_url != previous["preview_video_url"]):
            failed = True
            raise StorageError("Dub storage unavailable")
        save()
    def send():
        if operation == "revert":
            return api_client.delete(dub)
        return api_client.post(dub + "/" + operation, json={"video_task_id": "take", "offset_ms": 250} if operation == "preview" else None)
    with patch.object(api_module.pipeline, "_save_data", side_effect=fail_once):
        response = send()
    assert failed and response.status_code == 500, response.text
    api_module.pipeline.scripts = api_module.pipeline.repository.load_scripts()
    restored = api_client.get(route).json()["frames"][0]
    for field in ("preview_video_url", "preview_audio_url", "preview_video_task_id", "preview_source_video_url", "preview_offset_ms", "dubbed_video_url", "dubbed_video_task_id", "dub_offset_ms"):
        assert restored[field] == previous[field], field
    assert Path("output", previous["preview_video_url"]).exists()
    assert Path("output", previous["dubbed_video_url"]).exists()
    retry = send()
    assert retry.status_code == 200, retry.text


@pytest.mark.parametrize("changed", ["audio", "video", "selection"])
def test_dub_rejects_a_preview_whose_source_changed(api_client, dub_project, changed):
    route, fid = dub_project
    dub = route + f"/frames/{fid}/dub"
    assert api_client.post(dub + "/preview", json={"video_task_id": "take"}).status_code == 200
    script = api_module.pipeline.scripts[route.split('/')[-1]]
    if changed == "audio":
        shutil.copyfile("output/audio/voice.wav", "output/audio/new-voice.wav")
        script.frames[0].audio_url = "audio/new-voice.wav"
    elif changed == "video":
        shutil.copyfile("output/video/source.mp4", "output/video/new-source.mp4")
        script.video_tasks[0].video_url = "video/new-source.mp4"
    else:
        script.frames[0].selected_video_id = "different-take"
    api_module.pipeline._save_data()
    response = api_client.post(dub + "/apply")
    assert response.status_code == 400, response.text
    assert "preview" in response.json()["detail"].lower()
    assert api_client.get(route).json()["frames"][0]["dubbed_video_url"] == "video/old-dub.mp4"


@pytest.mark.parametrize("outcome", ["failed", "deleted", "wrong-frame"])
def test_dub_preview_failure_keeps_existing_media(api_client, dub_project, outcome):
    route, fid = dub_project
    dub = route + f"/frames/{fid}/dub"
    first = api_client.post(dub + "/preview", json={"video_task_id": "take"}).json()["frames"][0]
    original_run = subprocess.run
    def fail_render(command, **kwargs):
        if str(command[-1]).endswith(".mp4") and "preview_" in str(command[-1]):
            if outcome == "failed":
                Path(command[-1]).write_bytes(b"partial")
                raise subprocess.CalledProcessError(1, command, stderr=b"Controlled mux failure")
            api_client.delete(route + f"/frames/{fid}")
        return original_run(command, **kwargs)
    if outcome == "wrong-frame":
        api_module.pipeline.scripts[route.split('/')[-1]].video_tasks[0].frame_id = "different-frame"
        api_module.pipeline._save_data()
    with patch("src.apps.comic_gen.pipeline.subprocess.run", side_effect=fail_render):
        response = api_client.post(dub + "/preview", json={"video_task_id": "take"})
    assert response.status_code == {"failed": 500, "deleted": 404, "wrong-frame": 400}[outcome], response.text
    restored = api_client.get(route).json()["frames"]
    if outcome == "deleted":
        assert restored == []
    else:
        assert restored[0]["preview_video_url"] == first["preview_video_url"]
        assert restored[0]["dubbed_video_url"] == "video/old-dub.mp4"
    assert Path("output", first["preview_video_url"]).exists()
    assert Path("output/video/old-dub.mp4").exists()


@pytest.mark.parametrize("outcome", ["completed", "provider-error", "deleted"])
def test_first_frame_render_survives_project_refresh_and_keeps_candidate_history(api_client, outcome):
    from src.apps.comic_gen.storyboard import StoryboardGenerator

    project = _create_project(api_client, "First frame render")
    route = f"/projects/{project['id']}"
    frame_id = api_client.post(route + "/frames", json={"scene_id": "", "action_description": "Original prompt"}).json()["frames"][0]["id"]
    response = api_client.patch(route + f"/frames/{frame_id}/workbench", json={"t2i_image_urls": ["storyboard/previous.png"], "t2i_selected_index": 0})
    assert response.status_code == 200, response.text

    def generate(prompt, output_path, **kwargs):
        running = api_client.get(route).json()["frames"][0]
        assert running["image_generation_status"] == "processing"
        assert running["image_generation_id"]
        duplicate = api_client.post(route + "/storyboard/render", json={"frame_id": frame_id, "prompt": "Duplicate"})
        assert duplicate.status_code == 409, duplicate.text
        upload = api_client.post(route + f"/frames/{frame_id}/upload_t2i", files={"file": ("duplicate.png", b"image", "image/png")})
        assert upload.status_code == 409, upload.text
        assert list(Path("output/uploads").rglob("t2i_*.png")) == []
        edited = api_client.post(route + "/frames/update", json={"frame_id": frame_id, "action_description": "Edited while image was rendering"})
        assert edited.status_code == 200, edited.text
        if outcome == "provider-error":
            raise RuntimeError("Image provider unavailable")
        if outcome == "deleted":
            assert api_client.delete(route + f"/frames/{frame_id}").status_code == 200
        Path(output_path).write_bytes(b"image-provider-fixture")

    with patch("src.apps.comic_gen.storyboard.WanxImageModel") as model, patch("src.utils.oss_utils.OSSImageUploader") as uploader:
        model.return_value.generate.side_effect = generate
        uploader.return_value.is_configured = False
        api_module.pipeline.storyboard_generator = StoryboardGenerator()
        response = api_client.post(route + "/storyboard/render", json={"frame_id": frame_id, "prompt": "A station in the rain"})
    assert response.status_code == {"completed": 200, "provider-error": 500, "deleted": 404}[outcome], response.text
    api_module.pipeline.scripts = api_module.pipeline.repository.load_scripts()
    if outcome == "deleted":
        assert api_client.get(route).json()["frames"] == []
        return
    restored = api_client.get(route).json()["frames"][0]
    assert restored["image_generation_status"] == ("failed" if outcome == "provider-error" else "completed")
    if outcome == "provider-error":
        assert restored["status"] == "failed"
        assert restored["image_error"] == "Image provider unavailable"
        assert restored["t2i_image_urls"] == ["storyboard/previous.png"]
        assert restored["action_description"] == "Edited while image was rendering"
        return
    assert restored["status"] == "completed"
    assert restored["action_description"] == "Edited while image was rendering"
    assert restored["t2i_image_urls"] == ["storyboard/previous.png", restored["rendered_image_url"]]
    assert restored["t2i_selected_index"] == 1
    assert Path("output", restored["rendered_image_url"]).read_bytes() == b"image-provider-fixture"


def test_first_frame_start_storage_failure_does_not_dispatch_or_leave_a_pending_render(api_client):
    project = _create_project(api_client, "Image save failure")
    route = f"/projects/{project['id']}"
    frame = api_client.post(route + "/frames", json={"scene_id": "", "action_description": "Keep prompt"}).json()["frames"][0]
    with patch.object(api_module.pipeline.repository, "save_scripts", side_effect=StorageError("Unavailable")):
        response = api_client.post(route + "/storyboard/render", json={"frame_id": frame["id"], "prompt": "New image"})
    assert response.status_code == 500
    api_module.pipeline.storyboard_generator.generate_frame.assert_not_called()
    assert api_module.pipeline.scripts[project["id"]].frames[0].image_generation_status is None
    assert api_client.get(route).json()["frames"][0] == frame


def test_first_frame_restart_recovery_does_not_treat_audio_processing_as_image_generation(api_client):
    project = _create_project(api_client, "Image recovery")
    route = f"/projects/{project['id']}"
    for description in ("Interrupted image", "Running audio", "Interrupted dialogue"):
        api_client.post(route + "/frames", json={"scene_id": "", "action_description": description})
    frames = api_module.pipeline.scripts[project["id"]].frames
    frames[0].image_generation_status = "processing"
    frames[0].image_generation_id = "interrupted-image"
    frames[0].t2i_image_urls = ["previous.png"]
    frames[1].status = "processing"
    frames[2].audio_generation_status = "processing"
    frames[2].audio_generation_id = "interrupted-dialogue"
    frames[2].audio_url = "previous.mp3"
    frames[2].dub_generation_status = "processing"
    frames[2].preview_video_url = "video/previous-preview.mp4"
    api_module.pipeline._save_data()
    api_module.pipeline.scripts = api_module.pipeline.repository.load_scripts()
    api_module.pipeline._recover_orphan_tasks()
    restored = api_client.get(route).json()["frames"]
    assert restored[0]["image_generation_status"] == "failed"
    assert "restarted" in restored[0]["image_error"]
    assert restored[0]["t2i_image_urls"] == ["previous.png"]
    assert restored[1]["status"] == "processing"
    assert restored[1]["image_generation_status"] is None
    assert restored[2]["audio_generation_status"] == "failed"
    assert "restarted" in restored[2]["audio_error"]
    assert restored[2]["audio_url"] == "previous.mp3"
    assert restored[2]["dub_generation_status"] == "failed"
    assert "restarted" in restored[2]["dub_error"]
    assert restored[2]["preview_video_url"] == "video/previous-preview.mp4"


def test_first_frame_upload_reports_storage_failure_and_can_retry(api_client):
    project = _create_project(api_client, "First frame upload")
    route = f"/projects/{project['id']}"
    frame_id = api_client.post(route + "/frames", json={"scene_id": "", "action_description": "Keep the first frame"}).json()["frames"][0]["id"]
    api_client.patch(route + f"/frames/{frame_id}/workbench", json={"t2i_image_urls": ["previous.png"], "t2i_selected_index": 0})
    frame = api_module.pipeline.scripts[project["id"]].frames[0]
    frame.image_generation_status = "failed"
    frame.image_generation_id = "previous-failure"
    frame.image_error = "Previous generation failed"
    api_module.pipeline._save_data()
    before = api_client.get(route).json()["frames"][0]
    files = {"file": ("first-frame.png", b"upload-fixture", "image/png")}
    with patch.object(api_module.pipeline.repository, "save_scripts", side_effect=StorageError("Upload storage unavailable")):
        response = api_client.post(route + f"/frames/{frame_id}/upload_t2i", files=files)
    assert response.status_code == 500, response.text
    assert api_client.get(route).json()["frames"][0] == before
    assert list(Path("output/uploads").glob("t2i_*.png")) == []
    response = api_client.post(route + f"/frames/{frame_id}/upload_t2i", files=files)
    assert response.status_code == 200, response.text
    uploaded = response.json()
    assert uploaded["status"] == "completed"
    assert uploaded["image_error"] is None
    assert uploaded["image_generation_status"] is None
    assert uploaded["t2i_image_urls"][0] == "previous.png"
    assert Path("output", uploaded["t2i_image_urls"][1]).read_bytes() == b"upload-fixture"
    api_module.pipeline.scripts = api_module.pipeline.repository.load_scripts()
    assert api_client.get(route).json()["frames"][0]["t2i_image_urls"] == uploaded["t2i_image_urls"]


@pytest.mark.parametrize("outcome", ["completed", "failed", "deleted"])
def test_dialogue_generation_saves_the_current_frame_and_preserves_previous_audio(api_client, outcome):
    from src.apps.comic_gen.audio import AudioGenerator
    from src.apps.comic_gen.models import Character, DialogueStructured

    project = _create_project(api_client, "Dialogue workbench")
    route = f"/projects/{project['id']}"
    frame_id = api_client.post(route + "/frames", json={"scene_id": "", "action_description": "Original"}).json()["frames"][0]["id"]
    script = api_module.pipeline.scripts[project["id"]]
    script.characters = [Character(id="silent", name="Silent", description=""), Character(id="speaker", name="Speaker", description="", voice_id="test-voice")]
    frame = script.frames[0]
    frame.character_ids = ["silent", "speaker"]
    frame.dialogue = "Old dialogue"
    frame.dialogue_structured = DialogueStructured(speaker="Speaker", line="Old dialogue")
    old_url = f"audio/dialogue/{frame_id}.mp3"
    frame.audio_url = old_url
    old_file = Path("output", old_url)
    old_file.parent.mkdir(parents=True, exist_ok=True)
    old_file.write_bytes(b"previous-audio")
    api_module.pipeline._save_data()
    edited = api_client.post(route + "/frames/update", json={"frame_id": frame_id, "dialogue": "New dialogue"})
    assert edited.status_code == 200
    assert edited.json()["frames"][0]["dialogue_structured"]["line"] == "New dialogue"

    def synthesize(text, output_path, **kwargs):
        assert text == "New dialogue"
        assert kwargs["voice"] == "test-voice"
        assert kwargs["instructions"] == ""
        assert api_client.get(route).status_code == 200
        assert api_client.post(route + f"/frames/{frame_id}/audio", json={}).status_code == 409
        api_client.post(route + "/frames/update", json={"frame_id": frame_id, "action_description": "New writing", "dialogue": "Later dialogue"})
        Path(output_path).write_bytes(b"new-audio")
        if outcome == "failed":
            raise RuntimeError("TTS unavailable")
        if outcome == "deleted":
            api_client.delete(route + f"/frames/{frame_id}")

    with patch("src.apps.comic_gen.audio.TTSProcessor") as processor:
        processor.return_value.synthesize.side_effect = synthesize
        api_module.pipeline.audio_generator = AudioGenerator()
        response = api_client.post(route + f"/frames/{frame_id}/audio", json={"instructions": ""})
    assert response.status_code == {"completed": 200, "failed": 502, "deleted": 404}[outcome], response.text
    assert old_file.read_bytes() == b"previous-audio"
    api_module.pipeline.scripts = api_module.pipeline.repository.load_scripts()
    restored = api_client.get(route).json()["frames"]
    if outcome == "deleted":
        assert restored == []
        return
    assert restored[0]["dialogue_structured"]["line"] == "Later dialogue"
    assert restored[0]["action_description"] == "New writing"
    if outcome == "failed":
        assert "TTS unavailable" in restored[0]["audio_error"]
        assert restored[0]["audio_url"] == old_url
    else:
        assert restored[0]["dialogue_snapshot_text"] == "New dialogue"
        assert restored[0]["dialogue_voice_id"] == "test-voice"
        assert restored[0]["audio_url"] != old_url
        assert Path("output", restored[0]["audio_url"]).read_bytes() == b"new-audio"


@pytest.mark.parametrize("outcome", ["completed", "edited", "failed_save"])
def test_storyboard_analysis_persists_current_project_and_protects_existing_shots(api_client, outcome):
    project = _create_project(api_client, "Storyboard replacement")
    route = f"/projects/{project['id']}"
    frame_id = api_client.post(route + "/frames", json={"scene_id": "", "action_description": "Keep the original"}).json()["frames"][0]["id"]
    def analyze(*args, **kwargs):
        # GET reloads the current Script object from SQLite during the LLM call.
        running = api_client.get(route).json()
        assert running["frames"][0]["id"] == frame_id
        if outcome == "edited":
            api_client.post(route + "/frames/update", json={"frame_id": frame_id, "action_description": "A newer manual edit"})
        return [{"action_summary": "New generated shot", "dialogue": "New line"}]
    persist = api_module.pipeline._save_data
    def save():
        current = api_module.pipeline.scripts[project["id"]]
        if outcome == "failed_save" and current.frames[0].id != frame_id:
            raise StorageError("Cannot persist new shots")
        persist()
    with patch.object(api_module.pipeline.script_processor, "analyze_to_storyboard", side_effect=analyze), patch.object(api_module.pipeline, "_save_data", side_effect=save):
        response = api_client.post(route + "/storyboard/analyze", json={"text": "A sufficiently detailed scene about a radio operator listening for a signal."})
    assert response.status_code == {"completed": 200, "edited": 409, "failed_save": 500}[outcome], response.text
    restored = api_client.get(route).json()
    assert restored["frames"][0]["action_description"] == {"completed": "New generated shot", "edited": "A newer manual edit", "failed_save": "Keep the original"}[outcome]
    assert restored["storyboard_generation"]["status"] == ("completed" if outcome == "completed" else "failed")


@pytest.mark.parametrize("outcome", ["completed", "edited", "empty"])
def test_storyboard_refinement_saves_after_readback_and_rejects_stale_output(api_client, outcome):
    project = _create_project(api_client, "Refinement result")
    route = f"/projects/{project['id']}"
    fid = api_client.post(route + "/frames", json={"scene_id": "", "action_description": "Original action"}).json()["frames"][0]["id"]
    def refine(*args, **kwargs):
        assert api_client.get(route).status_code == 200
        if outcome == "edited":
            api_client.post(route + "/frames/update", json={"frame_id": fid, "action_description": "Newer manual action"})
        return None if outcome == "empty" else {"visual_description": "Detailed new composition", "shot_size": "close-up"}
    with patch.object(api_module.pipeline.script_processor, "refine_frame_to_rich", side_effect=refine):
        response = api_client.post(route + f"/frames/{fid}/refine")
    assert response.status_code == {"completed": 200, "edited": 409, "empty": 500}[outcome], response.text
    frame = api_client.get(route).json()["frames"][0]
    assert frame["visual_description"] == ("Detailed new composition" if outcome == "completed" else None)
    assert frame["action_description"] == ("Newer manual action" if outcome == "edited" else "Original action")


def test_storyboard_batch_refinement_persists_partial_results_and_retries_selected_frames(api_client):
    project = _create_project(api_client, "Batch refinement")
    route = f"/projects/{project['id']}"
    for text in ("First action", "Second action"):
        api_client.post(route + "/frames", json={"scene_id": "", "action_description": text})
    ids = [f["id"] for f in api_client.get(route).json()["frames"]]
    calls = []
    fail_second = True
    def refine(coarse, *args):
        calls.append(coarse["action_summary"])
        running = api_client.get(route).json()
        assert running["storyboard_generation"]["status"] == "processing"
        assert api_client.post(route + "/storyboard/refine_batch").status_code == 409
        if coarse["action_summary"] == "Second action" and fail_second:
            return None
        return {"visual_description": coarse["action_summary"] + " in detail"}
    with patch.object(api_module.pipeline.script_processor, "refine_frame_to_rich", side_effect=refine):
        response = api_client.post(route + "/storyboard/refine_batch")
        assert response.status_code == 200, response.text
        assert '"failed": 1' in response.text
        restored = api_client.get(route).json()
        assert restored["storyboard_generation"]["results"] == {ids[0]: "completed", ids[1]: "failed"}
        assert restored["frames"][0]["visual_description"] == "First action in detail"
        fail_second = False
        retry = api_client.post(route + "/storyboard/refine_batch", json={"frame_ids": [ids[1]]})
        assert retry.status_code == 200, retry.text
        assert '"failed": 0' in retry.text
    assert calls == ["First action", "Second action", "Second action"]
    assert api_client.get(route).json()["frames"][0]["visual_description"] == "First action in detail"


def test_dialogue_batch_recovers_partial_results_and_resolves_inherited_voices(api_client):
    from src.apps.comic_gen.audio import AudioGenerator
    from src.apps.comic_gen.models import Character, DialogueStructured

    project = _create_project(api_client, "Batch dialogue")
    route = f"/projects/{project['id']}"
    series = _create_series(api_client)
    _add_episode(api_client, series["id"], project["id"], 1)
    api_module.pipeline.series_store[series["id"]].characters = [Character(id="voice", name="Speaker", description="", voice_id="inherited-voice")]
    api_module.pipeline._save_series_data()
    for line in ("First dialogue", "Second dialogue", "Unbound dialogue"):
        api_client.post(route + "/frames", json={"scene_id": "", "action_description": line})
    script = api_module.pipeline.scripts[project["id"]]
    for index, frame in enumerate(script.frames):
        frame.dialogue = ("First dialogue", "Second dialogue", "Unbound dialogue")[index]
        frame.dialogue_structured = DialogueStructured(speaker="Speaker" if index < 2 else "Unbound", line=frame.dialogue)
        frame.character_ids = ["voice"] if index < 2 else []
    api_module.pipeline._save_data()
    ids = [frame.id for frame in script.frames]
    calls = []
    fail_second = True
    def synthesize(text, output_path, **kwargs):
        calls.append(text)
        assert kwargs["voice"] == "inherited-voice"
        assert kwargs["instructions"] == "whisper"
        running = api_client.get(route).json()
        assert running["dialogue_audio_batch"]["status"] == "processing"
        assert running["characters"][0]["voice_id"] == "inherited-voice"
        assert api_client.post(route + "/dialogue_audio/batch").status_code == 409
        api_client.post(route + "/frames/update", json={"frame_id": ids[0], "action_description": "New writing"})
        if text == "Second dialogue" and fail_second:
            raise RuntimeError("One voice failed")
        Path(output_path).write_bytes(b"valid-audio")
    with patch("src.apps.comic_gen.audio.TTSProcessor") as processor:
        processor.return_value.synthesize.side_effect = synthesize
        api_module.pipeline.audio_generator = AudioGenerator()
        response = api_client.post(route + "/dialogue_audio/batch", json={"instructions": {ids[0]: "whisper", ids[1]: "whisper"}})
        assert response.status_code == 200, response.text
        assert response.json()["_batch_stats"] == {"generated": 1, "skipped": 0, "failed": 1, "no_voice": 1, "busy": 0}
        api_module.pipeline.scripts = api_module.pipeline.repository.load_scripts()
        restored = api_client.get(route).json()
        assert restored["dialogue_audio_batch"]["results"] == {ids[0]: "generated", ids[1]: "failed", ids[2]: "no_voice"}
        assert restored["frames"][0]["action_description"] == "New writing"
        first_url = restored["frames"][0]["audio_url"]
        fail_second = False
        retry = api_client.post(route + "/dialogue_audio/batch", json={"instructions": {ids[1]: "whisper"}})
    assert retry.status_code == 200, retry.text
    assert retry.json()["_batch_stats"] == {"generated": 1, "skipped": 1, "failed": 0, "no_voice": 1, "busy": 0}
    assert calls == ["First dialogue", "Second dialogue", "Second dialogue"]
    assert api_client.get(route).json()["frames"][0]["audio_url"] == first_url



def test_dialogue_batch_preserves_progress_on_restart_and_failed_storage(api_client):
    from src.apps.comic_gen.models import Character, DialogueAudioBatch, GenerationStatus
    project = _create_project(api_client, "Interrupted dialogue batch")
    route = f"/projects/{project['id']}"
    api_client.post(route + "/frames", json={"scene_id": "", "action_description": "Keep this shot"})
    script = api_module.pipeline.scripts[project["id"]]
    frame = script.frames[0]
    frame.dialogue = "Keep this line"
    frame.character_ids = ["speaker"]
    frame.audio_url = "audio/previous.mp3"
    frame.audio_generation_status = GenerationStatus.PROCESSING
    script.characters = [Character(id="speaker", name="Speaker", description="", voice_id="test-voice")]
    api_module.pipeline._save_data()
    for instructions in ({"foreign-frame": "whisper"}, {frame.id: "x" * 257}):
        assert api_client.post(route + "/dialogue_audio/batch", json={"instructions": instructions}).status_code == 400
    with patch.object(api_module.pipeline, "generate_dialogue_line") as generate:
        response = api_client.post(route + "/dialogue_audio/batch")
        assert response.status_code == 200, response.text
        assert response.json()["_batch_stats"]["busy"] == 1
        generate.assert_not_called()
    previous = api_client.get(route).json()["dialogue_audio_batch"]
    with patch.object(api_module.pipeline, "_save_data", side_effect=StorageError("Storage unavailable")):
        assert api_client.post(route + "/dialogue_audio/batch").status_code == 500
    assert api_module.pipeline.scripts[script.id].dialogue_audio_batch.model_dump() == previous
    running = api_module.pipeline.scripts[script.id]
    running.dialogue_audio_batch = DialogueAudioBatch(id="interrupted", frame_ids=[frame.id], results={frame.id: "busy"}, instructions={frame.id: "whisper"})
    api_module.pipeline._save_data()
    api_module.pipeline.scripts = api_module.pipeline.repository.load_scripts()
    api_module.pipeline._recover_orphan_tasks()
    restored = api_client.get(route).json()
    assert restored["dialogue_audio_batch"]["status"] == "failed"
    assert restored["dialogue_audio_batch"]["instructions"] == {frame.id: "whisper"}
    assert restored["dialogue_audio_batch"]["results"] == {frame.id: "busy"}
    assert restored["frames"][0]["audio_url"] == "audio/previous.mp3"
    assert restored["frames"][0]["audio_generation_status"] == "failed"


@pytest.mark.parametrize("failing_save", [2, 3])
def test_dialogue_batch_progress_failure_is_persisted_without_losing_old_media(api_client, failing_save):
    project = _create_project(api_client, "Batch persistence failure")
    route = f"/projects/{project['id']}"
    api_client.post(route + "/frames", json={"scene_id": "", "action_description": "A shot"})
    frame = api_module.pipeline.scripts[project["id"]].frames[0]
    frame.dialogue = "A line without a voice binding"
    frame.audio_url = "audio/keep.mp3"
    api_module.pipeline._save_data()
    persist = api_module.pipeline._save_data
    calls = 0
    def save():
        nonlocal calls
        calls += 1
        if calls == failing_save:
            raise StorageError("Progress write failed")
        persist()
    with patch.object(api_module.pipeline, "_save_data", side_effect=save):
        response = api_client.post(route + "/dialogue_audio/batch")
    assert response.status_code == 500, response.text
    restored = api_client.get(route).json()
    assert restored["dialogue_audio_batch"]["status"] == "failed"
    assert "Progress write failed" in restored["dialogue_audio_batch"]["error"]
    assert restored["dialogue_audio_batch"]["results"] == ({} if failing_save == 2 else {frame.id: "no_voice"})
    assert restored["frames"][0]["audio_url"] == "audio/keep.mp3"


def _add_episode(client, series_id: str, script_id: str, episode_number: int) -> None:
    response = client.post(
        f"/series/{series_id}/episodes",
        json={"script_id": script_id, "episode_number": episode_number},
    )
    assert response.status_code == 200, response.text


def test_project_archive_restore_and_impact_preserve_production_data(api_client):
    project = _create_project(api_client, "项目生命周期")
    project_id = project["id"]

    impact = api_client.get(f"/projects/{project_id}/archive-impact")
    assert impact.status_code == 200, impact.text
    assert impact.json()["archived"] is False
    assert impact.json()["impact"]["episodes"] == 1
    assert "不会删除" in impact.json()["message"]

    archived = api_client.post(f"/projects/{project_id}/archive")
    assert archived.status_code == 200, archived.text
    assert archived.json()["archived"] is True
    assert archived.json()["impact"] == impact.json()["impact"]

    persisted = api_client.get(f"/projects/{project_id}")
    assert persisted.status_code == 200, persisted.text
    assert persisted.json()["archived"] is True

    restored = api_client.post(f"/projects/{project_id}/restore")
    assert restored.status_code == 200, restored.text
    assert restored.json()["archived"] is False
    assert restored.json()["archived_at"] is None


def test_project_title_update_does_not_reparse_script(api_client):
    project = _create_project(api_client, "原始标题")
    response = api_client.patch(
        f"/projects/{project['id']}",
        json={"title": "编辑后的标题"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["title"] == "编辑后的标题"
    loaded = api_client.get(f"/projects/{project['id']}")
    assert loaded.status_code == 200, loaded.text
    assert loaded.json()["title"] == "编辑后的标题"


def test_standalone_to_series_preview_and_confirm_preserve_episode(api_client):
    project = _create_project(api_client, "待转换项目")
    project_id = project["id"]

    preview = api_client.get(f"/projects/{project_id}/convert-to-series/preview")
    assert preview.status_code == 200, preview.text
    assert preview.json()["project_id"] == project_id
    assert preview.json()["episode_count"] == 1
    assert "video_tasks" in preview.json()["preserved_fields"]

    confirmed = api_client.post(
        f"/projects/{project_id}/convert-to-series",
        json={"title": "转换后的系列", "description": "保留原生产数据"},
    )
    assert confirmed.status_code == 200, confirmed.text
    payload = confirmed.json()
    assert payload["series"]["title"] == "转换后的系列"
    assert payload["series"]["episode_ids"] == [project_id]
    assert payload["episode"]["id"] == project_id
    assert payload["episode"]["series_id"] == payload["series"]["id"]
    assert payload["episode"]["episode_number"] == 1

    assert api_module.pipeline.repository.project_exists(project_id) is False
    series = api_client.get(f"/series/{payload['series']['id']}")
    assert series.status_code == 200, series.text
    assert [episode["id"] for episode in series.json()["episodes"]] == [project_id]

    repeated = api_client.get(f"/projects/{project_id}/convert-to-series/preview")
    assert repeated.status_code == 404


def test_episode_order_move_and_archive_api(api_client):
    series = _create_series(api_client, "Episode 生命周期")
    first = _create_project(api_client, "第一集")
    second = _create_project(api_client, "第二集")
    _add_episode(api_client, series["id"], first["id"], 1)
    _add_episode(api_client, series["id"], second["id"], 2)

    reordered = api_client.put(
        f"/series/{series['id']}/episodes/order",
        json={"episode_ids": [second["id"], first["id"]]},
    )
    assert reordered.status_code == 200, reordered.text
    episodes = api_client.get(f"/series/{series['id']}/episodes").json()
    assert [episode["id"] for episode in episodes] == [second["id"], first["id"]]
    assert [episode["episode_number"] for episode in episodes] == [1, 2]

    archived = api_client.post(f"/series/{series['id']}/episodes/{first['id']}/archive")
    assert archived.status_code == 200, archived.text
    assert api_client.get(f"/projects/{first['id']}").json()["archived"] is True
    blocked = api_client.post(f"/series/{series['id']}/episodes/{second['id']}/archive")
    assert blocked.status_code == 409, blocked.text

    restored = api_client.post(f"/series/{series['id']}/episodes/{first['id']}/restore")
    assert restored.status_code == 200, restored.text
    moved = api_client.post(
        f"/series/{series['id']}/episodes/{first['id']}/move",
        json={"target_index": 1},
    )
    assert moved.status_code == 200, moved.text


def test_series_and_episode_archive_are_independent_and_audited(api_client):
    series = _create_series(api_client, "项目与集归档分离")
    first = _create_project(api_client, "独立归档第一集")
    second = _create_project(api_client, "独立归档第二集")
    _add_episode(api_client, series["id"], first["id"], 1)
    _add_episode(api_client, series["id"], second["id"], 2)

    impact = api_client.get(f"/series/{series['id']}/archive-impact")
    assert impact.status_code == 200, impact.text
    assert impact.json()["impact"]["episodes"] == 2
    assert "不会归档或删除 Episode" in impact.json()["message"]

    archived_project = api_client.post(f"/series/{series['id']}/archive")
    assert archived_project.status_code == 200, archived_project.text
    assert archived_project.json()["archived"] is True
    assert api_client.get(f"/series/{series['id']}").json()["archived"] is True
    assert api_client.get(f"/projects/{first['id']}").json()["archived"] is False

    archived_episode = api_client.post(f"/series/{series['id']}/episodes/{first['id']}/archive")
    assert archived_episode.status_code == 200, archived_episode.text
    assert api_client.get(f"/projects/{first['id']}").json()["archived"] is True
    assert api_client.get(f"/projects/{second['id']}").json()["archived"] is False

    restored_project = api_client.post(f"/series/{series['id']}/restore")
    assert restored_project.status_code == 200, restored_project.text
    assert restored_project.json()["archived"] is False
    assert api_client.get(f"/projects/{first['id']}").json()["archived"] is True

    workspace_id = api_client.get("/auth/me").json()["workspace"]["id"]
    actions = [
        event.action
        for event in api_module.pipeline.repository.list_audit_events(workspace_id)
    ]
    assert "project.archive" in actions
    assert "episode.archive" in actions
    assert "project.restore" in actions


def test_permanent_project_purge_requires_preview_token_and_persists_report(api_client, tmp_path):
    project = _create_project(api_client, "永久清除项目")
    media_path = tmp_path / "output" / "video" / "purge-me.mp4"
    media_path.parent.mkdir(parents=True)
    media_path.write_bytes(b"purge")
    api_module.pipeline.scripts[project["id"]].merged_video_url = "video/purge-me.mp4"
    api_module.pipeline._save_data()

    preview = api_client.get(f"/projects/{project['id']}/purge-impact")
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["confirmation_phrase"] == "永久删除"
    assert body["impact"]["episodes"] == 1

    rejected = api_client.post(
        f"/projects/{project['id']}/purge",
        json={"confirmation_token": "0" * 64},
    )
    assert rejected.status_code == 409, rejected.text

    submitted = api_client.post(
        f"/projects/{project['id']}/purge",
        json={"confirmation_token": body["confirmation_token"]},
    )
    assert submitted.status_code == 202, submitted.text
    job = api_client.get(submitted.json()["report_url"])
    assert job.status_code == 200, job.text
    assert job.json()["status"] == "succeeded"
    assert job.json()["report"]["data_deleted"] is True
    assert job.json()["report"]["media"]["deleted"] == 1
    assert not media_path.exists()
    assert api_client.get(f"/projects/{project['id']}").status_code == 404
    workspace_id = api_client.get("/auth/me").json()["workspace"]["id"]
    events = api_module.pipeline.repository.list_audit_events(workspace_id)
    assert any(event.action == "project.purge.requested" for event in events)
    assert any(event.action == "project.purge.completed" for event in events)


def test_permanent_series_purge_removes_series_and_all_episodes(api_client):
    series = _create_series(api_client, "完整清除系列")
    first = _create_project(api_client, "完整清除第一集")
    second = _create_project(api_client, "完整清除第二集")
    _add_episode(api_client, series["id"], first["id"], 1)
    _add_episode(api_client, series["id"], second["id"], 2)

    preview = api_client.get(f"/series/{series['id']}/purge-impact")
    assert preview.status_code == 200, preview.text
    assert preview.json()["impact"]["episodes"] == 2
    submitted = api_client.post(
        f"/series/{series['id']}/purge",
        json={"confirmation_token": preview.json()["confirmation_token"]},
    )
    assert submitted.status_code == 202, submitted.text
    job = api_client.get(submitted.json()["report_url"])
    assert job.status_code == 200, job.text
    assert job.json()["status"] == "succeeded"
    assert api_client.get(f"/series/{series['id']}").status_code == 404
    assert api_client.get(f"/projects/{first['id']}").status_code == 404
    assert api_client.get(f"/projects/{second['id']}").status_code == 404


def test_episode_defaults_preview_then_promote_updates_only_series_defaults(api_client):
    series = _create_series(api_client, "Episode 默认配置")
    episode = _create_project(api_client, "默认来源集")
    _add_episode(api_client, series["id"], episode["id"], 1)
    api_module.pipeline.scripts[episode["id"]].default_generation_mode = "i2v"

    preview = api_client.get(
        f"/series/{series['id']}/episodes/{episode['id']}/promote-defaults/preview"
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["episode_id"] == episode["id"]
    assert preview.json()["changes"]["default_generation_mode"]["after"] == "i2v"
    assert api_module.pipeline.get_series(series["id"]).default_generation_mode == "r2v"

    promoted = api_client.post(
        f"/series/{series['id']}/episodes/{episode['id']}/promote-defaults",
        json={"sections": ["default_generation_mode"]},
    )
    assert promoted.status_code == 200, promoted.text
    assert promoted.json()["series"]["default_generation_mode"] == "i2v"
    assert promoted.json()["episode"]["default_generation_mode"] == "i2v"

    workspace_id = api_client.get("/auth/me").json()["workspace"]["id"]
    events = api_module.pipeline.repository.list_audit_events(workspace_id)
    assert any(
        event.action == "episode.defaults_promote"
        and event.object_id == episode["id"]
        and event.metadata["sections"] == ["default_generation_mode"]
        for event in events
    )


def test_list_projects_uses_canonical_path_without_trailing_slash(api_client):
    project = _create_project(api_client, "列表接口回归")

    response = api_client.get("/projects", follow_redirects=False)

    assert response.status_code == 200, response.text
    assert [item["id"] for item in response.json()] == [project["id"]]


def test_frame_visual_prompt_round_trips_without_overwriting_legacy_action(api_client):
    project = _create_project(api_client, "Prompt persistence")
    route = f"/projects/{project['id']}"
    created = api_client.post(route + "/frames", json={"scene_id": "", "action_description": "Coarse action"})
    assert created.status_code == 200, created.text
    frame_id = created.json()["frames"][0]["id"]
    for prompt in ["Refined visual narrative", ""]:
        saved = api_client.post(route + "/frames/update", json={"frame_id": frame_id, "visual_description": prompt})
        assert saved.status_code == 200, saved.text
        frame = api_client.get(route).json()["frames"][0]
        assert frame["visual_description"] == prompt
        assert frame["action_description"] == "Coarse action"
        if prompt:
            assert prompt in frame["assembled_prompt"]
        else:
            assert "Refined visual narrative" not in frame["assembled_prompt"]
    invalid = api_client.post(route + "/frames/update", json={"frame_id": frame_id, "visual_description": {"invalid": True}})
    assert invalid.status_code == 422


def test_script_document_uses_current_project_storage(api_client, tmp_path):
    project = _create_project(api_client, "剧本文档保存回归")
    content = {
        "type": "doc",
        "content": [{"type": "paragraph", "content": [{"type": "text", "text": "第一场"}]}],
    }

    empty_document = api_client.get(f"/projects/{project['id']}/document")
    empty_snapshots = api_client.get(f"/projects/{project['id']}/document/snapshots")

    assert empty_document.status_code == 200, empty_document.text
    assert empty_document.json() == {
        "type": "doc",
        "content": [{
            "type": "action",
            "content": [{"type": "text", "text": "剧本文档保存回归正文"}],
        }],
    }
    assert empty_snapshots.status_code == 200, empty_snapshots.text
    assert empty_snapshots.json() == []

    saved = api_client.post(
        f"/projects/{project['id']}/document",
        json={"content": content},
    )

    assert saved.status_code == 200, saved.text
    assert saved.json()["status"] == "ok"

    loaded = api_client.get(f"/projects/{project['id']}/document")

    assert loaded.status_code == 200, loaded.text
    assert loaded.json() == content
    assert (
        tmp_path / "output" / "documents" / project["id"] / "document.json"
    ).is_file()


def test_provider_configuration_is_isolated_by_workspace(api_client):
    team_id = api_client.get("/auth/me").json()["workspace"]["id"]
    saved = api_client.post(
        "/config/env",
        json={
            "DASHSCOPE_API_KEY": "team-secret",
            "OSS_BASE_PATH": "team-only",
        },
    )
    assert saved.status_code == 200, saved.text
    team_config = api_client.get("/config/env").json()
    assert team_config["secrets_configured"]["DASHSCOPE_API_KEY"] is True
    assert team_config["OSS_BASE_PATH"] == "team-only"

    personal = api_client.post(
        "/auth/workspaces",
        json={"name": "Personal Workspace"},
    )
    assert personal.status_code == 201, personal.text
    personal_id = personal.json()["id"]
    assert personal_id != team_id

    personal_config = api_client.get(
        "/config/env",
        headers={"X-Workspace-ID": personal_id},
    )
    assert personal_config.status_code == 200, personal_config.text
    assert personal_config.json()["secrets_configured"]["DASHSCOPE_API_KEY"] is False
    assert personal_config.json()["OSS_BASE_PATH"] == ""


def test_auth_me_ignores_a_stale_workspace_selection(api_client):
    response = api_client.get(
        "/auth/me",
        headers={"X-Workspace-ID": "workspace-no-longer-accessible"},
    )

    assert response.status_code == 200, response.text
    assert response.json()["user"]["username"] == "owner"


def test_local_upload_is_readable_only_in_its_workspace(api_client):
    team_id = api_client.get("/auth/me").json()["workspace"]["id"]
    disabled_oss = api_client.post("/config/env", json={"OSS_ENABLE": False})
    assert disabled_oss.status_code == 200, disabled_oss.text

    uploaded = api_client.post(
        "/upload",
        files={"file": ("sample.png", b"image-bytes", "image/png")},
    )
    assert uploaded.status_code == 200, uploaded.text
    path = uploaded.json()["url"]
    assert path.startswith(f"uploads/{team_id}/")
    assert api_client.get(f"/files/{path}").status_code == 200

    personal = api_client.post(
        "/auth/workspaces",
        json={"name": "Upload Isolation"},
    ).json()
    hidden = api_client.get(
        f"/files/{path}",
        headers={"X-Workspace-ID": personal["id"]},
    )
    assert hidden.status_code == 404


def test_task_status_is_hidden_from_other_workspaces(api_client):
    project = _create_project(api_client, "任务隔离")
    api_module.pipeline.asset_generation_tasks["team-task"] = {
        "status": "pending",
        "script_id": project["id"],
        "asset_id": "asset-1",
        "asset_type": "prop",
        "created_at": 1.0,
    }
    personal = api_client.post(
        "/auth/workspaces",
        json={"name": "Other Workspace"},
    ).json()

    hidden = api_client.get(
        "/tasks/team-task",
        headers={"X-Workspace-ID": personal["id"]},
    )

    assert hidden.status_code == 404


def test_playground_history_templates_and_media_are_workspace_scoped(api_client):
    from datetime import datetime, timezone

    from src.apps.playground import api as playground_api
    from src.apps.playground.models import (
        PlaygroundGeneration,
        PlaygroundMode,
        PlaygroundOutput,
        PlaygroundTemplate,
    )
    from src.apps.playground.service import PlaygroundService
    from src.apps.playground.storage import PlaygroundStorage

    team_id = api_client.get("/auth/me").json()["workspace"]["id"]
    personal = api_client.post(
        "/auth/workspaces",
        json={"name": "Playground Isolation"},
    ).json()
    other_id = personal["id"]
    now = datetime.now(timezone.utc).isoformat()
    storage = PlaygroundStorage()
    storage.HISTORY_PATH = "output/test_playground_history.json"
    storage.TEMPLATES_PATH = "output/test_playground_templates.json"
    storage._history = []
    storage._templates = []

    team_path = f"output/playground/images/{team_id}/team.png"
    other_path = f"output/playground/images/{other_id}/other.png"
    for workspace_id, generation_id, media_path in (
        (team_id, "team-generation", team_path),
        (other_id, "other-generation", other_path),
    ):
        path = api_module.MEDIA_PROJECT_ROOT / media_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(workspace_id.encode("utf-8"))
        storage.add_generation(
            PlaygroundGeneration(
                id=generation_id,
                workspace_id=workspace_id,
                mode=PlaygroundMode.T2I,
                model_id="wan2.7-image-pro",
                prompt=workspace_id,
                outputs=[
                    PlaygroundOutput(
                        id=f"{generation_id}-output",
                        media_path=media_path,
                        media_type="image",
                    )
                ],
                created_at=now,
            )
        )
        storage.add_template(
            PlaygroundTemplate(
                id=f"{generation_id}-template",
                workspace_id=workspace_id,
                name=workspace_id,
                prompt=workspace_id,
                created_at=now,
                updated_at=now,
            )
        )
    storage.add_template(
        PlaygroundTemplate(
            id="legacy-template",
            name="Legacy",
            prompt="Legacy",
            created_at=now,
            updated_at=now,
        )
    )

    previous_storage, previous_service = playground_api._storage, playground_api._service
    playground_api._storage = storage
    playground_api._service = PlaygroundService(storage)
    try:
        team_history = api_client.get("/playground/history")
        other_headers = {"X-Workspace-ID": other_id}
        other_history = api_client.get("/playground/history", headers=other_headers)
        hidden_generation = api_client.get(
            "/playground/history/team-generation",
            headers=other_headers,
        )
        hidden_delete = api_client.delete(
            "/playground/history/team-generation",
            headers=other_headers,
        )
        team_templates = api_client.get("/playground/templates")
        team_media = api_client.get(f"/files/{team_path.removeprefix('output/')}")
        hidden_media = api_client.get(
            f"/files/{team_path.removeprefix('output/')}",
            headers=other_headers,
        )
        hidden_input = api_client.post(
            "/playground/generate",
            headers=other_headers,
            json={
                "mode": "i2i",
                "model_id": "wan2.7-image-pro",
                "prompt": "cross workspace",
                "input_media": [team_path],
            },
        )
        uploaded = api_client.post(
            "/playground/upload",
            files={"file": ("reference.png", b"reference", "image/png")},
        )
        uploaded_path = uploaded.json()["path"]
        uploaded_media = api_client.get(
            f"/files/{uploaded_path.removeprefix('output/')}",
        )
        hidden_upload = api_client.get(
            f"/files/{uploaded_path.removeprefix('output/')}",
            headers=other_headers,
        )

        assert [item["id"] for item in team_history.json()] == ["team-generation"]
        assert [item["id"] for item in other_history.json()] == ["other-generation"]
        assert hidden_generation.status_code == 404
        assert hidden_delete.status_code == 404
        assert [item["id"] for item in team_templates.json()] == [
            "team-generation-template",
            "legacy-template",
        ]
        assert team_media.status_code == 200
        assert hidden_media.status_code == 404
        assert hidden_input.status_code == 404
        assert uploaded.status_code == 200
        assert f"playground/uploads/{team_id}/" in uploaded_path
        assert uploaded_media.status_code == 200
        assert hidden_upload.status_code == 404
    finally:
        playground_api._storage = previous_storage
        playground_api._service = previous_service


def test_voice_writes_cannot_target_a_series_in_another_workspace(api_client):
    series = api_client.post("/series", json={"title": "Team Series"}).json()
    personal = api_client.post(
        "/auth/workspaces",
        json={"name": "Voice Isolation"},
    ).json()
    headers = {"X-Workspace-ID": personal["id"]}

    clone = api_client.post(
        "/voice/clone",
        headers=headers,
        json={
            "series_id": series["id"],
            "audio_url": "uploads/sample.wav",
            "label": "Foreign Clone",
        },
    )
    accept = api_client.post(
        "/voice/design/accept",
        headers=headers,
        json={
            "series_id": series["id"],
            "voice_id": "foreign-voice",
            "voice_prompt": "低沉",
            "label": "Foreign Design",
        },
    )

    assert clone.status_code == 404
    assert accept.status_code == 404


def test_imported_series_and_episodes_are_assigned_to_active_workspace(api_client):
    workspace_id = api_client.get("/auth/me").json()["workspace"]["id"]
    response = api_client.post(
        "/series/import/confirm",
        json={
            "title": "导入系列",
            "text": "第一集正文",
            "episodes": [
                {
                    "episode_number": 1,
                    "title": "第一集",
                    "start_marker": "第一集正文",
                    "end_marker": "第一集正文",
                }
            ],
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert api_module.pipeline.repository.workspace_for_series(payload["series"]["id"]) == workspace_id
    assert api_module.pipeline.repository.workspace_for_script(payload["episodes"][0]["id"]) == workspace_id


def test_import_preview_cache_cannot_cross_workspaces(api_client):
    team_id = api_client.get("/auth/me").json()["workspace"]["id"]
    api_module.pipeline._import_cache["team-import"] = (team_id, "团队原文")
    personal = api_client.post(
        "/auth/workspaces",
        json={"name": "Import Isolation"},
    ).json()

    response = api_client.post(
        "/series/import/confirm",
        headers={"X-Workspace-ID": personal["id"]},
        json={"title": "越权导入", "import_id": "team-import", "episodes": []},
    )

    assert response.status_code == 400
    assert "team-import" in api_module.pipeline._import_cache


def test_legacy_unscoped_library_assets_move_to_default_workspace(api_client):
    workspace_id = api_client.get("/auth/me").json()["workspace"]["id"]
    legacy = Prop(id="legacy-prop", name="遗留道具", description="升级前资产")
    api_module.pipeline.library_store.props.append(legacy)
    api_module.pipeline._save_library_data()

    response = api_client.get("/library/assets")

    assert response.status_code == 200, response.text
    assert [item["id"] for item in response.json()["props"]] == ["legacy-prop"]
    assert legacy.workspace_id == workspace_id


def test_member_can_read_team_projects_but_cannot_create_top_level_project(api_client):
    team_id = api_client.get("/auth/me").json()["workspace"]["id"]
    project = _create_project(api_client, "Owner 创建的项目")
    series_response = api_client.post("/series", json={"title": "Owner 创建的系列"})
    assert series_response.status_code == 200, series_response.text
    series_id = series_response.json()["id"]
    shared_prop = api_client.post(
        "/library/assets",
        json={"asset_type": "prop", "name": "共享道具"},
    ).json()
    invitation = api_client.post(
        f"/auth/workspaces/{team_id}/invitations",
        json={"email": "writer@example.com"},
    )
    assert invitation.status_code == 201, invitation.text

    with make_client(api_module.app) as writer:
        registered = writer.post(
            "/auth/invitations/register",
            json={
                "token": invitation.json()["token"],
                "username": "writer",
                "email": "writer@example.com",
                "password": "writer password 123",
            },
        )
        assert registered.status_code == 201, registered.text
        workspace_headers = {"X-Workspace-ID": team_id}

        visible = writer.get("/projects", headers=workspace_headers)
        assert visible.status_code == 200, visible.text
        assert [item["id"] for item in visible.json()] == [project["id"]]

        forbidden = writer.post(
            "/projects?skip_analysis=true",
            headers=workspace_headers,
            json={"title": "成员越权创建", "text": "不应创建"},
        )
        assert forbidden.status_code == 403
        assert forbidden.json()["error"]["code"] == "AUTH_OWNER_REQUIRED"

        rename_series = writer.put(
            f"/series/{series_id}",
            headers=workspace_headers,
            json={"title": "成员越权改名"},
        )
        assert rename_series.status_code == 403
        assert rename_series.json()["error"]["code"] == "AUTH_OWNER_REQUIRED"

        import_series = writer.post(
            "/series/import/confirm",
            headers=workspace_headers,
            json={"title": "成员越权导入", "text": "正文", "episodes": []},
        )
        assert import_series.status_code == 403
        assert import_series.json()["error"]["code"] == "AUTH_OWNER_REQUIRED"

        shared_mutation = writer.post(
            f"/projects/{project['id']}/assets/toggle_starred",
            headers=workspace_headers,
            json={"asset_id": shared_prop["id"], "asset_type": "prop"},
        )
        assert shared_mutation.status_code == 403
        assert shared_mutation.json()["error"]["code"] == "AUTH_OWNER_REQUIRED"

        diagnostics = writer.get("/diagnose/log_tail", headers=workspace_headers)
        assert diagnostics.status_code == 403
        assert diagnostics.json()["error"]["code"] == "AUTH_OWNER_REQUIRED"

        members = writer.get(f"/auth/workspaces/{team_id}/members")
        assert members.status_code == 403
        assert members.json()["error"]["code"] == "AUTH_OWNER_REQUIRED"

    shared_after = api_client.get("/library/assets").json()["props"]
    assert next(item for item in shared_after if item["id"] == shared_prop["id"])["starred"] is False


def test_editor_can_edit_project_but_cannot_delete_it(api_client):
    team_id = api_client.get("/auth/me").json()["workspace"]["id"]
    project = _create_project(api_client, "Editor 可编辑项目")
    invitation = api_client.post(
        f"/auth/workspaces/{team_id}/invitations",
        json={"email": "editor@example.com", "access_role": "editor"},
    )
    assert invitation.status_code == 201, invitation.text

    with make_client(api_module.app) as editor:
        registered = editor.post(
            "/auth/invitations/register",
            json={
                "token": invitation.json()["token"],
                "username": "editor",
                "email": "editor@example.com",
                "password": "editor password 123",
            },
        )
        assert registered.status_code == 201, registered.text
        workspace_headers = {"X-Workspace-ID": team_id}

        updated = editor.patch(
            f"/projects/{project['id']}/style",
            headers=workspace_headers,
            json={"style_preset": "anime"},
        )
        assert updated.status_code == 200, updated.text
        assert updated.json()["style_preset"] == "anime"

        deleted = editor.delete(f"/projects/{project['id']}", headers=workspace_headers)
        assert deleted.status_code == 403, deleted.text
        assert deleted.json()["error"]["code"] == "AUTH_OWNER_REQUIRED"


def test_episode_edit_lease_blocks_second_editor_and_text_save_uses_cas(api_client):
    project = _create_project(api_client, "并发写作")
    project_id = project["id"]
    revision = api_client.get(f"/projects/{project_id}").json()["_revision"]

    acquired = api_client.post(
        f"/projects/{project_id}/edit-lease",
        json={"client_instance_id": "browser-a"},
    )
    assert acquired.status_code == 200, acquired.text
    lease = acquired.json()

    with make_client(api_module.app, local=True) as second_browser:
        login = second_browser.post(
            "/auth/login",
            json={
                "identifier": "owner",
                "password": "correct horse battery staple",
            },
        )
        assert login.status_code == 200, login.text
        blocked = second_browser.post(
            f"/projects/{project_id}/edit-lease",
            json={"client_instance_id": "browser-b"},
        )
        assert blocked.status_code == 423
        assert blocked.json()["error"]["code"] == "EDIT_LEASE_HELD"
        assert blocked.json()["lease"]["holder_display_name"] == "owner"

        blocked_mutation = second_browser.patch(
            f"/projects/{project_id}/style",
            headers={"X-Client-Instance-ID": "browser-b"},
            json={"style_preset": "anime"},
        )
        assert blocked_mutation.status_code == 423
        assert blocked_mutation.json()["error"]["code"] == "EDIT_LEASE_HELD"
        assert blocked_mutation.json()["lease"]["holder_display_name"] == "owner"

    saved = api_client.put(
        f"/projects/{project_id}/text",
        headers={"X-Edit-Lease": lease["token"]},
        json={
            "text": "A 保存的新内容",
            "expected_revision": revision,
            "client_instance_id": "browser-a",
        },
    )
    assert saved.status_code == 200, saved.text
    new_revision = saved.json()["_revision"]

    stale = api_client.put(
        f"/projects/{project_id}/text",
        headers={"X-Edit-Lease": lease["token"]},
        json={
            "text": "旧页面覆盖",
            "expected_revision": revision,
            "client_instance_id": "browser-a",
        },
    )
    assert stale.status_code == 409
    assert stale.json()["current_revision"] == new_revision
    assert api_client.get(f"/projects/{project_id}").json()["original_text"] == "A 保存的新内容"


def test_member_can_release_own_episode_edit_lease(api_client):
    team_id = api_client.get("/auth/me").json()["workspace"]["id"]
    project = _create_project(api_client, "成员释放编辑锁")
    invitation = api_client.post(
        f"/auth/workspaces/{team_id}/invitations",
        json={"email": "lease-writer@example.com"},
    )
    assert invitation.status_code == 201, invitation.text

    with make_client(api_module.app) as writer:
        registered = writer.post(
            "/auth/invitations/register",
            json={
                "token": invitation.json()["token"],
                "username": "lease-writer",
                "email": "lease-writer@example.com",
                "password": "writer password 123",
            },
        )
        assert registered.status_code == 201, registered.text
        workspace_headers = {"X-Workspace-ID": team_id}
        acquired = writer.post(
            f"/projects/{project['id']}/edit-lease",
            headers=workspace_headers,
            json={"client_instance_id": "writer-browser"},
        )
        assert acquired.status_code == 200, acquired.text

        released = writer.request(
            "DELETE",
            f"/projects/{project['id']}/edit-lease",
            headers={
                **workspace_headers,
                "X-Edit-Lease": acquired.json()["token"],
            },
            json={"client_instance_id": "writer-browser"},
        )

    assert released.status_code == 204, released.text
    reacquired = api_client.post(
        f"/projects/{project['id']}/edit-lease",
        json={"client_instance_id": "owner-browser"},
    )
    assert reacquired.status_code == 200, reacquired.text


def test_shared_library_is_isolated_by_workspace(api_client):
    primary = api_client.get("/auth/me").json()["workspace"]
    created = api_client.post(
        "/library/assets",
        headers={"X-Workspace-ID": primary["id"]},
        json={"asset_type": "prop", "name": "团队道具"},
    )
    assert created.status_code == 200, created.text

    second = api_client.post("/auth/workspaces", json={"name": "另一个团队"})
    assert second.status_code == 201, second.text
    second_id = second.json()["id"]
    isolated = api_client.get("/library/assets", headers={"X-Workspace-ID": second_id})
    assert isolated.status_code == 200, isolated.text
    assert isolated.json() == {"characters": [], "scenes": [], "props": []}

    primary_assets = api_client.get(
        "/library/assets",
        headers={"X-Workspace-ID": primary["id"]},
    )
    assert [item["name"] for item in primary_assets.json()["props"]] == ["团队道具"]


def test_get_project_episodes_returns_standalone_domain_view(api_client):
    script = _create_project(api_client, "独立短片")

    response = api_client.get(f"/projects/{script['id']}/episodes")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["id"] == script["id"]
    assert payload["title"] == "独立短片"
    assert payload["mode"] == "standalone"
    assert payload["episode_ids"] == [script["id"]]
    assert len(payload["episodes"]) == 1
    assert payload["episodes"][0]["id"] == script["id"]
    assert payload["episodes"][0]["project_id"] == script["id"]
    assert payload["episodes"][0]["script"]["id"] == script["id"]


def test_get_project_episodes_returns_sorted_series_and_shared_assets(api_client):
    series = _create_series(api_client)
    shared_character = api_client.post(
        f"/series/{series['id']}/characters",
        json={"name": "共享主角", "description": "系列共享角色"},
    )
    assert shared_character.status_code == 200, shared_character.text

    episode_two = _create_project(api_client, "第二集")
    episode_one = _create_project(api_client, "第一集")
    _add_episode(api_client, series["id"], episode_two["id"], 2)
    _add_episode(api_client, series["id"], episode_one["id"], 1)

    response = api_client.get(f"/projects/{series['id']}/episodes")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["id"] == series["id"]
    assert payload["mode"] == "series"
    assert [episode["episode_number"] for episode in payload["episodes"]] == [1, 2]
    assert [episode["id"] for episode in payload["episodes"]] == [
        episode_one["id"],
        episode_two["id"],
    ]
    assert all(episode["project_id"] == series["id"] for episode in payload["episodes"])
    assert payload["characters"][0]["id"] == shared_character.json()["id"]
    assert payload["characters"][0]["name"] == "共享主角"


def test_list_domain_projects_includes_standalone_and_series(api_client):
    standalone = _create_project(api_client, "独立项目")
    series = _create_series(api_client, "双集系列")
    episode_one = _create_project(api_client, "系列第一集")
    episode_two = _create_project(api_client, "系列第二集")
    _add_episode(api_client, series["id"], episode_one["id"], 1)
    _add_episode(api_client, series["id"], episode_two["id"], 2)

    response = api_client.get("/projects/domain")

    assert response.status_code == 200, response.text
    projects = {project["id"]: project for project in response.json()}
    assert projects[standalone["id"]]["mode"] == "standalone"
    assert projects[standalone["id"]]["episode_count"] == 1
    assert projects[standalone["id"]]["episode_ids"] == [standalone["id"]]
    assert projects[series["id"]]["mode"] == "series"
    assert projects[series["id"]]["episode_count"] == 2
    assert projects[series["id"]]["episode_ids"] == [episode_one["id"], episode_two["id"]]


def test_get_project_episodes_returns_404_for_unknown_project(api_client):
    response = api_client.get("/projects/nonexistent/episodes")

    assert response.status_code == 404
    assert response.json() == {"detail": "Project not found"}


def test_legacy_get_project_shape_and_source_merge_are_unchanged(api_client):
    series = _create_series(api_client)
    shared_character = api_client.post(
        f"/series/{series['id']}/characters",
        json={"name": "旧端点共享角色", "description": "用于兼容回归"},
    )
    assert shared_character.status_code == 200, shared_character.text
    episode = _create_project(api_client, "兼容集")
    _add_episode(api_client, series["id"], episode["id"], 1)

    response = api_client.get(f"/projects/{episode['id']}")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["id"] == episode["id"]
    assert payload["original_text"] == "兼容集正文"
    assert "script" not in payload
    shared = next(item for item in payload["characters"] if item["id"] == shared_character.json()["id"])
    assert shared["source"] == "series"


@pytest.mark.parametrize("operation", ["annotate", "select_video", "auto_select_latest_video", "unpin_video"])
def test_candidate_save_failure_retains_confirmed_state_and_retry_round_trips(api_client, operation):
    project = _create_project(api_client, "Candidate save recovery")
    route = f"/projects/{project['id']}"
    created = api_client.post(route + "/frames", json={"scene_id": "", "action_description": "A rooftop"})
    frame_id = created.json()["frames"][0]["id"]
    # Completed provider results are fixtures; no generation is dispatched.
    script = api_module.pipeline.scripts[project["id"]]
    script.video_tasks = [VideoTask(id="take-new", project_id=script.id, frame_id=frame_id,
        image_url="", prompt="A rooftop", status="completed", video_url="video/new.mp4")]
    frame = script.frames[0]
    frame.selected_video_id = "take-old"
    frame.video_url = "video/old.mp4"
    frame.is_video_pinned = operation == "unpin_video"
    api_module.pipeline._save_data()
    before = api_client.get(route).json()
    endpoint = route + "/video_tasks/take-new/annotate" if operation == "annotate" else route + f"/frames/{frame_id}/{operation}"
    method = api_client.patch if operation == "annotate" else api_client.post
    payload = {"is_starred": True, "label": "Best camera"} if operation == "annotate" else {"video_id": "take-new"} if operation == "select_video" else {}
    with patch.object(api_module.pipeline.repository, "save_scripts", side_effect=StorageError("simulated write failure")):
        failed = method(endpoint, json=payload)
    assert failed.status_code == 500, failed.text
    unchanged = api_client.get(route).json()
    assert unchanged["frames"] == before["frames"]
    assert unchanged["video_tasks"] == before["video_tasks"]
    saved = method(endpoint, json=payload)
    assert saved.status_code == 200, saved.text
    # Reload the isolated repository as a backend restart would, then read via API.
    api_module.pipeline.scripts = api_module.pipeline.repository.load_scripts()
    restored = api_client.get(route).json()
    if operation == "annotate":
        assert restored["video_tasks"][0]["is_starred"] is True
        assert restored["video_tasks"][0]["label"] == "Best camera"
    elif operation == "unpin_video":
        assert restored["frames"][0]["is_video_pinned"] is False
        assert restored["frames"][0]["video_url"] == "video/old.mp4"
    else:
        assert restored["frames"][0]["selected_video_id"] == "take-new"
        assert restored["frames"][0]["video_url"] == "video/new.mp4"
        assert restored["frames"][0]["is_video_pinned"] is (operation == "select_video")


def test_video_selection_rejects_unusable_or_unrelated_candidates_without_changing_the_frame(api_client):
    project = _create_project(api_client, "Candidate ownership")
    route = f"/projects/{project['id']}"
    frame_id = api_client.post(route + "/frames", json={"scene_id": "", "action_description": "Target shot"}).json()["frames"][0]["id"]
    other_id = api_client.post(route + "/frames", json={"scene_id": "", "action_description": "Other shot"}).json()["frames"][1]["id"]
    script = api_module.pipeline.scripts[project["id"]]
    base = dict(project_id=script.id, frame_id=frame_id, image_url="", prompt="Candidate", status="completed", video_url="video/new.mp4")
    script.video_tasks = [VideoTask(id="usable", **base)] + [
        VideoTask(id=name, **{**base, **changes}) for name, changes in [
            ("pending", {"status": "pending"}), ("processing", {"status": "processing"}),
            ("failed", {"status": "failed"}), ("no-media", {"video_url": None}),
            ("other-frame", {"frame_id": other_id}), ("unassigned", {"frame_id": None}),
            ("other-project", {"project_id": "another-project"}),
        ]
    ]
    script.frames[0].selected_video_id = "previous"
    script.frames[0].video_url = "video/previous.mp4"
    api_module.pipeline._save_data()
    before = api_client.get(route).json()["frames"]
    endpoint = route + f"/frames/{frame_id}/select_video"
    for task in script.video_tasks[1:]:
        response = api_client.post(endpoint, json={"video_id": task.id})
        assert response.status_code == 400, (task.id, response.text)
        assert api_client.get(route).json()["frames"] == before
    missing = api_client.post(endpoint, json={"video_id": "missing"})
    assert missing.status_code == 404
    saved = api_client.post(endpoint, json={"video_id": "usable"})
    assert saved.status_code == 200, saved.text
    frame = api_client.get(route).json()["frames"][0]
    assert frame["selected_video_id"] == "usable"
    assert frame["video_url"] == "video/new.mp4"
    assert frame["is_video_pinned"] is True


def test_automatic_selection_uses_creation_order_and_ignores_unrelated_tasks(api_client):
    project = _create_project(api_client, "Automatic candidates")
    route = f"/projects/{project['id']}"
    frame_id = api_client.post(route + "/frames", json={"scene_id": "", "action_description": "Target shot"}).json()["frames"][0]["id"]
    script = api_module.pipeline.scripts[project["id"]]
    base = dict(project_id=script.id, frame_id=frame_id, image_url="", prompt="Candidate", status="completed")
    script.video_tasks = [
        VideoTask(id="newer", video_url="video/newer.mp4", created_at=200, **base),
        VideoTask(id="older-finished-last", video_url="video/older.mp4", created_at=100, **base),
        VideoTask(id="wrong-project", video_url="video/wrong.mp4", created_at=300, **{**base, "project_id": "other-project"}),
        VideoTask(id="missing-media", created_at=400, **base),
    ]
    api_module.pipeline._save_data()
    response = api_client.post(route + f"/frames/{frame_id}/auto_select_latest_video")
    assert response.status_code == 200, response.text
    frame = api_client.get(route).json()["frames"][0]
    assert frame["selected_video_id"] == "newer"
    assert frame["video_url"] == "video/newer.mp4"
    assert frame["is_video_pinned"] is False


def test_video_retry_preserves_saved_inputs_and_recovers_without_duplicate_dispatch(api_client):
    project = _create_project(api_client, "Historical retry")
    route = f"/projects/{project['id']}"
    frame_id = api_client.post(route + "/frames", json={"scene_id": "", "action_description": "Original shot"}).json()["frames"][0]["id"]
    script = api_module.pipeline.scripts[project["id"]]
    script.frames[0].dialogue = "Original dialogue"
    api_module.pipeline._save_data()
    with patch.object(api_module.pipeline, "process_video_task") as process:
        created = api_client.post(route + "/video_tasks", json={
            "frame_id": frame_id, "image_url": "", "prompt": "Original camera move", "model": "wan2.7-r2v",
            "duration": 8, "resolution": "1080p", "seed": 0, "shot_type": "multi", "generation_mode": "r2v",
            "generate_audio": True, "audio_url": "audio/original.wav", "prompt_extend": False,
            "negative_prompt": "Original exclusions", "reference_video_urls": ["video/reference.mp4"],
            "reference_image_urls": ["assets/original.png"], "ratio": "9:16", "watermark": False,
            "mode": "pro", "sound": "on", "cfg_scale": 0, "vidu_audio": False,
            "movement_amplitude": "small", "workbench_tab": "direct_r2v",
        })
        assert created.status_code == 200, created.text
        task_id = created.json()[0]["id"]
        script = api_module.pipeline.scripts[project["id"]]
        source = next(task for task in script.video_tasks if task.id == task_id)
        source.status, source.error = "failed", "Original provider failure"
        source.provider_name, source.provider_task_id, source.provider_request_id = "dashscope", "old-provider-task", "old-request"
        source.is_starred, source.label, source.audio_setting = True, "Keep this note", "origin"
        script.frames[0].dialogue = "Changed dialogue"
        script.frames[0].action_description = "Changed camera move"
        api_module.pipeline._save_data()
        before = api_client.get(route).json()
        process.reset_mock()
        endpoint = route + f"/video_tasks/{task_id}/retry"
        with patch.object(api_module.pipeline.repository, "save_scripts", side_effect=StorageError("write unavailable")):
            failed = api_client.post(endpoint)
        assert failed.status_code == 500, failed.text
        process.assert_not_called()
        assert api_client.get(route).json()["video_tasks"] == before["video_tasks"]
        retried = api_client.post(endpoint)
        assert retried.status_code == 200, retried.text
        new = retried.json()
        volatile = {"id", "status", "error", "video_url", "created_at", "provider_name", "provider_task_id", "provider_request_id", "is_starred", "label", "retry_of_task_id"}
        assert {key: value for key, value in new.items() if key not in volatile} == {key: value for key, value in before["video_tasks"][0].items() if key not in volatile}
        assert "Original dialogue" in new["prompt"] and "Changed dialogue" not in new["prompt"]
        assert new["retry_of_task_id"] == task_id and new["id"] != task_id
        assert new["status"] == "pending" and new["is_starred"] is False
        assert all(new[key] is None for key in ["error", "video_url", "label", "provider_name", "provider_task_id", "provider_request_id"])
        process.assert_called_once_with(project["id"], new["id"])
        assert api_client.post(endpoint).json()["id"] == new["id"]
        process.assert_called_once()
    api_module.pipeline.scripts = api_module.pipeline.repository.load_scripts()
    restored = api_client.get(route).json()
    assert restored["frames"] == before["frames"]
    assert restored["video_tasks"][0] == before["video_tasks"][0]
    assert restored["video_tasks"][1] == new


@pytest.mark.parametrize("case", ["pending", "completed", "missing-frame", "unknown-task", "foreign-workspace"])
def test_video_retry_rejects_unavailable_tasks_without_dispatch(api_client, case):
    project = _create_project(api_client, "Retry scope")
    script = api_module.pipeline.scripts[project["id"]]
    script.video_tasks = [VideoTask(id="old-task", project_id=script.id, image_url="", prompt="Saved prompt",
        status=case if case in {"pending", "completed"} else "failed", frame_id="deleted-frame" if case == "missing-frame" else None)]
    api_module.pipeline._save_data()
    headers = {}
    if case == "foreign-workspace":
        workspace = api_client.post("/auth/workspaces", json={"name": "Another workspace"}).json()
        headers = {"X-Workspace-ID": workspace["id"]}
    task_id = "unknown" if case == "unknown-task" else "old-task"
    with patch.object(api_module.pipeline, "process_video_task") as process:
        response = api_client.post(f"/projects/{script.id}/video_tasks/{task_id}/retry", headers=headers)
        assert response.status_code == (404 if case in {"unknown-task", "foreign-workspace"} else 400), response.text
        process.assert_not_called()
    assert len(api_module.pipeline.scripts[script.id].video_tasks) == 1


def test_video_completion_persists_and_adopts_after_project_read_and_edit_without_a_workbench(api_client):
    project = _create_project(api_client, "Background completion")
    route = f"/projects/{project['id']}"
    frame_id = api_client.post(route + "/frames", json={"scene_id": "", "action_description": "Original description"}).json()["frames"][0]["id"]

    def generate(**kwargs):
        # A real project read replaces the cached project while the provider runs.
        running = api_client.get(route).json()
        assert running["video_tasks"][0]["status"] == "processing"
        kwargs["on_provider_ids"]("dashscope", "provider-task-fixture", "request-fixture")
        assert api_client.get(route).json()["video_tasks"][0]["provider_task_id"] == "provider-task-fixture"
        edited = api_client.post(route + "/frames/update", json={"frame_id": frame_id, "action_description": "Edited during generation"})
        assert edited.status_code == 200, edited.text
        Path(kwargs["output_path"]).write_bytes(b"provider-result-fixture")
        return kwargs["output_path"], None

    api_module.pipeline.video_generator.model.generate.side_effect = generate
    response = api_client.post(route + "/video_tasks", json={"frame_id": frame_id, "image_url": "", "prompt": "Saved camera move", "model": "wan2.7-t2v", "generation_mode": "t2v"})
    assert response.status_code == 200, response.text
    api_module.pipeline.scripts = api_module.pipeline.repository.load_scripts()
    restored = api_client.get(route).json()
    task = restored["video_tasks"][0]
    frame = restored["frames"][0]
    assert task["status"] == "completed"
    assert Path("output", task["video_url"]).read_bytes() == b"provider-result-fixture"
    assert frame["selected_video_id"] == task["id"]
    assert frame["video_url"] == task["video_url"]
    assert frame["is_video_pinned"] is False
    assert frame["action_description"] == "Edited during generation"


@pytest.mark.parametrize("intervention", ["pin", "lock", "cancel", "delete-frame", "provider-error", "save-error"])
def test_video_completion_preserves_changes_made_while_provider_is_running(api_client, intervention):
    project = _create_project(api_client, "Completion protections")
    route = f"/projects/{project['id']}"
    frame_id = api_client.post(route + "/frames", json={"scene_id": "", "action_description": "Keep this shot"}).json()["frames"][0]["id"]
    script = api_module.pipeline.scripts[project["id"]]
    script.video_tasks = [VideoTask(id="previous", project_id=script.id, frame_id=frame_id, image_url="", prompt="Previous", status="completed", video_url="video/previous.mp4", created_at=1)]
    script.frames[0].selected_video_id = "previous"
    script.frames[0].video_url = "video/previous.mp4"
    api_module.pipeline._save_data()
    saved = api_module.pipeline.repository.save_scripts
    failed_save = False

    def save_scripts(scripts):
        nonlocal failed_save
        task = scripts[project["id"]].video_tasks[-1]
        if intervention == "save-error" and task.status == "completed" and not failed_save:
            failed_save = True
            raise StorageError("simulated completion persistence failure")
        return saved(scripts)

    def generate(**kwargs):
        running = api_client.get(route).json()
        task_id = running["video_tasks"][-1]["id"]
        if intervention == "pin":
            response = api_client.post(route + f"/frames/{frame_id}/select_video", json={"video_id": "previous"})
        elif intervention == "lock":
            response = api_client.post(route + "/frames/toggle_lock", json={"frame_id": frame_id})
        elif intervention == "cancel":
            response = api_client.post(route + f"/video_tasks/{task_id}/cancel")
        elif intervention == "delete-frame":
            response = api_client.delete(route + f"/frames/{frame_id}")
        elif intervention == "provider-error":
            raise RuntimeError("Provider temporarily unavailable")
        else:
            response = None
        if response is not None:
            assert response.status_code == 200, response.text
        Path(kwargs["output_path"]).write_bytes(b"provider-result-fixture")
        return kwargs["output_path"], None

    api_module.pipeline.video_generator.model.generate.side_effect = generate
    with patch.object(api_module.pipeline.repository, "save_scripts", side_effect=save_scripts):
        response = api_client.post(route + "/video_tasks", json={"frame_id": frame_id, "image_url": "", "prompt": "Camera move", "model": "wan2.7-t2v", "generation_mode": "t2v"})
    assert response.status_code == 200, response.text
    restored = api_client.get(route).json()
    task = restored["video_tasks"][-1]
    if intervention in ("cancel", "provider-error", "save-error"):
        assert task["status"] == "failed"
        assert task["error"] == {"cancel": "Canceled by user", "provider-error": "Provider temporarily unavailable", "save-error": "simulated completion persistence failure"}[intervention]
        if intervention == "save-error":
            assert task["video_url"]
            assert Path("output", task["video_url"]).read_bytes() == b"provider-result-fixture"
    else:
        assert task["status"] == "completed"
    if intervention == "delete-frame":
        assert restored["frames"] == []
    else:
        frame = restored["frames"][0]
        assert frame["selected_video_id"] == "previous"
        assert frame["video_url"] == "video/previous.mp4"
        assert frame["is_video_pinned"] is (intervention == "pin")
        assert frame["locked"] is (intervention == "lock")


def test_video_retry_reports_processing_failure_and_keeps_original_task(api_client):
    project = _create_project(api_client, "Retry provider failure")
    script = api_module.pipeline.scripts[project["id"]]
    original = VideoTask(id="failed-original", project_id=script.id, image_url="", prompt="Saved camera move",
        status="failed", error="Original failure", seed=0, prompt_extend=False)
    script.video_tasks = [original]
    api_module.pipeline._save_data()
    # Exercise the real processor while replacing only the provider's generate boundary.
    generate = api_module.pipeline.video_generator.model.generate
    generate.side_effect = RuntimeError("Provider temporarily unavailable")
    response = api_client.post(f"/projects/{script.id}/video_tasks/{original.id}/retry")
    assert response.status_code == 200, response.text
    tasks = api_client.get(f"/projects/{script.id}").json()["video_tasks"]
    assert tasks[0]["error"] == "Original failure"
    assert tasks[1]["status"] == "failed"
    assert tasks[1]["error"] == "Provider temporarily unavailable"
    assert generate.call_args.kwargs["prompt"] == "Saved camera move"
    assert generate.call_args.kwargs["seed"] == 0
    assert generate.call_args.kwargs["prompt_extend"] is False
