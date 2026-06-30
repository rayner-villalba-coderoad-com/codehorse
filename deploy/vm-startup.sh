#!/usr/bin/env bash
# GCP VM startup script — installs Docker + the compose plugin and prepares /opt/coderoad.
# Pass at instance creation: `--metadata-from-file startup-script=deploy/vm-startup.sh`.
# Idempotent: safe to re-run. Runs as root on the VM. It does NOT place secrets — the
# operator still copies docker-compose.yml + deploy.sh and writes /opt/coderoad/.env.
set -euo pipefail

REGION="${REGION:-us-central1}" # set via instance metadata or edit before creating the VM

export DEBIAN_FRONTEND=noninteractive

# --- Docker Engine + compose plugin (official apt repo) ---
if ! command -v docker >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
fi

# --- Artifact Registry auth via the VM's attached service account ---
# gcloud ships on Google's Ubuntu images; the credential helper uses the metadata SA,
# which needs roles/artifactregistry.reader.
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet || true

# --- App directory ---
mkdir -p /opt/coderoad

echo "vm-startup: done. Next: copy docker-compose.yml + deploy.sh into /opt/coderoad, write .env, then 'docker compose up -d'."
