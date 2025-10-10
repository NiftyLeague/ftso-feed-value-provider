import { Injectable } from "@nestjs/common";
import { EventDrivenService } from "@/common/base/composed.service";

// Aggregation services
import { RealTimeAggregationService } from "@/aggregators/real-time-aggregation.service";

// Cache services
import { RealTimeCacheService } from "@/cache/real-time-cache.service";
import { CacheWarmerService } from "@/cache/cache-warmer.service";
import { CachePerformanceMonitorService } from "@/cache/cache-performance-monitor.service";

// Configuration
import { getFeedIdFromSymbol } from "@/common/utils";
import { type FeedConfiguration } from "@/common/types/core";
import { ConfigService } from "@/config/config.service";

// Types and interfaces
import type { AggregatedPrice } from "@/common/types/services";
import type { CoreFeedId, PriceUpdate } from "@/common/types/core";

// Constants
const DEFAULT_EXPECTED_FEEDS_COUNT = 64;

@Injectable()
export class PriceAggregationCoordinatorService extends EventDrivenService {
  public override isInitialized = false;
  private hasReceivedData = false;

  // Feed-specific initial data tracking
  private feedsWithInitialData = new Set<string>();
  private totalExpectedFeeds = 0;
  private feedInitializationStartTime = Date.now();
  private feedInitializationTimes = new Map<string, number>();

  // Fallback readiness detection
  private fallbackTimeoutId: NodeJS.Timeout | null = null;
  private fallbackTriggered = false;
  private readonly FALLBACK_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
  private readonly FALLBACK_READINESS_THRESHOLD = 0.9; // 90% of feeds

  // Periodic completion check
  private completionCheckIntervalId: NodeJS.Timeout | null = null;

  constructor(
    private readonly aggregationService: RealTimeAggregationService,
    private readonly cacheService: RealTimeCacheService,
    private readonly cacheWarmerService: CacheWarmerService,
    private readonly cachePerformanceMonitor: CachePerformanceMonitorService,
    private readonly configService: ConfigService
  ) {
    super({ useEnhancedLogging: true });
  }

  override async initialize(): Promise<void> {
    // Prevent double initialization
    if (this.isInitialized) {
      this.logger.debug("Price aggregation coordinator already initialized, skipping");
      return;
    }

    const operationId = `init_${Date.now()}`;
    this.startTimer(operationId);

    try {
      this.logCriticalOperation("price_aggregation_initialization", {
        phase: "starting",
        timestamp: Date.now(),
      });

      // Step 1: Load expected feeds count from configuration
      await this.loadFeedsConfiguration();

      // Reset feed initialization timing
      this.feedInitializationStartTime = Date.now();

      // Start fallback readiness timeout
      this.startFallbackReadinessTimeout();

      // Start periodic completion check
      this.startPeriodicCompletionCheck();

      // Step 2: Wire aggregation service connections
      await this.wireAggregationConnections();

      // Step 3: Configure cache warming
      await this.configureCacheWarming();

      // Step 4: Initialize cache performance monitoring
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
    } catch (error) {
      const errObj = error instanceof Error ? error : new Error(String(error));
      this.logFatal(`Price aggregation initialization failed: ${errObj.message}`, "price_aggregation_initialization", {
        severity: "critical",
        error: errObj.message,
        stack: errObj.stack,
      });
      throw error;
    } finally {
      // Always end the timer, regardless of success or failure
      this.endTimer(operationId);
    }
  }

  async shutdown(): Promise<void> {
    this.logger.log("Shutting down Price Aggregation Coordinator...");

    try {
      // Clear fallback timeout if it exists
      if (this.fallbackTimeoutId) {
        clearTimeout(this.fallbackTimeoutId);
        this.fallbackTimeoutId = null;
      }

      // Clear completion check interval if it exists
      if (this.completionCheckIntervalId) {
        clearInterval(this.completionCheckIntervalId);
        this.completionCheckIntervalId = null;
      }

      // Note: Cache services don't have explicit stop methods
      // They will be cleaned up when the module is destroyed

      this.logger.log("Price Aggregation Coordinator shutdown completed");
    } catch (error) {
      this.logger.error("Error during price aggregation coordinator shutdown:", error);
    }
  }

