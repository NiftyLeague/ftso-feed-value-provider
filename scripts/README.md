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

| Script                      | Purpose                                               | Usage                                       |
| --------------------------- | ----------------------------------------------------- | ------------------------------------------- |
| `all.sh`                    | Comprehensive debug analysis (runs all debug scripts) | `./scripts/debug/all.sh`                    |
| `cache.sh`                  | Cache system performance and efficiency analysis      | `./scripts/debug/cache.sh`                  |
| `config.sh`                 | Configuration and environment validation              | `./scripts/debug/config.sh`                 |
| `data-aggregation.sh`       | Data aggregation and consensus analysis               | `./scripts/debug/data-aggregation.sh`       |
| `errors.sh`                 | Error pattern analysis and circuit breaker monitoring | `./scripts/debug/errors.sh`                 |
| `feeds.sh`                  | Feed data quality and validation analysis             | `./scripts/debug/feeds.sh`                  |
| `integration.sh`            | Service integration and orchestration analysis        | `./scripts/debug/integration.sh`            |
| `performance.sh`            | System performance monitoring and analysis            | `./scripts/debug/performance.sh`            |
| `resilience-consistency.sh` | Environment consistency validation                    | `./scripts/debug/resilience-consistency.sh` |
| `resilience.sh`             | Circuit breaker and failover system analysis          | `./scripts/debug/resilience.sh`             |
| `startup.sh`                | Analyze application startup performance and issues    | `./scripts/debug/startup.sh`                |
| `websockets.sh`             | Monitor WebSocket connections and health              | `./scripts/debug/websockets.sh`             |

## 🧪 Testing Scripts (`scripts/test/`)

| Script         | Purpose                                             | Usage                         |
| -------------- | --------------------------------------------------- | ----------------------------- |
| `all.sh`       | Comprehensive testing suite (runs all test scripts) | `./scripts/test/all.sh`       |
| `readiness.sh` | Readiness checks (startup + health)                 | `./scripts/test/readiness.sh` |
| `server.sh`    | Test server functionality and endpoints             | `./scripts/test/server.sh`    |
| `security.sh`  | Security testing and rate limiting validation       | `./scripts/test/security.sh`  |
| `feeds.sh`     | Feed API and data sanity checks                     | `./scripts/test/feeds.sh`     |
| `data-flow.sh` | End-to-end data-flow validation                     | `./scripts/test/data-flow.sh` |
| `load.sh`      | Load testing and stress testing                     | `./scripts/test/load.sh`      |
| `shutdown.sh`  | Test graceful shutdown behavior                     | `./scripts/test/shutdown.sh`  |
| `docker.sh`    | Test Docker deployment and container health         | `./scripts/test/docker.sh`    |

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
pnpm test:all               # All system tests (scripts/test/all.sh)
pnpm test:server            # Server test only
pnpm test:security          # Security test only
pnpm test:load              # Load test only
pnpm test:validate          # Jest validation suite (via scripts/run.sh)

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

## 🐳 Docker Registry Deployment

For production/VM deployments, use `docker-compose.registry.yml` which pulls
pre-built images from GitHub Container Registry.

### Quick Start (Production/VM)

**Standard Deployment:**

```bash
# Pull and start
docker compose -f docker-compose.registry.yml up -d

# View logs
docker compose -f docker-compose.registry.yml logs -f

# Stop
docker compose -f docker-compose.registry.yml down
```

**VM Deployment (Host Network - Recommended):**

```bash
# Better performance for VMs
NETWORK_MODE=host docker compose -f docker-compose.registry.yml up -d
```

**With Monitoring Stack:**

```bash
# Includes Prometheus + Grafana
docker compose -f docker-compose.registry.yml --profile monitoring up -d
```

### Configuration Options

All settings can be overridden via environment variables:

```bash
# Custom tag
TAG=v1.2.3 docker compose -f docker-compose.registry.yml up -d

# Custom resources
MEMORY_LIMIT=2G CPU_LIMIT=2.0 docker compose -f docker-compose.registry.yml up -d

# Custom log level
LOG_LEVEL=debug docker compose -f docker-compose.registry.yml up -d

# Custom ports
API_PORT=8080 docker compose -f docker-compose.registry.yml up -d

# Combine multiple
TAG=latest NETWORK_MODE=host MEMORY_LIMIT=2G LOG_LEVEL=warn \
  docker compose -f docker-compose.registry.yml up -d
```

### Available Environment Variables

