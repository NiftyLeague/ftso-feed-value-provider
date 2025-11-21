# Health Endpoints Documentation

## Overview

The FTSO Feed Value Provider exposes four health check endpoints for monitoring
system status, readiness, and liveness. These endpoints are designed for use by
load balancers, orchestration systems (Kubernetes, Docker), and monitoring
tools.

## Endpoints

### 1. `/health` - Basic Health Check

Returns comprehensive system health status including all integrated components.

**Method**: `GET`

**Response** (200 OK):

```json
{
  "status": "healthy",
  "timestamp": 1763593721230,
  "version": "1.0.0",
  "uptime": 37.216613584,
  "memory": {
    "rss": 625786880,
    "heapTotal": 495910912,
    "heapUsed": 453173880,
    "external": 37795229,
    "arrayBuffers": 34387782
  },
  "connections": 6,
  "adapters": 6,
  "cache": {
    "hitRate": 0,
    "entries": 0
  },
  "startup": {
    "initialized": true,
    "startTime": 1763593721230,
    "readyTime": 1763593736012
  }
}
```

**Fields**:

- `status`: Overall system health (`healthy`, `degraded`, `unhealthy`)
- `adapters`: Total number of configured exchange adapters
- `connections`: Number of healthy, connected data sources
- `uptime`: Process uptime in seconds
- `memory`: Node.js memory usage statistics
- `cache`: Cache performance metrics
- `startup`: Initialization timing information

**Use Case**: General health monitoring, dashboards, metrics collection

---

### 2. `/health/ready` - Readiness Probe

Indicates whether the system is ready to serve requests. Used by load balancers
and orchestration systems to determine if traffic should be routed to this
instance.

**Method**: `GET`

**Response** (200 OK when ready):

```json
{
  "ready": true,
  "status": "healthy",
  "timestamp": 1763593736012,
  "responseTime": 1,
  "checks": {
    "integration": {
      "ready": true,
      "status": "healthy",
      "error": null
    },
    "provider": {
      "ready": true,
      "status": "healthy",
      "error": null
    },
    "startup": {
      "ready": true
    }
  },
  "startup": {
    "startTime": 1763593721230,
    "readyTime": 1763593736012
  }
}
```

**Response** (503 Service Unavailable when not ready):

```json
{
  "ready": false,
  "status": "unhealthy",
  "timestamp": 1763593725000,
  "message": "System not ready - Status: unhealthy",
  "details": "Integration: initializing, Provider: initializing, Startup: not ready",
  "checks": {
    "integration": {
      "ready": false,
      "status": "initializing",
      "error": "Integration service not initialized"
    },
    "provider": {
      "ready": false,
      "status": "initializing",
      "error": null
    },
    "startup": {
      "ready": false
    }
  }
}
```

**Readiness Criteria**:

**Development Mode** (`NODE_ENV=development`):

- Integration service is initialized
- More lenient to allow faster development iteration

**Production Mode** (`NODE_ENV=production`):

- Integration service is initialized AND
- At least one data source is healthy OR successful aggregation is occurring
- Ensures the system can actually serve real data to users

**Use Case**: Kubernetes readiness probes, load balancer health checks,
deployment validation

---

### 3. `/health/live` - Liveness Probe

Indicates whether the application process is alive and responsive. Used by
orchestration systems to determine if the container should be restarted.

**Method**: `GET`

**Response** (200 OK when alive):

```json
{
  "alive": true,
  "timestamp": 1763593736012,
  "uptime": 49.575382709,
  "checks": {
    "integration": true,
    "provider": true,
    "memory": true,
    "responseTime": 0
  }
}
```

**Response** (503 Service Unavailable when not alive):

```json
{
  "alive": false,
  "timestamp": 1763593736012,
  "uptime": 49.575382709,
  "message": "Liveness check failed - System is not alive",
  "details": "Integration: false, Provider: false"
}
```

**Liveness Criteria**:

- Integration service is responsive
- Provider service is responsive
- Memory usage is below 90% of heap
- Response time is acceptable

**Use Case**: Kubernetes liveness probes, container health monitoring, automatic
restart triggers

---

### 4. `/health/detailed` - Detailed Health Information

Returns detailed health information for all system components including
performance metrics.

**Method**: `GET`

**Response** (200 OK):

