"""Every backend route prefix must be proxied by the SPA's nginx, or the browser gets HTML.

docker/nginx.conf forwards an allowlist of path prefixes to FastAPI and falls back to
index.html for everything else. A route the allowlist misses does not 404 — it silently
returns the SPA shell, so the frontend sees HTML where it expected JSON and the feature
just looks broken. This happened to /billing and /admin.
"""

from __future__ import annotations

import re
from pathlib import Path

from src.apps.comic_gen.api import app

NGINX_CONF = Path(__file__).resolve().parents[1] / "docker" / "nginx.conf"

# Paths the browser never calls directly (mounted static files, internal redirects).
EXEMPT_PREFIXES = {"openapi.json", "redoc"}


def _allowlisted_prefixes() -> set[str]:
    conf = NGINX_CONF.read_text(encoding="utf-8")
    match = re.search(r"location ~ \^/\(([^)]+)\)", conf)
    assert match, "could not find the API location block in nginx.conf"
    return {prefix.replace("\\", "") for prefix in match.group(1).split("|")}


def _route_prefixes() -> set[str]:
    prefixes = set()
    for route in app.routes:
        path = getattr(route, "path", "")
        if not path.startswith("/") or path == "/":
            continue
        first = path.lstrip("/").split("/", 1)[0]
        if first.startswith("{") or not first:
            continue
        prefixes.add(first)
    return prefixes


def test_every_backend_prefix_is_proxied_to_fastapi():
    missing = sorted(_route_prefixes() - _allowlisted_prefixes() - EXEMPT_PREFIXES)
    assert missing == [], (
        "these prefixes would return the SPA's index.html instead of JSON; "
        f"add them to the location block in docker/nginx.conf: {missing}"
    )


def test_billing_and_admin_are_proxied():
    allowlist = _allowlisted_prefixes()
    assert {"billing", "admin"} <= allowlist
