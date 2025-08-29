# Environment Variables Documentation

This document describes all environment variables used by the FTSO Feed Value
Provider system.

## Core Application Settings

### LOG_LEVEL

- **Description**: Sets the logging level for the application
- **Type**: String
- **Default**: `log`
- **Valid Values**: `error`, `warn`, `log`, `debug`, `verbose`
- **Example**: `LOG_LEVEL=debug`
- **Required**: No

### VALUE_PROVIDER_CLIENT_PORT

- **Description**: Port number for the HTTP server
- **Type**: Integer
- **Default**: `3101`
- **Valid Range**: 1-65535
- **Example**: `VALUE_PROVIDER_CLIENT_PORT=3101`
- **Required**: No

### VALUE_PROVIDER_CLIENT_BASE_PATH

- **Description**: Base path for API endpoints
- **Type**: String
- **Default**: `""` (empty string)
- **Example**: `VALUE_PROVIDER_CLIENT_BASE_PATH=/api/v1`
- **Required**: No

### NODE_ENV

- **Description**: Node.js environment mode
- **Type**: String
- **Default**: `development`
- **Valid Values**: `development`, `production`, `test`
- **Example**: `NODE_ENV=production`
- **Required**: No

## Provider Implementation Settings

### VALUE_PROVIDER_IMPL

- **Description**: Specifies which data provider implementation to use
- **Type**: String
- **Default**: `""` (uses CCXT provider)
- **Valid Values**: `""`, `fixed`, `random`
- **Example**: `VALUE_PROVIDER_IMPL=fixed`
- **Required**: No

### USE_PRODUCTION_INTEGRATION

- **Description**: Whether to use production integration services
- **Type**: Boolean
- **Default**: `true`
- **Valid Values**: `true`, `false`
- **Example**: `USE_PRODUCTION_INTEGRATION=true`
- **Required**: No

## Data Processing Settings

### MEDIAN_DECAY

- **Description**: Exponential decay factor for weighted median calculation
- **Type**: Float
- **Default**: `0.00005`
- **Valid Range**: 0.0 < value <= 1.0
- **Example**: `MEDIAN_DECAY=0.00005`
- **Required**: No

### TRADES_HISTORY_SIZE

- **Description**: Number of trades to fetch per batch from exchanges
- **Type**: Integer
- **Default**: `1000`
- **Valid Range**: 1-10000
- **Example**: `TRADES_HISTORY_SIZE=1000`
- **Required**: No

## Network and Testing Settings

### NETWORK

- **Description**: Network environment for configuration selection
- **Type**: String
- **Default**: `mainnet`
- **Valid Values**: `mainnet`, `testnet`, `local-test`
- **Example**: `NETWORK=mainnet`
- **Required**: No

## Email Alerting Configuration

### ALERT_EMAIL_ENABLED

- **Description**: Enable email alerting
- **Type**: Boolean
- **Default**: `false`
- **Valid Values**: `true`, `false`
- **Example**: `ALERT_EMAIL_ENABLED=true`
- **Required**: No

### ALERT_SMTP_HOST

- **Description**: SMTP server hostname for email alerts
- **Type**: String
- **Default**: `localhost`
- **Example**: `ALERT_SMTP_HOST=smtp.gmail.com`
- **Required**: Yes (if email alerting is enabled)

### ALERT_SMTP_PORT

- **Description**: SMTP server port
- **Type**: Integer
- **Default**: `587`
- **Example**: `ALERT_SMTP_PORT=587`
- **Required**: No

### ALERT_SMTP_USERNAME

- **Description**: SMTP authentication username
- **Type**: String
- **Default**: `""` (empty string)
- **Example**: `ALERT_SMTP_USERNAME=alerts@company.com`
- **Required**: No

### ALERT_SMTP_PASSWORD

- **Description**: SMTP authentication password
- **Type**: String
- **Default**: `""` (empty string)
- **Example**: `ALERT_SMTP_PASSWORD=your-password`
- **Required**: No
- **Security**: Store securely, consider using secrets management

### ALERT_EMAIL_FROM

- **Description**: From email address for alerts
- **Type**: String
- **Default**: `alerts@ftso-provider.com`
- **Example**: `ALERT_EMAIL_FROM=noreply@company.com`
- **Required**: No

### ALERT_EMAIL_TO

