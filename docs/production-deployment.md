# Production Deployment Guide

This guide covers deploying the FTSO Feed Value Provider in a production
environment using Docker containers.

## Prerequisites

- Docker Engine 20.10+ and Docker Compose 2.0+
- At least 2GB RAM and 1 CPU core available
- Network access to exchange APIs
- SSL certificates (if using HTTPS)

## Quick Start

### 1. Production Deployment from Registry (Recommended)

For production/VM deployments, use pre-built images from GitHub Container
Registry:

```bash
# Clone the repository (just for docker-compose.registry.yml)
git clone <repository-url>
cd ftso-feed-value-provider

# Login to GHCR (if image is private)
echo "YOUR_GITHUB_TOKEN" | docker login ghcr.io -u YOUR_USERNAME --password-stdin

# Deploy with optimal VM settings
NETWORK_MODE=host docker-compose -f docker-compose.registry.yml up -d

# Check container status
docker-compose -f docker-compose.registry.yml ps

# View logs
docker-compose -f docker-compose.registry.yml logs -f ftso-provider
```

### 2. Local Build Deployment

For development or custom builds:

```bash
# Clone the repository
git clone <repository-url>
cd ftso-feed-value-provider

# Build and start the production container
docker-compose up -d

# Check container status
docker-compose ps

# View logs
docker-compose logs -f ftso-provider
```

### 3. With Monitoring Stack

```bash
# From registry with monitoring (Prometheus + Grafana)
docker-compose -f docker-compose.registry.yml --profile monitoring up -d

# Or from local build
docker-compose --profile monitoring up -d

# Access Grafana at http://localhost:3000 (admin/admin)
# Access Prometheus at http://localhost:9091
```

## Configuration

### Environment Variables

The application uses environment variables for configuration. Key production
settings:

```bash
# Core Application
NODE_ENV=production
LOG_LEVEL=warn
APP_PORT=3101

# Monitoring
MONITORING_ENABLED=true
MONITORING_METRICS_PORT=9090

# Logging
ENABLE_FILE_LOGGING=true
LOG_DIRECTORY=/app/logs
ENABLE_PERFORMANCE_LOGGING=true
ENABLE_DEBUG_LOGGING=false

# Cache
CACHE_TTL_MS=1000
CACHE_MAX_ENTRIES=50000

# Alerting (configure as needed)
ALERT_EMAIL_ENABLED=true
ALERT_SMTP_HOST=your-smtp-host
ALERT_SMTP_USERNAME=your-username
ALERT_SMTP_PASSWORD=your-password
ALERT_EMAIL_TO=ops@yourcompany.com

ALERT_WEBHOOK_ENABLED=true
ALERT_WEBHOOK_URL=https://your-webhook-url
```

### Custom Configuration

Modify environment variables directly in the `docker-compose.yml` file or create
a `.env` file:

```bash
# Create .env file for custom settings
cat > .env << EOF
ALERT_SMTP_HOST=your-smtp-host
ALERT_SMTP_USERNAME=your-username
ALERT_SMTP_PASSWORD=your-password
ALERT_EMAIL_TO=ops@yourcompany.com
ALERT_WEBHOOK_URL=https://your-webhook-url
EOF
```

## Health Checks

The application provides several health check endpoints:

- **Readiness**: `GET /health/ready` - Application is ready to serve requests
- **Liveness**: `GET /health/live` - Application is running
- **Health**: `GET /health` - Comprehensive health status

### Load Balancer Integration

Configure your load balancer to use the readiness endpoint:

```nginx
# Nginx example
upstream ftso_provider {
    server ftso-provider:3101;
}

server {
    listen 80;
    server_name your-domain.com;

    location /health {
        proxy_pass http://ftso_provider;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location / {
        proxy_pass http://ftso_provider;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## Monitoring

### Metrics Endpoint

The application exposes Prometheus metrics at `/metrics` on port 9090:

```bash
# Check metrics
curl http://localhost:9090/metrics
```

### Key Metrics

- `ftso_provider_requests_total` - Total API requests
- `ftso_provider_request_duration_seconds` - Request duration histogram
- `ftso_provider_cache_hit_rate` - Cache hit rate
- `ftso_provider_data_freshness_seconds` - Data freshness
- `ftso_provider_exchange_connections` - Exchange connection status

### Grafana Dashboards

Import the provided dashboards for comprehensive monitoring:

1. Access Grafana at `http://localhost:3000`
2. Import dashboard JSON files from `monitoring/grafana/dashboards/`
3. Configure Prometheus as data source

