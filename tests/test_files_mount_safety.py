"""Regression: /files must never expose the output root (db/json/backups)."""
from fastapi.staticfiles import StaticFiles


def test_files_mounts_never_expose_output_root():
    from starlette.routing import Mount

    from src.apps.comic_gen.api import app

    mounts = []
    for r in app.routes:
        if isinstance(r, Mount) and getattr(r, "path", "").startswith("/files"):
            inner = getattr(r, "app", None)
            directory = getattr(inner, "directory", None)
            mounts.append((r.path, str(directory) if directory else ""))
    paths = [p for p, _ in mounts]
    dirs = [d.replace("\\", "/") for d, _ in mounts]

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
