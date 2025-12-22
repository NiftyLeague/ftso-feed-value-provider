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
import type { CoreFeedId, DataSource, PriceUpdate } from "@/common/types/core";
import type { IntegrationServiceInterface } from "@/common/types/services/provider.types";
import type { AdapterStats } from "@/common/types/monitoring";
import type { Initializable } from "@/common/types/utils";

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
    super({ useEnhancedLogging: true });
  }

  override async initialize(): Promise<void> {
    if (this.isInitialized) {
      this.logger.debug("Integration service already initialized, skipping");
      return;
    }

    this.startTimer("initialize");

    await this.executeWithErrorHandling(
      async () => {
        this.logger.log("Starting Integration Orchestrator initialization");

        // IMPORTANT: Wire the price update flow first so we don't miss early updates
        // while other initialization steps are still running.
        this.wirePriceUpdateFlow();

        // Step 1: Initialize data source integration
        await this.initializeDependency(this.dataSourceIntegration, "dataSourceIntegration");
        this.triggerGarbageCollection("after_data_source_init");

        // Step 2: Initialize price aggregation coordination
        await this.initializeDependency(this.priceAggregationCoordinator, "priceAggregationCoordinator");
        this.triggerGarbageCollection("after_aggregation_init");

        // Step 3: Initialize system health monitoring
        await this.initializeDependency(this.systemHealth, "systemHealth");
        this.triggerGarbageCollection("after_health_init");

        // Step 4: Wire service interactions
        await this.wireServiceInteractions();
        this.triggerGarbageCollection("after_wiring");

        // Step 5: Subscribe to configured feeds
        await this.subscribeToFeeds();
        this.triggerGarbageCollection("after_feed_subscription");

        const duration = this.endTimer("initialize");
        this.logger.log(`Module initialization completed in ${duration.toFixed(2)}ms`);
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

  private async initializeDependency(dependency: Initializable, name: string): Promise<void> {
    // Prefer Nest lifecycle initialization (guarded by WithLifecycle) when available.
    if (typeof dependency?.onModuleInit === "function") {
      await dependency.onModuleInit();
      return;
    }

    // Fallback for unit tests and non-lifecycle-managed dependencies.
    if (typeof dependency?.initialize === "function") {
      await dependency.initialize();
      return;
    }

    throw new TypeError(`Dependency ${name} does not support initialization (no onModuleInit/initialize)`);
  }

  private priceUpdateFlowWired = false;

  private wirePriceUpdateFlow(): void {
    if (this.priceUpdateFlowWired) {
      return;
    }

    this.dataSourceIntegration.on("priceUpdate", (update: unknown) => {
      this.priceAggregationCoordinator.handlePriceUpdate(update as PriceUpdate);
    });

    this.priceUpdateFlowWired = true;
  }

  private triggerGarbageCollection(phase: string): void {
    if (global.gc) {
      const memBefore = process.memoryUsage();
      global.gc();
      const memAfter = process.memoryUsage();
      const freed = memBefore.heapUsed - memAfter.heapUsed;
      this.logger.debug(`GC triggered after ${phase}: freed ${(freed / 1024 / 1024).toFixed(2)}MB`);
    }
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

  /**
   * Sync initial source health status after event wiring
   * This handles the race condition where sources connect before event listeners are set up
   */
  private syncInitialSourceHealth(): void {
    try {
      // Get all currently connected sources from the data source integration
      const connectedSources = this.dataSourceIntegration.getConnectedSources();

      this.logger.log(`Syncing initial health for ${connectedSources.length} connected sources`);

      // Record their current health status
      connectedSources.forEach((source: DataSource) => {
        const sourceId = source.id; // DataSource has 'id' property, not getSourceId()
        const isConnected = source.isConnected();
        const status = isConnected ? "healthy" : "unhealthy";
        this.systemHealth.recordSourceHealth(sourceId, status);
        this.logger.log(`Initial health sync: ${sourceId} = ${status}`);
      });
    } catch (error) {
      this.logger.error("Error syncing initial source health:", error);
    }
  }

  // Service state management
  public override isServiceInitialized(): boolean {
    // Check if this service is initialized
    if (!this.isInitialized) {
      this.logger.debug("Integration service not initialized: isInitialized=false");
      return false;
    }

    // Check if all required sub-services are initialized
    // Handle both real services and test mocks gracefully
    const dataSourceReady = this.dataSourceIntegration?.isInitialized ?? true;
    const aggregationReady = this.priceAggregationCoordinator?.isInitialized ?? true;
    const healthReady = this.systemHealth?.isInitialized ?? true;

    const allReady = dataSourceReady && aggregationReady && healthReady;

    if (!allReady) {
      this.logger.debug(
        `Integration sub-services not all ready: ` +
          `dataSource=${dataSourceReady}, aggregation=${aggregationReady}, health=${healthReady}`
      );
    }

    return allReady;
  }

  // Public API methods
  async getCurrentPrice(feedId: CoreFeedId): Promise<AggregatedPrice> {
    if (!this.isServiceInitialized()) {
      throw new Error("Integration orchestrator not initialized");
    }

    return this.priceAggregationCoordinator.getCurrentPrice(feedId);
  }

  async getCurrentPrices(feedIds: CoreFeedId[]): Promise<AggregatedPrice[]> {
    if (!this.isServiceInitialized()) {
      throw new Error("Integration orchestrator not initialized");
    }

    return this.priceAggregationCoordinator.getCurrentPrices(feedIds);
  }

  async getSystemHealth(): Promise<ReturnType<SystemHealthService["getOverallHealth"]>> {
    if (!this.isServiceInitialized()) {
      throw new Error("Integration orchestrator not initialized");
    }

    return this.systemHealth.getOverallHealth();
  }

  // Lifecycle methods
  override async onModuleInit(): Promise<void> {
    // Delegate to WithLifecycle's guarded initialization.
    await super.onModuleInit();
  }

  override async onModuleDestroy(): Promise<void> {
    await super.onModuleDestroy();
  }

  // Override performInitialization to emit initialized event
  public override async performInitialization(): Promise<void> {
    await super.performInitialization();
    this.emitWithLogging("initialized");
  }

  // Private methods
  private async wireServiceInteractions(): Promise<void> {
    this.logDebug("Wiring service interactions...", "wireServiceInteractions");

    // Ensure price update flow is wired before attaching the rest.
    this.wirePriceUpdateFlow();

    // Connect price aggregation events to system health
    this.priceAggregationCoordinator.on("aggregatedPrice", (aggregatedPrice: AggregatedPrice) => {
      this.systemHealth.recordPriceAggregation(aggregatedPrice);
    });

    // Connect data source health events to system health
    this.dataSourceIntegration.on("sourceHealthy", (sourceId: string) => {
      this.logger.debug(`[Event] sourceHealthy received for ${sourceId}, recording in system health`);
      this.systemHealth.recordSourceHealth(sourceId, "healthy");
    });

    this.dataSourceIntegration.on("sourceUnhealthy", (sourceId: string) => {
      this.logger.debug(`[Event] sourceUnhealthy received for ${sourceId}, recording in system health`);
      this.systemHealth.recordSourceHealth(sourceId, "unhealthy");
    });

    this.dataSourceIntegration.on("sourceRecovered", (sourceId: string) => {
      this.systemHealth.recordSourceHealth(sourceId, "recovered");
    });

    // Connect system health alerts to orchestrator events
    this.systemHealth.on("healthAlert", (alert: unknown) => {
      this.emit("healthAlert", alert);
    });

    // IMPORTANT: Sync current source health status after wiring events
    // This handles the race condition where sources connect before event listeners are set up
    this.syncInitialSourceHealth();

    // Connect price aggregation errors to system health
    this.priceAggregationCoordinator.on("aggregationError", (error: Error) => {
      this.systemHealth.recordAggregationError(error);
    });

    this.logDebug("Service interactions wired successfully", "wireServiceInteractions");
  }

  private async subscribeToFeeds(): Promise<void> {
    this.logDebug("Subscribing to configured feeds...", "subscribeToFeeds");

    const feedConfigs = this.configService.getFeedConfigurations();

    // Process feeds in parallel batches to speed up initialization
    const batchSize = 10; // Process 10 feeds at a time
    const batches: (typeof feedConfigs)[] = [];

    for (let i = 0; i < feedConfigs.length; i += batchSize) {
      batches.push(feedConfigs.slice(i, i + batchSize));
    }

    for (const batch of batches) {
      const promises = batch.map(config =>
        this.executeWithErrorHandling(
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
            retries: 1, // Reduce retries for faster initialization
            retryDelay: 500, // Reduce retry delay
          }
        )
      );

      // Wait for the current batch to complete before starting the next
      await Promise.all(promises);
    }

    this.logDebug(`Processed ${feedConfigs.length} feed configurations in batches`, "subscribeToFeeds");
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

  getAdapterStats(): AdapterStats {
    return this.dataSourceIntegration.getAdapterStats();
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
