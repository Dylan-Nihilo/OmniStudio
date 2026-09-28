"""The hosted site shares one domain between the landing page and the Studio application.

deploy/gateway/studio.caddy sends /, the landing files and /assets/* to the landing page,
/app/* to the application with the prefix stripped, and everything else (the application's
/_next chunks, root-level images and every API prefix) to the application as well. Nothing
fails loudly if the two sides start claiming the same path — the application just gets the
landing page's file or the other way round — so the split is pinned here.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PRODUCTION_CONF = ROOT / "deploy" / "production.conf"
GATEWAY = ROOT / "deploy" / "gateway" / "studio.caddy"
WEBSITE = ROOT / "deploy" / "website"
FRONTEND_PUBLIC = ROOT / "frontend" / "public"
NGINX_CONF = ROOT / "docker" / "nginx.conf"

LANDING_FILES = ("index.html", "main.js", "styles.css")
# Top-level paths the gateway hands to the landing page (besides / itself).
LANDING_PREFIXES = {"app", "assets", *LANDING_FILES}


def _public_url() -> str:
    values = dict(
        line.split("=", 1)
        for line in PRODUCTION_CONF.read_text(encoding="utf-8").splitlines()
        if line and not line.startswith("#")
    )
    return values["OMNI_STUDIO_PUBLIC_URL"]


def _gateway_app_carve_outs() -> set[str]:
    match = re.search(r"not path ([^\n]+)", GATEWAY.read_text(encoding="utf-8"))
    assert match, "the landing matcher in studio.caddy no longer carves out application assets"
    return {re.fullmatch(r"/assets/([^/]+)/\*", item).group(1) for item in match.group(1).split()}


def test_public_url_is_a_host_serving_the_app_under_app():
    # deploy_public_site.sh, the gateway template and the landing links all assume /app/.
    assert re.fullmatch(r"https://[a-z0-9.-]+/app/", _public_url())


def test_landing_page_links_to_the_app_relatively():
    index = (WEBSITE / "index.html").read_text(encoding="utf-8")
    assert 'href="/app/"' in index
    for name in LANDING_FILES:
        text = (WEBSITE / name).read_text(encoding="utf-8")
        assert not re.search(r"https?://(\d{1,3}\.){3}\d{1,3}", text), (
            f"deploy/website/{name} links to a raw IP address; keep links on the public domain"
        )


def test_no_backend_prefix_is_claimed_by_the_landing_page():
    conf = NGINX_CONF.read_text(encoding="utf-8")
    match = re.search(r"location ~ \^/\(([^)]+)\)", conf)
    assert match
    api_prefixes = {prefix.replace("\\", "") for prefix in match.group(1).split("|")}
    assert api_prefixes & LANDING_PREFIXES == set()


def test_application_root_files_do_not_collide_with_the_landing_page():
    top_level = {path.name for path in FRONTEND_PUBLIC.iterdir()}
    assert top_level & (LANDING_PREFIXES - {"assets"}) == set()


def test_every_application_asset_folder_is_carved_out_of_the_landing_page():
    app_asset_dirs = {path.name for path in (FRONTEND_PUBLIC / "assets").iterdir() if path.is_dir()}
    loose_files = [path.name for path in (FRONTEND_PUBLIC / "assets").iterdir() if path.is_file()]
    assert loose_files == [], "files directly under frontend/public/assets would be served by the landing page"
    assert app_asset_dirs == _gateway_app_carve_outs(), (
        "update the `not path` list in deploy/gateway/studio.caddy to match frontend/public/assets"
    )
    landing_asset_dirs = {
        match.split("/")[1]
        for name in LANDING_FILES
        for match in re.findall(r"assets/[A-Za-z0-9_-]+/", (WEBSITE / name).read_text(encoding="utf-8"))
    }
    assert landing_asset_dirs & app_asset_dirs == set()


def test_gateway_template_takes_its_host_from_production_env():
    template = GATEWAY.read_text(encoding="utf-8")
    assert "__STUDIO_HOST__ {" in template
    assert "studio.omnisline.com" not in template
    assert "handle_path /app/*" in template
