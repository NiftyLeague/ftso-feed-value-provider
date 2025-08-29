# Comprehensive Logging and Debugging Guide

## Overview

The FTSO Feed Value Provider implements comprehensive logging and debugging
capabilities to support production operations, troubleshooting, and performance
monitoring. This document describes the logging architecture, configuration
options, and debugging procedures.

## Logging Architecture

### Enhanced Logger Service

The system uses an `EnhancedLoggerService` that extends the standard NestJS
logger with:

- **Structured logging** with contextual information
- **Performance tracking** with operation timers
- **Error classification** and severity determination
- **File-based logging** with rotation and retention
- **Audit logging** for critical operations
- **Debug logging** with detailed system behavior

### Log Levels and Categories

#### Standard Log Levels

- `ERROR`: System errors, exceptions, and failures
- `WARN`: Warning conditions that don't stop operation
- `LOG`: General operational information
- `DEBUG`: Detailed debugging information
- `VERBOSE`: Very detailed system behavior

#### Custom Log Categories

- **Critical Operations**: System startup, shutdown, configuration changes
- **Performance Logs**: Operation timing, latency, throughput metrics
- **Error Recovery**: Error handling, failover, recovery attempts
- **Data Flow**: Price updates, aggregation, cache operations
- **Connection Events**: Exchange connections, disconnections, reconnections
- **Audit Logs**: Security events, configuration changes, administrative actions

## Configuration

### Environment Variables

```bash
# File Logging
ENABLE_FILE_LOGGING=true
LOG_DIRECTORY=./logs
MAX_LOG_FILE_SIZE=10MB
MAX_LOG_FILES=5

# Performance Logging
ENABLE_PERFORMANCE_LOGGING=true
PERFORMANCE_LOG_THRESHOLD=100

# Debug Logging
ENABLE_DEBUG_LOGGING=false
DEBUG_LOG_LEVEL=debug

# Error Logging
ERROR_LOG_RETENTION_DAYS=30
MAX_ERROR_HISTORY_SIZE=1000

# Audit Logging
ENABLE_AUDIT_LOGGING=true
AUDIT_LOG_CRITICAL_OPERATIONS=true

# Log Formatting
LOG_FORMAT=json
INCLUDE_TIMESTAMP=true
INCLUDE_CONTEXT=true
INCLUDE_STACK_TRACE=true

# Component-Specific Log Levels
LOG_LEVEL_PRODUCTION_INTEGRATION=log
LOG_LEVEL_DATA_MANAGER=log
LOG_LEVEL_AGGREGATION=log
LOG_LEVEL_ERROR_HANDLER=log
LOG_LEVEL_PERFORMANCE_MONITOR=log
LOG_LEVEL_ALERTING=log
LOG_LEVEL_BOOTSTRAP=log
```

### Log File Structure

```
logs/
├── application.log      # General application logs
├── errors.log          # Error logs with stack traces
├── performance.log     # Performance metrics and timing
├── debug.log           # Debug information (when enabled)
└── audit.log           # Audit trail for critical operations
```

## Logging Features

### 1. Critical Operations Logging

All critical system operations are logged with detailed context:

```typescript
enhancedLogger.logCriticalOperation(
  "module_initialization",
  "ProductionIntegration",
  {
    phase: "starting",
    timestamp: Date.now(),
    components: ["adapters", "monitoring", "error-handling"],
  },
  true
);
```

**Logged Operations:**

- Application startup/shutdown
- Module initialization
- Exchange adapter registration
- Data source connections
- Error recovery attempts
- Configuration changes

### 2. Performance Logging

Performance metrics are automatically tracked for all operations:

```typescript
const operationId = `operation_${Date.now()}`;
enhancedLogger.startPerformanceTimer(
  operationId,
  "price_aggregation",
  "RealTimeAggregation"
);

// ... operation code ...

enhancedLogger.endPerformanceTimer(operationId, success, {
  sourceCount: 5,
  price: 1234.56,
});
```

**Performance Metrics:**

- Operation duration
- Success/failure rates
- Resource utilization
- Response times
- Throughput measurements

### 3. Error Logging with Root Cause Analysis

Comprehensive error logging includes:

```typescript
enhancedLogger.error(error, {
  component: "ProductionDataManager",
  operation: "source_failover",
  sourceId: "binance",
  severity: "high",
  metadata: {
    reason: "connection_timeout",
    attemptCount: 3,
    lastSuccessfulConnection: timestamp,
  },
});
```

**Error Information:**

- Error classification and severity
- Stack traces and context
- Recovery attempts and outcomes
- Impact assessment
- Related system state

### 4. Data Flow Logging

Track data movement through the system:

```typescript
enhancedLogger.logDataFlow(
  "ExchangeAdapter",
  "AggregationService",
  "PriceUpdate",
  1,
  {
    symbol: "BTC/USD",
    price: 45000,
    confidence: 0.95,
  }
);
```

### 5. Connection Event Logging

Monitor exchange connections:

