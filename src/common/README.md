# Common Modules

This directory contains shared modules, utilities, and base classes used
throughout the FTSO Feed Value Provider system. It centralizes reusable code to
eliminate duplication and standardize patterns.

## Structure

```
src/common/
├── base/           # Base classes for services and event handling
├── dto/            # Data Transfer Objects used across the app
├── errors/         # Error handling utilities and builders
├── interceptors/   # Shared NestJS interceptors
├── interfaces/     # Shared TypeScript interfaces (organized by domain)
├── logging/        # Consolidated logging services and types
├── rate-limiting/  # Consolidated rate limiting functionality
├── types/          # Shared type definitions
├── utils/          # Utility functions and services (consolidated)
└── validation/     # Validation utilities
```

## Base Classes

### BaseService

Provides common logging functionality for all services.

```typescript
import { BaseService } from "@/common/base/base.service";

@Injectable()
export class MyService extends BaseService {
  constructor() {
    super("MyService", true); // Enable enhanced logging
  }

  async doSomething(): Promise<void> {
    const startTime = performance.now();

    try {
      // Business logic here

      const duration = performance.now() - startTime;
      this.logPerformance("doSomething", duration);
    } catch (error) {
      this.logError(error as Error, "doSomething");
      throw error;
    }
  }
}
```

**Features:**

- Standardized logging methods with context and performance tracking
- Optional enhanced logging integration
- Consistent initialization and shutdown logging

### BaseEventService

Standardizes EventEmitter patterns with automatic tracking and logging.

```typescript
import { BaseEventService } from "@/common/base/base-event.service";

@Injectable()
export class MyEventService extends BaseEventService {
  constructor() {
    super("MyEventService");
  }

  publishData(data: any): void {
    // Automatic event logging and listener tracking
    this.emitWithLogging("data", data);
  }

  onData(callback: (data: any) => void): void {
    // Automatic listener tracking and memory leak prevention
    this.addListenerWithTracking("data", callback);
  }

  cleanup(): void {
    // Standardized cleanup with logging
    this.cleanup();
  }
}
```

**Features:**

- Automatic event listener tracking and memory leak prevention
- Built-in error handling for EventEmitter errors
- Event statistics and debugging capabilities

### ClientIdentificationUtils

Provides standardized client identification and sanitization across guards and
interceptors.

```typescript
import { ClientIdentificationUtils } from "@/common/utils/client-identification.utils";

// Get comprehensive client information
const clientInfo = ClientIdentificationUtils.getClientInfo(request);
console.log(clientInfo.id); // Full client ID
console.log(clientInfo.type); // 'api', 'bearer', 'client', or 'ip'
console.log(clientInfo.sanitized); // Sanitized for logging
```

**Features:**

- Unified client identification from API keys, bearer tokens, client IDs, and IP
  addresses
- Automatic sanitization for secure logging

## Rate Limiting Services

### RateLimiterService

Provides configurable rate limiting with client tracking and statistics.

```typescript
import { RateLimiterService } from "@/common/rate-limiting/rate-limiter.service";

const rateLimiter = new RateLimiterService({
  windowMs: 60000, // 1 minute window
  maxRequests: 1000, // 1000 requests per minute
});

// Check rate limit
const rateLimitInfo = rateLimiter.checkRateLimit(clientId);
if (rateLimitInfo.isBlocked) {
  // Handle rate limit exceeded
}

// Record request
rateLimiter.recordRequest(clientId, true);

// Get statistics
const stats = rateLimiter.getStats();
```

### RateLimitGuard

NestJS guard that automatically applies rate limiting to routes.

```typescript
import { RateLimitGuard } from "@/common/rate-limiting/rate-limit.guard";

@Controller()
@UseGuards(RateLimitGuard)
export class MyController {
  // All routes in this controller are rate limited
}
```

**Features:**

- Configurable rate limits per client
- Multiple client identification methods (API key, IP, etc.)
- Comprehensive rate limit headers
- Detailed logging and statistics
- Automatic cleanup of old records

## Logging Services

### EnhancedLoggerService

Provides comprehensive logging with performance tracking, error analysis, and
file output.

```typescript
import { EnhancedLoggerService } from "@/common/logging/enhanced-logger.service";

const logger = new EnhancedLoggerService("MyService");

// Performance tracking
logger.startPerformanceTimer("op1", "fetchData", "DataService");
// ... do work ...
logger.endPerformanceTimer("op1", true);

// Enhanced error logging
logger.error(new Error("Something failed"), {
  component: "DataService",
  operation: "fetchData",
  metadata: { userId: "123" },
});

// Get statistics
const errorStats = logger.getErrorStatistics();
const perfStats = logger.getPerformanceStatistics();
```

**Features:**

- Performance timing with automatic logging
- Enhanced error tracking with severity analysis
- File logging support for production environments
- Comprehensive statistics and monitoring

## Utility Classes

### ValidationUtils

Provides standardized request validation to eliminate duplication across
controllers.

```typescript
import { ValidationUtils } from "@/common/utils/validation.utils";

@Controller()
export class MyController {
  @Post("/feed-values")
  async getFeedValues(@Body() body: any): Promise<FeedValuesResponse> {
    // Automatic validation with standardized error responses
    const { feeds } = ValidationUtils.validateFeedValuesRequest(body);

    // Business logic here...
  }
}
```

**Available Validation Methods:**

- `validateFeedId(feed)` - Validates individual feed ID structure
- `validateFeedIds(feeds)` - Validates array of feed IDs
- `validateVotingRoundId(id)` - Validates voting round ID
- `validateTimeWindow(windowSec)` - Validates time window parameters
- `validateFeedValuesRequest(body)` - Validates complete feed values request
- `validateVolumesRequest(body)` - Validates complete volumes request

### ErrorResponseBuilder

Standardizes error response formats across all controllers.

```typescript
import { ErrorResponseBuilder } from "@/common/errors/error-response.builder";

@Controller()
export class MyController {
  @Post("/endpoint")
  async myEndpoint(@Body() body: any): Promise<any> {
    try {
      // Business logic here...
    } catch (error) {
      if (error instanceof ValidationError) {
        throw ErrorResponseBuilder.createValidationError(error.message);
      }

      throw ErrorResponseBuilder.createFromUnknownError(error);
    }
  }
}
```

**Available Error Methods:**

- `createValidationError(message)` - 400 Bad Request errors
- `createFeedNotFoundError(feedId)` - 404 Not Found errors
- `createDataSourceError(error)` - 502 Bad Gateway errors
- `createAggregationError(error)` - 500 Internal Server errors
- `createRateLimitError()` - 429 Too Many Requests errors
- `createFromUnknownError(error)` - Handles any unknown error type

## Testing

All base classes include comprehensive unit tests:

```bash
# Run tests for base classes
npm test -- src/common/__tests__

# Run specific test file
npm test -- src/common/__tests__/base.service.spec.ts
```

## Best Practices

1. **Always extend base classes** for new services that fit the patterns
2. **Use ValidationUtils** for all request validation in controllers
3. **Use ErrorResponseBuilder** for all error responses
4. **Enable enhanced logging** for critical services
5. **Call cleanup methods** in service destruction hooks
6. **Use performance logging** for operations that might be slow
7. **Add context** to error and warning logs for better debugging
