#!/usr/bin/env bash
# Activate an independently built UI release without replacing production services.
set -Eeuo pipefail
umask 077

readonly release_sha="${1:-}"
readonly site_root=/opt/omnistudio-ui
readonly production_root=/opt/omnistudio/app
readonly ui_port="${UI_PORT:-80}"
default_origin=http://47.236.165.75
[[ "$ui_port" = 80 ]] || default_origin+=":$ui_port"
readonly public_origin="${UI_PUBLIC_ORIGIN:-$default_origin}"

[[ "$release_sha" =~ ^[0-9a-f]{40}$ ]] || { echo 'Expected a full commit SHA' >&2; exit 2; }
[[ "$ui_port" =~ ^(80|[1-9][0-9]{3,4})$ ]] && (( (ui_port == 80 || ui_port > 1023) && ui_port < 65536 && ui_port != 3000 )) || exit 2
[[ "$public_origin" =~ ^https?://[a-zA-Z0-9.-]+:$ui_port$ ]] || [[ "$ui_port" = 80 && "$public_origin" =~ ^http://[a-zA-Z0-9.-]+$ ]] || exit 2
readonly release_dir="$site_root/releases/$release_sha"
test -s "$release_dir/frontend/out/index.html"
test -s "$release_dir/Dockerfile.ui-site"
test -s "$release_dir/docker-compose.ui.yml"
test -s "$production_root/.env"
test "$(cat "$release_dir/.release-commit")" = "$release_sha"
grep -rq 'omni_studio_ui' "$release_dir/frontend/out/_next/static"

available_kb=$(df --output=avail "$site_root" | tail -n 1)
(( available_kb > 1048576 )) || { echo 'At least 1 GiB free space is required' >&2; exit 1; }
if [[ ! -s "$site_root/.release.env" ]] && ss -lntH | awk '{print $4}' | grep -qE ":$ui_port$"; then
    echo "Port $ui_port is already in use" >&2
    exit 1
fi

readonly production_backend=$(docker inspect omni-studio-backend --format '{{.Id}}')
readonly production_frontend=$(docker inspect omni-studio-frontend --format '{{.Id}}')
readonly runtime_image=$(docker inspect omni-studio-backend --format '{{.Image}}')
readonly runtime_tag="omnistudio-ui-runtime:${runtime_image#sha256:}"
docker image tag "$runtime_image" "$runtime_tag"
docker build --pull=false --target backend --build-arg "BACKEND_BASE=$runtime_tag" -f "$release_dir/Dockerfile.ui-site" -t "omnistudio-ui-backend:$release_sha" "$release_dir"
docker build --pull=false --target frontend -f "$release_dir/Dockerfile.ui-site" -t "omnistudio-ui-frontend:$release_sha" "$release_dir"

# Initialize a private snapshot once. Future releases keep this site's own edits.
if [[ ! -s "$site_root/.initialized" ]]; then
    install -d -m 700 "$site_root/output" "$site_root/runtime-config"
    rsync -a --exclude='*.db' --exclude='*.db-wal' --exclude='*.db-shm' "$production_root/output/" "$site_root/output/"
    database="$production_root/output/omni_studio.db"
    [[ -f "$database" ]] || database="$production_root/output/lumenx.db"
    test -f "$database"
    sqlite3 "file:$database?mode=ro" ".backup '$site_root/output/$(basename "$database")'"
    test "$(sqlite3 "$site_root/output/$(basename "$database")" 'PRAGMA quick_check;')" = ok
    install -m 600 "$production_root/.env" "$site_root/.env"
    if docker exec omni-studio-backend test -f /root/.omni-studio/config.json; then
        docker cp omni-studio-backend:/root/.omni-studio/config.json "$site_root/runtime-config/config.json"
        chmod 600 "$site_root/runtime-config/config.json"
    fi
    printf '%s\n' 'Independent snapshot; never resync production data on updates.' > "$site_root/.initialized"
fi

if [[ -s "$site_root/.release.env" ]]; then
    cp "$site_root/.ui.env" "$site_root/.previous-ui.env"
fi
UI_SITE_ROOT="$site_root" UI_SITE_ORIGIN="$public_origin" python3 - <<'PY'
import os
import secrets
from pathlib import Path
root = Path(os.environ['UI_SITE_ROOT'])
settings_path = root / '.ui.env'
previous = dict(line.split('=', 1) for line in settings_path.read_text().splitlines()) if settings_path.exists() else {}
values = {
    'APP_ENV': 'production',
    'OMNI_STUDIO_AUTH_COOKIE_PREFIX': 'omni_studio_ui',
    'OMNI_STUDIO_AUTH_SIGNING_SECRET': previous.get('OMNI_STUDIO_AUTH_SIGNING_SECRET') or secrets.token_urlsafe(48),
    'OMNI_STUDIO_AUTH_ALLOWED_ORIGINS': os.environ['UI_SITE_ORIGIN'],
    'OMNI_STUDIO_AUTH_COOKIE_SECURE': str(os.environ['UI_SITE_ORIGIN'].startswith('https:')).lower(),
    'OMNI_STUDIO_AUTH_TEST_BYPASS': 'false',
}
settings_path.write_text(''.join(f'{key}={value}\n' for key, value in values.items()))
PY

if [[ -s "$site_root/.release.env" ]]; then
    cp "$site_root/docker-compose.ui.yml" "$site_root/docker-compose.ui.previous.yml"
fi
cp "$release_dir/docker-compose.ui.yml" "$site_root/docker-compose.ui.yml"
cat > "$site_root/.candidate.env" <<EOF
UI_BACKEND_IMAGE=omnistudio-ui-backend:$release_sha
UI_FRONTEND_IMAGE=omnistudio-ui-frontend:$release_sha
UI_PORT=$ui_port
EOF
compose=(docker compose --project-directory "$site_root" -f "$site_root/docker-compose.ui.yml")
"${compose[@]}" --env-file "$site_root/.candidate.env" config --quiet
if [[ -s "$site_root/.release.env" ]]; then
    cp "$site_root/.release.env" "$site_root/.previous-release.env"
fi

rollback() {
    local status=$?
    trap - ERR
    if [[ -s "$site_root/.previous-release.env" ]]; then
        cp "$site_root/.previous-ui.env" "$site_root/.ui.env"
        cp "$site_root/docker-compose.ui.previous.yml" "$site_root/docker-compose.ui.yml"
        "${compose[@]}" --env-file "$site_root/.previous-release.env" up -d --no-build --wait --wait-timeout 180 || true
    else
        "${compose[@]}" --env-file "$site_root/.candidate.env" down || true
    fi
    echo 'UI activation failed; production services were not changed' >&2
    exit "$status"
}
trap rollback ERR
"${compose[@]}" --env-file "$site_root/.candidate.env" up -d --no-build --wait --wait-timeout 180
curl --fail --silent --show-error --max-time 15 "http://127.0.0.1:$ui_port/" > /dev/null
curl --fail --silent --show-error --max-time 15 "http://127.0.0.1:$ui_port/health" > /dev/null
test "$(docker inspect omni-studio-backend --format '{{.Id}}')" = "$production_backend"
test "$(docker inspect omni-studio-frontend --format '{{.Id}}')" = "$production_frontend"
curl --fail --silent --show-error --max-time 15 http://127.0.0.1:3000/health > /dev/null
mv "$site_root/.candidate.env" "$site_root/.release.env"
printf '%s\n' "$release_sha" > "$site_root/.deployed-commit"
printf '%s\n' "$runtime_image" > "$release_dir/.backend-runtime-image"
echo "UI site deployed: $public_origin ($release_sha)"
