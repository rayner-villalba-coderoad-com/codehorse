# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev        # Start dev server (localhost:3000)
npm run build      # Production build
npm run lint       # ESLint

# Database
npx prisma migrate dev --name <name>   # Create and apply a migration
npx prisma generate                    # Regenerate Prisma client after schema changes
npx prisma studio                      # Open Prisma Studio GUI

# Inngest (background jobs) — run alongside npm run dev
npx inngest-cli@latest dev             # Start local Inngest dev server (http://localhost:8288)
```

For Inngest to work locally, `INNGEST_DEV=1` must be set in `.env`.

## Architecture

**CodeRoad AI Code Review** is an AI-powered GitHub PR review assistant. It connects to a user's GitHub repositories, listens for pull request events via webhooks, indexes the codebase into a vector DB, and generates AI code reviews using Google Gemini.

### Request / event flow

1. **GitHub webhook** fires on a PR → `POST /api/webhooks/github` → emits `"pr.review.requested"` Inngest event
2. **Inngest** picks up the event and runs `generateReview`:
   - Fetches PR diff and metadata via Octokit
   - Queries Pinecone for relevant codebase context (RAG)
   - Calls Google Gemini 2.5 Flash to produce the review
   - Posts the review as a GitHub PR comment
   - Sets a `coderoad/ai-review` commit status (`failure` on critical/high findings, else `success`) — see **Merge blocking**
   - Saves the review to the `Review` table
3. **Repository indexing** happens on `"repository.connected"` → `indexRepo` Inngest function fetches all repo files, generates embeddings, and upserts them into Pinecone

### Key directories

| Path | Purpose |
|------|---------|
| `app/` | Next.js App Router: pages, layouts, API routes |
| `app/api/` | `auth/[...all]` (better-auth), `inngest`, `webhooks/github` |
| `module/` | Feature modules — each owns its server actions, components, and hooks |
| `inngest/functions/` | `indexRepo` (codebase RAG indexing) and `generateReview` (AI review pipeline) |
| `lib/` | Singleton clients: `db.ts` (Prisma+PrismaPg), `auth.ts` (better-auth), `pinecone.ts` |
| `prisma/` | Schema and migrations |
| `components/ui/` | shadcn/ui component library |

### Module pattern

Business logic lives in `module/<feature>/` not in `app/`. Each module may contain:
- `actions/index.ts` — `"use server"` server actions called from client components
- `components/` — feature-specific React components
- `hooks/` — React hooks
- `lib/` — non-action server utilities

### Auth

better-auth handles GitHub OAuth. Server-side: import from `lib/auth.ts` and call `auth.api.getSession()`. Client-side: import from `lib/auth-client.ts` (`useSession`, `authClient.signOut`). Protected routes call `requireAuth()` from `module/auth/utils/`.

### Database

Prisma ORM with the native PrismaPg adapter (not the default Prisma engine). The client is a singleton in `lib/db.ts`. After any schema change run `npx prisma generate` — the generated types land in `lib/generated/`.

### AI / RAG

- Embeddings and vector storage: `@pinecone-database/pinecone` — configured in `lib/pinecone.ts`, logic in `module/ai/lib/rag.ts`
- Text generation: `@ai-sdk/google` with `google("gemini-2.5-flash")` via Vercel AI SDK `generateText`

### Merge blocking

After a review, `generateReview` posts a GitHub **commit status** (`repos.createCommitStatus`) on the PR head commit under the context `coderoad/ai-review`. `module/ai/agents/policy.ts` (`evaluateMergeBlock`) inspects the findings: any finding of severity **`critical` or `high`** (across all five agents — e.g. exploitable vulns, unmet Jira acceptance criteria) sets the status to `failure`; otherwise `success`. A failing status also prepends a "⛔ Merge blocked" banner to the PR comment, and the decision is persisted on the `Review` row (`blocking`, `criticalCount`, `highCount`).

The status helper lives in `module/github/lib/github.ts` (`setReviewStatus`, `REVIEW_STATUS_CONTEXT`). Because auth is a user OAuth token (`repo` scope), not a GitHub App, this uses commit statuses rather than Check Runs.

**A failing status only disables the merge button if the repo requires it.** To actually block merges, the repo owner must add `coderoad/ai-review` as a required status check: Repo → **Settings → Branches → Branch protection rule** → enable **"Require status checks to pass before merging"** → add `coderoad/ai-review`. The protection rule must be on the PR's **base** branch (commonly `main`); PRs targeting other unprotected branches are not gated.

### Environment variables

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL (Neon) connection string |
| `BETTER_AUTH_SECRET` | Auth session secret |
| `BETTER_AUTH_URL` | Base URL (e.g. `http://localhost:3000`) |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth app |
| `GITHUB_PERSONAL_ACCESS_TOKEN` | GitHub PAT for API calls |
| `NEXT_PUBLIC_APP_BASE_URL` | Public URL (used for webhook registration) |
| `INNGEST_DEV` | Set to `1` for local Inngest dev server |
| `PINECONE_DB_API_KEY` | Pinecone API key |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google Gemini API key (also used for embeddings/RAG, always) |
| `AI_PROVIDER` | Review chat model provider: `gemini` (default) or `anthropic` |
| `ANTHROPIC_API_KEY` | Anthropic API key (required when `AI_PROVIDER=anthropic`) |
| `ANTHROPIC_MODEL` | Optional Claude model override (default `claude-sonnet-4-6`) |
| `JIRA_BASE_URL` | Optional Jira Cloud base URL (e.g. `https://your-domain.atlassian.net`). Global **fallback** — per-user credentials saved in Settings take precedence |
| `JIRA_EMAIL` | Optional Atlassian account email for Jira API basic auth (fallback) |
| `JIRA_API_TOKEN` | Optional Atlassian API token (paired with `JIRA_EMAIL`). Per-user config in Settings overrides these. When neither a user's `JiraConfig` nor the `JIRA_*` vars are set, ticket enrichment is skipped and the testing agent runs in test-coverage mode |
| `INNGEST_SIGNING_KEY` / `INNGEST_EVENT_KEY` | **Production only** — register the app with Inngest Cloud so background jobs run. In production set these and do **not** set `INNGEST_DEV` |

