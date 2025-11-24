# FTSO Feed Value Provider

A production-ready FTSO (Flare Time Series Oracle) feed value provider that
delivers real-time cryptocurrency, forex, commodity, and stock price data with
enterprise-grade reliability, performance, and monitoring capabilities.

## Architecture Overview

This provider implements a fully modernized, production-ready architecture with:

- **Real-time Data Aggregation**: Multi-source price aggregation with advanced
  consensus algorithms and confidence scoring
- **High-Performance Caching**: Sub-second cache TTL with intelligent
  invalidation and performance monitoring
- **Standardized Error Handling**: Universal retry mechanisms with circuit
  breaker protection and intelligent error classification
- **Comprehensive Monitoring**: Real-time performance metrics, health checks,
  and intelligent alerting
- **Production Security**: Advanced rate limiting, comprehensive input
  validation, and structured error responses
- **Clean Mixin-Based Architecture**: Composable service architecture with
  exactly the capabilities you need
- **Unified Development Patterns**: Consistent patterns and conventions
  throughout the entire codebase

## Quick Start

### Using Docker

The Docker images are hosted on GitHub Container Registry (GHCR) as private
packages.

#### Authentication Required

First, authenticate with GHCR using a Personal Access Token:

```bash
# 1. Create a token at: https://github.com/settings/tokens
#    - Select scope: read:packages
#    - Copy the token

# 2. Login to GHCR
echo "YOUR_TOKEN" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

#### Production/VM Deployment (Recommended)

Use `docker-compose.registry.yml` to pull and run pre-built images:

```bash
# Standard deployment
pnpm docker:registry:up

# VM deployment with host network (better performance)
NETWORK_MODE=host pnpm docker:registry:up

# With custom resources
MEMORY_LIMIT=2G CPU_LIMIT=2.0 pnpm docker:registry:up

# View logs
pnpm docker:registry:logs

# Stop
pnpm docker:registry:down
```

**On a VM:** Clone the repo (just for the docker-compose.registry.yml file) and
run:

```bash
docker-compose -f docker-compose.registry.yml up -d
```

#### Local Development

Use `docker-compose.yml` to build and run from source:

```bash
# Build and start
pnpm docker:up

# View logs
pnpm docker:logs

# Test deployment
pnpm docker:test

# Stop
pnpm docker:down
```

**For detailed Docker documentation**, see:

- [docs/docker.md](./docs/docker.md) - Complete Docker guide

### Local Development

```bash
# Install dependencies
pnpm install

# Copy environment configuration
cp .env.example .env

# Start development server
pnpm start:dev
```

The service will be available at `http://localhost:3101` with API documentation
at `/api-doc`.

## API Endpoints

The provider offers production-grade API endpoints with comprehensive
validation, monitoring, and error handling:

### Core Endpoints

- **`POST /feed-values`**: Current feed values for Fast Updates (real-time data)
- **`POST /feed-values/:votingRoundId`**: Historical feed values for Scaling
  (specific voting rounds)
- **`POST /volumes`**: Volume data with configurable time windows
- **`POST /health`**: System health and performance metrics

### Supported Feed Categories

- **Category 1**: Cryptocurrency pairs (BTC/USD, ETH/USD, etc.)
- **Category 2**: Forex pairs (EUR/USD, GBP/USD, etc.)
- **Category 3**: Commodities (XAU/USD, XAG/USD, etc.)
- **Category 4**: Stock indices (AAPL/USD, TSLA/USD, etc.)

### Example Usage

#### Fetching Feed Values with a Voting Round ID

Use the endpoint `/feed-values/<votingRound>` to obtain values for a specific
voting round.

```bash
curl -X 'POST' \
  'http://localhost:3101/feed-values/0' \
  -H 'accept: application/json' \
  -H 'Content-Type: application/json' \
  -d '{
  "feeds": [
    { "category": 1, "name" : "BTC/USD" }
  ]
}'
```

**Example Response:**

```json
{
  "votingRoundId": 0,
  "data": [
    { "feed": { "category": 1, "name": "BTC/USD" }, "value": 71287.34508311428 }
  ]
}
```

#### Fetching Latest Feed Values (Without Voting Round ID)

Use the endpoint `/feed-values/` to get the most recent feed values without
specifying a voting round.

```bash
curl -X 'POST' \
  'http://localhost:3101/feed-values/' \
  -H 'accept: application/json' \
  -H 'Content-Type: application/json' \
  -d '{
  "feeds": [
    { "category": 1, "name" : "BTC/USD" }
  ]
}'
```

**Example Response:**

