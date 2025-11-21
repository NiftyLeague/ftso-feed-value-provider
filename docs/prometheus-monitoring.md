# Prometheus Monitoring Guide

This guide covers the Prometheus monitoring setup for the FTSO Provider service.

## Overview

The FTSO Provider exposes comprehensive metrics in Prometheus format for
monitoring, alerting, and performance analysis.

## Quick Start

### 1. Start Monitoring Stack

```bash
# Start with Prometheus + Grafana
docker-compose --profile monitoring up -d

# Or with registry deployment
docker-compose -f docker-compose.registry.yml --profile monitoring up -d
```

### 2. Access Monitoring Tools

- **Application**: http://localhost:3101
- **Prometheus**: http://localhost:9091
- **Grafana**: http://localhost:3000 (admin/admin)
- **Metrics Endpoint**: http://localhost:3101/metrics/prometheus

## Available Metrics

### API Metrics

| Metric                           | Type    | Description                           |
| -------------------------------- | ------- | ------------------------------------- |
| `ftso_api_requests_total`        | counter | Total number of API requests          |
| `ftso_api_requests_per_minute`   | gauge   | Current requests per minute           |
| `ftso_api_error_rate`            | gauge   | API error rate percentage             |
| `ftso_api_response_time_ms`      | gauge   | Average response time in milliseconds |
| `ftso_api_response_time_p50_ms`  | gauge   | 50th percentile response time         |
| `ftso_api_response_time_p95_ms`  | gauge   | 95th percentile response time         |
| `ftso_api_response_time_p99_ms`  | gauge   | 99th percentile response time         |
| `ftso_api_slow_request_rate`     | gauge   | Percentage of requests >100ms         |
| `ftso_api_critical_request_rate` | gauge   | Percentage of requests >1000ms        |

### Endpoint-Specific Metrics

| Metric                           | Type    | Description                        | Labels           |
| -------------------------------- | ------- | ---------------------------------- | ---------------- |
| `ftso_endpoint_requests_total`   | counter | Total requests per endpoint        | endpoint, method |
| `ftso_endpoint_response_time_ms` | gauge   | Average response time per endpoint | endpoint, method |
| `ftso_endpoint_error_rate`       | gauge   | Error rate per endpoint            | endpoint, method |

### System Metrics

| Metric                         | Type    | Description                   |
| ------------------------------ | ------- | ----------------------------- |
| `ftso_uptime_seconds`          | counter | Application uptime in seconds |
| `ftso_memory_heap_used_bytes`  | gauge   | Heap memory used in bytes     |
| `ftso_memory_heap_total_bytes` | gauge   | Total heap memory in bytes    |
| `ftso_memory_rss_bytes`        | gauge   | Resident set size in bytes    |
| `ftso_memory_external_bytes`   | gauge   | External memory in bytes      |
| `ftso_memory_usage_percent`    | gauge   | Heap memory usage percentage  |

### Business Metrics

| Metric                              | Type    | Description                         |
| ----------------------------------- | ------- | ----------------------------------- |
| `ftso_feeds_active_total`           | gauge   | Number of active feeds              |
| `ftso_feeds_healthy_total`          | gauge   | Number of healthy feeds             |
| `ftso_price_updates_total`          | counter | Total price updates processed       |
| `ftso_aggregation_success_rate`     | gauge   | Aggregation success rate percentage |
| `ftso_cache_hit_rate`               | gauge   | Cache hit rate percentage           |
| `ftso_data_sources_healthy_total`   | gauge   | Number of healthy data sources      |
| `ftso_data_sources_unhealthy_total` | gauge   | Number of unhealthy data sources    |
| `ftso_consensus_deviation_percent`  | gauge   | Consensus deviation percentage      |

## Alerting Rules

The following alerts are configured in `monitoring/prometheus-rules.yml`:

### Critical Alerts

- **HighErrorRate**: Error rate >5% for 2 minutes
- **CriticalResponseTime**: Response time >1000ms for 2 minutes
- **CriticalMemoryUsage**: Memory usage >90% for 2 minutes
- **CriticalCacheHitRate**: Cache hit rate <50% for 5 minutes
- **NoHealthyDataSources**: All data sources unhealthy for 1 minute
- **ServiceDown**: Service not responding for 1 minute

### Warning Alerts

