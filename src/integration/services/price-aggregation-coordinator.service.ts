import { Injectable } from "@nestjs/common";
import { BaseEventService } from "@/common/base/base-event.service";

// Aggregation services
import { RealTimeAggregationService } from "@/aggregators/real-time-aggregation.service";

// Cache services
import { RealTimeCacheService } from "@/cache/real-time-cache.service";
import { CacheWarmerService } from "@/cache/cache-warmer.service";
import { CachePerformanceMonitorService } from "@/cache/cache-performance-monitor.service";

// Configuration
import { ConfigService } from "@/config/config.service";

// Types and interfaces
import { EnhancedFeedId } from "@/common/types/feed.types";
import { PriceUpdate } from "@/common/interfaces/core/data-source.interface";
import { AggregatedPrice } from "@/aggregators/base/aggregation.interfaces";

import { FeedConfiguration } from "@/config/config.service";

@Injectable()
export class PriceAggregationCoordinatorService extends BaseEventService {
  private isInitialized = false;

  constructor(
    private readonly aggregationService: RealTimeAggregationService,
    private readonly cacheService: RealTimeCacheService,
    private readonly cacheWarmerService: CacheWarmerService,
    private readonly cachePerformanceMonitor: CachePerformanceMonitorService,
    private readonly configService: ConfigService
  ) {
    super("PriceAggregationCoordinator", true); // Needs enhanced logging for performance tracking and critical operations
  }

