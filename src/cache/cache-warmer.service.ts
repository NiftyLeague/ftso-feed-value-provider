import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { StandardService } from "@/common/base/composed.service";
import { executeWithConcurrency } from "@/common/utils/async.utils";
import type { CoreFeedId } from "@/common/types/core";
import type { CacheEntry } from "@/common/types/cache";
import type { AggregatedPrice } from "@/common/types/services";
import { RealTimeCacheService } from "./real-time-cache.service";
import { ENV } from "@/config/environment.constants";

interface FeedAccessPattern {
  feedId: CoreFeedId;
  accessCount: number;
  lastAccessed: number;
  averageInterval: number;
  priority: number;
  predictedNextAccess: number;
  warmingSuccess: number;
  warmingFailures: number;
}

interface WarmingStrategy {
  name: string;
  enabled: boolean;
  priority: number;
  targetFeeds: number;
  concurrency: number;
  interval: number;
}

@Injectable()
export class CacheWarmerService extends StandardService implements OnModuleDestroy {
  private accessPatterns = new Map<string, FeedAccessPattern>();
  private warmingStrategies: WarmingStrategy[] = [];
  private dataSourceCallback?: (feedId: CoreFeedId) => Promise<AggregatedPrice | null>;

  // Optimized warming intervals are now managed by lifecycle mixin

  // Performance tracking
  private warmingStats = {
    totalWarming: 0,
    successfulWarming: 0,
    failedWarming: 0,
    averageWarmingTime: 0,
    cacheHitImprovement: 0,
  };

  constructor(private readonly cacheService: RealTimeCacheService) {
    super();
    this.initializeWarmingStrategies();
    this.startWarming();
  }

  /**
   * Initialize cache warming strategies
   *
   * Three-tier approach for comprehensive cache warming:
   * 1. Critical: High frequency feeds with immediate warming
   * 2. Predictive: Access pattern-based prediction
   * 3. Maintenance: Background warming for cache health
   */
  private initializeWarmingStrategies(): void {
    this.warmingStrategies = [
      {
        name: "critical_realtime",
        enabled: true,
        priority: 1,
        targetFeeds: ENV.CACHE.WARMER.CRITICAL_TARGET_FEEDS,
        concurrency: ENV.CACHE.WARMER.CRITICAL_CONCURRENCY,
        interval: ENV.CACHE.WARMER.CRITICAL_INTERVAL_MS,
      },
      {
        name: "predictive_ml",
        enabled: true,
        priority: 2,
        targetFeeds: ENV.CACHE.WARMER.PREDICTIVE_TARGET_FEEDS,
        concurrency: ENV.CACHE.WARMER.PREDICTIVE_CONCURRENCY,
        interval: ENV.CACHE.WARMER.PREDICTIVE_INTERVAL_MS,
      },
      {
        name: "maintenance_optimized",
        enabled: true,
        priority: 3,
        targetFeeds: ENV.CACHE.WARMER.MAINTENANCE_TARGET_FEEDS,
        concurrency: ENV.CACHE.WARMER.MAINTENANCE_CONCURRENCY,
        interval: ENV.CACHE.WARMER.MAINTENANCE_INTERVAL_MS,
      },
    ];

    this.logger.log(`Initialized ${this.warmingStrategies.length} warming strategies`);
  }

