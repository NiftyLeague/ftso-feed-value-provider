# Docker Deployment

This directory contains Docker configuration files for deploying the FTSO Feed
Value Provider.

## Files Overview

- `Dockerfile` - Multi-stage production Dockerfile with security hardening
- `docker-compose.yml` - Production deployment configuration with optional
  monitoring
- `monitoring/` - Prometheus and Grafana configuration files

## Quick Start

### Production Deployment

```bash
# Start production environment
docker-compose up -d

# Check status
docker-compose ps
```

### With Monitoring

```bash
# Start with monitoring stack
docker-compose --profile monitoring up -d

# Access services
# - Application: http://localhost:3101
# - Metrics: http://localhost:9090
# - Prometheus: http://localhost:9091
# - Grafana: http://localhost:3000 (admin/admin)
```

## Dockerfile Features

- **Multi-stage build** for optimized image size
- **Security hardening** with non-root user
- **Health checks** built-in
- **Signal handling** with dumb-init
- **Production dependencies** only in final image

## Environment Configuration

### Required Environment Variables

```bash
NODE_ENV=production
VALUE_PROVIDER_CLIENT_PORT=3101
MONITORING_METRICS_PORT=9090
```

### Optional Environment Variables

```bash
LOG_LEVEL=warn
ENABLE_FILE_LOGGING=true
LOG_DIRECTORY=/app/logs
CACHE_TTL_MS=1000
CACHE_MAX_ENTRIES=50000
ALERT_EMAIL_ENABLED=false
ALERT_WEBHOOK_ENABLED=false
```

## Health Checks

The container includes built-in health checks:

```bash
# Check container health
docker inspect ftso-provider | grep -A 10 Health

# Test health endpoint
curl http://localhost:3101/health/ready
```

## Monitoring

### Metrics

Prometheus metrics are available at `/metrics` on port 9090:

```bash
curl http://localhost:9090/metrics
```

### Grafana Dashboards

Import dashboards from `monitoring/grafana/dashboards/` for comprehensive
monitoring.

## Security

### Container Security

- Runs as non-root user (`ftso-provider:nodejs`)
- Minimal Alpine Linux base image
- Security updates applied
- Proper signal handling

### Network Security

- Custom Docker network for isolation
- Only necessary ports exposed
- Health check endpoints for load balancer integration

## Troubleshooting

### Common Commands

```bash
# View container logs
docker-compose logs -f ftso-provider

# Execute commands in container
docker-compose exec ftso-provider sh

# Check resource usage
docker stats ftso-provider

# Restart container
docker-compose restart ftso-provider
```

### Debug Mode

```bash
# Run with debug logging
docker-compose run --rm -e LOG_LEVEL=debug ftso-provider
```

## Production Considerations

1. **Resource Limits**: Adjust memory and CPU limits in docker-compose files
2. **Log Rotation**: Configure log rotation to prevent disk space issues
3. **Secrets Management**: Use Docker secrets for sensitive data
4. **Backup Strategy**: Implement regular backups of logs and configuration
5. **Monitoring**: Deploy monitoring stack for production observability
6. **SSL/TLS**: Configure HTTPS termination at load balancer level
7. **Scaling**: Use orchestration tools (Docker Swarm, Kubernetes) for scaling

## Support

For Docker-specific issues:

1. Check container logs: `docker-compose logs -f`
2. Verify health status: `docker inspect <container-name>`
3. Test endpoints: `curl http://localhost:3101/health`
4. Review resource usage: `docker stats`
