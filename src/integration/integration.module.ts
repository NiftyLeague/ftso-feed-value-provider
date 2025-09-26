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

// Core services
import { ProductionDataManagerService } from "@/data-manager/production-data-manager.service";

// Error handling services
import { StandardizedErrorHandlerService } from "@/error-handling/standardized-error-handler.service";
import { UniversalRetryService } from "@/error-handling/universal-retry.service";
import { CircuitBreakerService } from "@/error-handling/circuit-breaker.service";
import { ConnectionRecoveryService } from "@/error-handling/connection-recovery.service";

// Import adapters module for registry initialization
import { AdaptersModule } from "@/adapters/adapters.module";

// Validation services
import { ValidationService } from "@/data-manager/validation/validation.service";
import { DataValidator } from "@/data-manager/validation/data-validator";

// WebSocket connection management is now handled directly by adapters

// Failover management is now handled by ErrorHandlingModule

// Data source factory
import { DataSourceFactory } from "./services/data-source.factory";

// Startup validation
import { StartupValidationService } from "./services/startup-validation.service";

// WebSocket orchestration
import { WebSocketOrchestratorService } from "./services/websocket-orchestrator.service";

@Module({
  imports: [CacheModule, AggregatorsModule, MonitoringModule, AdaptersModule, ConfigModule],
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

    // Data management
    ProductionDataManagerService,

    // Data source factory
    DataSourceFactory,

    // Error handling
    StandardizedErrorHandlerService,
    UniversalRetryService,
    CircuitBreakerService,
    ConnectionRecoveryService,

    // Validation
    {
      provide: DataValidator,
      useFactory: (universalRetryService: UniversalRetryService) => {
        return new DataValidator(universalRetryService);
      },
      inject: [UniversalRetryService],
    },
    {
      provide: ValidationService,
      useFactory: (dataValidator: DataValidator, universalRetryService: UniversalRetryService) => {
        return new ValidationService(dataValidator, universalRetryService);
      },
      inject: [DataValidator, UniversalRetryService],
    },

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
    ProductionDataManagerService,
    StartupValidationService,
    WebSocketOrchestratorService,

    // Factory
    "INTEGRATED_FTSO_PROVIDER",
  ],
})
export class IntegrationModule {}
