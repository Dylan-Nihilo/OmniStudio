#!/usr/bin/env bash
#
# Publishes the hosted pieces that live outside the compose project: the landing page and the
# gateway routes for the public domain in deploy/production.conf. Both used to be edited by
# hand on the host, so a redeploy from any other copy quietly brought the old address back.
# They are rendered from this repository on every production deploy instead, and each is left
# alone when it already matches.
#
#   scripts/deploy_public_site.sh <commit-sha>   publish and verify
#   scripts/deploy_public_site.sh --check        render and validate only; change nothing

set -Eeuo pipefail

readonly APP_DIR="${OMNI_STUDIO_APP_DIR:-/opt/omnistudio/app}"
readonly WEBSITE_ROOT="/opt/omnistudio/website"
readonly GATEWAY_CADDYFILE="/opt/kaizo/downloads/Caddyfile"
readonly GATEWAY_CONTAINER="kaizo-setup-downloads"
readonly GATEWAY_CONFIG_DIR="/etc/kaizo/downloads/caddy-config"
readonly BEGIN_MARK="# BEGIN omnistudio-public — managed by OmniStudio scripts/deploy_public_site.sh"
readonly END_MARK="# END omnistudio-public"
# The hand-written section this script takes over on its first run.
readonly LEGACY_MARK="# OmniStudio: landing at /"
readonly WEBSITE_FILES=(index.html main.js styles.css)

mode="${1:-}"
if [[ "$mode" == "--check" ]]; then
  check_only=1
  deploy_sha=""
elif [[ "$mode" =~ ^[0-9a-f]{40}$ ]]; then
  check_only=0
  deploy_sha="$mode"
else
  echo "usage: $0 <40-character commit SHA> | --check" >&2
  exit 2
fi

cd "$APP_DIR"
set -a
# shellcheck source=../deploy/production.conf
source deploy/production.conf
set +a

