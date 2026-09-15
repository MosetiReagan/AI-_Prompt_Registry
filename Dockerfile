# Multi-stage Dockerfile for AI Prompt Registry
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/ ./packages/
COPY apps/ ./apps/
COPY tsconfig.json ./

FROM base AS build
RUN pnpm install --frozen-lockfile
RUN pnpm -r build
RUN pnpm prune --prod

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 appuser

COPY --from=build --chown=appuser:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=appuser:nodejs /app/packages ./packages
COPY --from=build --chown=appuser:nodejs /app/apps ./apps
COPY --from=build --chown=appuser:nodejs /app/package.json ./package.json

USER appuser

EXPOSE 3000

CMD ["node", "apps/api/dist/index.js"]
