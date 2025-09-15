# Service Factory Usage Examples

This document demonstrates how the service factory utilities can be used to
simplify and standardize service creation patterns across the codebase.

## Available Factory Functions

### 1. `createServiceFactory` - Simple Service Creation

For services with straightforward dependencies.

**Before:**

```typescript
{
  provide: RateLimitGuard,
  useFactory: (rateLimiterService: RateLimiterService) => {
    return new RateLimitGuard(rateLimiterService);
  },
  inject: [RateLimiterService],
}
```

**After:**

```typescript
createServiceFactory(RateLimitGuard, [RateLimiterService.name]);
```

### 2. `createMultiDependencyServiceFactory` - Multiple Dependencies

For services that require multiple dependencies.

**Before:**

```typescript
{
  provide: ValidationService,
  useFactory: (dataValidator: DataValidator, universalRetryService: UniversalRetryService) => {
    return new ValidationService(dataValidator, universalRetryService);
  },
  inject: [DataValidator, UniversalRetryService],
}
```

**After:**

```typescript
createMultiDependencyServiceFactory(ValidationService, [
  DataValidator.name,
  UniversalRetryService.name,
]);
```

### 3. `createConfigurableServiceFactory` - Configuration-Based Services

For services that need configuration injection (already in use).

**Example:**

```typescript
createConfigurableServiceFactory(
  AccuracyMonitorService,
  "MonitoringConfig",
  (config: unknown) => (config as MonitoringConfig).thresholds
);
```

### 4. `createConditionalServiceFactory` - Environment-Based Services

For services that should only be created under certain conditions.

**Example - Debug Service (only in development):**

```typescript
createConditionalServiceFactory(
  DebugService,
  (config: unknown) =>
    (config as { nodeEnv: string }).nodeEnv === "development",
  ["ConfigService"]
);
```

**Example - Performance Monitor (only when enabled):**

```typescript
createConditionalServiceFactory(
  PerformanceMonitorService,
  (config: unknown) =>
    (config as { monitoring: { enabled: boolean } }).monitoring.enabled,
  ["ConfigService"]
);
```

### 5. `createSingletonServiceFactory` - Singleton Services

For services that should only have one instance.

**Example - Cache Manager:**

```typescript
createSingletonServiceFactory(CacheManager, [ConfigService.name]);
```

## Real-World Use Cases

### 1. Environment-Specific Services

```typescript
// Only create file logger in production
createConditionalServiceFactory(
  FileLoggerService,
  (config: unknown) => (config as { nodeEnv: string }).nodeEnv === "production",
  ["ConfigService"]
);

// Only create debug service in development
createConditionalServiceFactory(
  DebugService,
  (config: unknown) =>
    (config as { nodeEnv: string }).nodeEnv === "development",
  ["ConfigService"]
);
```

### 2. Feature-Flag Based Services

```typescript
// Only create alerting service when enabled
createConditionalServiceFactory(
  AlertingService,
  (config: unknown) =>
    (config as { alerting: { enabled: boolean } }).alerting.enabled,
  ["ConfigService", "EmailService"]
);

// Only create webhook service when configured
createConditionalServiceFactory(
  WebhookService,
  (config: unknown) => !!(config as { webhook: { url: string } }).webhook.url,
  ["ConfigService", "HttpService"]
);
```

### 3. Singleton Services

```typescript
// Ensure only one instance of expensive services
createSingletonServiceFactory(DatabaseConnectionManager, [ConfigService.name]);
createSingletonServiceFactory(CacheManager, [ConfigService.name]);
createSingletonServiceFactory(WebSocketManager, [ConfigService.name]);
```

### 4. Complex Dependency Chains

```typescript
// Service with multiple dependencies
createMultiDependencyServiceFactory(DataProcessorService, [
  DataValidator.name,
  CacheService.name,
  NotificationService.name,
  ConfigService.name,
]);

// Service with conditional dependencies
createConditionalServiceFactory(
  AdvancedMonitoringService,
  (config: unknown) =>
    (config as { monitoring: { advanced: boolean } }).monitoring.advanced,
  [ConfigService.name, MetricsService.name, AlertingService.name]
);
```

## Benefits

1. **Reduced Boilerplate**: Eliminates repetitive `useFactory` patterns
2. **Type Safety**: Full TypeScript support with proper type inference
3. **Consistency**: Standardized patterns across all modules
4. **Maintainability**: Easier to update factory logic in one place
5. **Readability**: Clear intent with descriptive function names
6. **Reusability**: Same patterns can be used across different modules

## Migration Strategy

1. **Phase 1**: Replace simple `useFactory` patterns with `createServiceFactory`
2. **Phase 2**: Replace multi-dependency patterns with
   `createMultiDependencyServiceFactory`
3. **Phase 3**: Add conditional services using `createConditionalServiceFactory`
4. **Phase 4**: Implement singleton services using
   `createSingletonServiceFactory`

## Current Usage

The factory functions are already being used in:

- `src/monitoring/monitoring.module.ts` - Configuration-based services
- `src/app.module.ts` - Simple service creation
- `src/integration/integration.module.ts` - Multi-dependency services

This demonstrates the practical value of these factory utilities in reducing
code duplication and improving maintainability.
