# Environment Constants Documentation

This document describes the centralized environment constants system implemented
in the FTSO Feed Value Provider.

## Overview

The environment constants system provides a single source of truth for all
environment variables used throughout the application. This eliminates
duplication, ensures consistency, and makes environment variable management much
easier.

## Files

- **`src/config/environment.constants.ts`** - Main constants file with all
  environment variables
- **`src/config/index.ts`** - Exports all constants

## Usage

### Basic Usage

```typescript
import { ENV, ENV_HELPERS } from "@/common/constants";

// Access environment variables
const port = ENV.PORT;
const logLevel = ENV.LOG_LEVEL;
const isProduction = ENV_HELPERS.isProduction();

// Access grouped constants
const freshDataThreshold = ENV.DATA_AGE_THRESHOLDS.FRESH_DATA_MS;
const maxDataAge = ENV.DATA_AGE_THRESHOLDS.MAX_DATA_AGE_MS;

// Use helper functions
const baseUrl = ENV_HELPERS.getBaseUrl();
const missingKeys = ENV_HELPERS.getMissingExchangeKeys();
```

### Available Constants

#### Core Application

- `ENV.NODE_ENV` - Application environment (development, production, test)
- `ENV.PORT` - Server port (default: 3101)
- `ENV.BASE_PATH` - API base path (default: "")

#### Logging

- `ENV.LOG_LEVEL` - Log level (default: "log")
- `ENV.ENABLE_FILE_LOGGING` - Enable file logging (default: false)
- `ENV.ENABLE_PERFORMANCE_LOGGING` - Enable performance logging (default: true)
- `ENV.ENABLE_DEBUG_LOGGING` - Enable debug logging (default: false)
- `ENV.LOG_DIRECTORY` - Log directory (default: "logs")

#### Data Processing

- `ENV.MEDIAN_DECAY` - Median decay factor (default: 0.00005)
- `ENV.TRADES_HISTORY_SIZE` - Trades history size (default: 1000)

#### Data Age Thresholds

- `ENV.DATA_AGE_THRESHOLDS.FRESH_DATA_MS` - Fresh data threshold (default:
  2000ms)
- `ENV.DATA_AGE_THRESHOLDS.MAX_DATA_AGE_MS` - Maximum data age (default:
  20000ms)
- `ENV.DATA_AGE_THRESHOLDS.STALE_WARNING_MS` - Stale warning threshold (default:
  10000ms)
- `ENV.DATA_AGE_THRESHOLDS.CACHE_TTL_MS` - Cache TTL (default: 500ms)

#### Application Lifecycle

- `ENV.GRACEFUL_SHUTDOWN_TIMEOUT_MS` - Shutdown timeout (default: 30000ms)
- `ENV.APP_READINESS_TIMEOUT_MS` - App readiness timeout (default: 30000ms)

#### Integration Services

- `ENV.INTEGRATION_SERVICE_TIMEOUT_MS` - Integration timeout (default: 60000ms)

#### Rate Limiting

- `ENV.RATE_LIMIT_MAX_REQUESTS` - Max requests per window (default: 1000)

#### Monitoring

- `ENV.MONITORING_INTERVAL` - Monitoring interval (default: 5000ms)
- `ENV.MAX_CONSENSUS_DEVIATION` - Max consensus deviation (default: 0.5)
- `ENV.MIN_ACCURACY_RATE` - Min accuracy rate (default: 80)
- `ENV.MIN_QUALITY_SCORE` - Min quality score (default: 70)

#### Performance Monitoring

- `ENV.MAX_RESPONSE_LATENCY` - Max response latency (default: 80ms)
- `ENV.MAX_DATA_AGE` - Max data age (default: 3000ms)
- `ENV.MIN_THROUGHPUT` - Min throughput (default: 150)
- `ENV.MIN_CACHE_HIT_RATE` - Min cache hit rate (default: 90)

#### Health Monitoring

- `ENV.MAX_ERROR_RATE` - Max error rate (default: 3)
- `ENV.MAX_CPU_USAGE` - Max CPU usage (default: 70%)
- `ENV.MAX_MEMORY_USAGE` - Max memory usage (default: 70%)
- `ENV.MIN_CONNECTION_RATE` - Min connection rate (default: 95%)

#### Alerting

- `ENV.ALERT_MAX_PER_HOUR` - Max alerts per hour (default: 20)
- `ENV.ALERT_RETENTION_DAYS` - Alert retention days (default: 30)

