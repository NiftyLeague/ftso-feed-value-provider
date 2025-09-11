# Service Base Classes - Clean Mixin Architecture

This directory provides a clean, composable architecture for building services
with exactly the capabilities you need.

## Overview

Instead of deep inheritance chains, we use **mixins** to compose services with
specific capabilities:

- **Logging** (BaseService) - Always included
- **Configuration** - Manage typed configuration with validation
- **Lifecycle** - NestJS lifecycle hooks with proper cleanup
- **Monitoring** - Metrics, counters, timers, and health status
- **Error Handling** - Retry logic, error tracking, and fallbacks
- **Events** - EventEmitter with logging and tracking

## Quick Start

### 1. Simple Service (just logging)

```typescript
@Injectable()
export class MyService extends BaseService {
  constructor() {
    super("MyService");
  }
}
```

### 2. Standard Service (lifecycle + monitoring + error handling)

```typescript
@Injectable()
export class MyService extends StandardService {
  constructor() {
    super("MyService");
  }

  protected async initialize() {
    // Custom initialization
  }

  async doWork() {
    this.ensureInitialized();
    this.startTimer("work");

    try {
      // Your logic
      this.incrementCounter("work_completed");
    } finally {
      this.endTimer("work");
    }
  }
}
```

### 3. Service with Configuration

```typescript
interface MyConfig {
  timeout: number;
  retries: number;
}

const defaultConfig: MyConfig = {
  timeout: 5000,
  retries: 3,
};

@Injectable()
export class MyService extends createConfigurableService(defaultConfig) {
  constructor() {
    super("MyService");
  }

  async doWork() {
    const config = this.getConfig();
    // Use config.timeout, config.retries
  }

  protected validateConfig() {
    const config = this.getConfig();
    if (config.timeout < 1000) {
      throw new Error("Timeout too low");
    }
  }
}
```

### 4. Event-Driven Service

```typescript
@Injectable()
export class MyService extends EventDrivenService {
  constructor() {
    super("MyService");
  }

  protected async initialize() {
    this.on("data", this.handleData.bind(this));
  }

  processData(data: any) {
    this.emitWithLogging("data", data);
  }

  private handleData(data: any) {
    // Handle the data
  }
}
```

### 5. Manual Composition with Mixins

```typescript
const MyServiceBase = Mixins.Events(
  Mixins.Monitoring(Mixins.Lifecycle(BaseService))
);

@Injectable()
export class MyService extends MyServiceBase {
  constructor() {
    super("MyService");
  }
}
```

## Available Capabilities

### BaseService (Always Included)

**Protected Methods (accessible within service classes and mixins):**

- `logger: Logger` - NestJS logger instance (protected)
- `logError(error, context?, data?)` - Log errors with context (protected)
- `logWarning(message, context?, data?)` - Log warnings (protected)
- `logDebug(message, context?, data?)` - Log debug info (protected)
- `logInitialization(message?)` - Log service startup (protected)
- `logShutdown(message?)` - Log service shutdown (protected)

**Note:** All logging methods are protected to encourage proper encapsulation.
They are accessible within your service classes and through mixins, but not from
external code.

### WithLifecycle

- `onModuleInit()` / `onModuleDestroy()` - NestJS lifecycle hooks
- `isServiceInitialized()` / `isServiceDestroyed()` - State checks
- `ensureInitialized()` - Throws if not initialized
- `createTimeout(callback, delay)` - Managed timeouts
- `createInterval(callback, delay)` - Managed intervals
- `initialize?()` - Override for custom initialization
- `cleanup?()` - Override for custom cleanup

### WithMonitoring

- `recordMetric(name, value)` - Record a metric value
- `incrementCounter(name, increment?)` - Increment a counter
- `startTimer(name)` / `endTimer(name)` - Time operations
- `setHealthStatus(status)` - Set health status
- `getHealthStatus()` - Get current health info
- `getMetrics()` / `getCounters()` - Get recorded data

### WithErrorHandling

- `handleError(error, context, options?)` - Handle errors with tracking
- `executeWithErrorHandling(operation, context, options?)` - Retry logic
- `getErrorCount(context)` - Get error count for context
- `resetErrorTracking(context?)` - Reset error tracking

### WithEvents

- All EventEmitter methods (`on`, `emit`, `off`, etc.)
- `emitWithLogging(event, ...args)` - Emit with debug logging
- `getEventStats()` - Get listener statistics
- `logEventStats()` - Log event statistics

### WithConfiguration

- `updateConfig(newConfig)` - Update configuration
- `getConfig()` - Get current configuration (readonly)
- `resetConfig()` - Reset to defaults
- `validateConfig()` - Override for validation
- `onConfigUpdated?(oldConfig, newConfig)` - Override for change handling

## Pre-composed Classes

For common combinations, use these ready-made classes:

- `StandardService` - Lifecycle + Monitoring + Error Handling
- `EventDrivenService` - Standard + Events

## Best Practices

1. **Start Simple** - Begin with `BaseService` or `StandardService`
2. **Add Capabilities as Needed** - Only include what you actually use
3. **Use TypeScript** - All mixins are fully typed
4. **Override Lifecycle Methods** - Implement `initialize()` and `cleanup()` as
   needed
5. **Validate Configuration** - Override `validateConfig()` for config
   validation
6. **Handle Errors Gracefully** - Use `executeWithErrorHandling()` for
   operations that might fail
7. **Monitor Performance** - Use timers and metrics for important operations

## Migration from Old Architecture

The old `UnifiedService`, `ConfigurableService`, and `BaseEventService` have
been removed and replaced with the new mixin architecture:

1. **UnifiedService** → `StandardService` or `EventDrivenService`
2. **BaseEventService** → Use `WithEvents` mixin or `EventService`
3. **Custom combinations** → Use manual composition

## Examples

See `examples.ts` and `usage-demo.ts` for comprehensive examples of each
pattern.
