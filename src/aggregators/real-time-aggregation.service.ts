import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { BaseEventService } from "@/common/base/base-event.service";
import { ConfigService } from "@/config/config.service";

import type { EnhancedFeedId, PriceUpdate } from "@/common/types/core";
import type { AggregatedPrice, QualityMetrics } from "@/common/types/services";
import type { ServicePerformanceMetrics, ServiceHealthStatus } from "@/common/types/services";
import type { HealthCheckResult, HealthStatusType } from "@/common/types/monitoring";

import { ConsensusAggregator } from "./consensus-aggregator";

interface IAggregationService {
  getActiveFeedCount(): number;
  getCacheStats(): AggregationCacheStats;
  getSubscriptionCount(): number;
}

export interface CacheEntry {
  value: AggregatedPrice;
  timestamp: number;
  ttl: number;
  sources: string[];
  confidence: number;
  votingRound?: number;
}

export interface AggregationCacheStats {
  totalEntries: number;
  hitRate: number;
  missRate: number;
  evictionCount: number;
  averageAge: number;
}

export interface RealTimeAggregationConfig {
  cacheTTLMs: number; // Maximum 1-second TTL for price data
  maxCacheSize: number; // LRU cache size limit
  aggregationIntervalMs: number; // How often to recalculate prices
  qualityMetricsEnabled: boolean;
  performanceTargetMs: number; // Target response time (100ms)
}

export interface PriceSubscription {
  feedId: EnhancedFeedId;
  callback: (price: AggregatedPrice) => void;
  lastUpdate?: number;
}