#### Email Alerting

- `ENV.ALERT_EMAIL_ENABLED` - Enable email alerts (default: false)
- `ENV.ALERT_SMTP_HOST` - SMTP host (default: "localhost")
- `ENV.ALERT_SMTP_PORT` - SMTP port (default: 587)
- `ENV.ALERT_SMTP_USERNAME` - SMTP username (default: "")
- `ENV.ALERT_SMTP_PASSWORD` - SMTP password (default: "")
- `ENV.ALERT_EMAIL_FROM` - From email (default: "Alerting Service
  <alerts@ftso-provider.com>")
- `ENV.ALERT_EMAIL_TO` - To emails (default: [])

#### Webhook Alerting

- `ENV.ALERT_WEBHOOK_ENABLED` - Enable webhook alerts (default: false)
- `ENV.ALERT_WEBHOOK_URL` - Webhook URL (default: "")
- `ENV.ALERT_WEBHOOK_HEADERS` - Webhook headers (default: {})
- `ENV.ALERT_WEBHOOK_TIMEOUT` - Webhook timeout (default: 5000ms)

#### Exchange API Keys

- `ENV.EXCHANGE_KEYS.BINANCE_API_KEY` - Binance API key
- `ENV.EXCHANGE_KEYS.BINANCE_SECRET` - Binance secret
- `ENV.EXCHANGE_KEYS.BINANCE_PASSPHRASE` - Binance passphrase
- `ENV.EXCHANGE_KEYS.COINBASE_API_KEY` - Coinbase API key
- `ENV.EXCHANGE_KEYS.COINBASE_SECRET` - Coinbase secret
- `ENV.EXCHANGE_KEYS.COINBASE_PASSPHRASE` - Coinbase passphrase
- `ENV.EXCHANGE_KEYS.KRAKEN_API_KEY` - Kraken API key
- `ENV.EXCHANGE_KEYS.KRAKEN_SECRET` - Kraken secret
- `ENV.EXCHANGE_KEYS.KRAKEN_PASSPHRASE` - Kraken passphrase
- `ENV.EXCHANGE_KEYS.OKX_API_KEY` - OKX API key
- `ENV.EXCHANGE_KEYS.OKX_SECRET` - OKX secret
- `ENV.EXCHANGE_KEYS.OKX_PASSPHRASE` - OKX passphrase
- `ENV.EXCHANGE_KEYS.CRYPTOCOM_API_KEY` - Crypto.com API key
- `ENV.EXCHANGE_KEYS.CRYPTOCOM_SECRET` - Crypto.com secret
- `ENV.EXCHANGE_KEYS.CRYPTOCOM_PASSPHRASE` - Crypto.com passphrase

### Helper Functions

#### Environment Checks

```typescript
ENV_HELPERS.isProduction(); // Check if running in production
ENV_HELPERS.isTest(); // Check if running in test
ENV_HELPERS.isDevelopment(); // Check if running in development
```

#### Utility Functions

```typescript
ENV_HELPERS.getBaseUrl(); // Get full base URL
ENV_HELPERS.hasExchangeKeys(); // Check if any exchange keys are configured
ENV_HELPERS.getMissingExchangeKeys(); // Get missing exchange keys for validation
```

## Benefits

1. **Single Source of Truth**: All environment variables are defined in one
   place
2. **Consistent Defaults**: No more different defaults across the codebase
3. **Type Safety**: Full TypeScript support with proper typing
4. **Validation**: Built-in validation with min/max ranges and pattern matching
5. **Error Handling**: Consistent warning messages and fallback to defaults
6. **Maintainability**: Easy to update and manage environment variables
7. **Helper Functions**: Convenient utility functions for common checks

## Migration

The migration from direct `process.env` access to centralized constants has been
completed for:

- `src/main.ts`
- `src/common/logging/filtered-logger.ts`
- `src/common/logging/enhanced-logger.service.ts`
- `src/integration/services/startup-validation.service.ts`
- `src/adapters/base/base-exchange-adapter.ts`
- `src/data-manager/websocket-connection-manager.service.ts`
- `src/controllers/health.controller.ts`

## Future Considerations

- Consider adding environment variable validation at startup
- Add support for environment-specific configuration files
- Consider adding runtime configuration updates (hot reload)
- Add support for encrypted environment variables