# The gateway template and the landing links both hard-code /app/, so the address may only
# change host.
if [[ ! "${OMNI_STUDIO_PUBLIC_URL:-}" =~ ^https://([a-z0-9]([a-z0-9.-]*[a-z0-9])?)/app/$ ]]; then
  echo "OMNI_STUDIO_PUBLIC_URL must look like https://<host>/app/ (got '${OMNI_STUDIO_PUBLIC_URL:-}')" >&2
  exit 1
fi
readonly STUDIO_HOST="${BASH_REMATCH[1]}"

workdir="$(mktemp -d)"
website_switched=0
previous_target=""
gateway_changed=0
gateway_backup=""

restore() {
  local status=$?
  trap - ERR
  if (( gateway_changed )); then
    echo "Restoring the previous gateway configuration" >&2
    cat "$gateway_backup" > "$GATEWAY_CADDYFILE"
    docker restart "$GATEWAY_CONTAINER" >/dev/null || echo "Gateway restore failed; manual recovery is required" >&2
  fi
  if (( website_switched )) && [[ -n "$previous_target" ]]; then
    echo "Restoring the previous landing release $previous_target" >&2
    ln -sfn "$previous_target" "$WEBSITE_ROOT/current.next"
    mv -T "$WEBSITE_ROOT/current.next" "$WEBSITE_ROOT/current"
  fi
  exit "$status"
}
trap restore ERR
trap 'rm -rf "$workdir"' EXIT

check_website_source() {
  local source="deploy/website" file ref
  for file in "${WEBSITE_FILES[@]}"; do
    test -s "$source/$file"
  done
  # Absolute links to a raw host are how the landing page drifted off the domain before.
  if grep -EnH 'https?://([0-9]{1,3}\.){3}[0-9]{1,3}' "${WEBSITE_FILES[@]/#/$source/}"; then
    echo "deploy/website must link relatively, not to a raw IP address" >&2
    return 1
  fi
  grep -q 'href="/app/"' "$source/index.html" || {
    echo "deploy/website/index.html no longer links to /app/" >&2
    return 1
  }
  # Media stays on the host (shared/assets, ~80 MB); every reference must resolve there.
  while read -r ref; do
    [[ -n "$ref" ]] || continue
    if [[ ! -f "$WEBSITE_ROOT/shared/$ref" ]]; then
      echo "deploy/website references $ref, which is missing from $WEBSITE_ROOT/shared" >&2
      return 1
    fi
  done < <(grep -ohE 'assets/[A-Za-z0-9._/-]+\.[A-Za-z0-9]+' "${WEBSITE_FILES[@]/#/$source/}" | sort -u)
}

publish_website() {
  local digest name release staging file current
  digest="$(cd deploy/website && sha256sum "${WEBSITE_FILES[@]}" | sha256sum | cut -c1-12)"
  name="repo-$digest"
  release="$WEBSITE_ROOT/releases/$name"
  current="$(readlink "$WEBSITE_ROOT/current")"

  if [[ "$current" == "releases/$name" ]]; then
    echo "Landing page unchanged ($name)"
    return
  fi
  if (( check_only )); then
    echo "Landing page would switch from $current to releases/$name"
    return
  fi

  if [[ ! -d "$release" ]]; then
    staging="$WEBSITE_ROOT/releases/.$name.staging"
    rm -rf "$staging"
    install -d -m 755 "$staging"
    for file in "${WEBSITE_FILES[@]}"; do
      install -m 644 "deploy/website/$file" "$staging/$file"
      # nginx serves these with gzip_static.
      gzip -9 -n -c "$staging/$file" > "$staging/$file.gz"
      chmod 644 "$staging/$file.gz"
    done
    printf '{\n  "sourceCommit": "%s",\n  "publicUrl": "%s"\n}\n' \
      "$deploy_sha" "$OMNI_STUDIO_PUBLIC_URL" > "$staging/.release.json"
    chmod 644 "$staging/.release.json"
    mv -T "$staging" "$release"
  fi

  previous_target="$current"
  ln -sfn "releases/$name" "$WEBSITE_ROOT/current.next"
  mv -T "$WEBSITE_ROOT/current.next" "$WEBSITE_ROOT/current"
  website_switched=1
  printf '%s\n' "$previous_target" > "$WEBSITE_ROOT/previous-release"
  echo "Landing page switched from $previous_target to releases/$name"
}

render_gateway() {
  local block="$workdir/block.caddy"
  sed "s/__STUDIO_HOST__/$STUDIO_HOST/g" deploy/gateway/studio.caddy > "$block"
  if grep -q '__[A-Z_]*__' "$block"; then
    echo "deploy/gateway/studio.caddy has an unfilled placeholder" >&2
    return 1
  fi

  GW_BLOCK="$block" GW_CURRENT="$GATEWAY_CADDYFILE" GW_OUT="$workdir/Caddyfile" \
  GW_BEGIN="$BEGIN_MARK" GW_END="$END_MARK" GW_LEGACY="$LEGACY_MARK" \
  GW_HOST="$STUDIO_HOST" python3 - <<'PY'
import os
import re
import sys

current = open(os.environ["GW_CURRENT"], encoding="utf-8").read()
block = open(os.environ["GW_BLOCK"], encoding="utf-8").read().rstrip("\n")
begin, end, legacy = os.environ["GW_BEGIN"], os.environ["GW_END"], os.environ["GW_LEGACY"]
managed = f"{begin}\n{block}\n{end}\n"

if current.count(begin) == 1 and current.count(end) == 1 and current.index(begin) < current.index(end):
    head, rest = current.split(begin, 1)
    tail = rest.split(end, 1)[1].lstrip("\n")
    rendered = head + managed + (("\n" + tail) if tail else "")
elif begin in current or end in current:
    sys.exit("gateway Caddyfile has unbalanced omnistudio-public markers; fix it by hand")
elif legacy in current:
    # First run: take over the hand-written section, which was appended at the end. Refuse if
    # anything other than the Studio sites follows it, rather than swallowing someone else's.
    head, tail = current.split(legacy, 1)
    sites = {line.rstrip("{ ").strip() for line in tail.splitlines() if re.match(r"^[^\s#}].*\{\s*$", line)}
    expected = {os.environ["GW_HOST"], "omnistudiox.cn, www.omnistudiox.cn"}
    if not sites <= expected:
        sys.exit(f"unexpected sites after the legacy OmniStudio section: {sorted(sites - expected)}")
    rendered = head.rstrip("\n") + "\n\n" + managed
else:
    rendered = current.rstrip("\n") + "\n\n" + managed

open(os.environ["GW_OUT"], "w", encoding="utf-8").write(rendered)
PY
}

publish_gateway() {
  local image
  if cmp -s "$workdir/Caddyfile" "$GATEWAY_CADDYFILE"; then
    echo "Gateway unchanged"
    return
  fi
  diff -u "$GATEWAY_CADDYFILE" "$workdir/Caddyfile" || true

  image="$(docker inspect -f '{{.Image}}' "$GATEWAY_CONTAINER")"
  docker run --rm \
    -v "$workdir/Caddyfile:/etc/caddy/Caddyfile:ro" \
    -v "$GATEWAY_CONFIG_DIR:/config:ro" \
    "$image" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
  if (( check_only )); then
    echo "Gateway would be updated (validated)"
    return
  fi

  gateway_backup="$GATEWAY_CADDYFILE.bak-$(date -u +%Y%m%dT%H%M%SZ)"
  cp -p "$GATEWAY_CADDYFILE" "$gateway_backup"
  # Single-file bind mount: rewrite in place so the container keeps seeing the same inode.
  cat "$workdir/Caddyfile" > "$GATEWAY_CADDYFILE"
  gateway_changed=1
  # The gateway runs with `admin off`, so a restart is the only way to load the new routes.
  docker restart "$GATEWAY_CONTAINER" >/dev/null
  echo "Gateway updated (backup: $gateway_backup)"
}

fetch() {
  curl --fail --silent --show-error --max-time 15 \
    --resolve "$STUDIO_HOST:443:127.0.0.1" "https://$STUDIO_HOST$1"
}

verify() {
  local attempt landing app
  for attempt in $(seq 1 30); do
    if landing="$(fetch /)"; then
      break
    fi
    (( attempt < 30 )) || return 1
    sleep 2
  done
  grep -q 'href="/app/"' <<<"$landing" || { echo "landing page is not the repository version" >&2; return 1; }
  app="$(fetch /app/)"
  # Proves the frontend image was built with the canonical address.
  grep -qF "\"$OMNI_STUDIO_PUBLIC_URL\"" <<<"$app" || {
    echo "$OMNI_STUDIO_PUBLIC_URL does not carry the canonical redirect; was the frontend built from deploy/production.conf?" >&2
    return 1
  }
  fetch /health > /dev/null
  echo "Verified https://$STUDIO_HOST/ and $OMNI_STUDIO_PUBLIC_URL"
}

check_website_source
render_gateway
publish_website
publish_gateway
if (( ! check_only )); then
  verify
fi
