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

// Error handling services
import { UniversalRetryService } from "@/error-handling/universal-retry.service";
import { CircuitBreakerService } from "@/error-handling/circuit-breaker.service";
import { ConnectionRecoveryService } from "@/error-handling/connection-recovery.service";

// Import adapters module for registry initialization
import { AdaptersModule } from "@/adapters/adapters.module";
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
    IntegrationService,
    DataSourceIntegrationService,
    PriceAggregationCoordinatorService,
    SystemHealthService,

    // Startup validation
    StartupValidationService,

    // WebSocket orchestration
    WebSocketOrchestratorService,

    // Data source factory
    DataSourceFactory,

    // Error handling (StandardizedErrorHandlerService is provided by ErrorHandlingModule)
    UniversalRetryService,
    CircuitBreakerService,
    ConnectionRecoveryService,

    // Factory for creating the integrated FTSO provider service
    {
      provide: "INTEGRATED_FTSO_PROVIDER",
      useFactory: async (integrationService: IntegrationService) => {
        // Ensure the integration service is initialized.
        // NOTE: Waiting for the "initialized" event here can deadlock because Nest calls
        // onModuleInit only after all providers (including this factory) are constructed.
        await integrationService.onModuleInit();

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
