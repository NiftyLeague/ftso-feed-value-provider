import { Injectable, Logger } from "@nestjs/common";
import { RealTimeCache, CacheEntry, CacheStats, CacheConfig } from "./interfaces/cache.interfaces";
import { EnhancedFeedId } from "../types/enhanced-feed-id.types";

interface CacheItem {
  entry: CacheEntry;
  expiresAt: number;
  accessCount: number;
  lastAccessed: number;
}

@Injectable()
export class RealTimeCacheService implements RealTimeCache {
  private readonly logger = new Logger(RealTimeCacheService.name);
  private readonly cache = new Map<string, CacheItem>();
  private config: CacheConfig;
  private readonly cleanupInterval: NodeJS.Timeout;
  private stats = {
    hits: 0,
    misses: 0,
    totalRequests: 0,
    evictions: 0,
  };

  constructor() {
    this.config = {
      maxTTL: 1000, // 1 second maximum TTL as per requirement 6.2
      maxEntries: 10000,
      evictionPolicy: "LRU",
      memoryLimit: 100 * 1024 * 1024, // 100MB
    };

    // Start cleanup interval for expired entries
    this.cleanupInterval = setInterval(() => this.cleanupExpiredEntries(), 500);
  }

  // Method to create a service with custom configuration (for testing)
  static withConfig(config: Partial<CacheConfig>): RealTimeCacheService {
    const service = new RealTimeCacheService();
    service.config = {
      maxTTL: 1000,
      maxEntries: 10000,
      evictionPolicy: "LRU",
      memoryLimit: 100 * 1024 * 1024,
      ...config,
    };
    return service;
  }

  set(key: string, value: CacheEntry, ttl: number): void {
    // Enforce maximum TTL of 1 second as per requirement 6.2
    const effectiveTTL = Math.min(ttl, this.config.maxTTL);

    // If TTL is 0 or negative, don't cache the item
    if (effectiveTTL <= 0) {
      this.logger.debug(`Cache set: ${key} with TTL ${effectiveTTL}ms - not cached due to zero/negative TTL`);
      return;
    }

    const expiresAt = Date.now() + effectiveTTL;

    // Check if we need to evict entries before adding new one
    if (this.cache.size >= this.config.maxEntries) {
      this.evictLRU();
    }

    const cacheItem: CacheItem = {
      entry: value,
      expiresAt,
      accessCount: 0,
      lastAccessed: Date.now(),
    };

    this.cache.set(key, cacheItem);
    this.logger.debug(`Cache set: ${key} with TTL ${effectiveTTL}ms`);
  }

  get(key: string): CacheEntry | null {
    this.stats.totalRequests++;

    const item = this.cache.get(key);

    if (!item) {
      this.stats.misses++;
      return null;
    }

    // Check if item has expired
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      this.stats.misses++;
      this.logger.debug(`Cache expired: ${key}`);
      return null;
    }

    // Update access statistics for LRU
    item.accessCount++;
    item.lastAccessed = Date.now();
    this.stats.hits++;

    this.logger.debug(`Cache hit: ${key}`);
    return item.entry;
  }

  invalidate(key: string): void {
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.logger.debug(`Cache invalidated: ${key}`);
    }
  }

  getStats(): CacheStats {
    const hitRate = this.stats.totalRequests > 0 ? this.stats.hits / this.stats.totalRequests : 0;

    const missRate = this.stats.totalRequests > 0 ? this.stats.misses / this.stats.totalRequests : 0;

    return {
      hitRate,
      missRate,
      totalRequests: this.stats.totalRequests,
      totalEntries: this.cache.size,
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
    this.set(key, value, this.config.maxTTL);

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

    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix) && key.endsWith(feedPattern)) {
        this.invalidate(key);
      }
    }
  }

  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, item] of this.cache.entries()) {
      if (item.lastAccessed < oldestTime) {
        oldestTime = item.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.stats.evictions++;
      this.logger.debug(`Evicted LRU entry: ${oldestKey}`);
    }
  }

  private cleanupExpiredEntries(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, item] of this.cache.entries()) {
      if (now > item.expiresAt) {
        expiredKeys.push(key);
      }
    }

    for (const key of expiredKeys) {
      this.cache.delete(key);
    }

    if (expiredKeys.length > 0) {
      this.logger.debug(`Cleaned up ${expiredKeys.length} expired entries`);
    }
  }

  private estimateMemoryUsage(): number {
    let totalSize = 0;

    for (const [key, item] of this.cache.entries()) {
      // Rough estimation of memory usage
      totalSize += key.length * 2; // String characters are 2 bytes each
      totalSize += 8 * 4; // Numbers (value, timestamp, confidence, expiresAt, accessCount, lastAccessed)
      totalSize += item.entry.sources.reduce((acc, source) => acc + source.length * 2, 0);
      totalSize += 64; // Object overhead
    }

    return totalSize;
  }

  // Utility methods for testing and monitoring
  clear(): void {
    this.cache.clear();
    this.stats = {
      hits: 0,
      misses: 0,
      totalRequests: 0,
      evictions: 0,
    };
    this.logger.debug("Cache cleared");
  }

  size(): number {
    return this.cache.size;
  }

  getConfig(): CacheConfig {
    return { ...this.config };
  }

  // Cleanup method to stop intervals and prevent memory leaks
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.cache.clear();
    this.logger.debug("Cache service destroyed");
  }
}
