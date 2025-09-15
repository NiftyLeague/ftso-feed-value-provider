import { Module } from "@nestjs/common";

// Decomposed integration services
import { IntegrationService } from "./integration.service";
import { DataSourceIntegrationService } from "./services/data-source-integration.service";
import { PriceAggregationCoordinatorService } from "./services/price-aggregation-coordinator.service";
import { SystemHealthService } from "./services/system-health.service";

// Core modules
import { CacheModule } from "@/cache/cache.module";
import { AggregatorsModule } from "@/aggregators/aggregators.module";
import { MonitoringModule } from "@/monitoring/monitoring.module";

// Core services
import { ProductionDataManagerService } from "@/data-manager/production-data-manager.service";
import { ConfigService } from "@/config/config.service";

// Error handling services
import { StandardizedErrorHandlerService } from "@/error-handling/standardized-error-handler.service";
import { UniversalRetryService } from "@/error-handling/universal-retry.service";
import {
  createServiceFactory,
  createMultiDependencyServiceFactory,
  createAsyncProvider,
  createSingletonServiceFactory,
} from "@/common/factories/service.factory";
import { CircuitBreakerService } from "@/error-handling/circuit-breaker.service";
import { ConnectionRecoveryService } from "@/error-handling/connection-recovery.service";

// Import adapters module for registry initialization
import { AdaptersModule } from "@/adapters/adapters.module";

// Validation services
import { ValidationService } from "@/data-manager/validation/validation.service";
import { DataValidator } from "@/data-manager/validation/data-validator";

// WebSocket connection management
import { WebSocketConnectionManager } from "@/data-manager/websocket-connection-manager.service";

// Failover management
import { FailoverManager } from "@/data-manager/failover-manager.service";

// Data source factory
import { DataSourceFactory } from "./services/data-source.factory";

// Startup validation
import { StartupValidationService } from "./services/startup-validation.service";

@Module({
  imports: [CacheModule, AggregatorsModule, MonitoringModule, AdaptersModule],
  controllers: [],
  providers: [
    // Decomposed integration services
    IntegrationService,
    DataSourceIntegrationService,
    PriceAggregationCoordinatorService,
    SystemHealthService,

    // Startup validation
    StartupValidationService,

    // Data management
    ProductionDataManagerService,
    createSingletonServiceFactory(WebSocketConnectionManager, [ConfigService.name]),
    FailoverManager,

    // Data source factory
    DataSourceFactory,

    // Configuration
    ConfigService,

    // Error handling
    StandardizedErrorHandlerService,
    UniversalRetryService,
    CircuitBreakerService,
    ConnectionRecoveryService,

    // Validation
    createServiceFactory(DataValidator, [UniversalRetryService.name]),
    createMultiDependencyServiceFactory(ValidationService, [DataValidator.name, UniversalRetryService.name]),

    // Factory for creating the integrated FTSO provider service
    createAsyncProvider(
      "INTEGRATED_FTSO_PROVIDER",
      async (integrationService: IntegrationService) => {
        // Wait for initialization to complete
        await new Promise<void>(resolve => {
          if (integrationService.listenerCount("initialized") > 0) {
            integrationService.once<[void]>("initialized", resolve);
          } else {
            // Already initialized
            resolve();
          }
        });

        return integrationService;
      },
      [IntegrationService.name]
    ),
  ],
  exports: [
    // Decomposed services
    IntegrationService,
    DataSourceIntegrationService,
    PriceAggregationCoordinatorService,
    SystemHealthService,

    // Core services
    ProductionDataManagerService,
    StartupValidationService,

    // Factory
    "INTEGRATED_FTSO_PROVIDER",
  ],
})
export class IntegrationModule {}
