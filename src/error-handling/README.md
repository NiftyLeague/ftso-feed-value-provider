# Error Handling System

## Overview

This directory contains the comprehensive error handling system for the FTSO
Feed Value Provider. The system has been enhanced with standardized error
handling, retry mechanisms, and circuit breaker patterns.

## Architecture

### Core Services

#### `StandardizedErrorHandlerService`

- **Purpose**: Provides standardized error handling across all controllers
- **Features**:
  - Automatic error classification
  - Consistent error response formats
  - Comprehensive error logging
  - Error statistics tracking
- **Usage**: Inject into controllers and use `executeWithStandardizedHandling()`

#### `UniversalRetryService`

- **Purpose**: Provides consistent retry mechanisms with exponential backoff
- **Features**:
  - Service-specific retry configurations
  - Exponential backoff with jitter
  - Retry statistics and monitoring
- **Usage**: Use specific methods like `executeHttpWithRetry()`,
  `executeDatabaseWithRetry()`

#### `CircuitBreakerService`

- **Purpose**: Provides circuit breaker protection for external calls
- **Features**:
  - Automatic failure detection
  - Service isolation during failures
  - Automatic recovery detection
- **Usage**: Integrated automatically with retry service

## Usage Examples

### New Standardized Approach

```typescript
@Controller()
export class MyController extends BaseController {
  constructor(
    private readonly standardizedErrorHandler: StandardizedErrorHandlerService,
    private readonly universalRetryService: UniversalRetryService
  ) {
    super("MyController");
    this.standardizedErrorHandler = standardizedErrorHandler;
    this.universalRetryService = universalRetryService;
  }

  @Post()
  async myEndpoint(@Body() body: any) {
    return this.handleControllerOperation(
      async () => {
        // Your business logic here
        return await this.executeWithRetry(
          () => this.externalService.call(body),
          {
            operationName: "externalServiceCall",
            serviceType: "external-api",
            endpoint: "/api/endpoint",
          }
        );
      },
      "myEndpoint",
      "POST",
      "/my-endpoint",
      {
        body,
        useStandardizedErrorHandling: true,
      }
    );
  }
}
```

### Error Handling Patterns

```typescript
// Validation Error
throw this.handleValidationError("Invalid input", { field: "email" });

// Authentication Error
throw this.handleAuthenticationError("Token expired");

// Rate Limit Error
throw this.handleRateLimitError(requestId, 60000);

// External Service Error
throw this.handleExternalServiceError("PaymentService", originalError);
```

## Configuration

### Retry Configuration

```typescript
// Configure retry settings for a service
universalRetryService.configureRetrySettings("MyService", {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitter: true,
});
```

### Circuit Breaker Configuration

```typescript
// Circuit breakers are auto-configured in ErrorHandlingModule
// Custom configuration can be added in the module constructor
```

## Monitoring

### Error Statistics

```typescript
const errorStats = standardizedErrorHandler.getErrorStatistics();
const retryStats = universalRetryService.getRetryStatistics();
```

### Health Checks

- Circuit breaker states are exposed via health endpoints
- Error rates and retry statistics are available for monitoring
- Comprehensive logging provides audit trail

## Best Practices

1. **Always use standardized error handling** for new code
2. **Configure service-specific retry settings** based on service
   characteristics
3. **Use appropriate error classifications** for consistent handling
4. **Include comprehensive context** in error metadata
5. **Monitor error statistics** for system health
6. **Test error scenarios** thoroughly including retry and circuit breaker
   behavior

## Troubleshooting

### Common Issues

1. **Missing Dependencies**: Ensure `ErrorHandlingModule` is imported
2. **Test Failures**: Add mock providers for new services
3. **Type Errors**: Import types from `@/common/types/error-handling`
4. **Configuration Issues**: Check service-specific retry configurations

### Debug Commands

```bash
# Find old error handler usage
grep -r "ApiErrorHandlerService" src/

# Find hybrid error handler usage
grep -r "HybridErrorHandlerService" src/

# Check for missing imports
npx tsc --noEmit --project tsconfig.json

# Run error handling tests
pnpm test -- --testPathPatterns=error-handling
```