```json
{
  "status": "healthy",
  "timestamp": 1763593736012,
  "uptime": 50.936473042,
  "version": "1.0.0",
  "components": {
    "database": {
      "component": "database",
      "status": "healthy",
      "timestamp": 1763593736012
    },
    "cache": {
      "component": "cache",
      "status": "healthy",
      "timestamp": 1763593736012
    },
    "adapters": {
      "component": "adapters",
      "status": "healthy",
      "timestamp": 1763593736012
    },
    "integration": {
      "component": "integration",
      "status": "healthy",
      "timestamp": 1763593736012
    }
  },
  "startup": {
    "initialized": true,
    "startTime": 1763593721230,
    "readyTime": 1763593736012
  }
}
```

**Use Case**: Debugging, detailed monitoring, troubleshooting

---

## Performance

All health endpoints are optimized for fast response times:

| Endpoint           | Typical Response Time |
| ------------------ | --------------------- |
| `/health`          | < 2ms                 |
| `/health/ready`    | < 2ms                 |
| `/health/live`     | < 1ms                 |
| `/health/detailed` | < 2ms                 |

## Rate Limiting

Health endpoints are **NOT rate limited** to allow frequent polling by
orchestration systems and load balancers.

## Testing

### Quick Health Check

```bash
./scripts/test-health.sh check
```

### Debug Mode

```bash
./scripts/test-health.sh debug
```

### Production Readiness Test

```bash
./scripts/test-health.sh production
```

### Comprehensive Integration Tests

```bash
./scripts/test-health-integration.sh
```

## Kubernetes Configuration

### Liveness Probe

```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: 3101
  initialDelaySeconds: 30
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 3
```

### Readiness Probe

```yaml
readinessProbe:
  httpGet:
    path: /health/ready
    port: 3101
  initialDelaySeconds: 10
  periodSeconds: 5
  timeoutSeconds: 3
  failureThreshold: 3
```

## Docker Compose Configuration

```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:3101/health/ready"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 40s
```

## Monitoring Integration

### Prometheus Metrics

The health endpoints can be scraped for metrics:

- System status
- Adapter count
- Connection count
- Memory usage
- Uptime

### Alerting Rules

Example alert conditions:

- `ready == false` for > 2 minutes
- `connections < 3` for > 5 minutes
- `status == "unhealthy"` for > 1 minute
- `memory.heapUsed / memory.heapTotal > 0.9`

## Troubleshooting

### System Not Ready

If `/health/ready` returns 503:

1. Check integration service status:

   ```bash
   curl http://localhost:3101/health/ready | jq '.checks.integration'
   ```

2. Check data source connections:

   ```bash
   curl http://localhost:3101/health | jq '{adapters, connections}'
   ```

3. Review startup logs:
   ```bash
   docker logs ftso-feed-value-provider
   ```

### Low Connection Count

If `connections` is lower than `adapters`:

1. Check proxy configuration (if in geo-blocked region):

   ```bash
   echo $WEBSOCKET_PROXY_ENABLED
   echo $WEBSOCKET_PROXY_URL
   ```

2. Check network connectivity to exchanges

3. Review adapter logs for connection errors

### Memory Issues

If memory usage is high:

1. Check current memory:

   ```bash
   curl http://localhost:3101/health | jq '.memory'
   ```

2. Trigger garbage collection (if enabled):

   ```bash
   kill -USR2 <pid>
   ```

3. Review cache size and hit rates

## Status Definitions

### Health Status

- **healthy**: All systems operational, no issues
- **degraded**: System operational but with reduced capacity or performance
- **unhealthy**: System not operational, cannot serve requests

### Ready Status

- **true**: System can serve requests, traffic should be routed here
- **false**: System cannot serve requests, do not route traffic

### Alive Status

- **true**: Process is running and responsive
- **false**: Process is unresponsive or deadlocked, should be restarted

## Best Practices

1. **Use `/health/ready` for load balancer health checks** - It provides the
   most accurate indication of whether the instance can serve traffic

2. **Use `/health/live` for container orchestration** - It detects deadlocks and
   unresponsive processes

3. **Monitor `/health` for metrics** - It provides comprehensive system
   information for dashboards

4. **Set appropriate timeouts** - Health checks should complete in < 5 seconds

5. **Configure failure thresholds** - Allow 2-3 failures before taking action to
   avoid flapping

6. **Use startup delays** - Give the system time to initialize before starting
   health checks (30-40 seconds)
