# API Reference

## Overview

The FTSO Feed Value Provider exposes a RESTful API for retrieving real-time and
historical price data across multiple asset categories. All endpoints use JSON
for request and response payloads.

## Base URL

- **Development**: `http://localhost:3101`
- **Production**: Configure via `APP_PORT` environment variable

## Interactive Documentation

Complete interactive API documentation is available at `/api-doc` when the
service is running.

## Authentication

Currently, the API uses IP-based rate limiting. Future versions may include API
key authentication.

## Rate Limiting

- **Default Limit**: 1000 requests per minute per client
- **Headers**: Rate limit information is included in response headers
- **Exceeded**: Returns HTTP 429 with retry information

## Core Endpoints

### Current Feed Values

**Endpoint**: `POST /feed-values`

Retrieves current feed values for Fast Updates clients.

**Request Body**:

```json
{
  "feeds": [
    { "category": 1, "name": "BTC/USD" },
    { "category": 2, "name": "EUR/USD" }
  ]
}
```

**Response**:

```json
{
  "data": [
    {
      "feed": { "category": 1, "name": "BTC/USD" },
      "value": 45000.5
    },
    {
      "feed": { "category": 2, "name": "EUR/USD" },
      "value": 1.085
    }
  ]
}
```

### Historical Feed Values

**Endpoint**: `POST /feed-values/:votingRoundId`

Retrieves feed values for a specific voting round (Scaling clients).

**Parameters**:

- `votingRoundId` (path): Integer voting round identifier

**Request Body**:

```json
{
  "feeds": [{ "category": 1, "name": "BTC/USD" }]
}
```

**Response**:

```json
{
  "votingRoundId": 12345,
  "data": [
    {
      "feed": { "category": 1, "name": "BTC/USD" },
      "value": 44950.25
    }
  ]
}
```

### Volume Data

**Endpoint**: `POST /volumes`

Retrieves volume data with configurable time windows.

**Query Parameters**:

- `window` (optional): Time window in seconds (default: 3600, range: 1-86400)

**Request Body**:

```json
{
  "feeds": [{ "category": 1, "name": "BTC/USD" }]
}
```

**Response**:

```json
{
  "windowSec": 3600,
  "data": [
    {
      "feed": { "category": 1, "name": "BTC/USD" },
      "value": 1250000.75
    }
  ]
}
```

### Health Check

**Endpoint**: `POST /health`

Returns system health and performance metrics.

**Response**:

```json
{
  "status": "healthy",
  "uptime": 3600000,
  "version": "1.0.0",
  "metrics": {
    "responseTime": 45,
    "cacheHitRate": 0.95,
    "activeConnections": 8
  }
}
```

## Feed Categories

### Category 1: Cryptocurrency

- **Examples**: BTC/USD, ETH/USD, ADA/USD
- **Base Currencies**: BTC, ETH, ADA, DOT, LINK, UNI, etc.
- **Quote Currencies**: USD, EUR, BTC

### Category 2: Forex

- **Examples**: EUR/USD, GBP/USD, JPY/USD
- **Base Currencies**: EUR, GBP, JPY, CHF, CAD, AUD
- **Quote Currencies**: USD, EUR

### Category 3: Commodities

- **Examples**: XAU/USD, XAG/USD, OIL/USD
- **Base Currencies**: XAU (Gold), XAG (Silver), OIL, GAS
- **Quote Currencies**: USD

### Category 4: Stock Indices

- **Examples**: AAPL/USD, TSLA/USD, GOOGL/USD
- **Base Currencies**: Major stock symbols
- **Quote Currencies**: USD

## Feed Name Format

All feed names must follow the `BASE/QUOTE` format:

- **Valid**: `BTC/USD`, `EUR/USD`, `XAU/USD`
- **Invalid**: `BTCUSD`, `BTC-USD`, `BTC_USD`

## Error Responses

All errors follow a consistent format:

```json
{
  "error": "ERROR_CODE",
  "code": 4000,
  "message": "Human-readable error description",
  "timestamp": 1640995200000,
  "requestId": "req_1640995200000_abc123"
}
```

### Common Error Codes

- **4000**: Invalid feed request format
- **4001**: Invalid feed category
- **4002**: Invalid feed name format
- **4003**: Invalid voting round ID
- **4041**: Feed not found
- **4291**: Rate limit exceeded
- **5001**: Internal server error
- **5002**: All feeds failed to retrieve data
- **5003**: Critical error in feed processing
- **5021**: Data source unavailable

## Response Headers

### Standard Headers

- `Content-Type`: `application/json`
- `X-Response-Time`: Response time in milliseconds
- `X-Request-ID`: Unique request identifier

### Rate Limiting Headers

- `X-RateLimit-Limit`: Maximum requests per window
- `X-RateLimit-Remaining`: Remaining requests in current window
- `X-RateLimit-Reset`: Time when rate limit resets
- `Retry-After`: Seconds to wait when rate limited

## Performance Characteristics

- **Target Response Time**: <100ms for all endpoints
- **Cache TTL**: 1 second maximum for real-time data
- **Data Freshness**: <2 seconds for price data
- **Availability**: 99.9% uptime target

## Client Libraries

While no official client libraries are provided, the API is designed to work
with standard HTTP clients in any programming language.

### Example cURL Commands

```bash
# Get current BTC price
curl -X POST http://localhost:3101/feed-values \
  -H "Content-Type: application/json" \
  -d '{"feeds": [{"category": 1, "name": "BTC/USD"}]}'

# Get historical data
curl -X POST http://localhost:3101/feed-values/12345 \
  -H "Content-Type: application/json" \
  -d '{"feeds": [{"category": 1, "name": "BTC/USD"}]}'

# Get volume data
curl -X POST "http://localhost:3101/volumes?window=3600" \
  -H "Content-Type: application/json" \
  -d '{"feeds": [{"category": 1, "name": "BTC/USD"}]}'

# Health check
curl -X POST http://localhost:3101/health
```

## WebSocket Support

Currently, the API is REST-only. WebSocket support for real-time streaming may
be added in future versions.

## Versioning

The API follows semantic versioning principles. The current production version
provides:

- Stable, consistent API contracts
- Comprehensive error handling with standardized response formats
- Production-grade performance and reliability
- Full backward compatibility within major versions

For the most up-to-date API documentation, always refer to the interactive
documentation at `/api-doc`.
