import { Injectable } from "@nestjs/common";
import { BaseService } from "@/common/base/base.service";
import { executeWithConcurrency } from "@/common/utils/async.utils";

import type { EnhancedFeedId } from "@/common/types/core";
import type { CacheEntry, WarmupConfig, FeedPopularityMetrics } from "@/common/types/cache";
import type { AggregatedPrice } from "@/common/types/services";

import { RealTimeCacheService } from "./real-time-cache.service";

@Injectable()
export class CacheWarmerService extends BaseService {
  private readonly popularityMetrics = new Map<string, FeedPopularityMetrics>();
  private warmupInterval?: NodeJS.Timeout;
  private config: WarmupConfig;
  private dataSourceCallback?: (feedId: EnhancedFeedId) => Promise<AggregatedPrice | null>;

  constructor(private readonly cacheService: RealTimeCacheService) {
    super(CacheWarmerService.name);
    this.config = {
      popularFeeds: [],
      warmupInterval: 30000, // 30 seconds
      enabled: true,
    };

    if (this.config.enabled) {
      this.startWarmupProcess();
    }
  }

  // Track feed access patterns to identify popular feeds
  trackFeedAccess(feedId: EnhancedFeedId): void {
    const key = this.generateFeedKey(feedId);
    const existing = this.popularityMetrics.get(key);

    if (existing) {
      existing.requestCount++;
      existing.lastRequested = Date.now();
      // Increase priority based on recent activity
      existing.priority = this.calculatePriority(existing);
    } else {
      this.popularityMetrics.set(key, {
        feedId,
        requestCount: 1,
        lastRequested: Date.now(),
        priority: 1,
      });
    }

    this.logger.debug(`Tracked access for feed: ${key}, count: ${existing?.requestCount || 1}`);
  }

  // Asynchronously warm cache for popular feeds
  async warmPopularFeeds(): Promise<void> {
    const popularFeeds = this.getPopularFeeds();

    if (popularFeeds.length === 0) {
      this.logDebug("No popular feeds to warm");
      return;
    }

    this.logDebug(`Warming cache for ${popularFeeds.length} popular feeds`);

    // Use the new async utility for controlled concurrency
    const { successful, failed } = await executeWithConcurrency(
      popularFeeds,
      async metrics => {
        await this.warmFeedCache(metrics.feedId);
        return metrics.feedId;
      },
      {
        concurrency: 5,
        onError: "continue",
        logger: this.logger,
      }
    );

    this.logDebug(`Cache warming completed: ${successful} successful, ${failed} failed`);
  }

