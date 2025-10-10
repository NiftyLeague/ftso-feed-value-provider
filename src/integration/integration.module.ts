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
import { ConfigModule } from "@/config/config.module";
import { DataManagerModule } from "@/data-manager/data-manager.module";

// Core services
// ProductionDataManagerService is now provided by DataManagerModule

// Error handling services
import { UniversalRetryService } from "@/error-handling/universal-retry.service";
import { CircuitBreakerService } from "@/error-handling/circuit-breaker.service";
import { ConnectionRecoveryService } from "@/error-handling/connection-recovery.service";

// Import adapters module for registry initialization
import { AdaptersModule } from "@/adapters/adapters.module";

// Validation services are now provided by DataManagerModule

// WebSocket connection management is now handled directly by adapters

// Failover management is now handled by ErrorHandlingModule

// Data source factory
import { DataSourceFactory } from "./services/data-source.factory";

// Startup validation
import { StartupValidationService } from "./services/startup-validation.service";

// WebSocket orchestration
import { WebSocketOrchestratorService } from "./services/websocket-orchestrator.service";

@Module({
  imports: [CacheModule, AggregatorsModule, MonitoringModule, AdaptersModule, ConfigModule, DataManagerModule],
  controllers: [],
  providers: [
    // Decomposed integration services
    {
      provide: IntegrationService,
      useClass: IntegrationService,
      scope: 1, // Make it a singleton
    },
    {
      provide: DataSourceIntegrationService,
      useClass: DataSourceIntegrationService,
      scope: 1, // Make it a singleton
    },
    {
      provide: PriceAggregationCoordinatorService,
      useClass: PriceAggregationCoordinatorService,
      scope: 1, // Make it a singleton
    },
    {
      provide: SystemHealthService,
      useClass: SystemHealthService,
      scope: 1, // Make it a singleton
    },

    // Startup validation
    StartupValidationService,

    // WebSocket orchestration
    {
      provide: WebSocketOrchestratorService,
      useClass: WebSocketOrchestratorService,
      scope: 1, // Make it a singleton
    },

    // Data management (ProductionDataManagerService is provided by DataManagerModule)
    // Data source factory
    DataSourceFactory,

    // Error handling (StandardizedErrorHandlerService is provided by ErrorHandlingModule)
    UniversalRetryService,
    CircuitBreakerService,
    ConnectionRecoveryService,

    // Validation (ValidationService and DataValidator are provided by DataManagerModule)

    // Factory for creating the integrated FTSO provider service
    {
      provide: "INTEGRATED_FTSO_PROVIDER",
      useFactory: async (integrationService: IntegrationService) => {
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
      inject: [IntegrationService],
    },
  ],
  exports: [
    // Decomposed services
    IntegrationService,
    DataSourceIntegrationService,
    PriceAggregationCoordinatorService,
    SystemHealthService,

    // Core services
    StartupValidationService,
    WebSocketOrchestratorService,

    // Factory
    "INTEGRATED_FTSO_PROVIDER",
  ],
})
export class IntegrationModule {}
