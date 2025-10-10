# Multi-stage production Dockerfile for FTSO Feed Value Provider
FROM node:22-alpine AS base

# Install security updates and required packages
RUN apk update && apk upgrade && \
    apk add --no-cache dumb-init curl && \
    rm -rf /var/cache/apk/*

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S ftso-provider -u 1001

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
RUN --mount=type=cache,target=/root/.local/share/pnpm \
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
RUN --mount=type=cache,target=/root/.local/share/pnpm \
    pnpm install --prod --frozen-lockfile && \
    pnpm store prune

# ===========================================
# Production stage
# ===========================================
FROM base AS production

# Set production environment
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=1024"

# Copy production dependencies
COPY --from=production-deps --chown=ftso-provider:nodejs /app/node_modules ./node_modules

# Copy built application
COPY --from=builder --chown=ftso-provider:nodejs /app/dist ./dist

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
CMD ["node", "dist/main.js"]