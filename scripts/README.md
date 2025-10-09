# FTSO Debug & Test Scripts

This directory contains comprehensive debugging, testing, and monitoring scripts
for the fully modernized FTSO Feed Value Provider system, organized into logical
subfolders for better maintainability. All scripts have been updated to work
with the unified architecture and modernized components.

## 📁 Directory Structure

```
scripts/
├── debug/          # 🔍 Debugging and analysis tools
├── test/           # 🧪 Testing and validation scripts
├── utils/          # 🛠️ Utility and management scripts
├── run.sh          # 🚀 Convenience script for easy access
└── README.md       # 📚 This documentation
```

## 🚀 Convenience Script

For easier access to scripts, use the convenience runner:

```bash
# Show all available options
./scripts/run.sh help

# Quick access to common operations
./scripts/run.sh debug all           # Complete debug analysis
./scripts/run.sh debug startup       # Debug startup issues
./scripts/run.sh test all            # Complete testing suite
./scripts/run.sh test server         # Test server functionality
./scripts/run.sh utils audit analyze # Analyze existing logs
```

## 🔍 Debug Scripts (`scripts/debug/`)

| Script                | Purpose                                               | Usage                                 |
| --------------------- | ----------------------------------------------------- | ------------------------------------- |
| `all.sh`              | Comprehensive debug analysis (runs all debug scripts) | `./scripts/debug/all.sh`              |
| `cache.sh`            | Cache system performance and efficiency analysis      | `./scripts/debug/cache.sh`            |
| `config.sh`           | Configuration and environment validation              | `./scripts/debug/config.sh`           |
| `data-aggregation.sh` | Data aggregation and consensus analysis               | `./scripts/debug/data-aggregation.sh` |
| `errors.sh`           | Error pattern analysis and circuit breaker monitoring | `./scripts/debug/errors.sh`           |
| `feeds.sh`            | Feed data quality and validation analysis             | `./scripts/debug/feeds.sh`            |
| `integration.sh`      | Service integration and orchestration analysis        | `./scripts/debug/integration.sh`      |
| `performance.sh`      | System performance monitoring and analysis            | `./scripts/debug/performance.sh`      |
| `resilience.sh`       | Circuit breaker and failover system analysis          | `./scripts/debug/resilience.sh`       |
| `startup.sh`          | Analyze application startup performance and issues    | `./scripts/debug/startup.sh`          |
| `websockets.sh`       | Monitor WebSocket connections and health              | `./scripts/debug/websockets.sh`       |

## 🧪 Testing Scripts (`scripts/test/`)

| Script          | Purpose                                             | Usage                          |
| --------------- | --------------------------------------------------- | ------------------------------ |
| `all.sh`        | Comprehensive testing suite (runs all test scripts) | `./scripts/test/all.sh`        |
| `shutdown.sh`   | Test graceful shutdown behavior                     | `./scripts/test/shutdown.sh`   |
| `load.sh`       | Load testing and stress testing                     | `./scripts/test/load.sh`       |
| `security.sh`   | Security testing and rate limiting validation       | `./scripts/test/security.sh`   |
| `server.sh`     | Test server functionality and endpoints             | `./scripts/test/server.sh`     |
| `validation.sh` | Test suite reliability and performance validation   | `./scripts/test/validation.sh` |

### ⚡ Optimized Test Performance

The test scripts have been optimized for reliability and performance:

- **Timeout Protection**: Configurable timeouts with intelligent defaults (2-5
  minutes per test category)
- **Process Cleanup**: Automatic cleanup of hanging processes and port conflicts
  with proper resource management
- **Load Balancing**: Optimized concurrent user counts for realistic load
  testing scenarios
- **Jest Optimization**: Optimized worker configuration and resource management
  to prevent contention
- **Signal Handlers**: Comprehensive cleanup on script interruption with proper
  resource deallocation
- **Performance Monitoring**: Built-in performance tracking and bottleneck
  identification

**Usage with timeout protection:**

```bash
# Use package.json scripts (recommended)
pnpm test:scripts           # All tests with timeouts
pnpm test:scripts:server    # Server test only
pnpm test:scripts:security  # Security test only
pnpm test:scripts:load      # Load test only

# Or use run.sh directly
./scripts/run.sh test all    # All tests
./scripts/run.sh test server # Individual test
```

## 🛠️ Utility Scripts (`scripts/utils/`)