- **Description**: Comma-separated list of recipient email addresses
- **Type**: String (comma-separated)
- **Default**: `""` (empty string)
- **Example**: `ALERT_EMAIL_TO=admin@company.com,ops@company.com`
- **Required**: Yes (if email alerting is enabled)

## Webhook Alerting Configuration

### ALERT_WEBHOOK_ENABLED

- **Description**: Enable webhook alerting
- **Type**: Boolean
- **Default**: `false`
- **Valid Values**: `true`, `false`
- **Example**: `ALERT_WEBHOOK_ENABLED=true`
- **Required**: No

### ALERT_WEBHOOK_URL

- **Description**: Webhook URL for alert delivery
- **Type**: String (URL)
- **Default**: `""` (empty string)
- **Example**: `ALERT_WEBHOOK_URL=https://hooks.slack.com/services/...`
- **Required**: Yes (if webhook alerting is enabled)

### ALERT_WEBHOOK_HEADERS

- **Description**: Additional HTTP headers for webhook requests (JSON format)
- **Type**: String (JSON)
- **Default**: `{}` (empty object)
- **Example**: `ALERT_WEBHOOK_HEADERS={"Authorization":"Bearer token123"}`
- **Required**: No

### ALERT_WEBHOOK_TIMEOUT

- **Description**: Webhook request timeout in milliseconds
- **Type**: Integer
- **Default**: `5000`
- **Example**: `ALERT_WEBHOOK_TIMEOUT=10000`
- **Required**: No

## General Alerting Settings

### ALERT_MAX_PER_HOUR

- **Description**: Maximum number of alerts to send per hour
- **Type**: Integer
- **Default**: `20`
- **Example**: `ALERT_MAX_PER_HOUR=50`
- **Required**: No

### ALERT_RETENTION_DAYS

- **Description**: Number of days to retain alert history
- **Type**: Integer
- **Default**: `30`
- **Example**: `ALERT_RETENTION_DAYS=90`
- **Required**: No

## Exchange API Keys

Exchange API keys follow the pattern `{EXCHANGE}_API_KEY`, `{EXCHANGE}_SECRET`,
etc.

### Supported Exchanges

- `BINANCE_API_KEY`, `BINANCE_SECRET`
- `COINBASE_API_KEY`, `COINBASE_SECRET`
- `KRAKEN_API_KEY`, `KRAKEN_SECRET`
- `OKX_API_KEY`, `OKX_SECRET`, `OKX_PASSPHRASE`
- `CRYPTOCOM_API_KEY`, `CRYPTOCOM_SECRET`
- `BITGET_API_KEY`, `BITGET_SECRET`, `BITGET_PASSPHRASE`
- `BYBIT_API_KEY`, `BYBIT_SECRET`
- `KUCOIN_API_KEY`, `KUCOIN_SECRET`, `KUCOIN_PASSPHRASE`
- `GATE_API_KEY`, `GATE_SECRET`
- `MEXC_API_KEY`, `MEXC_SECRET`
- `HTX_API_KEY`, `HTX_SECRET`

### Sandbox Mode

- **Pattern**: `{EXCHANGE}_SANDBOX`
- **Description**: Enable sandbox/testnet mode for the exchange
- **Type**: Boolean
- **Default**: `false`
- **Example**: `BINANCE_SANDBOX=true`
- **Required**: No

## Cache Configuration

### CACHE_TTL_MS

- **Description**: Cache time-to-live in milliseconds
- **Type**: Integer
- **Default**: `1000`
- **Valid Range**: 100-10000 (recommended)
- **Example**: `CACHE_TTL_MS=1000`
- **Required**: No

### CACHE_MAX_ENTRIES

- **Description**: Maximum number of entries in the cache
- **Type**: Integer
- **Default**: `10000`
- **Example**: `CACHE_MAX_ENTRIES=50000`
- **Required**: No

### CACHE_WARMUP_INTERVAL_MS

- **Description**: Interval for cache warmup operations in milliseconds
- **Type**: Integer
- **Default**: `30000`
- **Example**: `CACHE_WARMUP_INTERVAL_MS=60000`
- **Required**: No

## Monitoring Configuration

### MONITORING_ENABLED

- **Description**: Enable monitoring services
- **Type**: Boolean
- **Default**: `true`
- **Valid Values**: `true`, `false`
- **Example**: `MONITORING_ENABLED=true`
- **Required**: No

