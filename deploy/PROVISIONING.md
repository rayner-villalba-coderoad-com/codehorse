# Provisioning CodeRoad on a GCP VM (ngrok + self-hosted Inngest)

How to stand up a GCP virtual machine that runs the app from a prebuilt Artifact Registry
image, exposed publicly through **ngrok** (no domain/TLS needed) with a **self-hosted Inngest
dev server** for background jobs.

This complements the CI/CD pipeline (`.github/workflows/deploy.yml`), which builds + pushes
the image and can deploy to this VM over IAP SSH.

## Topology

```
GitHub (webhooks, OAuth)  ─┐
browser (UI / login)       └─► ngrok edge ──outbound tunnel──► [ngrok] ─► app:3000
                                                                [app] ◄─► [inngest:8288]   (internal)
```

Only **ngrok** faces the internet (via an outbound connection — no inbound app ports are
opened). The app ↔ Inngest traffic stays on the Docker network. Three containers run from
[deploy/docker-compose.yml](./docker-compose.yml): `app`, `inngest`, `ngrok`.

## Placeholders

| Name | Example |
|------|---------|
| `PROJECT` | `my-gcp-project` |
| `REGION` / `ZONE` | `us-central1` / `us-central1-a` |
| `GAR_REPO` | `coderoad` |
| `VM` | `coderoad-vm` |
| `VM_SA` | `coderoad-vm@PROJECT.iam.gserviceaccount.com` |
| `NGROK_DOMAIN` | `your-reserved.ngrok-free.app` |

---

## 0. ngrok first — it gates the image build

`NEXT_PUBLIC_APP_BASE_URL` is baked into the image at **build time**, so the public URL must
exist before you build.

1. Create an ngrok account → copy your **authtoken**.
2. Reserve a **static domain** (Dashboard → Domains; the free tier includes one). This is
   `NGROK_DOMAIN`.

## 1. Build the image with the ngrok URL

In the GitHub repo settings, set the **variable** `NEXT_PUBLIC_APP_BASE_URL` =
`https://<NGROK_DOMAIN>`, then run the **Deploy** workflow (push to `main` or
`workflow_dispatch`). Artifact Registry now has an image built with that public URL.

## 2. Service account for the VM (pull-only)

```bash
gcloud iam service-accounts create coderoad-vm --project PROJECT

gcloud projects add-iam-policy-binding PROJECT \
  --member="serviceAccount:VM_SA" \
  --role="roles/artifactregistry.reader"
```

## 3. Create the VM

Ubuntu 24.04 LTS, `e2-small` (bump to `e2-medium` for headroom — the box only *runs* the
image; the build happens in CI). ngrok needs only egress, so no 80/443 rules.

```bash
gcloud compute instances create coderoad-vm --project PROJECT --zone ZONE \
  --machine-type e2-small \
  --image-family ubuntu-2404-lts-amd64 --image-project ubuntu-os-cloud \
  --boot-disk-size 20GB \
  --service-account VM_SA \
  --scopes https://www.googleapis.com/auth/cloud-platform \
  --metadata REGION=REGION \
  --metadata-from-file startup-script=deploy/vm-startup.sh
```

The startup script installs Docker + the compose plugin and runs
`gcloud auth configure-docker REGION-docker.pkg.dev` so the box can pull from GAR.

## 4. Lock down SSH (IAP only)

No public app ports; administer over IAP.

```bash
gcloud compute firewall-rules create allow-iap-ssh --project PROJECT \
  --direction=INGRESS --action=ALLOW --rules=tcp:22 \
  --source-ranges=35.235.240.0/20
```

> Hardened alternative: create the VM with `--no-address` and add **Cloud NAT** for egress.
> Simpler default (above): keep the ephemeral public IP for egress; the firewall leaves no
> app ports open and ngrok provides public ingress over its outbound tunnel.

## 5. Place app files and start the stack

```bash
gcloud compute ssh coderoad-vm --project PROJECT --zone ZONE --tunnel-through-iap
```

On the VM, into `/opt/coderoad` (created by the startup script) copy
[docker-compose.yml](./docker-compose.yml) and [deploy.sh](./deploy.sh), then create
`/opt/coderoad/.env` from [.env.example](./.env.example) and fill in real values:

- `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_BASE_URL` = `https://<NGROK_DOMAIN>`
- `INNGEST_DEV=http://inngest:8288` (already the example default)
- `NGROK_AUTHTOKEN` + `NGROK_DOMAIN`
- DB / GitHub / AI keys
- **No inline `# comments`** after values — `env_file` keeps them literally.

Start it (or let the Deploy workflow do `docker compose pull && up -d` over IAP):

```bash
cd /opt/coderoad
IMAGE="REGION-docker.pkg.dev/PROJECT/GAR_REPO/coderoad:latest" docker compose up -d
```

## 6. Point GitHub OAuth at the ngrok URL

In your GitHub OAuth App settings:
- **Homepage URL:** `https://<NGROK_DOMAIN>`
- **Authorization callback URL:** `https://<NGROK_DOMAIN>/api/auth/callback/github`

## 7. Connect a repository

Log in at `https://<NGROK_DOMAIN>` and connect a repo. The app auto-registers the webhook at
`https://<NGROK_DOMAIN>/api/webhooks/github` (via `createWebhook`, which reads
`NEXT_PUBLIC_APP_BASE_URL`) — no manual webhook setup needed.

---

## Caveats

- **ngrok free interstitial:** the free tier shows a browser warning page on HTML responses,
  which can break the browser-based OAuth login redirect. Webhook/Inngest POSTs are
  unaffected. Use a **paid ngrok plan** (or a real domain + Caddy/TLS) for clean OAuth.
- **Inngest dev server is not durable:** in-memory — a container restart drops run history and
  in-flight jobs. Fine for demo/staging. For production switch to **Inngest Cloud** (set
  `INNGEST_SIGNING_KEY`/`INNGEST_EVENT_KEY`, drop `INNGEST_DEV`) or self-hosted `inngest start`
  backed by Postgres + Redis.
- **Egress:** the VM must reach Artifact Registry, the ngrok edge, the Gemini/Pinecone APIs,
  Neon, and GitHub — all outbound (public IP or Cloud NAT).

## Verify

1. `docker compose ps` → `app`, `inngest`, `ngrok` all `Up`; `docker compose logs ngrok`
   shows `started tunnel` at `https://<NGROK_DOMAIN>`.
2. Open `https://<NGROK_DOMAIN>` in a browser → app loads, GitHub login works.
3. Inngest dashboard: tunnel the port and open it —
   `gcloud compute ssh coderoad-vm --zone ZONE --tunnel-through-iap -- -L 8288:localhost:8288`
   then `http://localhost:8288` lists the app and its 3 functions.
4. End-to-end: open a PR on a connected repo → within ~1 min the review comment + the
   `coderoad/ai-review` status appear, and the Inngest dashboard shows a `generateReview` run.
