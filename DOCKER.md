# Docker Deployment Guide

This guide covers Docker deployment for the FTSO Feed Value Provider, including
architecture explanation, setup, and troubleshooting.

## 📋 Table of Contents

- [Quick Start](#quick-start)
- [Running from Registry](#running-from-registry)
- [Dockerfile Architecture](#dockerfile-architecture)
- [Configuration](#configuration)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Monitoring](#monitoring)

## 🚀 Quick Start

### Using npm/pnpm Scripts (Recommended)

```bash
# Start the application
pnpm docker:up

# View logs
pnpm docker:logs

# Test the deployment
pnpm docker:test
# or
pnpm test:docker

# Stop the application
pnpm docker:down
```

### Using Docker Compose Directly

```bash
# Start in detached mode
docker-compose up -d

# View logs
docker-compose logs -f ftso-provider

# Check status
docker-compose ps

# Stop
docker-compose down
```

### Available Docker Scripts

| Script                                   | Command            | Description                          |
| ---------------------------------------- | ------------------ | ------------------------------------ |
| `pnpm docker:build`                      | Build Docker image | Builds the image without starting    |
| `pnpm docker:up`                         | Start containers   | Starts in detached mode              |
| `pnpm docker:down`                       | Stop containers    | Stops and removes containers         |
| `pnpm docker:restart`                    | Restart app        | Restarts the ftso-provider container |
| `pnpm docker:logs`                       | Follow logs        | Streams logs in real-time            |
| `pnpm docker:logs:tail`                  | View recent logs   | Shows last 100 log lines             |
| `pnpm docker:ps`                         | Container status   | Shows running containers             |
| `pnpm docker:test` or `pnpm test:docker` | Run tests          | Executes Docker deployment tests     |
| `pnpm docker:rebuild`                    | Full rebuild       | Stops, rebuilds from scratch, starts |
| `pnpm docker:shell`                      | Access shell       | Opens shell inside container         |

## 🌐 Running from Registry

The application is automatically published to GitHub Container Registry (GHCR)
via GitHub Actions.

### Quick Run from GHCR

```bash
# Pull and run the latest image
docker run --rm -it \
  --publish "0.0.0.0:3101:3101" \
  --publish "0.0.0.0:9090:9090" \
  ghcr.io/niftyleague/ftso-feed-value-provider:latest
```

### If Image is Private

```bash
# Login to GHCR (requires GitHub Personal Access Token)
echo "YOUR_GITHUB_TOKEN" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin

# Then pull and run
docker pull ghcr.io/niftyleague/ftso-feed-value-provider:latest
docker run --rm -it --publish "0.0.0.0:3101:3101" ghcr.io/niftyleague/ftso-feed-value-provider:latest
```

### Available Tags

- `latest` - Latest build from main branch
- `v1.0.0`, `v1.0.1`, etc. - Specific version releases

**For detailed registry documentation**, see
[DOCKER-REGISTRY.md](./DOCKER-REGISTRY.md)

## 🏗️ Dockerfile Architecture

The Dockerfile uses a **multi-stage build** pattern for optimal image size and
security. Here's why each stage exists:

### Stage 1: `base`

```dockerfile
FROM node:22-alpine AS base
```

**Purpose**: Creates a common foundation for all other stages

- Installs system dependencies (curl, dumb-init)
- Creates non-root user for security
- Enables pnpm via corepack
- Sets up working directory

**Why**: Reduces duplication by defining common setup once

### Stage 2: `dependencies`

```dockerfile
FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
```

**Purpose**: Installs ALL dependencies (including devDependencies)

- Needed for building TypeScript code
- Includes build tools like `@nestjs/cli`, `typescript`, etc.

**Why separate stage**: Build dependencies are large and not needed in
production

### Stage 3: `builder`

```dockerfile
FROM dependencies AS builder
COPY . .
RUN pnpm build
```

**Purpose**: Compiles TypeScript to JavaScript

- Copies source code
- Runs `nest build` to create `dist/` folder
- Includes all source files needed for build

**Why**: Separates build artifacts from source code

### Stage 4: `production-deps`

```dockerfile
FROM base AS production-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile
```

**Purpose**: Installs ONLY production dependencies

- No devDependencies (no TypeScript, no build tools)
- Significantly smaller than full dependencies
- Only runtime packages like `@nestjs/core`, `ccxt`, etc.

**Why separate from dependencies stage**:

- The `dependencies` stage has ~825 packages
- The `production-deps` stage has ~151 packages
- This saves ~200MB in the final image

### Stage 5: `production` (Final Image)

```dockerfile
FROM base AS production
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/config ./src/config
```

**Purpose**: Creates the minimal final image

- Only production dependencies
- Only compiled JavaScript (no TypeScript source)
- Only runtime config files
- Runs as non-root user

**Why this approach**:

- **Security**: Minimal attack surface, no build tools
- **Size**: ~400MB vs ~1.2GB with all dependencies
- **Speed**: Faster deployments and container starts

### Why Copy Dependencies Twice?

You noticed we install dependencies in two stages. Here's why:

1. **`dependencies` stage** (line 30):
   - Installs ALL packages including devDependencies
   - Used ONLY for building TypeScript
   - Never makes it to final image
   - Includes: typescript, @nestjs/cli, jest, eslint, etc.

2. **`production-deps` stage** (line 50):
   - Installs ONLY production packages
   - Used in final image
   - Excludes: all dev tools
   - Includes: @nestjs/core, ccxt, axios, etc.

**Result**: Final image is 3x smaller and more secure!

### Why Copy `src/config` Manually?

The application reads `feeds.json` at runtime using:

```typescript
const feedsFilePath = join(process.cwd(), "src", "config", "feeds.json");
```

Since we only copy `dist/` (compiled code) to production, we need to explicitly
copy the runtime config files. The build process doesn't include JSON files in
`dist/` by default.

**Alternative approaches** (not implemented):

- Copy feeds.json to dist/ during build
- Use environment variables instead of JSON file
- Bundle JSON into compiled code

## 📊 Service Endpoints

| Endpoint      | URL                                | Description                |
| ------------- | ---------------------------------- | -------------------------- |
| **API**       | http://localhost:3101              | Main API endpoint          |
| **Health**    | http://localhost:3101/health       | System health check        |
| **Liveness**  | http://localhost:3101/health/live  | Kubernetes liveness probe  |
| **Readiness** | http://localhost:3101/health/ready | Kubernetes readiness probe |
| **Metrics**   | http://localhost:9090/metrics      | Prometheus metrics         |

## 📝 Example API Usage

### Get Feed Values

```bash
curl -X POST http://localhost:3101/feed-values \
  -H "Content-Type: application/json" \
  -d '{
    "feeds": [
      {"category": 1, "name": "BTC/USD"},
      {"category": 1, "name": "ETH/USD"}
    ]
  }'
```

### Response

```json
{
  "data": [
    {
      "feed": { "category": 1, "name": "BTC/USD" },
      "value": 101728.01,
      "source": "cache",
      "timestamp": 1762969923053,
      "confidence": 1
    }
  ]
}
```

## 🔧 Configuration

### Environment Variables

Key environment variables in `docker-compose.yml`:

```yaml
environment:
  - NODE_ENV=production # Production mode
  - LOG_LEVEL=warn # Logging level
  - VALUE_PROVIDER_CLIENT_PORT=3101
  - MONITORING_ENABLED=true
  - ENABLE_FILE_LOGGING=false # Console only in Docker
```

### Volumes

```yaml
volumes:
  - ftso-logs:/app/logs # Persistent logs (if enabled)
```

### Resource Limits

```yaml
deploy:
  resources:
    limits:
      memory: 1G
      cpus: "1.0"
```

## 🧪 Testing

Run the automated test suite:

```bash
./test-docker.sh
```

This tests:

- ✅ Container is running
- ✅ Liveness endpoint
- ✅ Health endpoint
- ✅ Feed values API
- ✅ Metrics endpoint

## 🐛 Troubleshooting

### Container Won't Start

```bash
# Check logs
pnpm docker:logs:tail

# Check for port conflicts
lsof -i :3101
lsof -i :9090

# Rebuild from scratch
pnpm docker:rebuild
```

### Health Check Shows "Unhealthy"

This is normal during startup (first 60 seconds). The system needs time to:

- Connect to multiple exchanges
- Initialize data sources
- Warm up the cache

Wait 1-2 minutes and check again:

```bash
# Check container status
pnpm docker:ps

# Test health endpoint
curl http://localhost:3101/health

# Or run full test suite
pnpm docker:test
```

### "Cannot find module" Errors

If you see errors about missing files:

1. Ensure `src/config/feeds.json` exists
2. Rebuild: `docker-compose build --no-cache`
3. Check Dockerfile COPY commands

### No Data Returned

```bash
# Check exchange connections in logs
docker-compose logs ftso-provider | grep -i "connected\|websocket"

# Verify feed name is correct
curl -X POST http://localhost:3101/feed-values \
  -H "Content-Type: application/json" \
  -d '{"feeds":[{"category":1,"name":"BTC/USD"}]}'
```

## 📈 Monitoring

### With Monitoring Stack

```bash
# Start with Prometheus and Grafana
docker-compose --profile monitoring up -d

# Access services
# - Application: http://localhost:3101
# - Metrics: http://localhost:9090
# - Prometheus: http://localhost:9091
# - Grafana: http://localhost:3000 (admin/admin)
```

### Prometheus Metrics

View available metrics:

```bash
curl http://localhost:9090/metrics
```

### Grafana Dashboards

Import dashboards from `monitoring/grafana/dashboards/` for visualization.

## 🔒 Security Features

### Container Security

- ✅ Runs as non-root user (`ftso-provider:nodejs`)
- ✅ Minimal Alpine Linux base image
- ✅ Security updates applied
- ✅ Proper signal handling with dumb-init
- ✅ No build tools in production image

### Network Security

- ✅ Custom Docker network for isolation
- ✅ Only necessary ports exposed (3101, 9090)
- ✅ Health check endpoints for load balancers

## 🔄 Updates and Rebuilds

After making code changes:

```bash
# Quick rebuild and restart
docker-compose up -d --build

# Or full rebuild
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

## 🚀 Production Considerations

### Resource Management

- Adjust memory/CPU limits in `docker-compose.yml`
- Monitor resource usage: `docker stats ftso-provider`

### Logging

- Configure log rotation to prevent disk issues
- Consider centralized logging (ELK, Loki)

### Secrets Management

- Use Docker secrets for sensitive data
- Never commit credentials to version control

### High Availability

- Use orchestration (Kubernetes, Docker Swarm)
- Implement load balancing
- Configure auto-scaling

### Monitoring

- Deploy Prometheus + Grafana stack
- Set up alerting for critical metrics
- Monitor exchange connections

## 📚 Additional Resources

- [.env.example](./.env.example) - All available environment variables
- [package.json](./package.json) - Project dependencies
- [test-docker.sh](./test-docker.sh) - Automated testing script

## 🆘 Common Issues

### Issue: "Cannot find module '/app/dist/main.js'"

**Solution**: The build output is in `dist/src/main.js`. This is already fixed
in the Dockerfile.

### Issue: "ENOENT: no such file or directory, open '/app/src/config/feeds.json'"

**Solution**: The Dockerfile now copies `src/config/` from the builder stage.

### Issue: "EACCES: permission denied, mkdir '/app/app/logs'"

**Solution**: Disable file logging in Docker or fix the LOG_DIRECTORY path.
Current config uses console logging only.

### Issue: Container shows "unhealthy" but API works

**Solution**: This is normal during startup. The readiness check is strict. If
`/health` returns "healthy", the app is working fine.

## 📞 Support

For issues:

1. Check logs: `docker-compose logs -f ftso-provider`
2. Run tests: `./test-docker.sh`
3. Verify health: `curl http://localhost:3101/health`
4. Check resources: `docker stats ftso-provider`