  async getCurrentPrice(feedId: CoreFeedId): Promise<AggregatedPrice> {
    if (!this.isInitialized) {
      throw new Error("Price aggregation coordinator not initialized");
    }

    this.startTimer(`getCurrentPrice_${feedId.name}`);

    // Check if we have received any data yet (service readiness check)
    // Allow requests even without WebSocket data to enable REST fallback for custom adapters
    if (!this.hasReceivedData) {
      this.logger.debug(
        `No WebSocket data received yet, but allowing request for ${feedId.name} to enable REST fallback`
      );
    }

    try {
      // Track feed access for cache warming
      this.cacheWarmerService.trackFeedAccess(feedId);

      // Check cache first
      const cachedPrice = this.cacheService.getPrice(feedId);
      if (cachedPrice && this.isFreshData(cachedPrice.timestamp)) {
        // Record cache hit performance
        const responseTime = this.endTimer(`getCurrentPrice_${feedId.name}`);
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
        const responseTime = this.endTimer(`getCurrentPrice_${feedId.name}`);
        this.cachePerformanceMonitor.recordResponseTime(responseTime);

        return aggregatedPrice;
      }

      // No data available - this should trigger REST fallback in the aggregation service
      throw new Error(`No price data available for feed ${feedId.name}`);
    } catch (error) {
      const isDataUnavailable = error instanceof Error && error.message.includes("No price data available");
      const isSystemInitializing = error instanceof Error && error.message.includes("system initializing");

      // During system initialization or when data is unavailable, log appropriately
      if (isSystemInitializing) {
        this.logger.warn(`Price data not yet available during initialization for ${feedId.name}`);
      } else if (isDataUnavailable) {
        // Log data unavailable as debug to reduce noise during normal operation
        this.logger.debug(`Price data temporarily unavailable for ${feedId.name}`);
      } else {
        this.logger.error(`Error getting current price for ${feedId.name}:`, error);
      }

      // Record error response time
      const responseTime = this.endTimer(`getCurrentPrice_${feedId.name}`);
      this.cachePerformanceMonitor.recordResponseTime(responseTime);

      // Only emit aggregation error for serious issues, not data unavailability or initialization
      if (!isSystemInitializing && !isDataUnavailable) {
        this.emit("aggregationError", error);
      }

      throw error;
    }
  }

  async getCurrentPrices(feedIds: CoreFeedId[]): Promise<AggregatedPrice[]> {
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
    this.startTimer(`handlePriceUpdate_${update.symbol}`);

    try {
      // Track that we've received data (for readiness checks)
      if (!this.hasReceivedData) {
        this.hasReceivedData = true;
        this.logger.debug("Price aggregation coordinator is now ready - first price update received");
      }

      // Map exchange symbol to feed symbol if needed
      const feedSymbol = this.mapExchangeSymbolToFeedSymbol(update.symbol);
      if (!feedSymbol) {
        // Silently ignore unknown symbols - no logging needed
        return;
      }

      // Track feed access for cache warming
      const feedId = getFeedIdFromSymbol(feedSymbol);
      if (!feedId) {
        // Silently ignore unknown symbols - no logging needed
        return;
      }
      this.cacheWarmerService.trackFeedAccess(feedId);

      // Track per-feed initial data reception using the mapped feed symbol
      this.trackFeedInitialData(feedSymbol);

      // Update the price update object with the correct feed symbol
      const mappedUpdate = { ...update, symbol: feedSymbol };

      // Process through aggregation service using the mapped update
      this.aggregationService.processPriceUpdate(mappedUpdate).catch(error => {
        this.logger.error(`Error processing price update in aggregation service:`, error);
        this.emit("aggregationError", error);
      });

      // Record cache performance metrics
      const responseTime = this.endTimer(`handlePriceUpdate_${update.symbol}`);
      this.cachePerformanceMonitor.recordResponseTime(responseTime);

      this.logger.debug(`Processed price update: ${feedSymbol} = ${update.price} (from ${update.symbol})`);
    } catch (error) {
      this.logger.error(`Error handling price update:`, error);
      this.emit("aggregationError", error);
    }
  }

  getCacheStats(): {
    stats: ReturnType<RealTimeCacheService["getStats"]>;
    performance: ReturnType<CachePerformanceMonitorService["getPerformanceMetrics"]>;
    health: ReturnType<CachePerformanceMonitorService["checkPerformanceThresholds"]>;
    warmup: ReturnType<CacheWarmerService["getWarmupStats"]>;
  } {
    return {
      stats: this.cacheService.getStats(),
      performance: this.cachePerformanceMonitor.getPerformanceMetrics(),
      health: this.cachePerformanceMonitor.checkPerformanceThresholds(),
      warmup: this.cacheWarmerService.getWarmupStats(),
    };
  }