- **SlowResponseTime**: Response time >500ms for 5 minutes
- **HighSlowRequestRate**: >20% of requests taking >100ms for 5 minutes
- **HighMemoryUsage**: Memory usage >80% for 5 minutes
- **LowCacheHitRate**: Cache hit rate <70% for 10 minutes
- **UnhealthyDataSources**: One or more data sources unhealthy for 5 minutes
- **LowActiveFeedCount**: Active feeds <50 for 5 minutes
- **LowAggregationSuccessRate**: Aggregation success rate <90% for 5 minutes
- **HighConsensusDeviation**: Consensus deviation >5% for 5 minutes

### Info Alerts

- **HighRequestRate**: Request rate >1000 req/s for 5 minutes

## Grafana Dashboard

A pre-configured Grafana dashboard is available at
`monitoring/grafana/provisioning/dashboards/ftso-provider.json`.

### Dashboard Panels

1. **API Request Rate**: Real-time request rate graph
2. **Error Rate**: Current error rate gauge
3. **Avg Response Time**: Average response time gauge
4. **Response Time Percentiles**: p50, p95, p99 response times
5. **Memory Usage**: Heap, RSS, and total memory usage
6. **Cache Hit Rate**: Current cache performance
7. **Aggregation Success Rate**: Data aggregation health
8. **Data Source Health**: Healthy vs unhealthy sources
9. **Feed Status**: Active and healthy feed counts
10. **Consensus Deviation**: Price consensus accuracy

### Accessing the Dashboard

1. Open Grafana: http://localhost:3000
2. Login with default credentials: `admin` / `admin`
3. Navigate to Dashboards → FTSO Provider Dashboard

## Querying Metrics

### Example Prometheus Queries

```promql
# Request rate over last 5 minutes
rate(ftso_api_requests_total[5m])

# Error rate percentage
ftso_api_error_rate

# Memory usage percentage
(ftso_memory_heap_used_bytes / ftso_memory_heap_total_bytes) * 100

# 95th percentile response time
ftso_api_response_time_p95_ms

# Requests per endpoint
sum by (endpoint) (ftso_endpoint_requests_total)

# Average response time per endpoint
avg by (endpoint) (ftso_endpoint_response_time_ms)
```

## Integration with External Monitoring

### Scraping from External Prometheus

Add this job to your external Prometheus configuration:

```yaml
scrape_configs:
  - job_name: "ftso-provider"
    static_configs:
      - targets: ["your-host:3101"]
    scrape_interval: 5s
    metrics_path: "/metrics/prometheus"
```

### Alertmanager Integration

Configure Alertmanager in `prometheus.yml`:

```yaml
alerting:
  alertmanagers:
    - static_configs:
        - targets: ["alertmanager:9093"]
```

## Best Practices

### 1. Scrape Interval

- Default: 15s for general metrics
- FTSO Provider: 5s for real-time monitoring
- Adjust based on your needs and storage capacity

### 2. Retention

- Default: 200 hours (8.3 days)
- Increase for longer historical analysis
- Consider using remote storage for long-term retention

### 3. Alert Tuning

- Adjust thresholds in `prometheus-rules.yml` based on your SLAs
- Use `for` duration to avoid alert flapping
- Set appropriate severity levels

### 4. Dashboard Customization

- Clone the default dashboard for custom views
- Add panels for specific business metrics
- Create team-specific dashboards

## Troubleshooting

### Metrics Not Appearing

1. Check if Prometheus is scraping successfully:

   ```bash
   curl http://localhost:9091/api/v1/targets
   ```

2. Verify metrics endpoint is accessible:

   ```bash
   curl http://localhost:3101/metrics/prometheus
   ```

3. Check Prometheus logs:
   ```bash
   docker logs ftso-prometheus
   ```

### High Cardinality Issues

If you experience performance issues:

1. Limit endpoint-specific metrics to important endpoints
2. Reduce scrape frequency
3. Use recording rules for complex queries

### Alert Not Firing

1. Check alert rules are loaded:

   ```bash
   curl http://localhost:9091/api/v1/rules
   ```

2. Verify alert conditions in Prometheus UI
3. Check Alertmanager configuration

## Monitoring Checklist

- [ ] Prometheus is scraping metrics successfully
- [ ] Grafana dashboard is accessible and showing data
- [ ] Alert rules are loaded and active
- [ ] Critical alerts are configured for on-call notifications
- [ ] Retention policy meets your requirements
- [ ] Backup strategy for Prometheus data is in place
- [ ] Team has access to monitoring tools
- [ ] Runbooks are created for common alerts

## Additional Resources

- [Prometheus Documentation](https://prometheus.io/docs/)
- [Grafana Documentation](https://grafana.com/docs/)
- [PromQL Basics](https://prometheus.io/docs/prometheus/latest/querying/basics/)
- [Alerting Best Practices](https://prometheus.io/docs/practices/alerting/)