```json
{
  "data": [
    { "feed": { "category": 1, "name": "BTC/USD" }, "value": 71285.74004472858 }
  ]
}
```

## Development

### Running Tests

The project includes a comprehensive test suite with intelligent log suppression
to keep output clean and focused on actual failures.

```bash
# Run all tests with clean output (default)
pnpm test

# Run tests with verbose logging (shows all logs)
pnpm run test:verbose

# Run tests without log suppression (shows expected errors)
pnpm run test:no-suppress

# Run specific test types
pnpm run test:unit          # Unit tests only
pnpm run test:integration   # Integration tests
pnpm run test:performance   # Performance tests
pnpm run test:endurance     # Long-running endurance tests
```

### Test Logging Control

The test suite automatically suppresses expected error messages and framework
noise while preserving actual test failures. You can control this behavior:

- **Default**: Clean output with suppressed expected logs
- **Verbose**: `VERBOSE_TEST_LOGS=true pnpm test` - Shows all logs
- **No suppression**: `SUPPRESS_TEST_LOGS=false pnpm test` - Shows expected
  errors

For more details, see [Test Logging Control](docs/test-logging-control.md).

### Development Scripts

```bash
# Development
pnpm start:dev              # Development server with hot reload
pnpm build                  # Build for production
pnpm start:prod             # Start production build

# Code Quality
pnpm lint                   # Lint and fix code
pnpm format                 # Format code
pnpm type:check             # TypeScript type checking
pnpm validate               # Run all quality checks

# System Analysis & Debugging
pnpm debug:all              # Complete system debug analysis
pnpm debug:startup          # Debug startup issues and initialization
pnpm debug:performance      # Performance analysis and optimization
pnpm debug:websockets       # WebSocket connection monitoring and health
pnpm debug:feeds            # Feed data quality and validation analysis
pnpm debug:errors           # Error pattern analysis and circuit breaker monitoring
pnpm debug:cache            # Cache performance and efficiency analysis
pnpm debug:config           # Configuration validation and environment checks
pnpm debug:integration      # Service integration and orchestration analysis
pnpm debug:resilience       # Circuit breaker and failover system analysis
pnpm debug:data-aggregation # Data processing pipeline and consensus analysis

# Testing
pnpm test                   # Jest unit tests with intelligent log suppression
pnpm test:cov               # Jest tests with coverage reporting
pnpm test:all               # Complete system test suite
pnpm test:server            # API endpoint functionality testing
pnpm test:security          # Security validation and rate limiting tests
pnpm test:load              # Load testing and stress testing
pnpm test:shutdown          # Graceful shutdown behavior testing
pnpm test:unit              # Unit tests only (isolated component testing)
pnpm test:integration       # Integration tests (service interaction testing)
pnpm test:performance       # Performance tests (latency and throughput validation)
pnpm test:endurance         # Long-running endurance tests (stability validation)

# System Audit
pnpm audit:full             # Complete system audit (debug + test + analysis)
pnpm audit:analyze          # Analyze existing logs and identify patterns
pnpm audit:baseline         # Establish system baseline for comparison
pnpm audit:status           # Current system status and health check
```

### Configuration

Environment configuration is managed through `.env` files with comprehensive
validation:

- Copy `.env.example` to `.env` for local development
- See [Environment Variables](docs/environment-variables.md) for detailed
  configuration options
- Configuration is validated at startup with clear error messages for missing or
  invalid values

## Modernization Achievements

### Code Quality & Architecture

- **Zero Code Duplication**: Eliminated all duplicate patterns and consolidated
  functionality into reusable components
- **Unified Error Handling**: Standardized error handling through
  StandardizedErrorHandlerService across all components
- **Clean Mixin Architecture**: Replaced inheritance hierarchies with composable
  mixins (BaseService, StandardService, EventDrivenService)
- **Consistent Patterns**: Unified development patterns and conventions
  throughout the entire codebase
- **Type Safety**: Full TypeScript support with comprehensive type definitions
  and interfaces
- **Performance Optimization**: Enhanced performance monitoring and optimization
  across all services

## Production Features

### Performance & Reliability

- **Sub-100ms Response Times**: Optimized for high-frequency trading
  requirements with intelligent caching
- **Real-time Caching**: 1-second maximum TTL with intelligent cache
  invalidation and performance monitoring
- **Circuit Breakers**: Automatic failure detection and service isolation with
  configurable thresholds
- **Universal Retry Mechanisms**: Exponential backoff with jitter and
  service-specific configurations
- **Graceful Degradation**: Comprehensive fallback mechanisms with automatic
  recovery detection

### Security & Monitoring

- **Rate Limiting**: Configurable per-client request limits (default:
  1000/minute)
