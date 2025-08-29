FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm \
    corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
RUN pnpm install --production --frozen-lockfile \
    && pnpm store prune

FROM node:22-alpine AS release
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
CMD ["node", "dist/main.js"]