  getAggregationStats(): {
    activeFeedCount: number;
    totalAggregations: number;
    averageAggregationTime: number;
    cacheStats: ReturnType<RealTimeAggregationService["getCacheStats"]>;
  } {
    const cacheStats = this.aggregationService.getCacheStats();
    return {
      activeFeedCount: this.aggregationService.getActiveFeedCount(),
      totalAggregations: 0,
      averageAggregationTime: 0,
      cacheStats,
    };
  }

  getFeedReadinessStats(): {
    feedsWithInitialData: number;
    totalExpectedFeeds: number;
    readinessPercentage: number;
    isAllFeedsReady: boolean;
    feedsWithData: string[];
    elapsedSeconds: number;
    averageTimePerFeed: number;
    slowestFeeds: Array<{ feed: string; time: number }>;
  } {
    const feedsWithInitialData = this.feedsWithInitialData.size;
    const readinessPercentage =
      this.totalExpectedFeeds > 0 ? Math.round((feedsWithInitialData / this.totalExpectedFeeds) * 100) : 0;

    const elapsedSeconds = Math.round((Date.now() - this.feedInitializationStartTime) / 1000);
    const averageTimePerFeed =
      feedsWithInitialData > 0 ? Math.round((elapsedSeconds / feedsWithInitialData) * 10) / 10 : 0;

    const slowestFeeds = Array.from(this.feedInitializationTimes.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([feed, time]) => ({ feed, time }));

    return {
      feedsWithInitialData,
      totalExpectedFeeds: this.totalExpectedFeeds,
      readinessPercentage,
      isAllFeedsReady: feedsWithInitialData === this.totalExpectedFeeds,
      feedsWithData: Array.from(this.feedsWithInitialData),
      elapsedSeconds,
      averageTimePerFeed,
      slowestFeeds,
    };
  }

  // Private methods
  private mapExchangeSymbolToFeedSymbol(exchangeSymbol: string): string | null {
    try {
      // First, try direct mapping (for exact matches)
      const directFeedId = getFeedIdFromSymbol(exchangeSymbol);
      if (directFeedId) {
        return exchangeSymbol;
      }

      // If no direct match, try to find a feed that has this exchange symbol as a source
      const feedConfigs = this.configService.getFeedConfigurations();

      for (const config of feedConfigs) {
        // Check if any source in this feed config matches the exchange symbol
        const hasMatchingSource = config.sources.some(source => source.symbol === exchangeSymbol);
        if (hasMatchingSource) {
          return config.feed.name;
        }
      }

      // If still no match, try USDT/USD conversion
      if (exchangeSymbol.endsWith("/USDT")) {
        const usdVersion = exchangeSymbol.replace("/USDT", "/USD");
        const usdFeedId = getFeedIdFromSymbol(usdVersion);
        if (usdFeedId) {
          return usdVersion;
        }
      }

      // If still no match, try USD/USDT conversion
      if (exchangeSymbol.endsWith("/USD")) {
        const usdtVersion = exchangeSymbol.replace("/USD", "/USDT");
        const usdtFeedId = getFeedIdFromSymbol(usdtVersion);
        if (usdtFeedId) {
          return usdtVersion;
        }
      }

      return null;
    } catch (error) {
      this.logger.debug(`Error mapping exchange symbol ${exchangeSymbol}:`, error);
      return null;
    }
  }

  private async loadFeedsConfiguration(): Promise<void> {
    this.logger.debug("Loading feeds configuration...");

    try {
      // Load total expected feeds count from config service
      this.totalExpectedFeeds = this.configService.getFeedsCount();

      this.logger.log(
        `Loaded feeds configuration: expecting ${this.totalExpectedFeeds} feeds for initial data tracking`
      );
    } catch (error) {
      this.logger.error("Failed to load feeds configuration from config service:", error);

      // Try fallback method with default value
      try {
        this.totalExpectedFeeds = this.configService.getFeedsCountWithFallback(DEFAULT_EXPECTED_FEEDS_COUNT);
        this.logger.warn(
          `Using fallback method for feeds count: ${this.totalExpectedFeeds} (config service error: ${error instanceof Error ? error.message : "Unknown error"})`
        );
      } catch (fallbackError) {
        // If both methods fail, use the constant as last resort
        this.totalExpectedFeeds = DEFAULT_EXPECTED_FEEDS_COUNT;
        this.logger.error(`Both config service methods failed, using default constant: ${this.totalExpectedFeeds}`, {
          originalError: error instanceof Error ? error.message : "Unknown error",
          fallbackError: fallbackError instanceof Error ? fallbackError.message : "Unknown error",
        });
      }
    }
  }

