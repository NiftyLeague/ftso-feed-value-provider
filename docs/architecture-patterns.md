# Architecture Patterns and Conventions

## Overview

The fully modernized FTSO Feed Value Provider follows unified architectural
patterns and conventions that eliminate code duplication and provide consistent,
maintainable, and scalable solutions. This document outlines the standardized
patterns used throughout the entire system after comprehensive modernization.

## Service Architecture Patterns

### Mixin-Based Service Composition

Instead of deep inheritance hierarchies, services use composable mixins:

```typescript
// Simple service with just logging
@Injectable()
export class SimpleService extends BaseService {
  constructor() {
    super("SimpleService");
  }
}

// Production service with full capabilities
@Injectable()
export class ProductionService extends StandardService {
  constructor() {
    super("ProductionService");
  }

  protected async initialize() {
    // Custom initialization
  }
}

// Event-driven service
@Injectable()
export class EventService extends EventDrivenService {
  constructor() {
    super("EventService");
  }
}
```

**Available Mixins:**

- `WithLifecycle`: NestJS lifecycle hooks with proper cleanup
- `WithMonitoring`: Metrics, counters, timers, and health status
- `WithErrorHandling`: Retry logic, error tracking, and fallbacks
- `WithEvents`: EventEmitter with logging and tracking
- `WithConfiguration`: Typed configuration management

### Dependency Injection Patterns

All services use constructor-based dependency injection with interfaces:

```typescript
@Injectable()
export class MyService {
  constructor(
    private readonly config: IConfigurationService,
    private readonly aggregation: IAggregationService,
    private readonly validation: IDataValidationService,
    private readonly logger: Logger
  ) {}
}
```

## Error Handling Patterns

### Standardized Error Handling

All controllers use the unified StandardizedErrorHandlerService for consistent
error handling:

```typescript
@Controller()
export class ModernController {
  constructor(private readonly errorHandler: StandardizedErrorHandlerService) {}

  @Post()
  async endpoint(@Body() body: any) {
    return this.errorHandler.executeWithStandardizedHandling(
      async () => {
        // Business logic here
      },
      {
        operationName: "endpoint",
        context: { method: "POST" },
        errorClassification: true,
      }
    );
  }
}
```

This approach provides:

- Automatic error classification and severity analysis
- Consistent error response formats across all endpoints
- Comprehensive error logging with context
- Built-in retry logic and circuit breaker protection

### Retry Mechanisms

Universal retry service with configurable strategies:

```typescript
// Configure retry settings
this.retryService.configureRetrySettings("MyService", {
  maxRetries: 3,
  initialDelayMs: 1000,
  backoffMultiplier: 2,
  jitter: true,
});

// Execute with retry
await this.retryService.executeWithRetry(() => this.externalCall(), {
  serviceType: "external-api",
});
```

## Data Flow Patterns

### Real-time Data Processing

Data flows through standardized processing stages:

1. **Ingestion**: WebSocket connections with automatic reconnection
2. **Validation**: Data quality checks with configurable thresholds
3. **Aggregation**: Consensus algorithms with confidence scoring
4. **Caching**: High-performance caching with intelligent invalidation
5. **API Response**: Sub-100ms response times with comprehensive validation

### Event-Driven Architecture

Services communicate through events with automatic logging:

```typescript
// Emit events with logging
this.emitWithLogging("data-processed", { feedId, price, confidence });

// Subscribe to events with tracking
this.on("data-processed", this.handleProcessedData.bind(this));
```

## Configuration Patterns

### Environment-Based Configuration

Configuration is managed through typed interfaces with validation:

```typescript
interface ServiceConfig {
  timeout: number;
  retries: number;
  enabled: boolean;
}

@Injectable()
export class ConfigurableService extends createConfigurableService<ServiceConfig>(
  {
    timeout: 5000,
    retries: 3,
    enabled: true,
  }
) {
  constructor() {
    super("ConfigurableService");
  }

  protected validateConfig() {
    const config = this.getConfig();
    if (config.timeout < 1000) {
      throw new Error("Timeout too low");
    }
  }
}
```

### Runtime Configuration Updates

Configuration can be updated at runtime with validation:

```typescript
// Update configuration
this.updateConfig({ timeout: 10000 });

// React to configuration changes
protected onConfigUpdated(oldConfig: ServiceConfig, newConfig: ServiceConfig) {
  if (oldConfig.timeout !== newConfig.timeout) {
    this.reinitializeConnections();
  }
}
```

## Monitoring and Observability Patterns

### Performance Monitoring

All services include built-in performance monitoring:

```typescript
async performOperation() {
  this.startTimer("operation");

  try {
    // Business logic
    this.incrementCounter("operations_completed");
  } catch (error) {
    this.incrementCounter("operations_failed");
    throw error;
  } finally {
    this.endTimer("operation");
  }
}
```

### Health Checks

Services provide standardized health information:

```typescript
async getHealthStatus(): Promise<ServiceHealthStatus> {
  return {
    status: this.isHealthy() ? "healthy" : "unhealthy",
    uptime: this.getUptime(),
    metrics: this.getMetrics(),
    lastError: this.getLastError(),
  };
}
```

## Testing Patterns

### Service Testing

Services are tested using the standardized test utilities:

```typescript
describe("MyService", () => {
  let service: MyService;
  let module: TestingModule;

  beforeEach(async () => {
    module = await createTestModule({
      providers: [MyService],
    });
    service = module.get<MyService>(MyService);
  });

  afterEach(async () => {
    await module.close();
  });

  it("should perform operation", () => {
    withLogging(() => {
      // Test with logging enabled
      expect(service.performOperation()).toBeDefined();
    });
  });
});
```

### Integration Testing

Integration tests use real services with proper cleanup:

```typescript
describe("Integration Test", () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await createTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it("should handle end-to-end flow", async () => {
    const response = await request(app.getHttpServer())
      .post("/feed-values")
      .send({ feeds: [{ category: 1, name: "BTC/USD" }] })
      .expect(200);

    expect(response.body.data).toBeDefined();
  });
});
```

## API Design Patterns

### Controller Structure

Controllers follow a consistent structure with standardized error handling:

```typescript
@Controller("api")
@UseGuards(RateLimitGuard)
@UseInterceptors(ResponseTimeInterceptor)
export class ApiController {
  constructor(
    private readonly service: IApiService,
    private readonly errorHandler: StandardizedErrorHandlerService
  ) {}

  @Post("endpoint")
  async endpoint(@Body() body: RequestDto): Promise<ResponseDto> {
    return this.errorHandler.executeWithStandardizedHandling(
      async () => {
        const validatedData = this.validateRequest(body);
        return await this.service.processRequest(validatedData);
      },
      {
        operationName: "endpoint",
        context: { endpoint: "/api/endpoint" },
      }
    );
  }

  private validateRequest(body: any): RequestDto {
    // Validation logic
    return body;
  }
}
```

### Response Formatting

All API responses follow consistent formats:

```typescript
// Success response
{
  "data": [...],
  "votingRoundId": 12345, // Optional
  "timestamp": 1640995200000
}

// Error response
{
  "error": "VALIDATION_ERROR",
  "code": 4000,
  "message": "Invalid feed ID",
  "timestamp": 1640995200000,
  "requestId": "req_1640995200000_abc123"
}
```

## Code Organization Patterns

### Module Structure

Modules are organized by domain with clear boundaries:

```
src/
├── adapters/           # External service adapters
├── aggregators/        # Data aggregation services
├── cache/             # Caching services
├── common/            # Shared utilities and base classes
├── config/            # Configuration management
├── controllers/       # API controllers
├── data-manager/      # Data management services
├── error-handling/    # Error handling services
├── integration/       # Service integration
└── monitoring/        # Monitoring and metrics
```

### File Naming Conventions

- **Services**: `*.service.ts`
- **Controllers**: `*.controller.ts`
- **Modules**: `*.module.ts`
- **Interfaces**: `*.interface.ts`
- **Types**: `*.types.ts`
- **Utils**: `*.utils.ts`
- **Tests**: `*.spec.ts`

## Best Practices

### Service Design

1. **Single Responsibility**: Each service has a clear, focused purpose
2. **Interface-Based**: Use interfaces for all service contracts
3. **Dependency Injection**: Constructor-based injection with proper typing
4. **Error Handling**: Consistent error handling patterns
5. **Monitoring**: Built-in performance and health monitoring

### Configuration Management

1. **Environment Variables**: All configuration through environment variables
2. **Validation**: Runtime validation with clear error messages
3. **Type Safety**: Strongly typed configuration interfaces
4. **Defaults**: Sensible defaults for all configuration options

### Testing Strategy

1. **Unit Tests**: Test individual components in isolation
2. **Integration Tests**: Test service interactions
3. **Performance Tests**: Validate performance requirements
4. **Clean Output**: Use logging control for clean test output

### Error Handling

1. **Standardized Responses**: Consistent error response format
2. **Proper Classification**: Appropriate HTTP status codes
3. **Retry Logic**: Intelligent retry with exponential backoff
4. **Circuit Breakers**: Automatic failure detection and isolation

This architectural foundation ensures consistency, maintainability, and
scalability across the entire FTSO Feed Value Provider system.
