# Liara / Docker image for @trade/api (Bun monorepo)
FROM oven/bun:1.2

WORKDIR /app

# Workspace manifests first (better layer cache)
COPY package.json bun.lock bunfig.toml tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/market/package.json ./packages/market/
COPY apps/api/package.json ./apps/api/
# Present so the lockfile workspace entry resolves; not installed via --filter
COPY apps/web/package.json ./apps/web/

# Install API + its workspace deps only (skip Nuxt / web)
RUN bun install --frozen-lockfile --filter @trade/api --filter @trade/market --filter @trade/shared

COPY packages/shared ./packages/shared
COPY packages/market ./packages/market
COPY apps/api ./apps/api

# SQLite dir — mount a Liara disk here in production
RUN mkdir -p /app/apps/api/data

WORKDIR /app/apps/api

ENV PORT=3001
ENV DB_PATH=/app/apps/api/data/trade.db
ENV NODE_ENV=production

EXPOSE 3001

CMD ["bun", "src/index.ts"]