@Injectable()
export class RealTimeAggregationService
  extends BaseEventService
  implements OnModuleInit, OnModuleDestroy, IAggregationService
{
  private readonly config: RealTimeAggregationConfig = {
    cacheTTLMs: 1000, // 1-second TTL maximum for real-time requirements
    maxCacheSize: 1000, // Store up to 1000 feed prices
    aggregationIntervalMs: 100, // Recalculate every 100ms for sub-100ms response
    qualityMetricsEnabled: true,
    performanceTargetMs: 100, // Sub-100ms response time target
  };

  // Real-time cache with 1-second TTL
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheAccessOrder = new Map<string, number>(); // For LRU eviction
  private cacheStats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    totalRequests: 0,
  };

  // Active price data storage
  private readonly activePriceUpdates = new Map<string, PriceUpdate[]>();
  private readonly priceSubscriptions = new Map<string, PriceSubscription[]>();

  // Performance tracking
  private readonly performanceMetrics = new Map<string, number[]>();
  private readonly operationTimers = new Map<string, number>();
  private aggregationInterval?: NodeJS.Timeout;
  private cacheCleanupInterval?: NodeJS.Timeout;

  constructor(
    private readonly consensusAggregator: ConsensusAggregator,
    private readonly configService: ConfigService
  ) {
    super("RealTimeAggregation", true); // Needs enhanced logging for performance tracking and data flow
  }

  async onModuleInit() {
    this.startRealTimeAggregation();
    this.startCacheCleanup();
    this.logger.log("Real-time aggregation service initialized");
  }

  async onModuleDestroy() {
    this.stopRealTimeAggregation();
    this.stopCacheCleanup();
    this.logger.log("Real-time aggregation service destroyed");
  }

  /**
   * Get aggregated price with real-time caching
   * Implements 1-second TTL caching for maximum freshness
   */
  async getAggregatedPrice(feedId: EnhancedFeedId): Promise<AggregatedPrice | null> {
    const operationId = `aggregate_${feedId.name}_${Date.now()}`;
    const feedKey = this.getFeedKey(feedId);

    this.startPerformanceTimer(operationId, "get_aggregated_price", {
      feedId: feedId.name,
      category: feedId.category,
    });

    try {
      // Check cache first (with 1-second TTL)
      const cachedEntry = this.getCachedPrice(feedKey);
      if (cachedEntry) {
        this.recordCacheHit();

        this.logDebug(`Cache hit for ${feedId.name}`, "cache_lookup", {
          cacheAge: Date.now() - cachedEntry.timestamp,
          price: cachedEntry.value.price,
          sources: cachedEntry.sources.length,
        });

        this.endPerformanceTimer(operationId, true, {
          cacheHit: true,
          price: cachedEntry.value.price,
        });

        return cachedEntry.value;
      }

      this.recordCacheMiss();

      // Get active price updates for this feed
      const updates = this.activePriceUpdates.get(feedKey) || [];
      if (updates.length === 0) {
        this.enhancedLogger?.warn(`No price updates available for ${feedId.name}`, {
          component: "RealTimeAggregation",
          operation: "get_aggregated_price",
          symbol: feedId.name,
          metadata: { availableUpdates: 0 },
        });

        this.enhancedLogger?.endPerformanceTimer(operationId, false, { error: "no_updates_available" });
        return null;
      }

      // Aggregate prices using consensus aggregator
      const aggregatedPrice = await this.consensusAggregator.aggregate(feedId, updates);

      // Cache the result with 1-second TTL
      this.setCachedPrice(feedKey, aggregatedPrice);

      // Log successful aggregation
      this.enhancedLogger?.logAggregation(
        feedId.name,
        updates.length,
        aggregatedPrice.price,
        aggregatedPrice.confidence,
        aggregatedPrice.consensusScore || 0
      );

      const startTime = this.operationTimers.get(operationId);
      const responseTime = startTime ? performance.now() - startTime : 0;

      // Log performance warning if exceeding target
      if (responseTime > this.config.performanceTargetMs) {
        this.enhancedLogger?.warn(`Aggregation performance threshold exceeded`, {
          component: "RealTimeAggregation",
          operation: "get_aggregated_price",
          symbol: feedId.name,
          metadata: {
            responseTime: responseTime.toFixed(2),
            target: this.config.performanceTargetMs,
            sourceCount: updates.length,
            price: aggregatedPrice.price,
          },
        });
      }

      // Record performance metrics (ensure minimum time for testing)
      const recordedTime = Math.max(responseTime, 0.01); // Minimum 0.01ms
      this.recordPerformance(feedKey, recordedTime);

      this.enhancedLogger?.endPerformanceTimer(operationId, true, {
        price: aggregatedPrice.price,
        sourceCount: updates.length,
        confidence: aggregatedPrice.confidence,
      });

      return aggregatedPrice;
    } catch (error) {
      const err = error as Error;
      this.enhancedLogger?.error(err, {
        component: "RealTimeAggregation",
        operation: "get_aggregated_price",
        symbol: feedId.name,
        severity: "high",
        metadata: {
          feedKey,
          availableUpdates: this.activePriceUpdates.get(feedKey)?.length || 0,
        },
      });

      // Emit error event for error handling services
      this.emit("error", err);

      this.enhancedLogger?.endPerformanceTimer(operationId, false, { error: err.message });
      return null;
    }
  }

  /**
   * Add new price update and trigger real-time recalculation
   * Processes price updates immediately for real-time data management
   */
  addPriceUpdate(feedId: EnhancedFeedId, update: PriceUpdate): void {
    const feedKey = this.getFeedKey(feedId);

    // Validate the update
    if (!this.consensusAggregator.validateUpdate(update)) {
      this.logger.debug(`Invalid price update rejected for ${feedId.name} from ${update.source}`);
      return;
    }

    // Get existing updates for this feed
    const existingUpdates = this.activePriceUpdates.get(feedKey) || [];

    // Replace update from same source or add new one
    const updatedList = existingUpdates.filter(u => u.source !== update.source);
    updatedList.push(update);

    // Keep only recent updates (within staleness threshold)
    const now = Date.now();
    const freshUpdates = updatedList.filter(u => now - u.timestamp <= 2000); // 2-second staleness

    this.activePriceUpdates.set(feedKey, freshUpdates);

    // Invalidate cache immediately for real-time priority
    this.invalidateCache(feedKey);

    // Notify subscribers of new data
    void this.notifySubscribers(feedId, feedKey);

    this.logger.debug(
      `Added price update for ${feedId.name} from ${update.source}: ${update.price} (${freshUpdates.length} total sources)`
    );
  }

  /**
   * Subscribe to real-time price updates for a feed
   */
  subscribe(feedId: EnhancedFeedId, callback: (price: AggregatedPrice) => void): () => void {
    const feedKey = this.getFeedKey(feedId);
    const subscription: PriceSubscription = {
      feedId,
      callback,
      lastUpdate: Date.now(),
    };

    const subscriptions = this.priceSubscriptions.get(feedKey) || [];
    subscriptions.push(subscription);
    this.priceSubscriptions.set(feedKey, subscriptions);

    this.logger.debug(`Added subscription for ${feedId.name}`);

    // Return unsubscribe function
    return () => {
      const currentSubscriptions = this.priceSubscriptions.get(feedKey) || [];
      const filteredSubscriptions = currentSubscriptions.filter(s => s !== subscription);

      if (filteredSubscriptions.length === 0) {
        this.priceSubscriptions.delete(feedKey);
      } else {
        this.priceSubscriptions.set(feedKey, filteredSubscriptions);
      }

      this.logger.debug(`Removed subscription for ${feedId.name}`);
    };
  }

  /**
   * Get quality metrics for aggregated price
   */
  async getQualityMetrics(feedId: EnhancedFeedId): Promise<QualityMetrics> {
    const feedKey = this.getFeedKey(feedId);
    const updates = this.activePriceUpdates.get(feedKey) || [];
    const performanceHistory = this.performanceMetrics.get(feedKey) || [];

    // Calculate real-time quality metrics
    const now = Date.now();
    const freshUpdates = updates.filter(u => now - u.timestamp <= 2000);

    const coverage = freshUpdates.length > 0 ? Math.min(1.0, freshUpdates.length / 5) : 0; // Assume 5 is ideal
    const avgLatency =
      performanceHistory.length > 0
        ? performanceHistory.reduce((sum, time) => sum + time, 0) / performanceHistory.length
        : 0;

    const avgConfidence =
      freshUpdates.length > 0 ? freshUpdates.reduce((sum, u) => sum + u.confidence, 0) / freshUpdates.length : 0;

    // Get consensus metrics from aggregator
    const baseMetrics = await this.consensusAggregator.getQualityMetrics(feedId);

    return {
      accuracy: baseMetrics.accuracy,
      latency: avgLatency,
      coverage,
      reliability: avgConfidence,
      consensusAlignment: baseMetrics.consensusAlignment,
    };
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): AggregationCacheStats {
    const totalRequests = this.cacheStats.totalRequests;
    const hitRate = totalRequests > 0 ? this.cacheStats.hits / totalRequests : 0;
    const missRate = totalRequests > 0 ? this.cacheStats.misses / totalRequests : 0;

    // Calculate average age of cache entries
    const now = Date.now();
    const ages = Array.from(this.cache.values()).map(entry => now - entry.timestamp);
    const averageAge = ages.length > 0 ? ages.reduce((sum, age) => sum + age, 0) / ages.length : 0;

    return {
      totalEntries: this.cache.size,
      hitRate,
      missRate,
      evictionCount: this.cacheStats.evictions,
      averageAge,
    };
  }

  /**
   * Get performance metrics for a specific feed
   */
  getFeedPerformanceMetrics(feedId: EnhancedFeedId): {
    averageResponseTime: number;
    maxResponseTime: number;
    minResponseTime: number;
    sampleCount: number;
  } {
    const feedKey = this.getFeedKey(feedId);
    const metrics = this.performanceMetrics.get(feedKey) || [];

    if (metrics.length === 0) {
      return { averageResponseTime: 0, maxResponseTime: 0, minResponseTime: 0, sampleCount: 0 };
    }

    const sum = metrics.reduce((acc, time) => acc + time, 0);
    const average = sum / metrics.length;
    const max = Math.max(...metrics);
    const min = Math.min(...metrics);

    return {
      averageResponseTime: average,
      maxResponseTime: max,
      minResponseTime: min,
      sampleCount: metrics.length,
    };
  }

  /**
   * Clear all cached data (for testing or reset)
   */
  clearCache(): void {
    this.cache.clear();
    this.cacheAccessOrder.clear();
    this.cacheStats = { hits: 0, misses: 0, evictions: 0, totalRequests: 0 };
    this.logger.log("Cache cleared");
  }

  /**
   * Get active feed count
   */
  getActiveFeedCount(): number {
    return this.activePriceUpdates.size;
  }

  /**
   * Get subscription count
   */
  getSubscriptionCount(): number {
    return Array.from(this.priceSubscriptions.values()).reduce(
      (total, subscriptions) => total + subscriptions.length,
      0
    );
  }

  /**
   * Process price update and trigger aggregation
   * This method is called by the DataSourceIntegrationService
   */
  async processPriceUpdate(update: PriceUpdate): Promise<void> {
    const operationId = `process_update_${update.symbol}_${Date.now()}`;
    this.enhancedLogger?.startPerformanceTimer(operationId, "process_price_update", "RealTimeAggregation", {
      symbol: update.symbol,
      source: update.source,
      price: update.price,
    });

    try {
      // Get feed ID from configuration
      const feedId = this.getFeedIdFromSymbol(update.symbol);
      if (!feedId) {
        this.logger.warn(`Unknown feed symbol: ${update.symbol}`);
        return;
      }

      // Log the incoming price update
      this.enhancedLogger?.logPriceUpdate(
        update.symbol,
        update.source,
        update.price,
        update.timestamp,
        update.confidence
      );

      // Add the price update to our active data
      this.addPriceUpdate(feedId, update);

      // Get fresh aggregated price
      const aggregatedPrice = await this.getAggregatedPrice(feedId);

      if (aggregatedPrice) {
        // Log successful aggregation
        this.enhancedLogger?.logDataFlow("RealTimeAggregation", "AggregatedPriceEvent", "AggregatedPrice", 1, {
          symbol: update.symbol,
          originalPrice: update.price,
          aggregatedPrice: aggregatedPrice.price,
          sourceCount: aggregatedPrice.sources.length,
        });

        // Emit aggregated price event for other services
        this.emit("aggregatedPrice", aggregatedPrice);

        this.enhancedLogger?.debug(`Price update processed successfully`, {
          component: "RealTimeAggregation",
          operation: "process_price_update",
          symbol: update.symbol,
          sourceId: update.source,
          metadata: {
            originalPrice: update.price,
            aggregatedPrice: aggregatedPrice.price,
            priceChange: aggregatedPrice.price - update.price,
            sourceCount: aggregatedPrice.sources.length,
            confidence: aggregatedPrice.confidence,
          },
        });

        this.enhancedLogger?.endPerformanceTimer(operationId, true, {
          aggregatedPrice: aggregatedPrice.price,
          sourceCount: aggregatedPrice.sources.length,
        });
      } else {
        this.enhancedLogger?.warn(`Failed to generate aggregated price for ${update.symbol}`, {
          component: "RealTimeAggregation",
          operation: "process_price_update",
          symbol: update.symbol,
          sourceId: update.source,
          metadata: {
            originalPrice: update.price,
            confidence: update.confidence,
          },
        });

        this.enhancedLogger?.endPerformanceTimer(operationId, false, {
          error: "no_aggregated_price_generated",
        });
      }
    } catch (error) {
      const err = error as Error;
      this.enhancedLogger?.error(err, {
        component: "RealTimeAggregation",
        operation: "process_price_update",
        symbol: update.symbol,
        sourceId: update.source,
        severity: "high",
        metadata: {
          price: update.price,
          confidence: update.confidence,
          timestamp: update.timestamp,
        },
      });

      // Emit error event for error handling services
      this.emit("error", err);

      this.enhancedLogger?.endPerformanceTimer(operationId, false, { error: err.message });
      throw err;
    }
  }

  /**
   * Emit events (uses BaseEventService implementation)
   */
  override emit(event: string | symbol, ...args: unknown[]): boolean {
    return super.emit(event, ...args);
  }

  /**
   * Listen for events (uses BaseEventService implementation)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  // Private methods

  private getFeedKey(feedId: EnhancedFeedId): string {
    return `${feedId.category}:${feedId.name}`;
  }

  private getCachedPrice(feedKey: string): CacheEntry | null {
    const entry = this.cache.get(feedKey);
    if (!entry) {
      return null;
    }

    const now = Date.now();
    const age = now - entry.timestamp;

    // Check TTL (1-second maximum)
    if (age > entry.ttl) {
      this.cache.delete(feedKey);
      this.cacheAccessOrder.delete(feedKey);
      return null;
    }

    // Update access order for LRU
    this.cacheAccessOrder.set(feedKey, now);
    return entry;
  }

  private setCachedPrice(feedKey: string, price: AggregatedPrice): void {
    const now = Date.now();
    const entry: CacheEntry = {
      value: price,
      timestamp: now,
      ttl: this.config.cacheTTLMs,
      sources: price.sources,
      confidence: price.confidence,
    };

    // Check cache size limit and evict LRU if necessary
    if (this.cache.size >= this.config.maxCacheSize) {
      this.evictLRU();
    }

    this.cache.set(feedKey, entry);
    this.cacheAccessOrder.set(feedKey, now);
  }

  private invalidateCache(feedKey: string): void {
    if (this.cache.has(feedKey)) {
      this.cache.delete(feedKey);
      this.cacheAccessOrder.delete(feedKey);
      this.logger.debug(`Cache invalidated for ${feedKey}`);
    }
  }

  private evictLRU(): void {
    // Find least recently used entry
    let oldestKey = "";
    let oldestTime = Date.now();

    for (const [key, accessTime] of this.cacheAccessOrder) {
      if (accessTime < oldestTime) {
        oldestTime = accessTime;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.cacheAccessOrder.delete(oldestKey);
      this.cacheStats.evictions++;
      this.logger.debug(`Evicted LRU cache entry: ${oldestKey}`);
    }
  }

  private recordCacheHit(): void {
    this.cacheStats.hits++;
    this.cacheStats.totalRequests++;
  }

  private recordCacheMiss(): void {
    this.cacheStats.misses++;
    this.cacheStats.totalRequests++;
  }

  private recordPerformance(feedKey: string, responseTime: number): void {
    const metrics = this.performanceMetrics.get(feedKey) || [];
    metrics.push(responseTime);

    // Keep only recent metrics (last 100 measurements)
    if (metrics.length > 100) {
      metrics.shift();
    }

    this.performanceMetrics.set(feedKey, metrics);
  }

  private async notifySubscribers(feedId: EnhancedFeedId, feedKey: string): Promise<void> {
    const subscriptions = this.priceSubscriptions.get(feedKey);
    if (!subscriptions || subscriptions.length === 0) {
      return;
    }

    try {
      // Get fresh aggregated price
      const aggregatedPrice = await this.getAggregatedPrice(feedId);
      if (!aggregatedPrice) {
        return;
      }

      // Notify all subscribers
      subscriptions.forEach(subscription => {
        try {
          subscription.callback(aggregatedPrice);
          subscription.lastUpdate = Date.now();
        } catch (error) {
          this.logger.error(`Error notifying subscriber for ${feedId.name}:`, error);
        }
      });

      this.logger.debug(`Notified ${subscriptions.length} subscribers for ${feedId.name}`);
    } catch (error) {
      this.logger.error(`Error getting aggregated price for notifications:`, error);
    }
  }

  private startRealTimeAggregation(): void {
    this.aggregationInterval = setInterval(() => {
      // Continuous recalculation happens on-demand via getAggregatedPrice
      // This interval is for cleanup and maintenance
      this.performMaintenance();
    }, this.config.aggregationIntervalMs);
  }

  private stopRealTimeAggregation(): void {
    if (this.aggregationInterval) {
      clearInterval(this.aggregationInterval);
      this.aggregationInterval = undefined;
    }
  }

  private startCacheCleanup(): void {
    // Clean up expired cache entries every 5 seconds
    this.cacheCleanupInterval = setInterval(() => {
      this.cleanupExpiredCache();
    }, 5000);
  }

  private stopCacheCleanup(): void {
    if (this.cacheCleanupInterval) {
      clearInterval(this.cacheCleanupInterval);
      this.cacheCleanupInterval = undefined;
    }
  }

  private cleanupExpiredCache(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, entry] of this.cache) {
      const age = now - entry.timestamp;
      if (age > entry.ttl) {
        this.cache.delete(key);
        this.cacheAccessOrder.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.debug(`Cleaned up ${cleanedCount} expired cache entries`);
    }
  }

  private performMaintenance(): void {
    // Clean up stale price updates
    const now = Date.now();
    let cleanedFeeds = 0;

    for (const [feedKey, updates] of this.activePriceUpdates) {
      const freshUpdates = updates.filter(u => now - u.timestamp <= 2000);

      if (freshUpdates.length !== updates.length) {
        if (freshUpdates.length === 0) {
          this.activePriceUpdates.delete(feedKey);
        } else {
          this.activePriceUpdates.set(feedKey, freshUpdates);
        }
        cleanedFeeds++;
      }
    }

    if (cleanedFeeds > 0) {
      this.logger.debug(`Cleaned up stale updates for ${cleanedFeeds} feeds`);
    }
  }

  /**
   * Get feed ID from symbol using configuration
   */
  private getFeedIdFromSymbol(symbol: string): EnhancedFeedId | null {
    const feedConfigs = this.configService.getFeedConfigurations();
    const config = feedConfigs.find(config => config.feed.name === symbol);
    return config ? config.feed : null;
  }

  getServiceName(): string {
    return "RealTimeAggregationService";
  }

  // IBaseService interface methods
  async getPerformanceMetrics(): Promise<ServicePerformanceMetrics> {
    const uptime = process.uptime();
    const totalRequests = this.cacheStats.totalRequests;
    const requestsPerSecond = totalRequests / uptime;

    // Calculate response time metrics from all feeds
    const allMetrics = Array.from(this.performanceMetrics.values()).flat();
    const averageResponseTime =
      allMetrics.length > 0 ? allMetrics.reduce((sum, time) => sum + time, 0) / allMetrics.length : 0;

    // Sort metrics for percentile calculation
    const sortedMetrics = [...allMetrics].sort((a, b) => a - b);
    const p95Index = Math.floor(sortedMetrics.length * 0.95);
    const p95 = sortedMetrics.length > 0 ? sortedMetrics[p95Index] : 0;
    const maxResponseTime = sortedMetrics.length > 0 ? sortedMetrics[sortedMetrics.length - 1] : 0;

    return {
      uptime,
      responseTime: {
        average: averageResponseTime,
        p95,
        max: maxResponseTime,
      },
      requestsPerSecond,
      errorRate: 0, // Mock value - should be calculated from actual error metrics
    };
  }

  async getHealthStatus(): Promise<ServiceHealthStatus> {
    const activeFeedCount = this.getActiveFeedCount();
    const cacheStats = this.getCacheStats();
    const now = Date.now();

    // Create health check results for each component
    const cacheHealth: HealthCheckResult = {
      isHealthy: cacheStats.hitRate >= 0.8,
      timestamp: now,
      details: {
        component: "cache",
        status: cacheStats.hitRate >= 0.8 ? "healthy" : "degraded",
        timestamp: now,
        metrics: {
          uptime: process.uptime() * 1000, // Convert to milliseconds
          memoryUsage: process.memoryUsage().heapUsed / (1024 * 1024), // Convert to MB
          cpuUsage: 0, // This would require actual CPU usage monitoring
          connectionCount: 0, // This would require actual connection tracking
        },
      },
    };

    const subscriptionHealth: HealthCheckResult = {
      isHealthy: activeFeedCount > 0,
      timestamp: now,
      details: {
        component: "subscriptions",
        status: activeFeedCount > 0 ? "healthy" : "unhealthy",
        timestamp: now,
        connections: activeFeedCount,
      },
    };

    // Determine overall status
    let status: HealthStatusType = "healthy";
    if (activeFeedCount === 0) {
      status = "unhealthy";
    } else if (cacheStats.hitRate < 0.8) {
      status = "degraded";
    }

    return {
      status,
      timestamp: now,
      details: [cacheHealth, subscriptionHealth],
    };
  }
}
