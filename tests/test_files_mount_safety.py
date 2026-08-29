"""Regression: /files is never exposed through a public static mount."""


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
    assert paths == []
    assert any(getattr(r, "path", "") == "/files/{media_path:path}" for r in app.routes)