  /**
   * Track feed access patterns for warming decisions
   */
  trackFeedAccess(feedId: CoreFeedId): void {
    const key = this.generateFeedKey(feedId);
    const now = Date.now();
    const existing = this.accessPatterns.get(key);

    if (existing) {
      // Update access pattern with intelligent analysis
      const timeSinceLastAccess = now - existing.lastAccessed;
      existing.accessCount++;
      existing.lastAccessed = now;

      // Calculate rolling average interval
      existing.averageInterval = (existing.averageInterval + timeSinceLastAccess) / 2;

      // Predict next access time based on pattern
      existing.predictedNextAccess = now + existing.averageInterval;

      // Update priority based on access frequency and recency
      existing.priority = this.calculatePriority(existing);
    } else {
      // Create new access pattern
      this.accessPatterns.set(key, {
        feedId,
        accessCount: 1,
        lastAccessed: now,
        averageInterval: ENV.CACHE.WARMER.DEFAULT_ACCESS_INTERVAL_MS,
        priority: 1,
        predictedNextAccess: now + ENV.CACHE.WARMER.DEFAULT_ACCESS_INTERVAL_MS,
        warmingSuccess: 0,
        warmingFailures: 0,
      });
    }

    this.logger.debug(`Tracked intelligent access pattern for ${key}`, {
      accessCount: existing?.accessCount || 1,
      averageInterval: existing?.averageInterval || ENV.CACHE.WARMER.DEFAULT_ACCESS_INTERVAL_MS,
      priority: existing?.priority || 1,
    });

    // Trigger immediate warming for high-priority feeds
    const pattern = this.accessPatterns.get(key);
    if (pattern && this.shouldWarmImmediately(pattern)) {
      // Trigger immediate warming asynchronously
      this.triggerImmediateWarming(feedId).catch(error => {
        this.logger.error(`Error in immediate warming for ${key}:`, error);
      });
    }
  }

  /**
   * Trigger immediate warming for a specific feed
   */
  private async triggerImmediateWarming(feedId: CoreFeedId): Promise<void> {
    try {
      await this.warmFeedCache(feedId);
    } catch (error) {
      this.logger.error(`Error in immediate warming for ${this.generateFeedKey(feedId)}:`, error);
    }
  }

  /**
   * Determine if a feed should be warmed immediately
   */
  private shouldWarmImmediately(pattern: FeedAccessPattern): boolean {
    // Warm immediately if:
    // 1. First access (new pattern)
    // 2. High access count (popular feed)
    // 3. Recent frequent access
    return (
      pattern.accessCount === 1 || // First access
      pattern.accessCount >= ENV.CACHE.WARMER.IMMEDIATE_THRESHOLD || // Popular feed
      pattern.averageInterval < ENV.CACHE.WARMER.FREQUENT_ACCESS_THRESHOLD_MS // Frequent access
    );
  }

  /**
   * Calculate priority score based on access patterns and recency
   */
  private calculatePriority(pattern: FeedAccessPattern): number {
    const now = Date.now();
    const timeSinceLastAccess = now - pattern.lastAccessed;
    const hoursSinceLastAccess = timeSinceLastAccess / (1000 * 60 * 60);

    // Base priority with exponential scaling
    let priority = Math.log(pattern.accessCount + 1) * ENV.CACHE.WARMER.PRIORITY_BASE_MULTIPLIER;

    // Recency boost with exponential decay
    if (hoursSinceLastAccess < 0.5) {
      priority *= ENV.CACHE.WARMER.RECENCY_BOOST_30MIN; // Triple priority for feeds accessed in last 30 minutes
    } else if (hoursSinceLastAccess < 2) {
      priority *= ENV.CACHE.WARMER.RECENCY_BOOST_2HOUR; // Higher boost for feeds accessed in last 2 hours
    } else if (hoursSinceLastAccess < 8) {
      priority *= ENV.CACHE.WARMER.RECENCY_BOOST_8HOUR; // Moderate boost for feeds accessed in last 8 hours
    }

    // Predictability scoring
    if (pattern.averageInterval < 15000) {
      priority *= ENV.CACHE.WARMER.FREQUENCY_BOOST_15SEC; // Higher boost for very frequent access patterns
    } else if (pattern.averageInterval < 60000) {
      priority *= ENV.CACHE.WARMER.FREQUENCY_BOOST_1MIN; // Boost for frequent access patterns
    }

    // Success rate adjustment with confidence intervals
    const totalAttempts = pattern.warmingSuccess + pattern.warmingFailures;
    const successRate = totalAttempts > 0 ? pattern.warmingSuccess / totalAttempts : 0.8; // Default confidence
    const confidenceMultiplier =
      ENV.CACHE.WARMER.CONFIDENCE_MULTIPLIER_MIN +
      successRate * (ENV.CACHE.WARMER.CONFIDENCE_MULTIPLIER_MAX - ENV.CACHE.WARMER.CONFIDENCE_MULTIPLIER_MIN);
    priority *= confidenceMultiplier;

    // Time decay with adaptive factors
    const adaptiveDecayRate = Math.min(
      ENV.CACHE.WARMER.DECAY_RATE_MAX_HOURS,
      Math.max(ENV.CACHE.WARMER.DECAY_RATE_MIN_HOURS, pattern.accessCount / 2)
    );
    const decayFactor = Math.exp(-hoursSinceLastAccess / adaptiveDecayRate);
    priority *= decayFactor;

    // Volume-based priority boost
    const volumeBoost = Math.min(ENV.CACHE.WARMER.VOLUME_BOOST_MAX, 1 + pattern.accessCount / 100);
    priority *= volumeBoost;

    return Math.max(ENV.CACHE.WARMER.PRIORITY_MIN, Math.min(ENV.CACHE.WARMER.PRIORITY_MAX, priority));
  }

