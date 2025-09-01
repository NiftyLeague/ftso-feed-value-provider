import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { EventEmitter } from "events";
import { EnhancedLoggerService } from "@/utils/enhanced-logger.service";

// Focused services
import { DataSourceIntegrationService } from "./services/data-source-integration.service";
import { PriceAggregationCoordinatorService } from "./services/price-aggregation-coordinator.service";
import { SystemHealthService } from "./services/system-health.service";

// Configuration
import { ConfigService } from "@/config/config.service";

// Types and interfaces
import { EnhancedFeedId } from "@/types";
import { AggregatedPrice } from "@/aggregators/base/aggregation.interfaces";

@Injectable()
export class IntegrationService extends EventEmitter implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IntegrationService.name);
  private readonly enhancedLogger = new EnhancedLoggerService("Integration");
  private isInitialized = false;
  private shutdownInProgress = false;

  constructor(
    private readonly dataSourceIntegration: DataSourceIntegrationService,
    private readonly priceAggregationCoordinator: PriceAggregationCoordinatorService,
    private readonly systemHealth: SystemHealthService,
    private readonly configService: ConfigService
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    const operationId = `init_${Date.now()}`;
    this.enhancedLogger.startPerformanceTimer(operationId, "module_initialization", "Integration");

    try {
      this.enhancedLogger.logCriticalOperation("module_initialization", "Integration", {
        phase: "starting",
        timestamp: Date.now(),
      });

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

      this.enhancedLogger.logCriticalOperation(
        "module_initialization",
        "Integration",
        {
          phase: "completed",
          timestamp: Date.now(),
          initialized: true,
        },
        true
      );

      this.enhancedLogger.endPerformanceTimer(operationId, true, { initialized: true });
      this.emit("initialized");
    } catch (error) {
      this.enhancedLogger.logCriticalOperation(
        "module_initialization",
        "Integration",
        {
          phase: "failed",
          timestamp: Date.now(),
          error: error.message,
        },
        false
      );

      this.enhancedLogger.endPerformanceTimer(operationId, false, { error: error.message });
      this.enhancedLogger.error(error, {
        component: "Integration",
        operation: "module_initialization",
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
      this.logger.error("Error during shutdown:", error);
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

  async getSystemHealth(): Promise<any> {
    if (!this.isInitialized) {
      throw new Error("Integration orchestrator not initialized");
    }

    return this.systemHealth.getOverallHealth();
  }

  // Private methods
  private async wireServiceInteractions(): Promise<void> {
    this.logger.log("Wiring service interactions...");

    try {
      // Connect data source events to price aggregation
      this.dataSourceIntegration.on("priceUpdate", (update: any) => {
        this.priceAggregationCoordinator.handlePriceUpdate(update);
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

      this.logger.log("Service interactions wired successfully");
    } catch (error) {
      this.logger.error("Failed to wire service interactions:", error);
      throw error;
    }
  }

  private async subscribeToFeeds(): Promise<void> {
    this.logger.log("Subscribing to configured feeds...");

    try {
      const feedConfigs = this.configService.getFeedConfigurations();

      for (const config of feedConfigs) {
        try {
          // Subscribe through data source integration
          await this.dataSourceIntegration.subscribeToFeed(config.feed);

          // Configure aggregation for the feed
          await this.priceAggregationCoordinator.configureFeed(config);

          this.logger.debug(`Subscribed to feed: ${config.feed.name}`);
        } catch (error) {
          this.logger.error(`Failed to subscribe to feed ${config.feed.name}:`, error);
          // Continue with other feeds
        }
      }

      this.logger.log(`Subscribed to ${feedConfigs.length} feeds`);
    } catch (error) {
      this.logger.error("Failed to subscribe to feeds:", error);
      throw error;
    }
  }
}