| Script               | Purpose                           | Usage                                              |
| -------------------- | --------------------------------- | -------------------------------------------------- |
| `audit.sh`           | System audit and log analysis     | `./scripts/utils/audit.sh [command]`               |
| `test-common.sh`     | Common utilities for test scripts | `source scripts/utils/test-common.sh`              |
| `timeout-wrapper.sh` | Timeout wrapper for any script    | `./scripts/utils/timeout-wrapper.sh script.sh 120` |

## 📊 Quick Start

### Run Complete System Analysis

```bash
# Using convenience script (recommended)
./scripts/run.sh debug all

# Or run directly
./scripts/debug/all.sh
```

### Run Complete Testing Suite

```bash
# Using convenience script (recommended)
./scripts/run.sh test all

# Or run directly
./scripts/test/all.sh
```

### Debug Specific Components

```bash
# Using convenience script
./scripts/run.sh debug startup       # Check startup issues
./scripts/run.sh debug websockets    # Monitor WebSocket connections
./scripts/run.sh debug performance   # Analyze performance
./scripts/run.sh debug feeds         # Check feed data quality
./scripts/run.sh debug errors        # Analyze error patterns
./scripts/run.sh debug cache         # Analyze cache performance
./scripts/run.sh debug resilience    # Check circuit breakers
./scripts/run.sh debug aggregation   # Analyze consensus system
./scripts/run.sh debug config        # Validate configuration
./scripts/run.sh debug integration   # Check service integration

# Or run directly
./scripts/debug/startup.sh
./scripts/debug/websockets.sh
./scripts/debug/performance.sh
./scripts/debug/feeds.sh
./scripts/debug/errors.sh
./scripts/debug/cache.sh
./scripts/debug/resilience.sh
./scripts/debug/aggregation.sh
./scripts/debug/config.sh
./scripts/debug/integration.sh
```

### Test Specific Components

```bash
# Using convenience script
./scripts/run.sh test server         # Test server endpoints
./scripts/run.sh test security       # Test security measures
./scripts/run.sh test load           # Run load tests
./scripts/run.sh test validation     # Validate test suite
./scripts/run.sh test shutdown       # Test graceful shutdown

# Or run directly
./scripts/test/server.sh
./scripts/test/security.sh
./scripts/test/load.sh
./scripts/test/validation.sh
./scripts/test/shutdown.sh
```

### System Audit

```bash
# Show audit system options
./scripts/utils/audit.sh help

# Analyze existing logs (without re-running scripts)
./scripts/utils/audit.sh analyze

# Show current system status
./scripts/utils/audit.sh status

# Establish system baseline
./scripts/utils/audit.sh baseline

# Compare current state with baseline
./scripts/utils/audit.sh compare

# Clean old audit files (keep latest 2)
./scripts/utils/audit.sh clean

# Run full audit (setup + debug + test + analysis)
./scripts/utils/audit.sh full
```

## 📁 Log Organization

All logs are stored in the `logs/` directory:

```
logs/
├── startup.log                      # Application startup logs
├── websocket-debug.log              # WebSocket connection analysis
├── performance-debug.log            # Performance monitoring logs
├── performance-metrics.log          # System metrics (CSV format)
├── feeds-debug.log                  # Feed data analysis logs
├── error-debug.log                  # Error analysis logs
├── cache-debug.log                  # Cache system analysis logs
├── resilience-debug.log             # Circuit breaker analysis logs
├── aggregation-debug.log            # Aggregation system analysis logs
├── config-debug.log                 # Configuration analysis logs
├── integration-debug.log            # Integration analysis logs
├── server-test.log                  # Server functionality test logs
├── security-test.log                # Security testing logs
├── load-test.log                    # Load testing logs
├── test-validation.log              # Test validation logs
├── feed-values-response.json        # API response samples
├── volumes-response.json            # Volume API response samples
├── debug_session_YYYYMMDD_HHMMSS/   # Comprehensive debug sessions
│   ├── comprehensive_summary.md
│   ├── startup_output.log
│   ├── websockets_output.log
│   ├── performance_output.log
│   ├── feeds_output.log
│   ├── errors_output.log
│   ├── cache_output.log
│   ├── resilience_output.log
│   ├── aggregation_output.log
│   ├── config_output.log
│   └── integration_output.log
└── test_session_YYYYMMDD_HHMMSS/    # Comprehensive test sessions
    ├── comprehensive_test_summary.md
    ├── server_output.log
    ├── security_output.log
    ├── load_output.log
    ├── validation_output.log
    └── shutdown_output.log
```