## Security Considerations

### Container Security

The Dockerfile implements several security best practices:

- **Non-root user**: Application runs as `ftso-provider` user (UID 1001)
- **Minimal base image**: Uses Alpine Linux for smaller attack surface
- **Security updates**: Installs latest security patches
- **Signal handling**: Uses `dumb-init` for proper signal handling

### Network Security

```bash
# Use custom network for isolation
docker network create ftso-network

# Restrict container communication
docker-compose -f docker-compose.prod.yml up -d
```

### Secrets Management

For production, use Docker secrets or external secret management:

```bash
# Using Docker secrets
echo "your-smtp-password" | docker secret create smtp_password -
echo "your-webhook-token" | docker secret create webhook_token -

# Update docker-compose.prod.yml to use secrets
```

## Scaling

### Horizontal Scaling

```bash
# Scale the application
docker-compose up -d --scale ftso-provider=3
```

### Resource Limits

Adjust resource limits in `docker-compose.yml`:

```yaml
deploy:
  resources:
    limits:
      memory: 2G
      cpus: "2.0"
    reservations:
      memory: 1G
      cpus: "1.0"
```

## Backup and Recovery

### Log Backup

```bash
# Backup logs
docker run --rm -v ftso-feed-value-provider_ftso-logs:/data -v $(pwd):/backup alpine tar czf /backup/logs-backup.tar.gz -C /data .
```

### Configuration Backup

```bash
# Backup configuration
tar czf config-backup.tar.gz docker-compose.prod.yml monitoring/ .env.production
```

## Troubleshooting

### Common Issues

1. **Container won't start**

   ```bash
   # Check logs
   docker-compose logs ftso-provider

   # Check resource usage
   docker stats ftso-provider
   ```

2. **Health checks failing**

   ```bash
   # Test health endpoint directly
   curl -f http://localhost:3101/health/ready

   # Check container health
   docker inspect ftso-provider | grep -A 10 Health
   ```

3. **High memory usage**

   ```bash
   # Monitor memory
   docker stats ftso-provider

   # Adjust memory limits in docker-compose.yml
   ```

### Debug Mode

For debugging, run with debug logging:

```bash
# Override environment for debugging
docker-compose run --rm -e LOG_LEVEL=debug ftso-provider
```

## Maintenance

### Updates

```bash
# Pull latest changes
git pull origin main

# Rebuild and restart
docker-compose build --no-cache
docker-compose up -d
```

### Log Rotation

Configure log rotation in `docker-compose.yml`:

```yaml
logging:
  driver: "json-file"
  options:
    max-size: "50m"
    max-file: "5"
```

### Cleanup

```bash
# Remove unused containers and images
docker system prune -a

# Remove unused volumes
docker volume prune
```

## Performance Tuning

### Memory Optimization

```bash
# Adjust Node.js heap size
export NODE_OPTIONS="--max-old-space-size=2048"

# Update docker-compose.prod.yml
environment:
  - NODE_OPTIONS=--max-old-space-size=2048
```

### Cache Tuning

```bash
# Adjust cache settings
environment:
  - CACHE_TTL_MS=500
  - CACHE_MAX_ENTRIES=100000
```

## Support

For issues and support:

1. Check the logs: `docker-compose -f docker-compose.prod.yml logs -f`
2. Review health endpoints: `curl http://localhost:3101/health`
3. Monitor metrics: `curl http://localhost:9090/metrics`
4. Check GitHub issues for known problems

## Production Checklist

- [ ] Environment variables configured
- [ ] SSL certificates installed (if using HTTPS)
- [ ] Monitoring stack deployed
- [ ] Alerting configured
- [ ] Backup strategy implemented
- [ ] Resource limits set appropriately
- [ ] Health checks configured
- [ ] Log rotation enabled
- [ ] Security updates applied
- [ ] Load balancer configured
- [ ] DNS records updated
- [ ] Firewall rules configured
