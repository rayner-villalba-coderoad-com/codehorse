#!/usr/bin/env bash
# Deploy script run on the GCP VM (lives at /opt/coderoad/deploy.sh). Invoked by the
# Deploy workflow over IAP SSH:  ./deploy.sh <REGION>-docker.pkg.dev/<proj>/<repo>/coderoad:<tag>
set -euo pipefail

IMAGE="${1:?usage: deploy.sh <image:tag>}"
export IMAGE

# Always operate from this script's directory (where docker-compose.yml and .env live).
cd "$(dirname "$0")"

echo "Deploying ${IMAGE}"
docker compose pull
docker compose up -d
# Reclaim disk from superseded images.
docker image prune -f

# Wait for the container to answer on the published loopback port.
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
