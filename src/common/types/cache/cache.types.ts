import { EnhancedFeedId } from "../core/feed.types";
import { IBaseService } from "../services/base.types";

/**
 * Defines the structure for a single cache entry, representing the data stored for a feed.
 */
export interface CacheEntry {
  value: number;
  timestamp: number;
  sources: string[];
  confidence: number;
  votingRound?: number;
}

/**
 * Describes the structure of an item stored in the cache, including metadata for eviction policies.
 */
export interface CacheItem {
  entry: CacheEntry;
  expiresAt: number;
  accessCount: number;
  lastAccessed: number;
}

/**
 * Configuration for the real-time cache, specifying its behavior and limits.
 */
export interface CacheConfig {
  enabled: boolean;
  ttl: number; // Time-to-live in milliseconds
  maxSize: number; // Maximum number of entries
  evictionPolicy: "LRU" | "LFU" | "TTL";
  memoryLimit: number; // Memory limit in bytes
  compression: boolean;
}

/**
 * Statistical data for monitoring cache performance and health.
 */
export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  size: number;
  evictions: number;
  averageGetTime: number;
  averageSetTime: number;
  averageResponseTime: number; // Average response time in milliseconds
  memoryUsage: number;
  totalRequests: number;
  missRate: number;
  totalEntries: number;
}

/**
 * Performance metrics for cache monitoring
 */
export interface CachePerformanceMetrics {
  timestamp: number;
  hitRate: number;
  missRate: number;
  totalRequests: number;
  requestRate: number;
  requestsPerSecond: number; // Requests per second
  averageGetTime: number;
  averageResponseTime: number; // Average response time in milliseconds
  memoryUsage: number;
  entryCount: number;
  evictionRate: number;
}

/**
 * Response time metrics for cache operations
 */
export interface ResponseTimeMetric {
  timestamp: number;
  responseTime: number; // Duration in milliseconds
}

/**
 * Memory usage metrics for cache monitoring
 */
export interface MemoryUsageMetric {
  timestamp: number;
  usage: number; // Memory usage in bytes
}

/**
 * Interface for a real-time cache implementation, defining core cache operations.
 */
export interface RealTimeCache {
  set(key: string, value: CacheEntry, ttl?: number): void;
  get(key: string): CacheEntry | null;
  invalidate(key: string): void;
  getStats(): CacheStats;
  clear(): void;
}

/**
 * Defines the service interface for cache management, extending base service capabilities.
 */
export interface ICacheService extends IBaseService {
  get(key: string): CacheEntry | null;
  set(key: string, value: CacheEntry, ttl?: number): void;
  invalidate(key: string): void;
  getStats(): CacheStats;
  getCacheConfig(): CacheConfig;
}

/**
 * Configuration for the cache warmer service, which proactively populates the cache.
 */
export interface WarmupConfig {
  enabled: boolean;
  warmupInterval: number; // Interval in milliseconds
  popularFeeds: EnhancedFeedId[];
}

/**
 * Metrics for tracking the popularity of feeds to inform cache warming strategies.
 */
export interface FeedPopularityMetrics {
  feedId: EnhancedFeedId;
  requestCount: number;
  lastRequested: number;
  priority: number;
}