### MONITORING_METRICS_PORT

- **Description**: Port for metrics endpoint (Prometheus format)
- **Type**: Integer
- **Default**: `9090`
- **Valid Range**: 1-65535 (must be different from main port)
- **Example**: `MONITORING_METRICS_PORT=9090`
- **Required**: No

### MONITORING_HEALTH_CHECK_INTERVAL_MS

- **Description**: Interval for health check operations in milliseconds
- **Type**: Integer
- **Default**: `5000`
- **Example**: `MONITORING_HEALTH_CHECK_INTERVAL_MS=10000`
- **Required**: No

## Error Handling Configuration

### ERROR_HANDLING_MAX_RETRIES

- **Description**: Maximum number of retry attempts for failed operations
- **Type**: Integer
- **Default**: `3`
- **Example**: `ERROR_HANDLING_MAX_RETRIES=5`
- **Required**: No

### ERROR_HANDLING_RETRY_DELAY_MS

- **Description**: Delay between retry attempts in milliseconds
- **Type**: Integer
- **Default**: `1000`
- **Example**: `ERROR_HANDLING_RETRY_DELAY_MS=2000`
- **Required**: No

### ERROR_HANDLING_CIRCUIT_BREAKER_THRESHOLD

- **Description**: Number of failures before opening circuit breaker
- **Type**: Integer
- **Default**: `5`
- **Example**: `ERROR_HANDLING_CIRCUIT_BREAKER_THRESHOLD=10`
- **Required**: No

### ERROR_HANDLING_CIRCUIT_BREAKER_TIMEOUT_MS

- **Description**: Circuit breaker timeout in milliseconds
- **Type**: Integer
- **Default**: `60000`
- **Example**: `ERROR_HANDLING_CIRCUIT_BREAKER_TIMEOUT_MS=120000`
- **Required**: No

## Example Configuration Files

### Development (.env.development)

```bash
LOG_LEVEL=debug
VALUE_PROVIDER_CLIENT_PORT=3101
NODE_ENV=development
USE_PRODUCTION_INTEGRATION=false
MONITORING_ENABLED=true
CACHE_TTL_MS=1000
```

### Production (.env.production)

```bash
LOG_LEVEL=warn
VALUE_PROVIDER_CLIENT_PORT=3101
NODE_ENV=production
USE_PRODUCTION_INTEGRATION=true

# Alerting
ALERT_EMAIL_ENABLED=true
ALERT_SMTP_HOST=smtp.company.com
ALERT_SMTP_PORT=587
ALERT_SMTP_USERNAME=alerts@company.com
ALERT_SMTP_PASSWORD=secure-password
ALERT_EMAIL_FROM=ftso-alerts@company.com
ALERT_EMAIL_TO=ops@company.com,admin@company.com

# Exchange API Keys (example - use your actual keys)
BINANCE_API_KEY=your-binance-api-key
BINANCE_SECRET=your-binance-secret
COINBASE_API_KEY=your-coinbase-api-key
COINBASE_SECRET=your-coinbase-secret

# Monitoring
MONITORING_ENABLED=true
MONITORING_METRICS_PORT=9090
MONITORING_HEALTH_CHECK_INTERVAL_MS=5000

# Cache
CACHE_TTL_MS=1000
CACHE_MAX_ENTRIES=50000
```

### Testing (.env.test)

```bash
LOG_LEVEL=error
NODE_ENV=test
NETWORK=local-test
USE_PRODUCTION_INTEGRATION=false
MONITORING_ENABLED=false
ALERT_EMAIL_ENABLED=false
ALERT_WEBHOOK_ENABLED=false
```

## Security Considerations

1. **API Keys**: Never commit API keys to version control. Use
   environment-specific files or secrets management.
2. **SMTP Passwords**: Store SMTP passwords securely using secrets management
   systems.
3. **Webhook URLs**: Ensure webhook URLs use HTTPS and include authentication
   tokens.
4. **File Permissions**: Ensure environment files have restricted permissions
   (600 or 640).

## Validation

The configuration service automatically validates all environment variables on
startup and provides detailed error messages for:

- Missing required variables
- Invalid value formats
- Out-of-range numeric values
- Invalid enum values

Use the `/health` endpoint or configuration status methods to check validation
results.
