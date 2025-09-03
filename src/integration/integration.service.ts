import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { BaseEventService } from "@/common/base/base-event.service";

// Focused services
import { DataSourceIntegrationService } from "./services/data-source-integration.service";
import { PriceAggregationCoordinatorService } from "./services/price-aggregation-coordinator.service";
import { SystemHealthService } from "./services/system-health.service";

// Configuration
import { ConfigService } from "@/config/config.service";

// Types and interfaces
import type { AggregatedPrice } from "@/common/types/services";
import type { EnhancedFeedId, PriceUpdate } from "@/common/types/core";
import type { IntegrationServiceInterface } from "@/common/types/services/provider.types";

@Injectable()
export class IntegrationService
  extends BaseEventService
  implements OnModuleInit, OnModuleDestroy, IntegrationServiceInterface
{
  private isInitialized = false;
  private shutdownInProgress = false;

  constructor(
    private readonly dataSourceIntegration: DataSourceIntegrationService,
    private readonly priceAggregationCoordinator: PriceAggregationCoordinatorService,
    private readonly systemHealth: SystemHealthService,
    private readonly configService: ConfigService
  ) {
    super("Integration");
  }

  async onModuleInit(): Promise<void> {
    const startTime = performance.now();

    try {
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

      this.isInitialized = true;

      const duration = performance.now() - startTime;
      this.logger.log(`Module initialization completed in ${duration.toFixed(2)}ms`);

      this.emitWithLogging("initialized");
    } catch (error) {
      this.logError(error as Error, "module_initialization", {
        phase: "failed",
        timestamp: Date.now(),
        severity: "critical",
      });
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.shutdownInProgress) {
      return;
    }

    this.shutdownInProgress = true;
    this.logger.log("Shutting down Integration Orchestrator...");

    try {
      // Stop system health monitoring
      await this.systemHealth.shutdown();

      // Stop price aggregation coordination
      await this.priceAggregationCoordinator.shutdown();

      // Stop data source integration
      await this.dataSourceIntegration.shutdown();

      this.logger.log("Integration Orchestrator shutdown completed");
    } catch (error) {
      this.logError(error as Error, "shutdown");
    }
  }

  // Public API methods
  async getCurrentPrice(feedId: EnhancedFeedId): Promise<AggregatedPrice> {
    if (!this.isInitialized) {
      throw new Error("Integration orchestrator not initialized");
    }

    return this.priceAggregationCoordinator.getCurrentPrice(feedId);
  }

  async getCurrentPrices(feedIds: EnhancedFeedId[]): Promise<AggregatedPrice[]> {
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

    try {
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
    } catch (error) {
      this.logError(error as Error, "wireServiceInteractions");
      throw error;
    }
  }

  private async subscribeToFeeds(): Promise<void> {
    this.logDebug("Subscribing to configured feeds...", "subscribeToFeeds");

    try {
      const feedConfigs = this.configService.getFeedConfigurations();

      for (const config of feedConfigs) {
        try {
          // Subscribe through data source integration
          await this.dataSourceIntegration.subscribeToFeed(config.feed);

          // Configure aggregation for the feed
          await this.priceAggregationCoordinator.configureFeed(config);

          this.logDebug(`Subscribed to feed: ${config.feed.name}`, "subscribeToFeeds");
        } catch (error) {
          this.logError(error as Error, "subscribeToFeeds", { feedName: config.feed.name });
          // Continue with other feeds
        }
      }

      this.logDebug(`Subscribed to ${feedConfigs.length} feeds`, "subscribeToFeeds");
    } catch (error) {
      this.logError(error as Error, "subscribeToFeeds");
      throw error;
    }
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

  getMetrics(): Record<string, number | string> {
    const h = this.systemHealth.getOverallHealth();
    return {
      status: h.status,
      timestamp: String(h.timestamp),
      sources: String(h.sources.length),
      aggregation_errorCount: h.aggregation.errorCount,
      aggregation_successRate: h.aggregation.successRate,
      performance_avgResponseTime: h.performance.averageResponseTime,
      performance_errorRate: h.performance.errorRate,
      accuracy_avgConfidence: h.accuracy.averageConfidence,
      accuracy_outlierRate: h.accuracy.outlierRate,
    } as Record<string, number | string>;
  }
}