  /**
   * Get feeds for aggressive warming (most critical feeds)
   */
  private getFeedsForAggressiveWarming(): FeedAccessPattern[] {
    const strategy = this.warmingStrategies.find(s => s.name === "critical_realtime");
    if (!strategy?.enabled) return [];

    return Array.from(this.accessPatterns.values())
      .filter(pattern => {
        const now = Date.now();
        const timeSinceLastAccess = now - pattern.lastAccessed;
        return timeSinceLastAccess < 300000 && pattern.accessCount >= 5; // Active in last 5 minutes with 5+ accesses
      })
      .sort((a, b) => b.priority - a.priority)
      .slice(0, strategy.targetFeeds);
  }

  /**
   * Get feeds for predictive warming (based on access patterns)
   */
  private getFeedsForPredictiveWarming(): FeedAccessPattern[] {
    const strategy = this.warmingStrategies.find(s => s.name === "predictive_ml");
    if (!strategy?.enabled) return [];

    const now = Date.now();

    return Array.from(this.accessPatterns.values())
      .filter(pattern => {
        // Predict feeds likely to be accessed soon
        const timeUntilPredictedAccess = pattern.predictedNextAccess - now;
        return timeUntilPredictedAccess > 0 && timeUntilPredictedAccess < 60000; // Within next minute
      })
      .sort((a, b) => a.predictedNextAccess - now - (b.predictedNextAccess - now)) // Sort by predicted access time
      .slice(0, strategy.targetFeeds);
  }

  /**
   * Get feeds for maintenance warming (general cache maintenance)
   */
  private getFeedsForMaintenanceWarming(): FeedAccessPattern[] {
    const strategy = this.warmingStrategies.find(s => s.name === "maintenance_optimized");
    if (!strategy?.enabled) return [];

    return Array.from(this.accessPatterns.values())
      .filter(pattern => {
        const now = Date.now();
        const timeSinceLastAccess = now - pattern.lastAccessed;
        return timeSinceLastAccess < 3600000; // Active in last hour
      })
      .sort((a, b) => b.priority - a.priority)
      .slice(0, strategy.targetFeeds);
  }

  /**
   * Perform aggressive warming for high-priority feeds
   */
  private async performAggressiveWarming(): Promise<void> {
    const feeds = this.getFeedsForAggressiveWarming();
    if (feeds.length === 0) return;

    const strategy = this.warmingStrategies.find(s => s.name === "critical_realtime")!;

    this.logger.debug(`Starting aggressive warming for ${feeds.length} feeds`, {
      feedCount: feeds.length,
      concurrency: strategy.concurrency,
    });

    await this.executeWarmingStrategy(feeds, strategy);
  }

