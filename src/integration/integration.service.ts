import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { EventDrivenService } from "@/common/base/composed.service";

// Focused services
import { DataSourceIntegrationService } from "./services/data-source-integration.service";
import { PriceAggregationCoordinatorService } from "./services/price-aggregation-coordinator.service";
import { SystemHealthService } from "./services/system-health.service";

// Configuration
import { ConfigService } from "@/config/config.service";

// Types and interfaces
import type { AggregatedPrice } from "@/common/types/services";
import type { CoreFeedId, PriceUpdate } from "@/common/types/core";
import type { IntegrationServiceInterface } from "@/common/types/services/provider.types";

@Injectable()
export class IntegrationService
  extends EventDrivenService
  implements OnModuleInit, OnModuleDestroy, IntegrationServiceInterface
{
  private shutdownInProgress = false;

  constructor(
    private readonly dataSourceIntegration: DataSourceIntegrationService,
    private readonly priceAggregationCoordinator: PriceAggregationCoordinatorService,
    private readonly systemHealth: SystemHealthService,
    private readonly configService: ConfigService
  ) {
    super();
  }

  override async initialize(): Promise<void> {
    this.startTimer("initialize");

    await this.executeWithErrorHandling(
      async () => {
        this.logger.log("Starting Integration Orchestrator initialization");

        // Step 1: Initialize data source integration
        await this.dataSourceIntegration.initialize();

        // Step 2: Initialize price aggregation coordination
        await this.priceAggregationCoordinator.initialize();

        // Step 3: Initialize system health monitoring
        await this.systemHealth.initialize();

        // Step 4: Wire service interactions
        await this.wireServiceInteractions();

        // Step 5: Subscribe to configured feeds
        await this.subscribeToFeeds();

        const duration = this.endTimer("initialize");
        this.logger.log(`Module initialization completed in ${duration.toFixed(2)}ms`);

        this.emitWithLogging("initialized");
      },
      "module_initialization",
      {
        retries: 2,
        retryDelay: 2000,
        onError: (error, attempt) => {
          this.logger.warn(`Initialization attempt ${attempt + 1} failed: ${error.message}`);
        },
      }
    );
  }

  override async cleanup(): Promise<void> {
    if (this.shutdownInProgress) {
      return;
    }

    this.shutdownInProgress = true;
    this.logger.log("Shutting down Integration Orchestrator...");

    await this.executeWithErrorHandling(
      async () => {
        // Stop system health monitoring
        await this.systemHealth.shutdown();

        // Stop price aggregation coordination
        await this.priceAggregationCoordinator.shutdown();

        // Stop data source integration
        await this.dataSourceIntegration.shutdown();

        this.logger.log("Integration Orchestrator shutdown completed");
      },
      "shutdown",
      {
        shouldThrow: false, // Don't throw during shutdown
        retries: 1,
        retryDelay: 1000,
      }
    );
  }

  // Public API methods
  async getCurrentPrice(feedId: CoreFeedId): Promise<AggregatedPrice> {
    if (!this.isInitialized) {
      throw new Error("Integration orchestrator not initialized");
    }

    return this.priceAggregationCoordinator.getCurrentPrice(feedId);
  }

  async getCurrentPrices(feedIds: CoreFeedId[]): Promise<AggregatedPrice[]> {
    if (!this.isInitialized) {
      throw new Error("Integration orchestrator not initialized");
    }

    return this.priceAggregationCoordinator.getCurrentPrices(feedIds);
  }

  async getSystemHealth(): Promise<ReturnType<SystemHealthService["getOverallHealth"]>> {
    if (!this.isInitialized) {
      throw new Error("Integration orchestrator not initialized");
    }

    return this.systemHealth.getOverallHealth();
  }

  // Private methods
  private async wireServiceInteractions(): Promise<void> {
    this.logDebug("Wiring service interactions...", "wireServiceInteractions");

    // Connect data source events to price aggregation
    this.dataSourceIntegration.on("priceUpdate", (update: unknown) => {
      this.priceAggregationCoordinator.handlePriceUpdate(update as PriceUpdate);
    });

    // Connect price aggregation events to system health
    this.priceAggregationCoordinator.on("aggregatedPrice", (aggregatedPrice: AggregatedPrice) => {
      this.systemHealth.recordPriceAggregation(aggregatedPrice);
    });

    // Connect data source health events to system health
    this.dataSourceIntegration.on("sourceHealthy", (sourceId: string) => {
      this.systemHealth.recordSourceHealth(sourceId, "healthy");
    });

    this.dataSourceIntegration.on("sourceUnhealthy", (sourceId: string) => {
      this.systemHealth.recordSourceHealth(sourceId, "unhealthy");
    });

    this.dataSourceIntegration.on("sourceRecovered", (sourceId: string) => {
      this.systemHealth.recordSourceHealth(sourceId, "recovered");
    });

    // Connect system health alerts to orchestrator events
    this.systemHealth.on("healthAlert", (alert: unknown) => {
      this.emit("healthAlert", alert);
    });

    // Connect price aggregation errors to system health
    this.priceAggregationCoordinator.on("aggregationError", (error: Error) => {
      this.systemHealth.recordAggregationError(error);
    });

    this.logDebug("Service interactions wired successfully", "wireServiceInteractions");
  }

  private async subscribeToFeeds(): Promise<void> {
    this.logDebug("Subscribing to configured feeds...", "subscribeToFeeds");

    const feedConfigs = this.configService.getFeedConfigurations();

    for (const config of feedConfigs) {
      await this.executeWithErrorHandling(
        async () => {
          // Subscribe through data source integration
          await this.dataSourceIntegration.subscribeToFeed(config.feed);

          // Configure aggregation for the feed
          await this.priceAggregationCoordinator.configureFeed(config);

          this.logDebug(`Subscribed to feed: ${config.feed.name}`, "subscribeToFeeds");
        },
        `subscribeToFeed_${config.feed.name}`,
        {
          shouldThrow: false, // Continue with other feeds even if one fails
          retries: 2,
          retryDelay: 1000,
        }
      );
    }

    this.logDebug(`Processed ${feedConfigs.length} feed configurations`, "subscribeToFeeds");
  }

  // IntegrationServiceInterface implementation
  isHealthy(): boolean {
    const health = this.systemHealth.getOverallHealth();
    return health.status === "healthy" || health.status === "degraded"; // consider degraded as operational
  }

  getStatus(): string {
    const health = this.systemHealth.getOverallHealth();
    return health.status;
  }

  override getMetrics(): Record<string, number> {
    const baseMetrics = super.getMetrics();
    const h = this.systemHealth.getOverallHealth();
    return {
      ...baseMetrics,
      timestamp: h.timestamp,
      sources_count: h.sources.length,
      aggregation_error_count: h.aggregation.errorCount,
      aggregation_success_rate: h.aggregation.successRate,
      performance_avg_response_time: h.performance.averageResponseTime,
      performance_error_rate: h.performance.errorRate,
      accuracy_avg_confidence: h.accuracy.averageConfidence,
      accuracy_outlier_rate: h.accuracy.outlierRate,
    };
  }
}