  // Warm cache for a specific feed
  async warmFeedCache(feedId: EnhancedFeedId): Promise<void> {
    try {
      // Check if feed is already cached and fresh
      const existing = this.cacheService.getPrice(feedId);
      if (existing && this.isCacheFresh(existing)) {
        this.logger.debug(`Feed ${this.generateFeedKey(feedId)} already has fresh cache`);
        return;
      }

      // Fetch fresh data from data sources
      const freshData = await this.fetchFreshData(feedId);

      if (freshData) {
        this.cacheService.setPrice(feedId, freshData);
        this.logger.debug(`Warmed cache for feed: ${this.generateFeedKey(feedId)}`);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Error warming cache for feed ${this.generateFeedKey(feedId)}: ${errorMessage}`);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error("An unknown error occurred while warming cache");
    }
  }

  // Get list of popular feeds sorted by priority
  getPopularFeeds(limit: number = 10): FeedPopularityMetrics[] {
    const allMetrics = Array.from(this.popularityMetrics.values());

    // Filter out stale metrics (older than 1 hour)
    const recentMetrics = allMetrics.filter(metrics => Date.now() - metrics.lastRequested < 3600000);

    // Sort by priority (descending) and return top feeds
    return recentMetrics.sort((a, b) => b.priority - a.priority).slice(0, limit);
  }

  // Get cache warming statistics
  getWarmupStats(): {
    totalTrackedFeeds: number;
    popularFeeds: number;
    lastWarmupTime?: number;
    warmupEnabled: boolean;
  } {
    return {
      totalTrackedFeeds: this.popularityMetrics.size,
      popularFeeds: this.getPopularFeeds().length,
      warmupEnabled: this.config.enabled,
    };
  }

  // Configure popular feeds manually
  setPopularFeeds(feeds: EnhancedFeedId[]): void {
    this.config.popularFeeds = feeds;

    // Initialize metrics for manually configured feeds
    feeds.forEach(feedId => {
      const key = this.generateFeedKey(feedId);
      if (!this.popularityMetrics.has(key)) {
        this.popularityMetrics.set(key, {
          feedId,
          requestCount: 0,
          lastRequested: Date.now(),
          priority: 5, // Higher priority for manually configured feeds
        });
      }
    });

    this.logger.debug(`Configured ${feeds.length} popular feeds for warming`);
  }

  // Start the automatic warmup process
  private startWarmupProcess(): void {
    if (this.warmupInterval) {
      clearInterval(this.warmupInterval);
    }

    this.warmupInterval = setInterval(async () => {
      try {
        await this.warmPopularFeeds();
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        this.logger.error(`Cache warmup process failed: ${errorMessage}`);
      }
    }, this.config.warmupInterval);

    this.logger.debug(`Started cache warmup process with ${this.config.warmupInterval}ms interval`);
  }

  // Stop the warmup process
  stopWarmupProcess(): void {
    if (this.warmupInterval) {
      clearInterval(this.warmupInterval);
      this.warmupInterval = undefined;
      this.logger.debug("Stopped cache warmup process");
    }
  }

  // Calculate priority based on request patterns
  private calculatePriority(metrics: FeedPopularityMetrics): number {
    const now = Date.now();
    const timeSinceLastRequest = now - metrics.lastRequested;
    const hoursSinceLastRequest = timeSinceLastRequest / (1000 * 60 * 60);

    // Base priority on request count
    let priority = Math.log(metrics.requestCount + 1);

    // Decay priority based on time since last request
    if (hoursSinceLastRequest > 0) {
      priority = priority * Math.exp(-hoursSinceLastRequest / 24); // Decay over 24 hours
    }

    return Math.max(priority, 0.1); // Minimum priority
  }

  // Check if cached data is still fresh
  private isCacheFresh(cacheEntry: CacheEntry): boolean {
    const age = Date.now() - cacheEntry.timestamp;
    return age < 500; // Consider fresh if less than 500ms old
  }

  // Set data source callback for fetching fresh data
  setDataSourceCallback(callback: (feedId: EnhancedFeedId) => Promise<AggregatedPrice | null>): void {
    this.dataSourceCallback = callback;
    this.logger.debug("Data source callback configured for cache warming");
  }

  // Fetch fresh data from actual data sources
  private async fetchFreshData(feedId: EnhancedFeedId): Promise<CacheEntry | null> {
    if (this.dataSourceCallback) {
      try {
        // Use actual data source integration
        const aggregatedPrice = await this.dataSourceCallback(feedId);

        if (aggregatedPrice) {
          return {
            value: aggregatedPrice.price,
            timestamp: aggregatedPrice.timestamp,
            sources: aggregatedPrice.sources,
            confidence: aggregatedPrice.confidence,
          };
        }

        return null;
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        this.logger.error(`Error fetching fresh data for ${this.generateFeedKey(feedId)}: ${errorMessage}`);
        if (error instanceof Error) {
          throw error;
        }
        throw new Error("An unknown error occurred while fetching fresh data");
      }
    }

    // Fallback to mock data if no callback is configured (for testing)
    this.logger.debug(`Using mock data for cache warming of ${this.generateFeedKey(feedId)}`);
    return {
      value: Math.random() * 50000, // Mock price
      timestamp: Date.now(),
      sources: ["mock-source"],
      confidence: 0.95,
    };
  }

  private generateFeedKey(feedId: EnhancedFeedId): string {
    return `${feedId.category}:${feedId.name}`;
  }

  // Cleanup method
  destroy(): void {
    this.stopWarmupProcess();
    this.popularityMetrics.clear();
    this.logger.debug("Cache warmer service destroyed");
  }
}