  /**
   * Perform predictive warming based on access patterns
   */
  private async performPredictiveWarming(): Promise<void> {
    const feeds = this.getFeedsForPredictiveWarming();
    if (feeds.length === 0) return;

    const strategy = this.warmingStrategies.find(s => s.name === "predictive_ml")!;

    this.logger.debug(`Starting predictive warming for ${feeds.length} feeds`, {
      feedCount: feeds.length,
      concurrency: strategy.concurrency,
    });

    await this.executeWarmingStrategy(feeds, strategy);
  }

  /**
   * Perform maintenance warming for general cache health
   */
  private async performMaintenanceWarming(): Promise<void> {
    const feeds = this.getFeedsForMaintenanceWarming();
    if (feeds.length === 0) return;

    const strategy = this.warmingStrategies.find(s => s.name === "maintenance_optimized")!;

    this.logger.debug(`Starting maintenance warming for ${feeds.length} feeds`, {
      feedCount: feeds.length,
      concurrency: strategy.concurrency,
    });

    await this.executeWarmingStrategy(feeds, strategy);
  }

  /**
   * Execute warming strategy with controlled concurrency
   */
  private async executeWarmingStrategy(feeds: FeedAccessPattern[], strategy: WarmingStrategy): Promise<void> {
    const startTime = performance.now();

    try {
      const { successful, failed } = await executeWithConcurrency(
        feeds,
        async pattern => {
          const warmingStartTime = performance.now();

          try {
            await this.warmFeedCache(pattern.feedId);

            // Update success metrics
            pattern.warmingSuccess++;
            this.warmingStats.successfulWarming++;

            const warmingTime = performance.now() - warmingStartTime;
            this.warmingStats.averageWarmingTime = (this.warmingStats.averageWarmingTime + warmingTime) / 2;

            return pattern.feedId;
          } catch (error) {
            pattern.warmingFailures++;
            this.warmingStats.failedWarming++;
            throw error;
          }
        },
        {
          concurrency: strategy.concurrency,
          onError: "continue",
          logger: this.logger,
        }
      );

      const totalTime = performance.now() - startTime;
      this.warmingStats.totalWarming += feeds.length;

      this.logger.debug(`Completed ${strategy.name} warming`, {
        strategy: strategy.name,
        successful,
        failed,
        totalTime: totalTime.toFixed(2),
        averageTimePerFeed: (totalTime / feeds.length).toFixed(2),
      });
    } catch (error) {
      this.logger.error(`Error in ${strategy.name} warming:`, error);
    }
  }

