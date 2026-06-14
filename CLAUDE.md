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
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google Gemini API key |
