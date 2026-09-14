"""The out-of-band super-admin account must be able to log in and reach the billing console."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

from src.billing import BillingError, BillingServices
from src.billing.roles import RoleService
from src.billing.routes import admin_router, billing_exception_handler, router
from src.storage.auth_repository import AuthRepository
from tests.auth_test_helpers import make_auth_app, make_client

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "create_platform_user.py"
spec = importlib.util.spec_from_file_location("create_platform_user", SCRIPT)
create_user_script = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(create_user_script)

PASSWORD = "correct horse battery staple"


def _app(tmp_path: Path):
    app, engine, service = make_auth_app(tmp_path)
    app.add_exception_handler(BillingError, billing_exception_handler)
    app.include_router(router)
    app.include_router(admin_router)
    app.state.billing = BillingServices.build(engine)
    return app, engine


def test_created_root_can_log_in_and_open_the_billing_console(tmp_path: Path, monkeypatch, capsys):
    app, engine = _app(tmp_path)
    monkeypatch.setenv("OMNI_STUDIO_DATABASE_URL", f"sqlite:///{tmp_path / 'auth.db'}")

    assert create_user_script.main([
        "--username", "superadmin", "--email", "admin@example.com", "--role", "root",
        "--password", PASSWORD, "--display-name", "超级管理员",
    ]) == 0
    printed = capsys.readouterr().out
    assert "platform role root" in printed and PASSWORD not in printed  # explicit passwords are not echoed

    user = AuthRepository(engine).find_user_by_username("superadmin")
    assert user is not None and RoleService(engine).role_of(user.id) == "root"

    with make_client(app, local=True) as client:
        login = client.post("/auth/login", json={"identifier": "superadmin", "password": PASSWORD})
        assert login.status_code == 200, login.text
        wallet = client.get("/billing/wallet").json()
        # Billing is off, yet root still gets its role so prices can be configured before go-live.
        assert wallet["enabled"] is False and wallet["role"] == "root"
        assert client.get("/admin/pricing/rule").json()["credits_per_yuan"] == 44.0
        assert client.get("/admin/roles").status_code == 200


def test_the_account_owns_a_private_workspace_and_names_must_be_unique(tmp_path: Path, monkeypatch, capsys):
    _, engine = _app(tmp_path)
    monkeypatch.setenv("OMNI_STUDIO_DATABASE_URL", f"sqlite:///{tmp_path / 'auth.db'}")
    create_user_script.main(["--username", "superadmin", "--email", "a@example.com", "--password", PASSWORD])
    capsys.readouterr()

    repository = AuthRepository(engine)
    user = repository.find_user_by_username("superadmin")
    workspaces = repository.list_user_workspaces(user.id)
    assert len(workspaces) == 1 and workspaces[0].role == "owner"
    assert workspaces[0].workspace.slug == "default"  # login looks the landing workspace up by this slug

    assert create_user_script.main(["--username", "SuperAdmin", "--email", "b@example.com", "--password", PASSWORD]) == 1
    assert create_user_script.main(["--username", "other", "--email", "A@example.com", "--password", PASSWORD]) == 1


def test_generated_passwords_survive_the_password_policy(tmp_path: Path, monkeypatch, capsys):
    _app(tmp_path)
    monkeypatch.setenv("OMNI_STUDIO_DATABASE_URL", f"sqlite:///{tmp_path / 'auth.db'}")
    assert create_user_script.main(["--username", "generated", "--email", "gen@example.com"]) == 0
    printed = capsys.readouterr().out
    assert "password: " in printed and len(printed.split("password: ")[1].splitlines()[0]) == 24
