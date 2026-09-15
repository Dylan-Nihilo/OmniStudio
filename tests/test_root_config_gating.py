"""Provider credentials belong to whoever operates the deployment, not to every workspace.

On the hosted platform the operator holds the keys and users only pick models and spend
credits, so /config/env is root-only. A desktop build has no platform roles at all and its
owner has to be able to enter their own keys, so the gate only engages once a root exists.
"""

from __future__ import annotations

import pytest

from sqlalchemy import delete

from src.apps.comic_gen import api as api_module
from src.billing import BillingServices
from src.storage.schema import PlatformRole
from tests.test_w2_project_api import api_client  # noqa: F401  (fixture)


@pytest.fixture
def roles(api_client):  # noqa: F811
    """Role service on the same engine the app is using, for arranging each scenario."""
    engine = api_module.app.state.storage_engine
    services = BillingServices.build(engine)
    api_module.app.state.billing = services
    yield services.roles
    api_module.app.state.billing = None


def _setup_user_id(roles) -> str:
    # /auth/setup bootstraps its user as root, so that row identifies the owner.
    granted = [row for row in roles.list_roles() if row["role"] == "root"]
    assert granted, "setup should have bootstrapped a root"
    return str(granted[0]["user_id"])


PASSWORD = "correct horse battery staple"


def _hand_root_to_someone_else(client, roles) -> None:
    """Leave the deployment centrally operated, but by somebody other than this caller.

    platform_roles.user_id is a real foreign key, so the stand-in operator has to be an
    actual account; and revoke() refuses to remove the last root, so root moves before it
    is taken away. The invite flow logs in as the invitee, hence the login back at the end.
    """
    owner_id = _setup_user_id(roles)
    workspaces = client.get("/auth/workspaces")
    assert workspaces.status_code == 200, workspaces.text
    workspace_id = workspaces.json()[0]["id"]
    invite = client.post(f"/auth/workspaces/{workspace_id}/invitations",
                         json={"email": "operator@example.com"})
    assert invite.status_code == 201, invite.text
    client.post("/auth/logout")
    registered = client.post("/auth/invitations/register", json={
        "token": invite.json()["token"], "username": "operator",
        "email": "operator@example.com", "password": PASSWORD})
    assert registered.status_code == 201, registered.text

    roles.grant(registered.json()["user"]["id"], "root", by_user_id=None)
    roles.revoke(owner_id)

    client.post("/auth/logout")
    back = client.post("/auth/login", json={"identifier": "owner", "password": PASSWORD})
    assert back.status_code == 200, back.text


def _make_it_a_desktop_build(roles) -> None:
    """A packaged build never had platform roles, so drop the rows rather than revoking —
    revoke() would refuse to remove the last root, which is correct for a hosted platform."""
    with roles.engine.begin() as connection:
        connection.execute(delete(PlatformRole.__table__))


def test_root_can_read_provider_credentials(api_client, roles):  # noqa: F811
    assert roles.has_root() is True
    response = api_client.get("/config/env")
    assert response.status_code == 200, response.text
    assert "DASHSCOPE_API_KEY" in response.json()


def test_a_workspace_owner_who_is_not_root_is_refused(api_client, roles):  # noqa: F811
    """The case this gate exists for: a customer who owns their workspace but does not
    operate the platform. Credentials are ours, and their usage is accounted for in credits.
    """
    _hand_root_to_someone_else(api_client, roles)

    for method, call in (("GET", lambda: api_client.get("/config/env")),
                         ("POST", lambda: api_client.post("/config/env", json={"DASHSCOPE_API_KEY": "x"}))):
        response = call()
        assert response.status_code == 403, f"{method}: {response.text}"
        assert response.json()["error"]["code"] == "AUTH_ROOT_REQUIRED", response.text


def test_without_any_root_the_workspace_owner_keeps_access(api_client, roles):  # noqa: F811
    """Desktop regression. A packaged build has no platform roles, and its single user must
    still be able to configure their own providers."""
    _make_it_a_desktop_build(roles)
    assert roles.has_root() is False

    assert api_client.get("/config/env").status_code == 200
    assert api_client.post("/config/env", json={"DASHSCOPE_API_KEY": "desktop-key"}).status_code == 200


def test_model_defaults_stay_open_to_the_workspace(api_client, roles):  # noqa: F811
    """Only credentials moved to root. Which model a project defaults to is a creative
    choice and has to stay with the people doing the creating."""
    _hand_root_to_someone_else(api_client, roles)

    response = api_client.get("/config/model-settings")
    assert response.status_code == 200, response.text


def test_what_root_saves_lands_in_the_platform_layer(api_client, roles):  # noqa: F811
    """The point of this whole arrangement: root configures once, everybody gets it.

    Asserted against the store rather than only through the API, because the failure this
    replaces was invisible from the outside — the save returned 200 and read back correctly
    for root, while every other workspace was still resolving from .env.
    """
    saved = api_client.post("/config/env", json={"OSS_BASE_PATH": "platform-wide"})
    assert saved.status_code == 200, saved.text
    assert saved.json()["scope"] == "platform"

    repository = api_module.app.state.auth_service.repository
    assert repository.get_platform_provider_config()["OSS_BASE_PATH"] == "platform-wide"
    # And nothing was written to the caller's own workspace, which is what used to happen.
    workspace_id = api_client.get("/auth/me").json()["workspace"]["id"]
    assert "OSS_BASE_PATH" not in repository.get_workspace_provider_config(workspace_id)


def test_a_desktop_build_still_saves_to_its_own_workspace(api_client, roles):  # noqa: F811
    """Desktop regression. With no root there is no platform to configure, so the setting
    belongs where it always went — and stays out of the shared layer entirely."""
    _make_it_a_desktop_build(roles)

    saved = api_client.post("/config/env", json={"OSS_BASE_PATH": "this-machine"})
    assert saved.status_code == 200, saved.text
    assert saved.json()["scope"] == "workspace"

    repository = api_module.app.state.auth_service.repository
    workspace_id = api_client.get("/auth/me").json()["workspace"]["id"]
    assert repository.get_workspace_provider_config(workspace_id)["OSS_BASE_PATH"] == "this-machine"
    assert repository.get_platform_provider_config() == {}


def test_the_config_page_says_which_layer_it_edits(api_client, roles):  # noqa: F811
    """Root is editing settings for every customer, so the page has to be able to say so
    rather than leaving it to be inferred from a role badge."""
    assert api_client.get("/config/env").json()["config_scope"] == "platform"
    _make_it_a_desktop_build(roles)
    assert api_client.get("/config/env").json()["config_scope"] == "workspace"


def test_an_admin_can_read_the_console_but_not_change_prices(api_client, roles):  # noqa: F811
    """Only root configures. Admin keeps read access so operations can answer billing
    questions without holding the keys to the price book.
    """
    owner_id = _setup_user_id(roles)
    roles.grant(owner_id, "admin", by_user_id=None)

    assert api_client.get("/admin/pricing/items").status_code == 200
    refused = api_client.put("/admin/pricing/items", json={
        "item_id": "x", "model_id": "m", "stage": "image", "billing_unit": "image",
        "match": {}, "purchase_price_cny": 1.0})
    assert refused.status_code == 403, refused.text
