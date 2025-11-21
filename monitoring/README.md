# Monitoring Stack

This directory contains the monitoring configuration for the FTSO Provider
service using Prometheus and Grafana.

## Directory Structure

```
monitoring/
├── prometheus.yml              # Prometheus configuration
├── prometheus-rules.yml        # Alert rules
├── grafana/
│   └── provisioning/
│       ├── datasources/        # Grafana datasource config
│       │   └── datasources.yml
│       └── dashboards/         # Grafana dashboard config
│           ├── dashboard.yml
│           └── ftso-provider.json
└── README.md                   # This file
```

## Quick Start

### Start Monitoring Stack

```bash
# From project root
docker-compose --profile monitoring up -d
```

This will start:

- **Prometheus** on port 9091
- **Grafana** on port 3000

### Access Services

- **Prometheus UI**: http://localhost:9091
- **Grafana**: http://localhost:3000 (admin/admin)
- **Metrics Endpoint**: http://localhost:3101/metrics/prometheus

## Configuration Files

### prometheus.yml

Main Prometheus configuration file that defines:

- Scrape targets (FTSO Provider service)
- Scrape intervals
- Alert rule files
- Global settings

**Key Settings:**

- Scrape interval: 15s (global), 5s (FTSO Provider)
- Evaluation interval: 15s
- Retention: 200 hours

### prometheus-rules.yml

Alert rules for monitoring the FTSO Provider service.

**Alert Categories:**

- API Performance (error rate, response time)
- System Resources (memory, CPU)
- Cache Performance
- Data Source Health
- Feed Health
- Aggregation Quality

**Severity Levels:**

- `critical`: Immediate action required
- `warning`: Attention needed
- `info`: Informational only

### Grafana Configuration

**Datasources** (`grafana/provisioning/datasources/datasources.yml`):

- Pre-configured Prometheus datasource
- Automatically connected on startup

**Dashboards** (`grafana/provisioning/dashboards/`):

- `dashboard.yml`: Dashboard provisioning config
- `ftso-provider.json`: Main FTSO Provider dashboard

## Customization

### Adding New Metrics

1. Add metric to `src/controllers/metrics.controller.ts`:

   ```typescript
   metrics.push(
     "# HELP my_custom_metric Description",
     "# TYPE my_custom_metric gauge",
     `my_custom_metric ${value}`,
     ""
   );
   ```

2. Metric will be automatically scraped by Prometheus

### Adding New Alerts

1. Edit `prometheus-rules.yml`:

   ```yaml
   - alert: MyCustomAlert
     expr: my_custom_metric > 100
     for: 5m
     labels:
       severity: warning
     annotations:
       summary: "Custom alert triggered"
       description: "Value is {{ $value }}"
   ```

2. Reload Prometheus configuration:
   ```bash
   curl -X POST http://localhost:9091/-/reload
   ```

### Customizing Dashboard

1. Open Grafana: http://localhost:3000
2. Navigate to the FTSO Provider Dashboard
3. Click "Dashboard settings" → "Save As"
4. Make your changes
5. Export JSON and save to `grafana/provisioning/dashboards/`

## Monitoring Best Practices

### 1. Alert Fatigue Prevention

- Set appropriate `for` durations to avoid flapping
- Use severity levels correctly
- Group related alerts
- Create runbooks for common alerts

### 2. Metric Naming

Follow Prometheus naming conventions:

- Use base unit (seconds, bytes, not milliseconds, megabytes)
- Suffix with unit (`_seconds`, `_bytes`, `_total`)
- Use descriptive names

### 3. Label Usage

- Keep cardinality low
- Use labels for dimensions (endpoint, method, status)
- Avoid high-cardinality labels (user IDs, timestamps)

### 4. Dashboard Design

- Group related metrics
- Use appropriate visualization types
- Set meaningful thresholds
- Include time range selector

## Troubleshooting

### Prometheus Not Scraping

**Check target status:**

```bash
curl http://localhost:9091/api/v1/targets
```

**Common issues:**

- Service not running on expected port
- Network connectivity issues
- Incorrect metrics path

### Grafana Not Showing Data

**Check datasource:**

1. Go to Configuration → Data Sources
2. Test the Prometheus connection
3. Verify URL is correct: `http://prometheus:9090`

**Check queries:**

1. Open Prometheus UI
2. Test queries manually
3. Verify metrics exist

### Alerts Not Firing

**Check alert rules:**

```bash
curl http://localhost:9091/api/v1/rules
```

**Verify conditions:**

1. Open Prometheus UI
2. Go to Alerts tab
3. Check alert state and evaluation

## Maintenance

### Backup Prometheus Data

```bash
# Stop Prometheus
docker-compose stop prometheus

# Backup data directory
docker run --rm -v ftso-prometheus-data:/data -v $(pwd):/backup \
  alpine tar czf /backup/prometheus-backup.tar.gz /data

# Restart Prometheus
docker-compose start prometheus
```

### Update Grafana Dashboards

```bash
# Export dashboard from Grafana UI
# Save to grafana/provisioning/dashboards/

# Restart Grafana to load changes
docker-compose restart grafana
```

### Clean Old Data

```bash
# Prometheus automatically manages retention
# To manually clean:
docker-compose exec prometheus \
  promtool tsdb clean-tombstones /prometheus
```

## Integration Examples

### External Prometheus

Add to your external Prometheus config:

```yaml
scrape_configs:
  - job_name: "ftso-provider"
    static_configs:
      - targets: ["ftso-host:3101"]
    metrics_path: "/metrics/prometheus"
    scrape_interval: 5s
```

### Alertmanager

Add to `prometheus.yml`:

```yaml
alerting:
  alertmanagers:
    - static_configs:
        - targets: ["alertmanager:9093"]
```

### Remote Storage

For long-term storage, configure remote write:

```yaml
remote_write:
  - url: "https://your-remote-storage/api/v1/write"
    basic_auth:
      username: user
      password: pass
```

## Resources

- [Prometheus Documentation](https://prometheus.io/docs/)
- [Grafana Documentation](https://grafana.com/docs/)
- [PromQL Guide](https://prometheus.io/docs/prometheus/latest/querying/basics/)
- [Alert Rule Examples](https://awesome-prometheus-alerts.grep.to/)
- [Dashboard Examples](https://grafana.com/grafana/dashboards/)

## Support

For issues or questions:

1. Check the main documentation: `docs/prometheus-monitoring.md`
2. Review Prometheus logs: `docker logs ftso-prometheus`
3. Review Grafana logs: `docker logs ftso-grafana`
4. Check service health: http://localhost:3101/health
