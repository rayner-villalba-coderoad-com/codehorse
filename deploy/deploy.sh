#!/usr/bin/env bash
# Deploy script run on the GCP VM (lives at /opt/coderoad/deploy.sh). Invoked by the
# Deploy workflow over IAP SSH:  ./deploy.sh <REGION>-docker.pkg.dev/<proj>/<repo>/coderoad:<tag>
set -euo pipefail

IMAGE="${1:?usage: deploy.sh <image:tag>}"
export IMAGE

# Always operate from this script's directory (where docker-compose.yml and .env live).
cd "$(dirname "$0")"

echo "Deploying ${IMAGE}"

# ── Snapshot the image currently backing the running container ──────────────
# We look this up by digest (not tag) so we can remove it after the swap even
# if it still carries its old version tag — which docker image prune -f would
# otherwise skip.
OLD_CONTAINER_ID=$(docker compose ps -q app 2>/dev/null || true)
OLD_IMAGE_ID=""
if [[ -n "${OLD_CONTAINER_ID}" ]]; then
  OLD_IMAGE_ID=$(docker inspect --format='{{.Image}}' "${OLD_CONTAINER_ID}" 2>/dev/null || true)
  echo "Current image digest: ${OLD_IMAGE_ID:-<unknown>}"
fi

# ── Pull new image and restart the service ───────────────────────────────────
docker compose pull
docker compose up -d --remove-orphans

# ── Remove the superseded image ──────────────────────────────────────────────
if [[ -n "${OLD_IMAGE_ID}" ]]; then
  NEW_IMAGE_ID=$(docker inspect --format='{{.Image}}' \
    "$(docker compose ps -q app)" 2>/dev/null || true)

  if [[ "${OLD_IMAGE_ID}" == "${NEW_IMAGE_ID}" ]]; then
    echo "Image digest unchanged — skipping old image removal."
  else
    echo "Removing old image ${OLD_IMAGE_ID}…"
    docker image rm "${OLD_IMAGE_ID}" \
      || echo "Warning: could not remove old image (may be referenced elsewhere)."
  fi
fi

# Catch any other dangling layers left over.
docker image prune -f

# ── Health check ─────────────────────────────────────────────────────────────
echo "Waiting for health…"
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3000/ >/dev/null 2>&1; then
    echo "Healthy — deploy complete."
    exit 0
  fi
  sleep 2
done

echo "Health check failed after ~60s. Recent logs:" >&2
docker compose logs --tail=80 app >&2 || true
exit 1