| Variable             | Default      | Description                       |
| -------------------- | ------------ | --------------------------------- |
| `TAG`                | `latest`     | Image tag to pull                 |
| `NETWORK_MODE`       | `bridge`     | Network mode (`bridge` or `host`) |
| `API_PORT`           | `3101`       | API port mapping                  |
| `NODE_ENV`           | `production` | Node environment                  |
| `LOG_LEVEL`          | `warn`       | Logging level                     |
| `MEMORY_LIMIT`       | `1G`         | Memory limit                      |
| `CPU_LIMIT`          | `1.0`        | CPU limit                         |
| `MEMORY_RESERVATION` | `512M`       | Memory reservation                |
| `CPU_RESERVATION`    | `0.5`        | CPU reservation                   |

### pnpm Scripts (Convenience)

```bash
# Start from registry
pnpm docker:registry:up

# Pull latest image
pnpm docker:registry:pull

# View logs
pnpm docker:registry:logs

# Restart
pnpm docker:registry:restart

# Stop
pnpm docker:registry:down

# Start with monitoring
pnpm docker:registry:monitoring
```

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
./scripts/run.sh debug data-aggregation # Analyze consensus system
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
./scripts/debug/data-aggregation.sh
./scripts/debug/resilience-consistency.sh
./scripts/debug/config.sh
./scripts/debug/integration.sh
```

### Test Specific Components

```bash
# Using convenience script
./scripts/run.sh test docker         # Test Docker deployment
./scripts/run.sh test server         # Test server endpoints
./scripts/run.sh test security       # Test security measures
./scripts/run.sh test load           # Run load tests
./scripts/run.sh test validate       # Validate Jest suite
./scripts/run.sh test readiness      # Readiness checks
./scripts/run.sh test feeds          # Feed API checks
./scripts/run.sh test data-flow      # End-to-end data-flow
./scripts/run.sh test shutdown       # Test graceful shutdown

# Or run directly
./scripts/test/docker.sh
./scripts/test/server.sh
./scripts/test/security.sh
./scripts/test/load.sh
./scripts/test/readiness.sh
./scripts/test/feeds.sh
./scripts/test/data-flow.sh
./scripts/test/shutdown.sh
```

### Docker Deployment

```bash
# Test Docker deployment (auto-starts if not running)
pnpm docker:test
# or
./scripts/run.sh test docker

# Deploy from registry (standard mode)
pnpm docker:registry:up
# or
docker compose -f docker-compose.registry.yml up -d

# Deploy from registry (VM mode with host network)
NETWORK_MODE=host pnpm docker:registry:up
# or
NETWORK_MODE=host docker compose -f docker-compose.registry.yml up -d

# Deploy with custom resources
MEMORY_LIMIT=2G CPU_LIMIT=2.0 pnpm docker:registry:up
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
├── feed-values-response.json        # API response samples
├── volumes-response.json            # Volume API response samples
├── debug/                           # Debug script outputs
│   ├── comprehensive_summary.md
│   ├── startup_output.log
│   ├── websockets_output.log
│   ├── performance_output.log
│   ├── feeds_output.log
│   ├── errors_output.log
│   ├── cache_output.log
│   ├── resilience_output.log
│   ├── data-aggregation_output.log
│   ├── config_output.log
│   ├── integration_output.log
│   └── resilience-consistency_output.log
└── test/                            # Test script outputs
  ├── comprehensive_test_summary.md
  ├── readiness_output.log
  ├── server_output.log
  ├── security_output.log
  ├── feeds_output.log
  ├── data-flow_output.log
  ├── load_output.log
  ├── shutdown_output.log
  └── docker_output.log
```

## 🔍 Script Coverage Matrix

### System Components Covered

| Component                  | Debug Script           | Test Script     | Coverage |
| -------------------------- | ---------------------- | --------------- | -------- |
| **Application Startup**    | ✅ startup.sh          | ✅ readiness.sh | Complete |
| **WebSocket Connections**  | ✅ websockets.sh       | ✅ load.sh      | Complete |
| **Performance Monitoring** | ✅ performance.sh      | ✅ load.sh      | Complete |
| **Feed Data Quality**      | ✅ feeds.sh            | ✅ feeds.sh     | Complete |
| **Error Handling**         | ✅ errors.sh           | ✅ server.sh    | Complete |
| **Cache System**           | ✅ cache.sh            | ✅ load.sh      | Complete |
| **Circuit Breakers**       | ✅ resilience.sh       | ✅ load.sh      | Complete |
| **Data Aggregation**       | ✅ data-aggregation.sh | ✅ data-flow.sh | Complete |
| **Configuration**          | ✅ config.sh           | ✅ validate     | Complete |
| **Service Integration**    | ✅ integration.sh      | ✅ server.sh    | Complete |
| **API Security**           | ❌                     | ✅ security.sh  | Partial  |
| **Load Handling**          | ❌                     | ✅ load.sh      | Partial  |
| **Graceful Shutdown**      | ❌                     | ✅ shutdown.sh  | Partial  |

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
