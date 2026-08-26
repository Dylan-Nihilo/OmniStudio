"""Regression: /files must never expose the output root (db/json/backups)."""
from fastapi.staticfiles import StaticFiles


def test_files_mounts_never_expose_output_root():
    from src.apps.comic_gen.api import app

    mounts = [
        (r.path, r.directory)
        for r in app.routes
        if isinstance(r, StaticFiles) and getattr(r, "path", "").startswith("/files")
    ]
    paths = [p for p, _ in mounts]
    dirs = [str(d).replace("\\", "/") for _, d in mounts]

    # The output root itself must never be mounted under /files.
    assert "/files" not in paths, f"output root exposed: {paths}"
    assert "/files/outputs" not in paths

    # Every mounted directory must be a media subdirectory of output.
    for d in dirs:
        assert d.startswith("output/"), f"non-output dir mounted: {d}"
        assert d not in ("output", "output/"), f"output root mounted: {d}"

    # Media folders the frontend depends on must stay reachable.
    for needed in ("/files/storyboard", "/files/audio", "/files/video", "/files/assets", "/files/uploads"):
        assert needed in paths, f"missing media mount: {needed}"
