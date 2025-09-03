# Standardized Service Interfaces

This document describes the standardized service interfaces implemented as part
of the production system audit refactoring. These interfaces ensure proper
dependency injection, consistent service contracts, and improved
maintainability.

## Overview

The following standardized interfaces have been created to define clear
contracts for the core services:

1. **IFtsoProviderService** - Main business logic for feed value provision
2. **IAggregationService** - Price aggregation and real-time caching
3. **IConfigurationService** - Configuration management and validation
4. **IDataValidationService** - Data validation and quality assurance

## Interface Definitions

### IFtsoProviderService

The main service interface for FTSO feed value provision.

**Location:** `src/common/interfaces/services/provider.interface.ts`
**Implementation:** `src/app.service.ts` (FtsoProviderService)

**Key Methods:**

- `getValue(feed: FeedId): Promise<FeedValueData>` - Get current value for a
  single feed
- `getValues(feeds: FeedId[]): Promise<FeedValueData[]>` - Get current values
  for multiple feeds
- `getVolumes(feeds: FeedId[], volumeWindow: number): Promise<FeedVolumeData[]>` -
  Get volume data
- `healthCheck(): Promise<HealthStatus>` - Perform health check
- `getPerformanceMetrics(): Promise<PerformanceMetrics>` - Get performance
  metrics
- `setIntegrationService(integrationService: any): void` - Set integration
  service for DI

### IAggregationService

Interface for real-time price aggregation and caching services.

**Location:** `src/common/interfaces/services/aggregation.interface.ts`
**Implementation:** `src/aggregators/real-time-aggregation.service.ts`
(RealTimeAggregationService)

**Key Methods:**

- `getAggregatedPrice(feedId: EnhancedFeedId): Promise<AggregatedPrice | null>` -
  Get aggregated price with caching
- `addPriceUpdate(feedId: EnhancedFeedId, update: PriceUpdate): void` - Add
  price update and trigger recalculation
- `subscribe(feedId: EnhancedFeedId, callback: Function): () => void` -
  Subscribe to real-time updates
- `getQualityMetrics(feedId: EnhancedFeedId): Promise<QualityMetrics>` - Get
  quality metrics
- `getCacheStats(): CacheStats` - Get cache statistics
- `processPriceUpdate(update: PriceUpdate): Promise<void>` - Process price
  updates

### IConfigurationService

Interface for configuration management and validation.

**Location:** `src/common/interfaces/services/configuration.interface.ts`
**Implementation:** `src/config/config.service.ts` (ConfigService)

**Key Methods:**

- `getFeedConfigurations(): FeedConfiguration[]` - Get all feed configurations
- `getFeedConfiguration(feedId: EnhancedFeedId): FeedConfiguration | undefined` -
  Get specific feed config
- `getFeedConfigurationsByCategory(category: FeedCategory): FeedConfiguration[]` -
  Get configs by category
- `getEnvironmentConfig(): EnvironmentConfig` - Get environment configuration
- `validateConfiguration(): ValidationResult` - Validate current configuration
- `reloadConfiguration(): void` - Reload configuration from files
- `hasCustomAdapter(exchange: string): boolean` - Check if exchange has custom
  adapter
- `getExchangeApiKey(exchange: string): ApiKeyConfig | undefined` - Get API key
  for exchange

### IDataValidationService

Interface for data validation and quality assurance.

**Location:** `src/common/interfaces/services/validation.interface.ts`
**Implementation:** `src/data-manager/validation/validation.service.ts`
(ValidationService)

**Key Methods:**

- `validatePriceUpdate(update: PriceUpdate, feedId: EnhancedFeedId, config?: any): Promise<ValidationResult>` -
  Validate single update
- `validateBatch(updates: PriceUpdate[], feedId: EnhancedFeedId, config?: any): Promise<Map<string, ValidationResult>>` -
  Validate multiple updates
- `filterValidUpdates(updates: PriceUpdate[], results: Map<string, ValidationResult>): PriceUpdate[]` -
  Filter valid updates
- `getValidationStats(): ValidationStats` - Get validation statistics
- `clearCache(): void` - Clear validation cache
- `clearHistoricalData(): void` - Clear historical validation data

## Base Service Interface

All services implement the `IBaseService` interface which provides common
functionality:

**Methods:**

- `getHealthStatus(): Promise<ServiceHealthStatus>` - Get service health status
- `getPerformanceMetrics(): Promise<ServicePerformanceMetrics>` - Get
  performance metrics
- `getServiceName(): string` - Get service name/identifier

## Implementation Benefits

### 1. Dependency Injection

- Clear interface contracts enable proper dependency injection
- Services can be easily mocked for testing
- Loose coupling between service implementations

### 2. Maintainability

- Standardized method signatures across services
- Clear separation of concerns
- Consistent error handling patterns

### 3. Testability

- Interfaces enable easy mocking in unit tests
- Clear contracts make testing more focused
- Standardized health checks and metrics

### 4. Scalability

- Services can be easily replaced or extended
- Interface-based design supports future enhancements
- Consistent patterns across the codebase

## Usage Examples

### Dependency Injection

```typescript
@Injectable()
export class SomeService {
  constructor(
    private readonly ftsoProvider: IFtsoProviderService,
    private readonly aggregation: IAggregationService,
    private readonly config: IConfigurationService,
    private readonly validation: IDataValidationService
  ) {}
}
```

### Service Health Monitoring

```typescript
async function checkSystemHealth() {
  const services = [ftsoProvider, aggregation, config, validation];

  for (const service of services) {
    const health = await service.getHealthStatus();
    console.log(`${service.getServiceName()}: ${health.status}`);
  }
}
```

### Performance Monitoring

```typescript
async function getSystemMetrics() {
  const services = [ftsoProvider, aggregation, config, validation];

  const metrics = await Promise.all(
    services.map(async service => ({
      name: service.getServiceName(),
      metrics: await service.getPerformanceMetrics(),
    }))
  );

  return metrics;
}
```

## Testing

The interfaces are validated through comprehensive unit tests located at:

- `src/interfaces/__tests__/service-interfaces.spec.ts`

These tests verify that all services properly implement their respective
interfaces and that all required methods are available.

## Requirements Compliance

This implementation addresses the following requirements:

- **Requirement 3.3**: Proper interfaces, abstractions, and helpers for reused
  code
- **Requirement 3.4**: Proper dependency injection and separation of concerns
- **Requirement 4.1**: Custom exchange adapters with standardized patterns
- **Requirement 4.2**: Proper service integration and interface definitions

## Future Enhancements

The standardized interfaces provide a foundation for future improvements:

1. **Service Registry**: Automatic service discovery and registration
2. **Health Monitoring**: Centralized health monitoring dashboard
3. **Performance Analytics**: Automated performance tracking and alerting
4. **Service Mesh**: Integration with service mesh technologies
5. **Auto-scaling**: Interface-based auto-scaling decisions

## Migration Guide

For existing code that directly uses service implementations:

1. **Update Imports**: Import interfaces instead of concrete classes where
   possible
2. **Constructor Injection**: Use interfaces in constructor parameters
3. **Type Annotations**: Use interface types for service references
4. **Testing**: Update tests to use interface mocks

Example migration:

```typescript
// Before
constructor(private readonly aggregationService: RealTimeAggregationService) {}

// After
constructor(private readonly aggregationService: IAggregationService) {}
```

This ensures loose coupling and better testability while maintaining all
existing functionality.
