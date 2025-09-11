import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { StandardService } from "@/common/base/composed.service";
import type { RealTimeCache, CacheEntry, CacheStats, CacheConfig, CacheItem } from "@/common/types/cache";
import type { EnhancedFeedId } from "@/common/types/core";

@Injectable()
export class RealTimeCacheService extends StandardService implements RealTimeCache, OnModuleDestroy {
  private readonly cache = new Map<string, CacheItem>();

  // Cleanup interval is now managed by lifecycle mixin
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    hitRate: 0,
    size: 0,
    evictions: 0,
    averageGetTime: 0,
    averageSetTime: 0,
    averageResponseTime: 0,
    memoryUsage: 0,
    totalRequests: 0,
    missRate: 0,
    totalEntries: 0,
  };

  // Performance optimization features
  private readonly performanceBuffer: number[] = [];
  private readonly maxBufferSize = 100;
  private adaptiveTTL = true;
  private compressionEnabled = false;

  constructor() {
    super({
      ttl: 600, // TTL for cache entries
      maxSize: 25000, // Cache capacity for better hit rates
      evictionPolicy: "LRU",
      memoryLimit: 256 * 1024 * 1024, // Increased memory limit for better performance
      enabled: true,
      compression: false,
    });

    // Cleanup interval for expired entries using managed timer
    this.createInterval(() => this.cleanupExpiredEntries(), 1500);
  }

  override getConfig(): CacheConfig {
    return { ...this.config } as CacheConfig;
  }

  /**
   * Get the typed configuration for this service
   */
  private get cacheConfig(): CacheConfig {
    return this.getConfig();
  }

  // Method to create a service with custom configuration (for testing)
  static withConfig(config: Partial<CacheConfig>): RealTimeCacheService {
    const service = new RealTimeCacheService();
    service.updateConfig({
      ttl: 1000,
      maxSize: 10000,
      evictionPolicy: "LRU",
      memoryLimit: 100 * 1024 * 1024,
      enabled: true,
      compression: false,
      ...config,
    });
    return service;
  }

  set(key: string, value: CacheEntry, ttl: number): void {
    const startTime = performance.now();

    // Adaptive TTL based on access patterns
    const effectiveTTL = this.adaptiveTTL ? this.calculateAdaptiveTTL(key, ttl) : Math.min(ttl, this.cacheConfig.ttl);

    if (effectiveTTL <= 0) {
      this.logger.debug(`Cache set: ${key} with TTL ${effectiveTTL}ms - not cached due to zero/negative TTL`);
      return;
    }

    const expiresAt = Date.now() + effectiveTTL;

    // Eviction with intelligent algorithms
    if (this.cache.size >= this.cacheConfig.maxSize) {
      this.intelligentEviction();
    }

    const cacheItem: CacheItem = {
      entry: value,
      expiresAt,
      accessCount: 0,
      lastAccessed: Date.now(),
    };

    this.cache.set(key, cacheItem);

    // Performance tracking
    const setTime = performance.now() - startTime;
    this.recordPerformanceMetric(setTime);
    this.stats.averageSetTime = this.calculateMovingAverage(this.stats.averageSetTime, setTime);

    this.logger.debug(`Cache set: ${key} with TTL ${effectiveTTL}ms (${setTime.toFixed(2)}ms)`);
  }

  get(key: string): CacheEntry | null {
    const startTime = performance.now();
    const item = this.cache.get(key);

    if (!item) {
      this.trackRequest(false);
      const getTime = performance.now() - startTime;
      this.stats.averageGetTime = (this.stats.averageGetTime + getTime) / 2;
      return null;
    }

    const now = Date.now();

    // Expiration check with batch cleanup for efficiency
    if (now > item.expiresAt) {
      this.cache.delete(key);
      this.trackRequest(false);

      // Trigger batch cleanup if we're finding many expired items
      if (Math.random() < 0.1) {
        // 10% chance to trigger cleanup
        this.cleanupExpiredEntries();
      }

      const getTime = performance.now() - startTime;
      this.stats.averageGetTime = (this.stats.averageGetTime + getTime) / 2;
      this.logger.debug(`Cache expired: ${key}`);
      return null;
    }

    // Access tracking - update occasionally for performance
    if (now - item.lastAccessed > 100) {
      // Only update if >100ms since last access
      item.accessCount++;
      item.lastAccessed = now;
    }

    this.trackRequest(true);

    const getTime = performance.now() - startTime;
    this.stats.averageGetTime = (this.stats.averageGetTime + getTime) / 2;

    this.logger.debug(`Cache hit: ${key} (${getTime.toFixed(2)}ms)`);
    return item.entry;
  }

  invalidate(key: string): void {
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.stats.size = this.cache.size;
      this.logger.debug(`Cache invalidated: ${key}`);
    }
  }

  getStats(): CacheStats {
    // Calculate hit rate and other metrics
    const totalRequests = this.stats.hits + this.stats.misses;
    const hitRate = totalRequests > 0 ? this.stats.hits / totalRequests : 0;
    const missRate = totalRequests > 0 ? this.stats.misses / totalRequests : 0;

    // Calculate average response time as a weighted average of get and set times
    const totalOperations = this.stats.hits + this.stats.misses;
    const averageResponseTime =
      totalOperations > 0
        ? (this.stats.averageGetTime * this.stats.hits + this.stats.averageSetTime * this.stats.misses) /
          totalOperations
        : 0;

    return {
      ...this.stats,
      hitRate,
      missRate,
      totalRequests,
      averageResponseTime,
      totalEntries: this.cache.size,
      size: this.cache.size,
      memoryUsage: this.estimateMemoryUsage(),
    };
  }

  // Voting round-aware caching methods
  setForVotingRound(feedId: EnhancedFeedId, votingRound: number, value: CacheEntry, ttl: number = 60000): void {
    const key = this.generateVotingRoundKey(feedId, votingRound);
    const entryWithRound: CacheEntry = {
      ...value,
      votingRound,
    };
    this.set(key, entryWithRound, ttl);
  }

  getForVotingRound(feedId: EnhancedFeedId, votingRound: number): CacheEntry | null {
    const key = this.generateVotingRoundKey(feedId, votingRound);
    return this.get(key);
  }

  // Real-time price caching with immediate invalidation
  setPrice(feedId: EnhancedFeedId, value: CacheEntry): void {
    const key = this.generatePriceKey(feedId);
    // Use maximum allowed TTL for price data
    this.set(key, value, this.cacheConfig.ttl);

    // Invalidate any existing voting round cache for this feed
    this.invalidateFeedCache(feedId);
  }

  getPrice(feedId: EnhancedFeedId): CacheEntry | null {
    const key = this.generatePriceKey(feedId);
    return this.get(key);
  }

  // Cache invalidation on new price updates (requirement 6.5)
  invalidateOnPriceUpdate(feedId: EnhancedFeedId): void {
    // Only invalidate voting round cache, not current price cache
    // Current price should remain cached until it expires naturally
    this.invalidateFeedCache(feedId);

    this.logger.debug(`Invalidated voting round cache for feed: ${feedId.category}/${feedId.name}`);
  }

  private generatePriceKey(feedId: EnhancedFeedId): string {
    return `price:${feedId.category}:${feedId.name}`;
  }

  private generateVotingRoundKey(feedId: EnhancedFeedId, votingRound: number): string {
    return `voting:${votingRound}:${feedId.category}:${feedId.name}`;
  }

  private invalidateFeedCache(feedId: EnhancedFeedId): void {
    const prefix = `voting:`;
    const feedPattern = `:${feedId.category}:${feedId.name}`;

    const keysToInvalidate: string[] = [];
    this.cache.forEach((_, key) => {
      if (key.startsWith(prefix) && key.endsWith(feedPattern)) {
        keysToInvalidate.push(key);
      }
    });

    keysToInvalidate.forEach(key => this.invalidate(key));
  }

  private cleanupExpiredEntries(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    this.cache.forEach((item, key) => {
      if (now > item.expiresAt) {
        expiredKeys.push(key);
      }
    });

    for (const key of expiredKeys) {
      this.cache.delete(key);
    }

    if (expiredKeys.length > 0) {
      this.logger.debug(`Cleaned up ${expiredKeys.length} expired entries`);
    }
  }

  private estimateMemoryUsage(): number {
    let totalSize = 0;

    this.cache.forEach((item, key) => {
      // Rough estimation of memory usage
      totalSize += key.length * 2; // String characters are 2 bytes each
      totalSize += 8 * 4; // Numbers (value, timestamp, confidence, expiresAt, accessCount, lastAccessed)
      totalSize += item.entry.sources.reduce((acc, source) => acc + source.length * 2, 0);
      totalSize += 64; // Object overhead
    });

    return totalSize;
  }

  private trackRequest(hit: boolean): void {
    if (hit) {
      this.stats.hits++;
    } else {
      this.stats.misses++;
    }
  }

  // Utility methods for testing and monitoring
  clear(): void {
    this.cache.clear();
    this.stats = {
      hits: 0,
      misses: 0,
      hitRate: 0,
      size: 0,
      evictions: 0,
      averageGetTime: 0,
      averageSetTime: 0,
      averageResponseTime: 0,
      memoryUsage: 0,
      totalRequests: 0,
      missRate: 0,
      totalEntries: 0,
    };
    this.logger.debug("Cache cleared");
  }

  size(): number {
    return this.cache.size;
  }

  // Cleanup method to stop intervals and prevent memory leaks
  destroy(): void {
    // Managed intervals are automatically cleaned up by lifecycle mixin
    this.cache.clear();
    this.logger.debug("Cache service destroyed");
  }

  override async cleanup(): Promise<void> {
    this.destroy();
  }

  // Performance optimization methods

  /**
   * Calculate adaptive TTL based on access patterns
   */
  private calculateAdaptiveTTL(key: string, requestedTTL: number): number {
    const item = this.cache.get(key);
    if (!item) {
      return Math.min(requestedTTL, this.cacheConfig.ttl);
    }

    // Increase TTL for frequently accessed items
    const accessFrequency = item.accessCount / Math.max(1, (Date.now() - item.lastAccessed) / 1000);
    const adaptiveMultiplier = Math.min(2.0, 1 + accessFrequency * 0.1);

    return Math.min(requestedTTL * adaptiveMultiplier, this.cacheConfig.ttl * 1.5);
  }

  /**
   * Intelligent eviction using access patterns and prediction
   */
  private intelligentEviction(): void {
    const evictionCount = Math.min(200, Math.floor(this.cache.size * 0.15)); // Evict 15% or 200 items max
    const entries = Array.from(this.cache.entries());

    // Score entries based on multiple factors
    const scoredEntries = entries.map(([key, item]) => {
      const age = Date.now() - item.lastAccessed;
      const accessScore = item.accessCount / Math.max(1, age / 1000); // Access per second
      const freshnessScore = Math.max(0, 1 - age / (this.cacheConfig.ttl * 2));
      const combinedScore = accessScore * 0.7 + freshnessScore * 0.3;

      return { key, score: combinedScore };
    });

    // Sort by score (lowest first for eviction)
    scoredEntries.sort((a, b) => a.score - b.score);

    // Evict lowest scoring entries
    for (let i = 0; i < evictionCount && i < scoredEntries.length; i++) {
      const { key } = scoredEntries[i];
      this.cache.delete(key);
      this.stats.evictions++;
    }

    this.logger.debug(`Intelligent eviction removed ${evictionCount} entries`);
  }

  /**
   * Record performance metrics for optimization
   */
  private recordPerformanceMetric(responseTime: number): void {
    this.performanceBuffer.push(responseTime);

    if (this.performanceBuffer.length > this.maxBufferSize) {
      this.performanceBuffer.shift();
    }
  }

  /**
   * Calculate moving average for smoother metrics
   */
  private calculateMovingAverage(current: number, newValue: number): number {
    const alpha = 0.1; // Smoothing factor
    return current * (1 - alpha) + newValue * alpha;
  }

  /**
   * Get performance insights for optimization
   */
  getPerformanceInsights(): {
    averageResponseTime: number;
    p95ResponseTime: number;
    hitRateEfficiency: number;
    memoryEfficiency: number;
    evictionRate: number;
    recommendations: string[];
  } {
    const sortedTimes = [...this.performanceBuffer].sort((a, b) => a - b);
    const p95Index = Math.floor(sortedTimes.length * 0.95);
    const p95ResponseTime = sortedTimes.length > 0 ? sortedTimes[p95Index] : 0;

    const averageResponseTime =
      this.performanceBuffer.length > 0
        ? this.performanceBuffer.reduce((sum, time) => sum + time, 0) / this.performanceBuffer.length
        : 0;

    const hitRateEfficiency = this.stats.hitRate;
    const memoryEfficiency = 1 - this.estimateMemoryUsage() / this.cacheConfig.memoryLimit;
    const evictionRate = this.stats.totalRequests > 0 ? this.stats.evictions / this.stats.totalRequests : 0;

    const recommendations: string[] = [];

    if (hitRateEfficiency < 0.85) {
      recommendations.push("Consider increasing cache size or implementing more aggressive warming");
    }

    if (averageResponseTime > 5) {
      recommendations.push("Response times are high - consider optimizing data structures or reducing TTL");
    }

    if (memoryEfficiency < 0.3) {
      recommendations.push("Memory usage is high - consider enabling compression or reducing cache size");
    }

    if (evictionRate > 0.1) {
      recommendations.push("High eviction rate detected - consider increasing cache size");
    }

    return {
      averageResponseTime,
      p95ResponseTime,
      hitRateEfficiency,
      memoryEfficiency,
      evictionRate,
      recommendations,
    };
  }

  /**
   * Enable adaptive optimizations
   */
  enableOptimizations(options: { adaptiveTTL?: boolean; compression?: boolean; intelligentEviction?: boolean }): void {
    if (options.adaptiveTTL !== undefined) {
      this.adaptiveTTL = options.adaptiveTTL;
    }

    if (options.compression !== undefined) {
      this.compressionEnabled = options.compression;
    }

    this.logger.log(
      `Cache optimizations updated: adaptiveTTL=${this.adaptiveTTL}, compression=${this.compressionEnabled}`
    );
  }

  /**
   * Optimize cache performance based on current metrics
   */
  optimizePerformance(): void {
    const insights = this.getPerformanceInsights();

    // Apply optimizations based on insights
    if (insights.hitRateEfficiency < 0.9) {
      // Increase cache size if hit rate is low
      this.config.maxSize = Math.min(this.cacheConfig.maxSize * 1.2, 50000);
      this.logger.log(`Increased cache size to ${this.config.maxSize} for better hit rates`);
    }

    if (insights.averageResponseTime > 3) {
      // Reduce TTL for faster cache operations
      this.config.ttl = Math.max(this.cacheConfig.ttl * 0.9, 300);
      this.logger.log(`Reduced TTL to ${this.config.ttl}ms for faster operations`);
    }

    if (insights.memoryEfficiency < 0.4) {
      // Enable compression if memory usage is high
      this.compressionEnabled = true;
      this.logger.log("Enabled compression due to high memory usage");
    }

    // Enable adaptive features for better performance
    this.adaptiveTTL = true;
  }

  /**
   * Get cache efficiency score (0-1, higher is better)
   */
  getEfficiencyScore(): number {
    const insights = this.getPerformanceInsights();
    return (insights.hitRateEfficiency + insights.memoryEfficiency + (1 - insights.evictionRate)) / 3;
  }
}
