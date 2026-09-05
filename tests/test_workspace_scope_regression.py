from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import Request

from src.apps.comic_gen.auth.dependencies import require_workspace_access
from src.apps.comic_gen.auth.service import AuthError
from src.utils.media_refs import media_ref_for_path


def _request(context):
    return SimpleNamespace(state=SimpleNamespace(auth_context=context), app=SimpleNamespace(state=SimpleNamespace()))


def test_workspace_access_accepts_member_and_owner_roles():
    context = SimpleNamespace(
        user=SimpleNamespace(id="user-1"),
        workspace=SimpleNamespace(id="workspace-1"),
        membership=SimpleNamespace(role="member"),
    )

    resolved = require_workspace_access(_request(context), "workspace-1", minimum_role="member")

    assert resolved is context


def test_workspace_access_rejects_wrong_workspace_or_role():
    context = SimpleNamespace(
        user=SimpleNamespace(id="user-1"),
        workspace=SimpleNamespace(id="workspace-1"),
        membership=SimpleNamespace(role="member"),
    )

    with pytest.raises(AuthError) as wrong_workspace:
        require_workspace_access(_request(context), "workspace-2")
    assert wrong_workspace.value.status_code == 404

    with pytest.raises(AuthError) as owner_required:
        require_workspace_access(_request(context), "workspace-1", minimum_role="owner")
    assert owner_required.value.status_code == 403


def test_media_ref_for_path_requires_workspace_owned_file(tmp_path):
    output = tmp_path / "output" / "uploads" / "workspace-1"
    output.mkdir(parents=True)
    media = output / "sample.png"
    media.write_bytes(b"image")

    reference = media_ref_for_path(
        "uploads/workspace-1/sample.png",
        "workspace-1",
        project_root=str(tmp_path),
    )

    assert reference.workspace_id == "workspace-1"
    assert reference.relative_path == "uploads/workspace-1/sample.png"

    with pytest.raises(ValueError):
        media_ref_for_path(
            "uploads/workspace-2/sample.png",
            "workspace-1",
            project_root=str(tmp_path),
        )