  async initialize(): Promise<void> {
    const operationId = `init_${Date.now()}`;
    this.startPerformanceTimer(operationId, "price_aggregation_initialization");

    try {
      this.logCriticalOperation("price_aggregation_initialization", {
        phase: "starting",
        timestamp: Date.now(),
      });

      // Step 1: Wire aggregation service connections
      await this.wireAggregationConnections();

      // Step 2: Configure cache warming
      await this.configureCacheWarming();

      // Step 3: Initialize cache performance monitoring
      await this.initializeCacheMonitoring();

      this.isInitialized = true;

      this.logCriticalOperation(
        "price_aggregation_initialization",
        {
          phase: "completed",
          timestamp: Date.now(),
          initialized: true,
        },
        true
      );

      this.endPerformanceTimer(operationId, true, { initialized: true });
    } catch (error) {
      this.endPerformanceTimer(operationId, false, { error: error.message });
      this.logError(error as Error, "price_aggregation_initialization", { severity: "critical" });
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    this.logger.log("Shutting down Price Aggregation Coordinator...");

    try {
      // Note: Cache services don't have explicit stop methods
      // They will be cleaned up when the module is destroyed

      this.logger.log("Price Aggregation Coordinator shutdown completed");
    } catch (error) {
      this.logger.error("Error during price aggregation coordinator shutdown:", error);
    }
  }

  async getCurrentPrice(feedId: EnhancedFeedId): Promise<AggregatedPrice> {
    if (!this.isInitialized) {
      throw new Error("Price aggregation coordinator not initialized");
    }

    const startTime = performance.now();

    try {
      // Track feed access for cache warming
      this.cacheWarmerService.trackFeedAccess(feedId);

      // Check cache first
      const cachedPrice = this.cacheService.getPrice(feedId);
      if (cachedPrice && this.isFreshData(cachedPrice.timestamp)) {
        // Record cache hit performance
        const responseTime = performance.now() - startTime;
        this.cachePerformanceMonitor.recordResponseTime(responseTime);

        return {
          symbol: feedId.name,
          price: cachedPrice.value,
          timestamp: cachedPrice.timestamp,
          sources: cachedPrice.sources,
          confidence: cachedPrice.confidence,
          consensusScore: 0, // Will be calculated by consensus aggregator
        };
      }

      // Get fresh aggregated price
      const aggregatedPrice = await this.aggregationService.getAggregatedPrice(feedId);

      if (aggregatedPrice) {
        // Cache the result with automatic invalidation
        this.cacheService.setPrice(feedId, {
          value: aggregatedPrice.price,
          timestamp: aggregatedPrice.timestamp,
          sources: aggregatedPrice.sources,
          confidence: aggregatedPrice.confidence,
        });

        // Invalidate any stale cache entries
        this.cacheService.invalidateOnPriceUpdate(feedId);

        // Record cache miss performance
        const responseTime = performance.now() - startTime;
        this.cachePerformanceMonitor.recordResponseTime(responseTime);

        return aggregatedPrice;
      }

      throw new Error(`No price data available for feed ${feedId.name}`);
    } catch (error) {
      this.logger.error(`Error getting current price for ${feedId.name}:`, error);

      // Record error response time
      const responseTime = performance.now() - startTime;
      this.cachePerformanceMonitor.recordResponseTime(responseTime);

      // Emit aggregation error
      this.emit("aggregationError", error);

      throw error;
    }
  }

  async getCurrentPrices(feedIds: EnhancedFeedId[]): Promise<AggregatedPrice[]> {
    if (!this.isInitialized) {
      throw new Error("Price aggregation coordinator not initialized");
    }

    const results = await Promise.allSettled(feedIds.map(feedId => this.getCurrentPrice(feedId)));

    return results
      .filter((result): result is PromiseFulfilledResult<AggregatedPrice> => result.status === "fulfilled")
      .map(result => result.value);
  }

  async configureFeed(feedConfig: FeedConfiguration): Promise<void> {
    try {
      // Note: Services are configured through their constructors and don't have explicit configure methods
      // The feed configuration is handled through the data flow

      this.logger.debug(`Configured feed: ${feedConfig.feed.name}`);
    } catch (error) {
      this.logger.error(`Failed to configure feed ${feedConfig.feed.name}:`, error);
      throw error;
    }
  }

  handlePriceUpdate(update: PriceUpdate): void {
    const startTime = performance.now();

    try {
      // Track feed access for cache warming
      const feedId = this.getFeedIdFromSymbol(update.symbol);
      if (!feedId) {
        this.logger.warn(`Unknown feed symbol: ${update.symbol}`);
        return;
      }
      this.cacheWarmerService.trackFeedAccess(feedId);

      // Process through aggregation service
      this.aggregationService.processPriceUpdate(update).catch(error => {
        this.logger.error(`Error processing price update in aggregation service:`, error);
        this.emit("aggregationError", error);
      });

      // Record cache performance metrics
      const responseTime = performance.now() - startTime;
      this.cachePerformanceMonitor.recordResponseTime(responseTime);

      this.logger.debug(`Processed price update: ${update.symbol} = ${update.price}`);
    } catch (error) {
      this.logger.error(`Error handling price update:`, error);
      this.emit("aggregationError", error);
    }
  }

  getCacheStats(): any {
    return {
      stats: this.cacheService.getStats(),
      performance: this.cachePerformanceMonitor.getPerformanceMetrics(),
      health: this.cachePerformanceMonitor.checkPerformanceThresholds(),
      warmup: this.cacheWarmerService.getWarmupStats(),
    };
  }

  getAggregationStats(): any {
    return {
      activeFeedCount: this.aggregationService.getActiveFeedCount(),
      cacheStats: this.aggregationService.getCacheStats(),
    };
  }

  // Private methods
  private async wireAggregationConnections(): Promise<void> {
    this.logger.log("Wiring aggregation service connections...");

    try {
      // Connect aggregation service events to cache and monitoring
      this.aggregationService.on("aggregatedPrice", (aggregatedPrice: AggregatedPrice) => {
        this.handleAggregatedPrice(aggregatedPrice);
      });

      // Connect aggregation service errors
      this.aggregationService.on("error", (error: Error) => {
        this.logger.error("Aggregation service error:", error);
        this.emit("aggregationError", error);
      });

      this.logger.log("Aggregation service connections established");
    } catch (error) {
      this.logger.error("Failed to wire aggregation connections:", error);
      throw error;
    }
  }

  private async configureCacheWarming(): Promise<void> {
    this.logger.log("Configuring cache warming...");

    try {
      // Wire cache warmer service to actual data sources
      this.cacheWarmerService.setDataSourceCallback(async (feedId: EnhancedFeedId) => {
        try {
          return await this.aggregationService.getAggregatedPrice(feedId);
        } catch (error) {
          this.logger.error(`Error fetching data for cache warming of ${feedId.name}:`, error);
          return null;
        }
      });

      this.logger.log("Cache warming configured");
    } catch (error) {
      this.logger.error("Failed to configure cache warming:", error);
      throw error;
    }
  }

  private async initializeCacheMonitoring(): Promise<void> {
    this.logger.log("Initializing cache performance monitoring...");

    try {
      // Note: Cache performance monitor is initialized through its constructor
      // No explicit start method needed

      this.logger.log("Cache performance monitoring initialized");
    } catch (error) {
      this.logger.error("Failed to initialize cache monitoring:", error);
      throw error;
    }
  }

  private handleAggregatedPrice(aggregatedPrice: AggregatedPrice): void {
    try {
      // Cache the aggregated price
      const feedId = this.getFeedIdFromSymbol(aggregatedPrice.symbol);
      if (!feedId) {
        this.logger.warn(`Unknown feed symbol: ${aggregatedPrice.symbol}`);
        return;
      }

      // Set price in cache with automatic invalidation
      this.cacheService.setPrice(feedId, {
        value: aggregatedPrice.price,
        timestamp: aggregatedPrice.timestamp,
        sources: aggregatedPrice.sources,
        confidence: aggregatedPrice.confidence,
      });

      // Invalidate any stale cache entries for this feed
      this.cacheService.invalidateOnPriceUpdate(feedId);

      // Emit for external consumers
      this.emit("aggregatedPrice", aggregatedPrice);

      this.logger.debug(`Cached aggregated price for ${aggregatedPrice.symbol}: ${aggregatedPrice.price}`);
    } catch (error) {
      this.logger.error(`Error handling aggregated price for ${aggregatedPrice.symbol}:`, error);
      this.emit("aggregationError", error);
    }
  }

  // Helper methods
  private getFeedIdFromSymbol(symbol: string): EnhancedFeedId | null {
    const feedConfigs = this.configService.getFeedConfigurations();
    const config = feedConfigs.find(config => config.feed.name === symbol);
    return config ? config.feed : null;
  }

  private isFreshData(timestamp: number): boolean {
    const age = Date.now() - timestamp;
    return age <= 2000; // 2-second freshness requirement
  }
}
