# Health Endpoints Documentation

## Overview

The FTSO Feed Value Provider exposes multiple health check endpoints, each with
a distinct purpose for monitoring system status, readiness, and liveness.
Understanding the role of each is crucial for effective monitoring and
orchestration.

- **`/health` (Primary Health Check)**: Answers "Is the application
  operational?" Used for Docker health checks.
- **`/health/ready` (Readiness)**: Answers "Is the application ready to serve
  traffic?" Used for Kubernetes readiness probes.
- **`/health/live` (Liveness)**: Answers "Is the application running?" Used for
  Kubernetes liveness probes.
- **`/health/detailed` (Debugging)**: Provides a verbose report for human
  analysis.

## Endpoints

### 1. `/health` - Primary Health Check

Returns a simple `200 OK` if the system is `healthy` or `degraded`, and a
`503 Service Unavailable` if `unhealthy`. This is the primary endpoint for
Docker health checks.

A `degraded` status indicates that the application is functional but may have
non-critical issues (e.g., a single data source is down). It is still considered
"healthy" by Docker to avoid unnecessary container restarts. An `unhealthy`
status means the application cannot function correctly.

**Method**: `GET`

**Response** (200 OK):

```json
{
  "status": "healthy",
  "timestamp": 1763593721230
}
```

**Fields**:

- `status`: The overall system health (`healthy`, `degraded`, or `unhealthy`).
- `timestamp`: The timestamp of the health check.

**Use Case**: The primary health check for orchestration systems like Docker
that need a reliable signal of the application's overall operational status.

---

### 2. `/health/ready` - Readiness Probe

Indicates whether the system is ready to serve requests. Used by load balancers
and orchestration systems (like Kubernetes) to determine if traffic should be
routed to this instance.

**Method**: `GET`

**Response** (200 OK when ready):

```json
{
  "ready": true,
  "status": "ready",
  "timestamp": 1763593736012,
  "responseTime": 1,
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

**Use Case**: Kubernetes readiness probes and load balancer health checks. It
ensures the instance can do its job before receiving traffic.

---

### 3. `/health/live` - Liveness Probe

Indicates whether the application process is alive and responsive. Used by
orchestration systems to determine if the container should be restarted.

**Method**: `GET`

**Response** (200 OK when alive):

```json
{
  "alive": true,
  "status": "alive",
  "timestamp": 1763593736012,
  "uptime": 49.575
}
```

**Response** (503 Service Unavailable when not alive):

```json
{
  "alive": false,
  "status": "dead",
  "timestamp": 1763593736012,
  "uptime": 49.575,
  "message": "Liveness check failed - System is not alive",
  "details": "Integration: false, Provider: false"
}
```

**Liveness Criteria**:

- Integration service is responsive
- Memory usage is below 90% of heap

**Use Case**: Kubernetes liveness probes. If this fails, the container should be
restarted.

---

### 4. `/health/detailed` - Detailed Health Information

Returns detailed health information for all system components including
performance metrics.

**Method**: `GET`

**Response** (200 OK):

```json
{
  "status": "healthy",
  "timestamp": 1678886400000,
  "uptime": 7200,
  "version": "1.0.0",
  "memory": {
    "used": 128,
    "total": 512,
    "external": 50,
    "rss": 200
  },
  "details": {
    "environment": "development",
    "nodeVersion": "v18.12.0",
    "platform": "darwin",
    "pid": 12345
  },
  "components": {
    "provider": {
      "status": "healthy",
      "details": { "sources": [], "aggregation": {} }
    },
    "cache": {
      "status": "healthy",
      "details": { "hitRate": 0.95, "totalEntries": 1000 }
    },
    "aggregation": {
      "status": "healthy",
      "details": { "totalEntries": 500, "averageAge": 1500 }
    },
    "integration": {
      "status": "healthy",
      "details": { "connected": 6, "total": 6 }
    },
    "performance": {
      "status": "healthy",
      "details": { "averageResponseTime": 150 }
    },
    "api": {
      "status": "healthy",
      "details": {
        "totalRequests": 1000,
        "requestsPerMinute": 120,
        "averageResponseTime": 85,
        "errorRate": 1.5,
        "errorAnalysis": {
          "totalErrors": 10,
          "errorsByStatusCode": { "500": 6 }
        }
      }
    },
    "rateLimiter": {
      "status": "healthy",
      "details": {
        "stats": {
          "totalRequests": 1000,
          "blockedRequests": 0,
          "hitRate": 0.99
        },
        "config": { "windowMs": 60000, "maxRequests": 1000 }
      }
    },
    "retries": {
      "status": "healthy",
      "details": {
        "DataSourceIntegrationService": {
          "successfulRetries": 3,
          "failedRetries": 0
        }
      }
    },
    "errorHandling": {
      "status": "healthy",
      "details": {
        "HealthController": { "totalErrors": 0, "consecutiveFailures": 0 }
      }
    }
  },
  "startup": {
    "initialized": true,
    "startTime": 1678879200000,
    "readyTime": 1678879230000
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
  test: ["CMD", "curl", "-f", "http://localhost:3101/health"]
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
   curl http://localhost:3101/health/detailed | jq '{adapters, connections}'
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
   curl http://localhost:3101/health/detailed | jq '.memory'
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

1. **Use `/health/live` for Liveness Probes in Kubernetes.**  
   This check is the most basic and ensures the container process is running and
   not deadlocked. A failure here should trigger a container restart.

2. **Use `/health/ready` for Readiness Probes in Kubernetes.**  
   This check is critical for traffic management in Kubernetes. It confirms the
   application is fully initialized and can serve data. An orchestrator should
   only route traffic to an instance that passes this check.

3. **Use `/health` for Docker Health Checks.**  
   This endpoint provides a comprehensive check of the application's overall
   health. It is the recommended health check for Docker environments.

4. **Use `/health/detailed` for Manual Debugging.**  
   This verbose endpoint should be used by developers during troubleshooting to
   get a complete picture of the system's state.

5. **Configure Appropriate Timeouts and Thresholds.**  
   Allow 2-3 failures before taking action to avoid flapping, and use a startup
   delay (e.g., `initialDelaySeconds`) to give the system time to initialize
   before probes begin.