  /**
   * Warm cache for a specific feed
   */
  private async warmFeedCache(feedId: CoreFeedId): Promise<void> {
    try {
      // Check if feed is already cached and fresh
      const existing = this.cacheService.getPrice(feedId);
      if (existing && this.isCacheFresh(existing)) {
        return; // Already fresh, no need to warm
      }

      // Fetch fresh data from data sources
      const freshData = await this.fetchFreshData(feedId);

      if (freshData) {
        this.cacheService.setPrice(feedId, freshData);

        this.logger.debug(`Successfully warmed cache for ${this.generateFeedKey(feedId)}`, {
          price: freshData.value,
          confidence: freshData.confidence,
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Error warming cache for ${this.generateFeedKey(feedId)}:`, error);
      throw new Error(`Failed to warm cache for ${this.generateFeedKey(feedId)}: ${errorMessage}`);
    }
  }

  /**
   * Check if cached data is fresh enough
   */
  private isCacheFresh(cacheEntry: CacheEntry): boolean {
    const age = Date.now() - cacheEntry.timestamp;
    return age < ENV.CACHE.FRESHNESS_CHECK_MS; // Very aggressive freshness check
  }

  /**
   * Fetch fresh data from data sources
   */
  private async fetchFreshData(feedId: CoreFeedId): Promise<CacheEntry | null> {
    if (this.dataSourceCallback) {
      try {
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
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        this.logger.error(`Error fetching fresh data for ${this.generateFeedKey(feedId)}: ${errorMessage}`);
        throw error;
      }
    }

    // Fallback to mock data if no callback is configured
    return {
      value: Math.random() * 50000,
      timestamp: Date.now(),
      sources: ["mock-source"],
      confidence: 0.95,
    };
  }

  /**
   * Set data source callback
   */
  setDataSourceCallback(callback: (feedId: CoreFeedId) => Promise<AggregatedPrice | null>): void {
    this.dataSourceCallback = callback;
    this.logger.log("Data source callback configured for cache warming");
  }

  /**
   * Start intelligent warming with multiple strategies
   */
  private startWarming(): void {
    // Aggressive warming for high-priority feeds using managed intervals
    this.createInterval(async () => {
      try {
        await this.performAggressiveWarming();
      } catch (error) {
        this.logger.error("Error in aggressive warming:", error);
      }
    }, ENV.CACHE.WARMER.AGGRESSIVE_INTERVAL_MS);

    // Predictive warming based on access patterns using managed intervals
    this.createInterval(async () => {
      try {
        await this.performPredictiveWarming();
      } catch (error) {
        this.logger.error("Error in predictive warming:", error);
      }
    }, ENV.CACHE.WARMER.PREDICTIVE_INTERVAL_MS);

    // Maintenance warming for general cache health using managed intervals
    this.createInterval(async () => {
      try {
        await this.performMaintenanceWarming();
        this.cleanupStalePatterns();
      } catch (error) {
        this.logger.error("Error in maintenance warming:", error);
      }
    }, ENV.CACHE.WARMER.MAINTENANCE_INTERVAL_MS);

    this.logger.log("Cache warming started with multiple strategies");
  }

  /**
   * Clean up stale access patterns
   */
  private cleanupStalePatterns(): void {
    const now = Date.now();
    const staleThreshold = ENV.CACHE.STALE_PATTERN_THRESHOLD_MS;
    let cleanedCount = 0;

    this.accessPatterns.forEach((pattern, key) => {
      if (now - pattern.lastAccessed > staleThreshold) {
        this.accessPatterns.delete(key);
        cleanedCount++;
      }
    });

    if (cleanedCount > 0) {
      this.logger.debug(`Cleaned up ${cleanedCount} stale access patterns`);
    }
  }

  /**
   * Get warming statistics
   */
  getWarmupStats(): {
    totalPatterns: number;
    activePatterns: number;
    warmingStats: {
      totalWarming: number;
      successfulWarming: number;
      failedWarming: number;
      averageWarmingTime: number;
      cacheHitImprovement: number;
    };
    strategies: WarmingStrategy[];
    topFeeds: Array<{ feedId: string; priority: number; accessCount: number }>;
  } {
    const now = Date.now();
    const activePatterns = Array.from(this.accessPatterns.values()).filter(
      pattern => now - pattern.lastAccessed < ENV.CACHE.ACTIVE_PATTERN_THRESHOLD_MS
    ); // Active in threshold period

    const topFeeds = Array.from(this.accessPatterns.values())
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 10)
      .map(pattern => ({
        feedId: this.generateFeedKey(pattern.feedId),
        priority: pattern.priority,
        accessCount: pattern.accessCount,
      }));

    return {
      totalPatterns: this.accessPatterns.size,
      activePatterns: activePatterns.length,
      warmingStats: { ...this.warmingStats },
      strategies: [...this.warmingStrategies],
      topFeeds,
    };
  }

  private generateFeedKey(feedId: CoreFeedId): string {
    return `${feedId.category}:${feedId.name}`;
  }

  /**
   * Stop intelligent warming and cleanup
   */
  override async cleanup(): Promise<void> {
    // Managed intervals are automatically cleaned up by lifecycle mixin
    this.accessPatterns.clear();
    this.logger.log("Cache warmer service destroyed");
  }
}