- **Input Validation**: Comprehensive FTSO specification compliance
- **Structured Logging**: Enhanced logging with performance tracking and error
  analysis
- **Health Monitoring**: Real-time system health and performance metrics
- **Error Tracking**: Standardized error handling with detailed context
- **Prometheus Metrics**: Comprehensive metrics for monitoring and alerting
- **Grafana Dashboards**: Pre-configured dashboards for visualization
- **Alert Rules**: Production-ready alerting for critical issues

#### Monitoring Stack

Start the full monitoring stack with Prometheus and Grafana:

```bash
# Start with monitoring
docker-compose --profile monitoring up -d

# Access monitoring tools
# - Prometheus: http://localhost:9091
# - Grafana: http://localhost:3000 (admin/admin)
# - Metrics: http://localhost:3101/metrics/prometheus
```

**Available Metrics:**

- API performance (request rate, error rate, response times)
- System resources (memory, CPU, uptime)
- Cache performance (hit rate, entries)
- Data source health (healthy/unhealthy sources)
- Feed status (active feeds, aggregation success rate)
- Business metrics (consensus deviation, price updates)

**Pre-configured Alerts:**

- High error rate (>5%)
- Slow response times (>500ms)
- Memory issues (>80% usage)
- Low cache hit rate (<70%)
- Unhealthy data sources
- Feed health issues

See [Prometheus Monitoring Guide](docs/prometheus-monitoring.md) for detailed
documentation.

### Data Quality

- **Multi-source Aggregation**: Consensus algorithms across multiple exchanges
- **Real-time Validation**: Data quality checks with outlier detection
- **Accuracy Monitoring**: Continuous accuracy tracking and alerting
- **Feed Coverage**: Support for 70+ currencies across 4 asset categories

## System Architecture

### Core Components

- **Feed Controller**: Production-grade API endpoints with standardized error
  handling and comprehensive monitoring
- **Real-time Aggregation Service**: Multi-source price consensus with
  intelligent caching and confidence scoring
- **Production Data Manager**: WebSocket connection management with automatic
  failover and connection recovery
- **Standardized Error Handler**: Universal error handling with retry logic and
  circuit breaker protection
- **Universal Retry Service**: Intelligent retry mechanisms with exponential
  backoff and service-specific configurations
- **Circuit Breaker Service**: Automatic failure detection and service isolation
  with configurable thresholds
- **Enhanced Monitoring System**: Real-time performance tracking, health checks,
  and intelligent alerting
- **High-Performance Cache**: Sub-second TTL with intelligent invalidation and
  performance optimization

### Data Flow

1. **Data Ingestion**: Real-time WebSocket connections to multiple exchanges
2. **Validation**: Data quality checks and outlier detection
3. **Aggregation**: Consensus algorithms for price determination
4. **Caching**: High-performance caching with intelligent invalidation
5. **API Response**: Sub-100ms response times with comprehensive validation

## Documentation

### Core Documentation

- **[Architecture Patterns](docs/architecture-patterns.md)**: Unified patterns
  and conventions
- **[API Reference](docs/api-reference.md)**: Complete API documentation and
  examples
- **[Environment Variables](docs/environment-variables.md)**: Configuration
  options and examples
- **[Logging and Debugging](docs/logging-and-debugging.md)**: Logging system and
  troubleshooting
- **[Test Logging Control](docs/test-logging-control.md)**: Test suite logging
  configuration
- **[Troubleshooting Geo-Blocking](docs/troubleshooting-geo-blocking.md)**: Fix
  HTTP 451 errors and WebSocket connection issues

### Interactive API Documentation

Complete interactive API documentation is available at `/api-doc` when the
service is running.

### Unified Development Patterns

The modernized system follows consistent architectural patterns throughout:

- **Clean Mixin-Based Services**: Composable service architecture using
  BaseService, StandardService, and EventDrivenService
- **Standardized Error Handling**: Universal error handling through
  StandardizedErrorHandlerService with retry logic and circuit breaker
  protection
- **Enhanced Monitoring**: Built-in performance tracking and health monitoring
  for all components through WithMonitoring mixin
- **Intelligent Caching**: High-performance caching with automatic invalidation
  and performance optimization
- **Comprehensive Testing**: Multi-tier testing strategy with intelligent log
  control and performance validation
- **Zero Code Duplication**: Eliminated all duplicate patterns and consolidated
  functionality into reusable components

## Support

Email [andy@niftyleague.com](mailto:andy@niftyleague.com)

**OR**

Join the Nifty League [Discord Server](https://discord.gg/niftyleague) and
message an admin