```typescript
enhancedLogger.logConnection("binance", "connected", {
  connectionType: "websocket",
  latency: 45,
  subscriptions: ["BTC/USD", "ETH/USD"],
});
```

## Debugging Procedures

### 1. Application Startup Issues

**Check Bootstrap Logs:**

```bash
grep "Bootstrap" logs/application.log | tail -50
```

**Common Issues:**

- Environment variable validation failures
- Port binding conflicts
- Module initialization errors
- Database connection issues

### 2. Exchange Connection Problems

**Check Connection Logs:**

```bash
grep "Connection" logs/application.log | grep -E "(failed|disconnected|error)"
```

**Debug Steps:**

1. Verify API keys and credentials
2. Check network connectivity
3. Review rate limiting status
4. Examine WebSocket connection logs

### 3. Price Aggregation Issues

**Check Aggregation Performance:**

```bash
grep "RealTimeAggregation" logs/performance.log | tail -20
```

**Debug Steps:**

1. Verify data source availability
2. Check aggregation algorithm parameters
3. Review cache hit/miss ratios
4. Examine consensus scoring

### 4. Error Recovery Analysis

**Check Error Recovery Logs:**

```bash
grep "ErrorRecovery" logs/application.log | tail -30
```

**Analysis Points:**

1. Error classification accuracy
2. Recovery strategy effectiveness
3. Failover timing and success rates
4. Circuit breaker status

## Log Analysis Tools

### 1. Performance Analysis

```bash
# Find slow operations (>100ms)
grep '"duration":[0-9][0-9][0-9]' logs/performance.log

# Analyze error rates by component
grep -o '"component":"[^"]*"' logs/errors.log | sort | uniq -c

# Check cache performance
grep "cache" logs/application.log | grep -E "(hit|miss)"
```

### 2. Error Pattern Analysis

```bash
# Most common errors
grep -o '"errorType":"[^"]*"' logs/errors.log | sort | uniq -c | sort -nr

# Error severity distribution
grep -o '"severity":"[^"]*"' logs/errors.log | sort | uniq -c

# Recovery success rates
grep "ErrorRecovery" logs/application.log | grep -c "success.*true"
```

### 3. System Health Monitoring

```bash
# Connection status summary
grep "Connection" logs/application.log | tail -10

# Recent critical operations
grep "Critical Operation" logs/audit.log | tail -20

# Performance threshold violations
grep "threshold exceeded" logs/application.log
```

## Production Monitoring

### 1. Log Rotation and Retention

- **Automatic rotation** when files exceed configured size
- **Retention policy** based on age and disk space
- **Compression** of archived log files
- **Cleanup** of old log files

### 2. Real-time Monitoring

- **Log streaming** to monitoring systems
- **Alert integration** for critical errors
- **Performance dashboards** from log metrics
- **Health check endpoints** with log-based status

### 3. Security Considerations

- **Sensitive data filtering** in logs
- **Access control** for log files
- **Audit trail** for log access
- **Encryption** for log transmission

## Troubleshooting Common Issues

### High Memory Usage

1. Check error history size: `MAX_ERROR_HISTORY_SIZE`
2. Review performance timer cleanup
3. Examine log file sizes and rotation
4. Monitor cache entry counts

### Performance Degradation

1. Enable performance logging: `ENABLE_PERFORMANCE_LOGGING=true`
2. Lower performance threshold: `PERFORMANCE_LOG_THRESHOLD=50`
3. Check operation timing patterns
4. Analyze resource utilization logs

### Missing Log Entries

1. Verify log level configuration
2. Check file permissions and disk space
3. Review component-specific log levels
4. Ensure logger initialization

### Log File Growth

1. Adjust log rotation settings
2. Reduce debug logging verbosity
3. Implement log filtering
4. Monitor disk space usage

## Best Practices

### 1. Log Message Design

- **Use structured data** with consistent field names
- **Include relevant context** for troubleshooting
- **Avoid sensitive information** in log messages
- **Use appropriate log levels** for different scenarios

### 2. Performance Considerations

- **Minimize logging overhead** in hot paths
- **Use async logging** for high-volume operations
- **Implement log sampling** for very frequent events
- **Monitor logging performance** impact

### 3. Operational Procedures

- **Regular log review** for system health
- **Automated alerting** on error patterns
- **Log analysis automation** for trend detection
- **Documentation updates** based on log insights

## Integration with Monitoring Systems

### Metrics Export

The logging system provides metrics for:

- Error rates by component and type
- Performance statistics and trends
- Connection health and stability
- System resource utilization

### Alert Integration

Automatic alerts are generated for:

- Critical error thresholds
- Performance degradation
- Connection failures
- System resource exhaustion

### Dashboard Integration

Log data feeds into dashboards showing:

- Real-time system status
- Historical performance trends
- Error pattern analysis
- Operational metrics

This comprehensive logging and debugging system ensures full visibility into the
FTSO Feed Value Provider's operation, enabling effective troubleshooting,
performance optimization, and proactive monitoring.