## 🔍 Script Coverage Matrix

### System Components Covered

| Component                  | Debug Script      | Test Script      | Coverage |
| -------------------------- | ----------------- | ---------------- | -------- |
| **Application Startup**    | ✅ startup.sh     | ✅ server.sh     | Complete |
| **WebSocket Connections**  | ✅ websockets.sh  | ✅ load.sh       | Complete |
| **Performance Monitoring** | ✅ performance.sh | ✅ load.sh       | Complete |
| **Feed Data Quality**      | ✅ feeds.sh       | ✅ validation.sh | Complete |
| **Error Handling**         | ✅ errors.sh      | ✅ server.sh     | Complete |
| **Cache System**           | ✅ cache.sh       | ✅ load.sh       | Complete |
| **Circuit Breakers**       | ✅ resilience.sh  | ✅ load.sh       | Complete |
| **Data Aggregation**       | ✅ aggregation.sh | ✅ feeds.sh      | Complete |
| **Configuration**          | ✅ config.sh      | ✅ validation.sh | Complete |
| **Service Integration**    | ✅ integration.sh | ✅ server.sh     | Complete |
| **API Security**           | ❌                | ✅ security.sh   | Partial  |
| **Load Handling**          | ❌                | ✅ load.sh       | Partial  |
| **Graceful Shutdown**      | ❌                | ✅ shutdown.sh   | Partial  |

## 🛠️ Customization

### Environment Variables

Scripts respect the following environment variables:

- `LOG_LEVEL`: Controls logging verbosity
- `DEBUG_TIMEOUT`: Override default script timeouts
- `DEBUG_INTERVAL`: Override monitoring intervals

### Script Configuration

Each script can be customized by editing the configuration section at the top:

```bash
# Configuration
TIMEOUT=60
LOG_FILE="logs/script-name.log"
```

## 📈 Interpreting Results

### Debug Scripts

- **Startup**: < 2000 log lines = Good, > 3000 = Needs attention
- **WebSocket**: All exchanges connected = Good, failures = Critical
- **Performance**: CPU < 50%, Memory < 500MB = Good
- **Cache**: Hit rate > 90% = Excellent, < 70% = Needs optimization
- **Resilience**: No circuit breaker trips = Excellent
- **Aggregation**: No consensus deviations = Excellent
- **Config**: Score > 90 = Excellent, < 60 = Critical
- **Integration**: All services initialized = Good

### Test Scripts

- **Server**: All endpoints responding = Good
- **Security**: Score > 90% = Secure, < 70% = Vulnerable
- **Load**: Success rate > 95% = Excellent, < 80% = Poor
- **Validation**: No flaky tests = Excellent

## 🚨 Troubleshooting

### Common Issues

1. **Permission Denied**

   ```bash
   chmod +x scripts/**/*.sh
   ```

2. **Missing Dependencies**

   ```bash
   # Install required tools (macOS)
   brew install jq bc curl
   ```

3. **Port Already in Use**

   ```bash
   # Kill existing processes
   lsof -ti:3101 | xargs kill -9
   ```

4. **Logs Directory Full**
   ```bash
   # Run system audit
   ./scripts/utils/audit.sh analyze
   ```

### Getting Help

1. **Script Usage**: Run any script with `--help` or check the script header
2. **System Audit**: Use `./scripts/utils/audit.sh analyze` for comprehensive
   log analysis
3. **Complete Analysis**: Run `./scripts/debug/all.sh` for complete system
   overview
4. **Complete Testing**: Run `./scripts/test/all.sh` for comprehensive testing

## 🔄 Maintenance

### Regular Tasks

- Run `debug/all.sh` weekly for system health checks
- Run `test/all.sh` before deployments for validation
- Run system audit weekly: `utils/audit.sh full`
- Clean audit files monthly: `utils/audit.sh clean`

### Performance Monitoring

- Monitor startup time trends
- Track WebSocket connection stability
- Watch for increasing error rates
- Monitor memory usage patterns
- Track cache performance metrics

### Security Monitoring

- Run security tests regularly
- Monitor for new vulnerabilities
- Review rate limiting effectiveness
- Validate input sanitization

---

_For more information about the FTSO Feed Value Provider system, see the main
project documentation._
