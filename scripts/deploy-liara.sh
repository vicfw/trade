#!/usr/bin/env bash
# Deploy @trade/api and/or @trade/web to Liara (Docker).
# Usage:
#   ./scripts/deploy-liara.sh api
#   ./scripts/deploy-liara.sh web
#   ./scripts/deploy-liara.sh all

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TARGET="${1:-}"

if [[ -z "$TARGET" ]]; then
  echo "Usage: $0 api|web|all" >&2
  exit 1
fi

if ! command -v liara >/dev/null 2>&1; then
  echo "liara CLI not found. Install: npm i -g @liara/cli" >&2
  exit 1
fi



API_APP="${LIARA_API_APP:-trade-api}"
WEB_APP="${LIARA_WEB_APP:-trade-web}"
API_DISK="${LIARA_API_DISK:-data:/app/apps/api/data}"

deploy_api() {
  echo "==> Deploying API ($API_APP)…"
  liara deploy \
    --app="$API_APP" \
    --platform=docker \
    --port=3001 \
    --dockerfile=Dockerfile \
    --build-location="$BUILD_LOCATION" \
    --disks "$API_DISK" \
    --no-app-logs
  echo "==> API deployed: https://${API_APP}.liara.run"
}

deploy_web() {
  echo "==> Deploying Web ($WEB_APP)…"
  liara deploy \
    --app="$WEB_APP" \
    --platform=docker \
    --port=3000 \
    --dockerfile=Dockerfile.web \
    --build-location="$BUILD_LOCATION" \
    --no-app-logs
  echo "==> Web deployed: https://${WEB_APP}.liara.run"
}

case "$TARGET" in
  api) deploy_api ;;
  web) deploy_web ;;
  all)
    deploy_api
    deploy_web
    ;;
  *)
    echo "Unknown target: $TARGET (use api|web|all)" >&2
    exit 1
    ;;
esac