## Deployment (CI/CD → GCP VM)

CI/CD runs on GitHub Actions and ships a Docker image to a GCP virtual machine.

- **Package manager:** dependencies install with **bun** (`bun.lock`). bun resolves the
  platform-specific native binaries (lightningcss / `@tailwindcss/oxide`) that npm's
  darwin-only `package-lock.json` cannot. The app is built and run with **Node 22**.
- **`.github/workflows/ci.yml`** — on every PR and on `main`: `bun install` → `prisma generate` → lint → `tsc --noEmit` → `next build`.
- **`.github/workflows/deploy.yml`** — on push to `main` (and manual `workflow_dispatch`): builds the `Dockerfile` (Next.js `output: "standalone"`; deps via bun, build via Node), pushes to **Google Artifact Registry**, runs `prisma migrate deploy` against Neon, then deploys to the VM over an **IAP SSH** tunnel. Auth to GCP is keyless via **Workload Identity Federation** (no service-account key in GitHub). `workflow_dispatch` accepts an `image_tag` input to **roll back** to a previously built image (skips build + migrate).
- **`deploy/`** — files that live on the VM at `/opt/coderoad`: `docker-compose.yml` (the `app` + self-hosted `inngest` + `ngrok` stack), `deploy.sh` (pull → `up -d` → prune → health-check, invoked by the workflow), `.env.example` (runtime vars template), and `vm-startup.sh` (VM bootstrap).

**Provisioning the VM** is documented step-by-step in [deploy/PROVISIONING.md](deploy/PROVISIONING.md). The chosen runtime topology: **ngrok** gives the box a public HTTPS URL (no domain/TLS) tunneling GitHub webhooks + OAuth + UI to the app, and a **self-hosted Inngest dev server** runs background jobs on the VM (`INNGEST_DEV=http://inngest:8288`; in-memory, not durable). Only ngrok faces the internet — no inbound app ports are opened. (For a production-grade setup instead, front the app with a reverse proxy + TLS + a real domain and use Inngest Cloud.)

**One-time setup**

- *GCP*: an Artifact Registry Docker repo; a WIF pool + provider bound to this GitHub repo; a **deployer SA** with `artifactregistry.writer`, `compute.osLogin` (or `instanceAdmin`), `iap.tunnelResourceAccessor`, `iam.serviceAccountUser`; the **VM's SA** with `artifactregistry.reader` and Docker configured via `gcloud auth configure-docker <REGION>-docker.pkg.dev`; IAP TCP forwarding allowed on port 22.
- *GitHub repo **variables***: `GCP_PROJECT_ID`, `GCP_REGION`, `GAR_REPO`, `GCE_INSTANCE`, `GCE_ZONE`, `NEXT_PUBLIC_APP_BASE_URL` (build-time public URL).
- *GitHub `production` environment **secrets***: `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT`, `DATABASE_URL`.
- *ngrok* (runtime URL): reserve a static ngrok domain **before** building the image (it's baked into `NEXT_PUBLIC_APP_BASE_URL` at build time); put `NGROK_AUTHTOKEN` + `NGROK_DOMAIN` in the VM `.env`. See PROVISIONING.md.
- *Inngest*: this deployment self-hosts the Inngest dev server (`INNGEST_DEV=http://inngest:8288` in the VM `.env`). For production instead, use Inngest Cloud — set `INNGEST_SIGNING_KEY`/`INNGEST_EVENT_KEY`, drop `INNGEST_DEV`, and sync `https://<url>/api/inngest` in the dashboard.

Local image smoke test: `docker build --build-arg NEXT_PUBLIC_APP_BASE_URL=http://localhost:3000 -t coderoad:test .` then `docker run --rm -p 3000:3000 --env-file .env coderoad:test`.
