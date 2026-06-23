# syntax=docker/dockerfile:1

# Multi-stage build producing a slim Next.js "standalone" runtime image.
# See next.config.ts (`output: "standalone"`) and deploy/ for how this is run on the VM.
#
# Dependencies are installed with bun (the repo's lockfile is bun.lock, and bun resolves
# the platform-specific native binaries — lightningcss / @tailwindcss/oxide — that npm's
# darwin-only package-lock.json cannot). The app is then built and run with Node.

# ---- deps: install node_modules with bun -----------------------------------
FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# ---- builder: generate the Prisma client and build the app with Node --------
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app
# Reuse the bun-installed modules (a standard node_modules tree Node can consume).
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* values are inlined at build time, so the public app URL must be
# present here (not just at runtime). Passed via --build-arg from CI.
ARG NEXT_PUBLIC_APP_BASE_URL
ENV NEXT_PUBLIC_APP_BASE_URL=${NEXT_PUBLIC_APP_BASE_URL}
ENV NEXT_TELEMETRY_DISABLED=1

# The Prisma client is generated into lib/generated/prisma (gitignored), so it must
# be regenerated in the image before the build can import it.
RUN npx prisma generate

# `next build` evaluates route modules to collect page data, and several clients
# (better-auth, the Gemini/Anthropic models, Pinecone, Prisma) initialize from env at
# import time. These throwaway placeholders are scoped to this RUN only (not baked into
# any image layer) so evaluation doesn't throw — the real values are supplied at runtime
# via the container's .env.
RUN BETTER_AUTH_SECRET=build-placeholder \
    BETTER_AUTH_URL=http://localhost:3000 \
    DATABASE_URL=postgresql://user:pass@localhost:5432/db \
    GOOGLE_GENERATIVE_AI_API_KEY=build-placeholder \
    PINECONE_DB_API_KEY=build-placeholder \
    GITHUB_CLIENT_ID=build-placeholder \
    GITHUB_CLIENT_SECRET=build-placeholder \
    npm run build

# ---- runner: minimal image that just runs the standalone server -------------
FROM node:22-alpine AS runner
RUN apk add --no-cache libc6-compat
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Run as a non-root user.
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# Static assets and the traced standalone server output.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Belt-and-suspenders: ensure the generated Prisma client is present even if tracing misses it.
COPY --from=builder --chown=nextjs:nodejs /app/lib/generated ./lib/generated

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
