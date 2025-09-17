# Data Age Thresholds and Quality Control

This document describes the data age thresholds and quality control measures
implemented in the system.

## Thresholds

The system uses the following thresholds for data age management:

- `FRESH_DATA_MS` (2000ms): Maximum age for considering data "fresh" - higher
  values allow for more network latency/jitter
- `MAX_DATA_AGE_MS` (20000ms): Maximum age for accepting data at all - after
  this age, data is completely ignored
- `STALE_WARNING_MS` (1000ms): Age threshold for triggering staleness warnings -
  helps identify latency issues early
- `CACHE_TTL_MS` (500ms): Cache TTL for price data

## Configuration

These thresholds can be configured via environment variables:

```bash
# Override defaults
export FRESH_DATA_MS=2000      # Max age for fresh data (default: 2000ms, range: 500-10000ms)
export MAX_DATA_AGE_MS=20000   # Max age for any data (default: 20000ms, range: 5000-60000ms)
export STALE_WARNING_MS=1000   # Warning threshold (default: 1000ms, range: 500-5000ms)
export CACHE_TTL_MS=500        # Cache TTL (default: 500ms, range: 100-2000ms)
```

## Data Quality Control

The system enforces these thresholds in the following ways:

1. Fresh Data (2s threshold)
   - Data newer than this is considered "fresh" and processed normally
   - Used for real-time aggregation and validation

2. Warning Zone (1s threshold)
   - Data older than this triggers staleness warnings
   - Alerts operators to potential latency issues
   - Data still processed but flagged for monitoring

3. Maximum Age (20s cutoff)
   - Data older than this is rejected entirely
   - Prevents use of severely outdated data
   - Sources producing stale data are marked for investigation

4. Cache Control (0.5s TTL)
   - Cached data expires quickly to ensure freshness
   - Balances performance with data recency requirements

## Implementation Details

- Thresholds are defined in `data-age-thresholds.ts`
- Enforced in `ProductionDataManagerService`
- Applied during price updates and data validation
- Monitored via enhanced logging system

## Best Practices

1. Monitor warning logs for early detection of latency issues
2. Review cache hit rates to ensure proper TTL balance
3. Adjust thresholds based on network conditions and requirements
4. Use monitoring dashboards to track data age metrics