  private trackFeedInitialData(symbol: string): void {
    // Check if this is the first time we're seeing this feed
    if (!this.feedsWithInitialData.has(symbol)) {
      const currentTime = Date.now();
      const elapsedSeconds = Math.round((currentTime - this.feedInitializationStartTime) / 1000);

      // Track when this feed received its first data
      this.feedsWithInitialData.add(symbol);
      this.feedInitializationTimes.set(symbol, elapsedSeconds);

      const currentCount = this.feedsWithInitialData.size;

      this.logger.debug(
        `Feed ${symbol} received initial data (${currentCount}/${this.totalExpectedFeeds}) at ${elapsedSeconds}s`
      );

      // Log progress every 10 feeds (10, 20, 30, etc.) or at significant milestones
      const shouldLogProgress =
        currentCount % 10 === 0 ||
        currentCount === 1 ||
        currentCount === Math.floor(this.totalExpectedFeeds * 0.5) || // 50%
        currentCount === Math.floor(this.totalExpectedFeeds * 0.75) || // 75%
        currentCount === Math.floor(this.totalExpectedFeeds * 0.9) || // 90%
        currentCount === Math.floor(this.totalExpectedFeeds * 0.95); // 95%

      if (shouldLogProgress) {
        const progressPercentage = Math.round((currentCount / this.totalExpectedFeeds) * 100);
        const recentFeeds = Array.from(this.feedsWithInitialData).slice(-5); // Last 5 feeds
        const avgTimePerFeed = currentCount > 0 ? Math.round((elapsedSeconds / currentCount) * 10) / 10 : 0;

        this.logger.log(
          `Feed initialization progress: ${currentCount}/${this.totalExpectedFeeds} (${progressPercentage}%) ` +
            `after ${elapsedSeconds}s (avg: ${avgTimePerFeed}s/feed) - recent: [${recentFeeds.join(", ")}]`
        );

        // Log slow feeds for debugging (feeds that took longer than average + 50%)
        if (currentCount >= 10) {
          const slowThreshold = avgTimePerFeed * 1.5;
          const slowFeeds = Array.from(this.feedInitializationTimes.entries())
            .filter(([_, time]) => time > slowThreshold)
            .map(([feed, time]) => `${feed}(${time}s)`)
            .slice(0, 5); // Limit to 5 for readability

          if (slowFeeds.length > 0) {
            this.logger.debug(`Slow feeds (>${slowThreshold}s): [${slowFeeds.join(", ")}]`);
          }
        }
      }

      // Check if we've reached the milestone (100% or high percentage after reasonable time)
      const readinessPercentage = currentCount / this.totalExpectedFeeds;
      const shouldTriggerCompletion =
        currentCount === this.totalExpectedFeeds || // 100% complete
        (readinessPercentage >= 0.95 && elapsedSeconds >= 30) || // 95%+ after 30 seconds
        (readinessPercentage >= 0.9 && elapsedSeconds >= 60); // 90%+ after 60 seconds

      // Debug logging for completion trigger
      if (readinessPercentage >= 0.9 && elapsedSeconds >= 30) {
        this.logger.debug(
          `Completion check: ${currentCount}/${this.totalExpectedFeeds} (${Math.round(readinessPercentage * 100)}%) ` +
            `after ${elapsedSeconds}s, shouldTrigger=${shouldTriggerCompletion}, fallbackTriggered=${this.fallbackTriggered}`
        );
      }

      if (shouldTriggerCompletion && !this.fallbackTriggered) {
        this.triggerCompletion(currentCount, elapsedSeconds);
      }
    }
  }

