# Modernized Common Modules

This directory contains the fully modernized shared modules, utilities, and base
classes used throughout the FTSO Feed Value Provider system. The architecture
has been completely unified to eliminate all code duplication and provide
consistent, standardized patterns across every component.

## Fully Modernized Architecture

```
src/common/
├── base/           # Unified mixin-based service architecture (BaseService, StandardService, EventDrivenService)
├── errors/         # Standardized error handling and response builders (ErrorResponseBuilder)
├── filters/        # HTTP exception filters with unified error handling
├── interceptors/   # Performance monitoring and response time tracking
├── logging/        # Enhanced logging with performance tracking and audit capabilities
├── rate-limiting/  # Production-grade rate limiting system with comprehensive client tracking
├── types/          # Comprehensive type definitions organized by domain with full TypeScript support
├── utils/          # Consolidated utility functions and helpers (ValidationUtils, ClientIdentificationUtils)
└── debug/          # Debug utilities for development and troubleshooting
```

## Modernized Base Architecture

### Clean Mixin-Based Services

The base service architecture has been completely modernized using composable
mixins instead of deep inheritance chains:

```typescript
import {
  BaseService,
  StandardService,
  EventDrivenService,
} from "@/common/base";

// Simple service with just logging
@Injectable()
export class SimpleService extends BaseService {
  constructor() {
    super("SimpleService");
  }
}

// Standard service with lifecycle, monitoring, and error handling
@Injectable()
export class ProductionService extends StandardService {
  constructor() {
    super("ProductionService");
  }

  protected async initialize() {
    // Custom initialization logic
  }

  async performOperation() {
    this.ensureInitialized();
    this.startTimer("operation");

    try {
      // Business logic
      this.incrementCounter("operations_completed");
    } finally {
      this.endTimer("operation");
    }
  }
}

// Event-driven service with full capabilities
@Injectable()
export class EventService extends EventDrivenService {
  constructor() {
    super("EventService");
  }

  protected async initialize() {
    this.on("data", this.handleData.bind(this));
  }

  private handleData(data: any) {
    this.emitWithLogging("processed", data);
  }
}
```

**Available Mixins:**

- `WithLifecycle`: NestJS lifecycle hooks with proper cleanup
- `WithMonitoring`: Metrics, counters, timers, and health status
- `WithErrorHandling`: Retry logic, error tracking, and fallbacks
- `WithEvents`: EventEmitter with logging and tracking
- `WithConfiguration`: Typed configuration management with validation

### Modernized Utilities

#### Standardized Error Handling

```typescript
import { ErrorResponseBuilder } from "@/common/errors/error-response.builder";

// Standardized error responses across all controllers
throw ErrorResponseBuilder.createValidationError("Invalid feed ID");
throw ErrorResponseBuilder.createRateLimitError();
throw ErrorResponseBuilder.createFromUnknownError(error);
```

#### Client Identification

```typescript
import { ClientIdentificationUtils } from "@/common/utils/client-identification.utils";

const clientInfo = ClientIdentificationUtils.getClientInfo(request);
// Unified identification across API keys, bearer tokens, and IP addresses
```

#### Performance Monitoring

```typescript
import { ResponseTimeInterceptor } from "@/common/interceptors/response-time.interceptor";

// Automatic response time monitoring with <100ms target warnings
@UseInterceptors(ResponseTimeInterceptor)
export class MyController {}
```

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
pnpm test -- src/common/__tests__

# Run specific test file
pnpm test -- src/common/__tests__/base.service.spec.ts
```

## Best Practices

1. **Use appropriate base classes** - Choose the right service base class for
   your needs (BaseService, StandardService, EventDrivenService)
2. **Leverage ValidationUtils** - Use standardized validation for all request
   processing in controllers
3. **Implement StandardizedErrorHandlerService** - Use consistent error handling
   patterns across all controllers
4. **Enable comprehensive logging** - Use enhanced logging for all critical
   services and operations
5. **Implement proper lifecycle management** - Use lifecycle hooks for proper
   initialization and cleanup
6. **Monitor performance** - Use built-in performance logging for all
   potentially slow operations
7. **Provide rich context** - Include comprehensive context in all error and
   warning logs for effective debugging
8. **Use dependency injection** - Leverage NestJS DI for all service
   dependencies with proper typing
