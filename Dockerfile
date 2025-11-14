# Multi-stage production Dockerfile for FTSO Feed Value Provider
FROM node:22-bookworm-slim AS base

# Install security updates and required packages
RUN apt-get update && apt-get upgrade -y && \
    apt-get install -y --no-install-recommends dumb-init curl ca-certificates && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN groupadd -g 1001 nodejs && \
    useradd -r -u 1001 -g nodejs ftso-provider

# Set working directory
WORKDIR /app

# Enable corepack for pnpm
RUN corepack enable

# ===========================================
# Dependencies stage
# ===========================================
FROM base AS dependencies

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install all dependencies (including dev dependencies for build)
# Set HUSKY=0 to skip git hooks installation in Docker
RUN --mount=type=cache,target=/root/.local/share/pnpm \
    export HUSKY=0 && \
    pnpm install --frozen-lockfile

# ===========================================
# Build stage
# ===========================================
FROM dependencies AS builder

# Copy source code
COPY . .

# Build the application
RUN pnpm build

# ===========================================
# Production dependencies stage
# ===========================================
FROM base AS production-deps

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install only production dependencies
# Set HUSKY=0 to skip git hooks installation in Docker
RUN --mount=type=cache,target=/root/.local/share/pnpm \
    export HUSKY=0 && \
    pnpm install --prod --frozen-lockfile && \
    pnpm store prune

# ===========================================
# Production stage
# ===========================================
FROM base AS production

# Set production environment
# Note: Most configuration defaults are defined in src/config/environment.constants.ts
# Override via environment variables in docker-compose.yml or docker run command
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=1024"

# Copy production dependencies
COPY --from=production-deps --chown=ftso-provider:nodejs /app/node_modules ./node_modules

# Copy built application
COPY --from=builder --chown=ftso-provider:nodejs /app/dist ./dist

# Copy runtime config files (feeds.json is read at runtime via process.cwd())
COPY --from=builder --chown=ftso-provider:nodejs /app/src/config ./src/config

# Copy configuration files
COPY --chown=ftso-provider:nodejs package.json ./

# Create logs directory with proper permissions
RUN mkdir -p /app/logs && chown -R ftso-provider:nodejs /app/logs

# Switch to non-root user
USER ftso-provider

# Expose port
EXPOSE 3101

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3101/health/ready || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "dist/src/main.js"]