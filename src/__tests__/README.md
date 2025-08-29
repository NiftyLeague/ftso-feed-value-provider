# FTSO Provider Test Suite

This directory contains the comprehensive test suite for the FTSO (Flare Time
Series Oracle) Provider, designed to validate accuracy, performance, and
reliability requirements for production deployment.

## Test Categories

### 1. Unit Tests (`src/adapters/**/*.spec.ts`, `src/aggregators/**/*.spec.ts`, etc.)

**Purpose**: Test individual components in isolation **Coverage**:

- Exchange adapter implementations (Binance, Coinbase, Crypto.com, Kraken, OKX)
- Data normalization and validation logic
- Aggregation algorithms and consensus mechanisms
- Error handling and recovery systems

**Requirements Validated**:

- Data format validation and normalization
- Exchange-specific symbol mapping
- Confidence score calculations
- Error handling and graceful degradation

### 2. Integration Tests

#### WebSocket Integration (`src/adapters/__tests__/websocket-integration.spec.ts`)

**Purpose**: Test real-time data flow and connection management **Coverage**:

- Multi-exchange WebSocket connections
- Real-time price update processing
- Connection recovery and failover mechanisms
- High-frequency data handling

**Requirements Validated**:

- Sub-2-second data freshness (Requirements 1.1, 3.1)
- Automatic failover within 100ms (Requirement 3.2)
- Support for 50+ concurrent connections (Requirement 4.1)

#### API Integration (`src/api/__tests__/api-integration.spec.ts`)

**Purpose**: Test API endpoints with real data sources **Coverage**:

- Feed value retrieval endpoints
- Historical data queries
- Volume data aggregation
- Error handling and rate limiting

**Requirements Validated**:

- API response times <100ms (Requirement 3.3)
- Proper error responses and status codes
- Rate limiting and security headers
- Data consistency across requests

#### Monitoring Integration (`src/monitoring/__tests__/monitoring-integration.spec.ts`)

**Purpose**: Test monitoring and alerting systems **Coverage**:

- Performance metric collection
- Accuracy monitoring and deviation detection
- Alert generation and escalation
- System health monitoring

**Requirements Validated**:

- Real-time monitoring capabilities (Requirement 4.1)
- Alert generation for system issues
- Performance degradation detection

### 3. Performance Tests

#### Load Testing (`src/__tests__/performance/load-testing.spec.ts`)

**Purpose**: Validate system performance under high request volumes **Test
Scenarios**:

- 1000+ concurrent requests
- Sustained load (100 RPS for 10 minutes)
- Burst traffic patterns
- Memory and resource usage validation

**Requirements Validated**:

- High request volume handling (Requirement 4.1)
- Response time consistency under load
- Memory efficiency and leak prevention
- Graceful degradation under stress

#### Latency Testing (`src/__tests__/performance/latency-testing.spec.ts`)

**Purpose**: Ensure response times meet <100ms requirement **Test Scenarios**:

- Single request latency measurement
- Concurrent load latency impact
- Latency distribution analysis
- Cold start vs warm performance

**Requirements Validated**:

- API response times <100ms (Requirement 3.3)
- Consistent performance across different conditions
- P95 and P99 latency percentiles
- Cache effectiveness

#### Endurance Testing (`src/__tests__/performance/endurance-testing.spec.ts`)

**Purpose**: Validate long-term stability and resource management **Test
Scenarios**:

- 30-minute continuous operation
- Memory usage over extended periods
- Connection stability testing
- Resource leak detection

**Requirements Validated**:

- Long-term system stability
- Memory efficiency over time
- Connection reliability
- Graceful shutdown capabilities

### 4. Accuracy Tests

#### Backtesting Framework (`src/__tests__/accuracy/backtesting-framework.spec.ts`)

**Purpose**: Validate historical accuracy using backtesting methodology **Test
Scenarios**:

- Historical data accuracy validation
- Consensus alignment over time periods
- Data quality metrics analysis
- Extreme market condition handling

**Requirements Validated**:

- Price accuracy within 0.5% deviation (Requirement 2.6)
- Consensus algorithm effectiveness
- Data quality maintenance
- Robustness under market volatility

## Running Tests

### Quick Start

```bash
# Run all tests (comprehensive suite)
npm run test:comprehensive

# Run specific test categories
npm run test:unit
npm run test:integration
npm run test:performance
npm run test:accuracy
```

### Individual Test Suites

```bash
# Performance tests
npm run test:load          # Load testing
npm run test:latency       # Latency testing
npm run test:endurance     # Endurance testing

# Accuracy tests
npm run test:backtesting   # Historical accuracy validation
```

### Advanced Usage

```bash
# Run specific test suite
npm run test:comprehensive -- --suite "Load Testing"

# Run with custom category
npm run test:comprehensive -- --category performance
```

## Test Configuration

### Timeouts

- Unit tests: 30 seconds
- Integration tests: 2 minutes
- Performance tests: 5-30 minutes
- Endurance tests: Up to 30 minutes

### Performance Thresholds

- API Response Time: <100ms average, <150ms P95
- Load Handling: 1000+ concurrent requests
- Memory Usage: <200MB increase over 30 minutes
- Accuracy: <0.5% deviation from consensus

### Environment Requirements

- Node.js 22+
- Available memory: 2GB+
- Network connectivity for exchange APIs
- Optional: `--expose-gc` flag for memory testing

## Test Reports

Test results are automatically saved to `test-reports/` directory with:

- Detailed JSON reports with timestamps
- Performance metrics and statistics
- Error logs and failure analysis
- Trend analysis for endurance tests

## Continuous Integration

The test suite is designed for CI/CD integration:

- Parallel execution where appropriate
- Deterministic results
- Comprehensive error reporting
- Performance regression detection

## Troubleshooting

### Common Issues

1. **Timeout Errors**: Increase test timeouts for slower environments
2. **Memory Issues**: Run with `--expose-gc` flag and increase heap size
3. **Network Failures**: Ensure stable internet connection for exchange APIs
4. **Port Conflicts**: Ensure test ports are available

### Performance Tuning

1. **Sequential Execution**: Use `--maxWorkers=1` for performance tests
2. **Memory Management**: Enable garbage collection for endurance tests
3. **Resource Cleanup**: Ensure proper cleanup in test teardown

### Debugging

```bash
# Run with debug output
npm run test:debug

# Run specific failing test
jest --testNamePattern="specific test name" --verbose

# Memory profiling
node --inspect --expose-gc npm run test:endurance
```

## Contributing

When adding new tests:

1. Follow existing naming conventions
2. Include proper timeout configurations
3. Add comprehensive assertions
4. Document performance expectations
5. Update this README with new test descriptions

## Requirements Traceability

Each test file includes requirement references in comments:

- `_Requirements: 1.1, 2.3_` format
- Links back to requirements.md
- Validates specific acceptance criteria
- Enables requirement coverage analysis
