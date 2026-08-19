# Node 24 to match the template's engines field and .nvmrc.
FROM node:24.15.0-alpine AS base
# libc6-compat keeps sharp's prebuilt binaries happy on Alpine.
RUN apk add --no-cache libc6-compat && corepack enable
WORKDIR /app

# ---------------------------------------------------------------------------
# Dependencies
#
# Dev dependencies are installed on purpose. `payload migrate` transpiles
# src/payload.config.ts at runtime, so the migration step needs the TypeScript
# toolchain — which is also why this image is not built with Next's
# standalone output: a slim runtime cannot run the migration that the mounted
# volume requires. Image size is not what this demo optimises for.
# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Build
#
# No database is present here. The storefront renders dynamically (see the
# (app) layout) precisely so the image can be built without one — and so that
# stock levels are never frozen into a prerendered page.
# ---------------------------------------------------------------------------
FROM base AS builder
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM base AS runner

ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app ./

# The volume mounts here; the directory has to exist and be writable first.
RUN mkdir -p /data && chown nextjs:nodejs /data
VOLUME /data

USER nextjs
EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["pnpm", "start"]