  private async wireAggregationConnections(): Promise<void> {
    this.logger.debug("Wiring aggregation service connections...");

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

      this.logger.debug("Aggregation service connections established");
    } catch (error) {
      this.logger.error("Failed to wire aggregation connections:", error);
      throw error;
    }
  }

  private async configureCacheWarming(): Promise<void> {
    this.logger.log("Configuring cache warming...");

    try {
      // Wire cache warmer service to actual data sources
      this.cacheWarmerService.setDataSourceCallback(async (feedId: CoreFeedId) => {
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
      // Map exchange symbol to feed symbol if needed
      const feedSymbol = this.mapExchangeSymbolToFeedSymbol(aggregatedPrice.symbol);
      if (!feedSymbol) {
        // Silently ignore unknown symbols - no logging needed
        return;
      }

      // Cache the aggregated price
      const feedId = getFeedIdFromSymbol(feedSymbol);
      if (!feedId) {
        // Silently ignore unknown symbols - no logging needed
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

      // Emit for external consumers with the correct feed symbol
      const mappedAggregatedPrice = { ...aggregatedPrice, symbol: feedSymbol };
      this.emit("aggregatedPrice", mappedAggregatedPrice);

      this.logger.debug(
        `Cached aggregated price for ${feedSymbol}: ${aggregatedPrice.price} (from ${aggregatedPrice.symbol})`
      );
    } catch (error) {
      this.logger.error(`Error handling aggregated price for ${aggregatedPrice.symbol}:`, error);
      this.emit("aggregationError", error);
    }
  }

  private isFreshData(timestamp: number): boolean {
    const age = Date.now() - timestamp;
    return age <= 2000; // 2-second freshness requirement
  }

  private startFallbackReadinessTimeout(): void {
    // Clear any existing timeout
    if (this.fallbackTimeoutId) {
      clearTimeout(this.fallbackTimeoutId);
    }

    this.fallbackTimeoutId = setTimeout(() => {
      this.checkFallbackReadiness();
    }, this.FALLBACK_TIMEOUT_MS);

    this.logger.debug(
      `Started fallback readiness timeout: will check for ${Math.round(this.FALLBACK_READINESS_THRESHOLD * 100)}% readiness after ${this.FALLBACK_TIMEOUT_MS / 1000}s`
    );
  }

  private startPeriodicCompletionCheck(): void {
    // Check every 10 seconds for completion conditions
    this.completionCheckIntervalId = setInterval(() => {
      this.checkPeriodicCompletion();
    }, 10000);

    this.logger.debug("Started periodic completion check (every 10s)");
  }

  private checkPeriodicCompletion(): void {
    if (this.fallbackTriggered) {
      return; // Already completed
    }

    const currentCount = this.feedsWithInitialData.size;
    const elapsedSeconds = Math.round((Date.now() - this.feedInitializationStartTime) / 1000);
    const readinessPercentage = currentCount / this.totalExpectedFeeds;

    const shouldTriggerCompletion =
      currentCount === this.totalExpectedFeeds || // 100% complete
      (readinessPercentage >= 0.95 && elapsedSeconds >= 30) || // 95%+ after 30 seconds
      (readinessPercentage >= 0.9 && elapsedSeconds >= 60); // 90%+ after 60 seconds

    if (shouldTriggerCompletion) {
      this.logger.debug(
        `Periodic completion check triggered: ${currentCount}/${this.totalExpectedFeeds} (${Math.round(readinessPercentage * 100)}%) after ${elapsedSeconds}s`
      );
      this.triggerCompletion(currentCount, elapsedSeconds);
    }
  }

  private triggerCompletion(currentCount: number, elapsedSeconds: number): void {
    if (this.fallbackTriggered) {
      return; // Already triggered
    }

    this.fallbackTriggered = true; // Prevent multiple triggers

    // Clear timeouts since we've reached completion
    if (this.fallbackTimeoutId) {
      clearTimeout(this.fallbackTimeoutId);
      this.fallbackTimeoutId = null;
    }
    if (this.completionCheckIntervalId) {
      clearInterval(this.completionCheckIntervalId);
      this.completionCheckIntervalId = null;
    }

    // Emit the exact format expected by websocket-detection.sh
    const timestamp = new Date().toISOString();
    const completionMessage = `Data collection phase completed: ${currentCount}/${this.totalExpectedFeeds} feeds`;

    this.logger.log(completionMessage);

    // Add diagnostic information for debugging
    const readinessPercentage = currentCount / this.totalExpectedFeeds;
    const avgTimePerFeed = currentCount > 0 ? Math.round((elapsedSeconds / currentCount) * 10) / 10 : 0;

    // Identify the slowest feeds for final diagnostic
    const slowestFeeds = Array.from(this.feedInitializationTimes.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([feed, time]) => `${feed}(${time}s)`);

    const completionIcon = currentCount === this.totalExpectedFeeds ? "✅" : "⚠️";
    const completionStatus =
      currentCount === this.totalExpectedFeeds
        ? "All feeds ready"
        : `${Math.round(readinessPercentage * 100)}% feeds ready`;

    this.logger.log(
      `${completionIcon} ${completionStatus} at ${timestamp} - system ready for testing ` +
        `(total time: ${elapsedSeconds}s, avg: ${avgTimePerFeed}s/feed, ` +
        `slowest: [${slowestFeeds.join(", ")}], ` +
        `feeds: ${Array.from(this.feedsWithInitialData).slice(0, 5).join(", ")}${this.feedsWithInitialData.size > 5 ? "..." : ""})`
    );

    // Log missing feeds if not 100% complete
    if (currentCount < this.totalExpectedFeeds) {
      this.logMissingFeeds();
    }
  }

  private checkFallbackReadiness(): void {
    if (this.fallbackTriggered) {
      return; // Already triggered
    }

    const currentCount = this.feedsWithInitialData.size;
    const readinessPercentage = this.totalExpectedFeeds > 0 ? currentCount / this.totalExpectedFeeds : 0;
    const elapsedSeconds = Math.round((Date.now() - this.feedInitializationStartTime) / 1000);

    // Check if we meet the fallback threshold (90% of feeds ready)
    if (readinessPercentage >= this.FALLBACK_READINESS_THRESHOLD) {
      this.fallbackTriggered = true;

      // Emit completion message with actual count (not total expected)
      const completionMessage = `Data collection phase completed: ${currentCount}/${this.totalExpectedFeeds} feeds`;
      this.logger.log(completionMessage);

      // Add diagnostic message about partial readiness
      const readinessPercent = Math.round(readinessPercentage * 100);
      const timestamp = new Date().toISOString();

      this.logger.log(
        `⚠️ Fallback readiness triggered at ${timestamp} - system ready with partial data ` +
          `(${readinessPercent}% ready: ${currentCount}/${this.totalExpectedFeeds} feeds after ${elapsedSeconds}s)`
      );

      // Log which feeds haven't received initial data
      this.logMissingFeeds();

      // Clear the timeout since we've triggered
      this.fallbackTimeoutId = null;
    } else {
      // Not enough feeds ready, log diagnostic and don't trigger fallback
      const readinessPercent = Math.round(readinessPercentage * 100);
      this.logger.warn(
        `Fallback readiness check failed: only ${readinessPercent}% ready ` +
          `(${currentCount}/${this.totalExpectedFeeds} feeds) after ${elapsedSeconds}s - ` +
          `need ${Math.round(this.FALLBACK_READINESS_THRESHOLD * 100)}% for fallback`
      );

      // Log which feeds haven't received initial data for debugging
      this.logMissingFeeds();
    }
  }

  private logMissingFeeds(): void {
    try {
      // Get all expected feeds from config
      const allFeeds = this.configService.getAllFeedSymbols();
      const feedsWithData = Array.from(this.feedsWithInitialData);
      const missingFeeds = allFeeds.filter(feed => !feedsWithData.includes(feed));

      if (missingFeeds.length > 0) {
        // Limit the list to avoid overwhelming logs
        const displayLimit = 10;
        const displayFeeds = missingFeeds.slice(0, displayLimit);
        const remainingCount = missingFeeds.length - displayLimit;

        let missingFeedsMessage = `Missing feeds (${missingFeeds.length}): [${displayFeeds.join(", ")}]`;
        if (remainingCount > 0) {
          missingFeedsMessage += ` and ${remainingCount} more`;
        }

        this.logger.debug(missingFeedsMessage);

        // Also log feeds that have received data for comparison
        if (feedsWithData.length > 0) {
          const displayDataFeeds = feedsWithData.slice(0, displayLimit);
          const remainingDataCount = feedsWithData.length - displayLimit;

          let dataFeedsMessage = `Feeds with data (${feedsWithData.length}): [${displayDataFeeds.join(", ")}]`;
          if (remainingDataCount > 0) {
            dataFeedsMessage += ` and ${remainingDataCount} more`;
          }

          this.logger.debug(dataFeedsMessage);
        }
      } else {
        this.logger.debug("All expected feeds have received initial data");
      }
    } catch (error) {
      this.logger.error("Error logging missing feeds:", error);
    }
  }
}
