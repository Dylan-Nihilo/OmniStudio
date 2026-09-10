#!/usr/bin/env bash

set -Eeuo pipefail

readonly DEPLOY_SHA="${1:-}"
readonly APP_DIR="/opt/omnistudio/app"
readonly BACKUP_DIR="/opt/omnistudio/backups"
readonly PREVIOUS_COMPOSE="$BACKUP_DIR/docker-compose.previous.yml"
activation_started=0

if [[ ! "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Expected a full 40-character Git commit SHA" >&2
  exit 2
fi

rollback() {
  local status=$?
  trap - ERR

  if (( activation_started )); then
    echo "Deployment failed; restoring the previous images" >&2
    cp "$PREVIOUS_COMPOSE" "$APP_DIR/docker-compose.yml"
    docker image tag omnistudio-rollback-backend:previous app-backend:latest
    docker image tag omnistudio-rollback-frontend:previous app-frontend:latest
    docker compose up -d --no-build --wait --wait-timeout 180 || \
      echo "Automatic rollback failed; manual recovery is required" >&2
  fi

  exit "$status"
}
trap rollback ERR

cd "$APP_DIR"

available_kb=$(df --output=avail "$APP_DIR" | tail -n 1)
if (( available_kb < 2097152 )); then
  echo "Deployment requires at least 2 GiB of free disk space" >&2
  exit 1
fi

test -s .env
test -s "$PREVIOUS_COMPOSE"
docker compose config --quiet

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
database_url="$(grep -E '^OMNI_STUDIO_DATABASE_URL=' .env | cut -d= -f2- || true)"
if [[ "$database_url" == mysql* ]]; then
  # Hosted MySQL: consistent dump from the compose service before touching images.
  mysql_root_password="$(grep -E '^MYSQL_ROOT_PASSWORD=' .env | cut -d= -f2-)"
  backup="$BACKUP_DIR/omnistudio.$stamp.sql.gz"
  docker compose exec -T mysql mysqldump --single-transaction --routines --triggers \
    -uroot -p"$mysql_root_password" omnistudio | gzip > "$backup"
  test -s "$backup"
  gzip -t "$backup"
else
  database="output/omni_studio.db"
  if [[ ! -f "$database" ]]; then
    database="output/lumenx.db"
  fi

  if [[ -f "$database" ]]; then
    backup="$BACKUP_DIR/$(basename "$database").$stamp.bak"
    sqlite3 "$database" ".backup '$backup'"
    test "$(sqlite3 "$backup" 'PRAGMA quick_check;')" = "ok"
  fi
fi

docker image tag app-backend:latest omnistudio-rollback-backend:previous
docker image tag app-frontend:latest omnistudio-rollback-frontend:previous
docker compose build

activation_started=1
docker compose up -d --no-build --wait --wait-timeout 180
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:17177/health \
  | grep -Eq '"storage":\{"dialect":"(sqlite|mysql)","ok":true' \
  || { echo "backend storage check failed" >&2; exit 1; }
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3000/ > /dev/null
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3000/health > /dev/null

printf '%s\n' "$DEPLOY_SHA" > .deployed-commit
echo "Deployed $DEPLOY_SHA"
