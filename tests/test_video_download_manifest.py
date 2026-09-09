import json
import shutil
import zipfile
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import pytest

import src.apps.comic_gen.pipeline as pipeline_module
from src.apps.comic_gen.pipeline import build_video_download_archive


def _task(task_id, frame_id, url, *, status="completed", created_at=1):
    return SimpleNamespace(
        id=task_id,
        project_id="script-1",
        frame_id=frame_id,
        video_url=url,
        status=status,
        created_at=created_at,
    )


def _test_output_root():
    output_root = Path("output/.test-video-manifest")
    shutil.rmtree(output_root, ignore_errors=True)
    output_root.mkdir(parents=True)
    return output_root


def test_video_download_archive_contains_shot_take_manifest_and_original_filenames(monkeypatch):
    output_root = _test_output_root()
    first = output_root / "take-a.mp4"
    second = output_root / "take-b.mp4"
    first.write_bytes(b"a")
    second.write_bytes(b"b")

    monkeypatch.setattr(
        pipeline_module,
        "_safe_resolve_path",
        lambda base, relative: str(output_root / relative),
    )
    script = SimpleNamespace(
        id="script-1",
        frames=[SimpleNamespace(id="shot-1"), SimpleNamespace(id="shot-2")],
        video_tasks=[
            _task("take-1", "shot-1", "take-a.mp4"),
            _task("take-2", "shot-2", "take-b.mp4"),
            _task("take-pending", "shot-1", "pending.mp4", status="processing"),
        ],
    )

    archive, manifest = build_video_download_archive(script)

    assert manifest["script_id"] == "script-1"
    assert [entry["take_id"] for entry in manifest["files"]] == ["take-1", "take-2"]
    assert manifest["files"][0]["filename"] == "take-a.mp4"
    assert manifest["files"][0]["shot_id"] == "shot-1"
    with zipfile.ZipFile(BytesIO(archive)) as zipped:
        names = zipped.namelist()
        assert "manifest.json" in names
        assert manifest["files"][0]["archive_path"] in names
        assert zipped.read("manifest.json") == json.dumps(
            manifest, ensure_ascii=False, indent=2
        ).encode("utf-8")


def test_video_download_archive_rejects_unknown_or_empty_take_selection(monkeypatch):
    output_root = _test_output_root()
    (output_root / "take.mp4").write_bytes(b"a")
    monkeypatch.setattr(
        pipeline_module,
        "_safe_resolve_path",
        lambda base, relative: str(output_root / relative),
    )
    script = SimpleNamespace(
        id="script-1",
        frames=[SimpleNamespace(id="shot-1")],
        video_tasks=[_task("take-1", "shot-1", "take.mp4")],
    )

    with pytest.raises(ValueError, match="No completed video takes matched"):
        build_video_download_archive(script, ["missing"])
