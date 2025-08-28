import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { EnhancedFeedId } from "@/types/enhanced-feed-id.types";
import { PriceUpdate } from "@/interfaces/data-source.interface";
import { AggregatedPrice, QualityMetrics } from "./base/aggregation.interfaces";
import { ConsensusAggregator } from "./consensus-aggregator";

export interface CacheEntry {
  value: AggregatedPrice;
  timestamp: number;
  ttl: number;
  sources: string[];
  confidence: number;
  votingRound?: number;
}

export interface CacheStats {
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
export class RealTimeAggregationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealTimeAggregationService.name);

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
  private aggregationInterval?: NodeJS.Timeout;
  private cacheCleanupInterval?: NodeJS.Timeout;

  constructor(private readonly consensusAggregator: ConsensusAggregator) {}

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
    const startTime = performance.now();
    const feedKey = this.getFeedKey(feedId);

    try {
      // Check cache first (with 1-second TTL)
      const cachedEntry = this.getCachedPrice(feedKey);
      if (cachedEntry) {
        this.recordCacheHit();
        this.recordPerformance(feedKey, performance.now() - startTime);
        return cachedEntry.value;
      }

      this.recordCacheMiss();

      // Get active price updates for this feed
      const updates = this.activePriceUpdates.get(feedKey) || [];
      if (updates.length === 0) {
        this.recordPerformance(feedKey, performance.now() - startTime);
        return null;
      }

      // Aggregate prices using consensus aggregator
      const aggregatedPrice = await this.consensusAggregator.aggregate(feedId, updates);

      // Cache the result with 1-second TTL
      this.setCachedPrice(feedKey, aggregatedPrice);

      // Record performance metrics
      const responseTime = performance.now() - startTime;
      this.recordPerformance(feedKey, responseTime);

      // Log performance warning if exceeding target
      if (responseTime > this.config.performanceTargetMs) {
        this.logger.warn(
          `Aggregation for ${feedId.name} took ${responseTime.toFixed(2)}ms, exceeding target of ${this.config.performanceTargetMs}ms`
        );
      }

      return aggregatedPrice;
    } catch (error) {
      this.logger.error(`Error aggregating price for ${feedId.name}:`, error);
      this.recordPerformance(feedKey, performance.now() - startTime);
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
    this.notifySubscribers(feedId, feedKey);

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
  getCacheStats(): CacheStats {
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
  getPerformanceMetrics(feedId: EnhancedFeedId): {
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
}
