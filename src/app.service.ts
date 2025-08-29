import { Injectable, Logger } from "@nestjs/common";
import { FeedId, FeedValueData, FeedVolumeData } from "@/dto/provider-requests.dto";
import { BaseDataFeed } from "@/data-feeds/base-feed";
import { RealTimeCacheService } from "@/cache/real-time-cache.service";
import { RealTimeAggregationService } from "@/aggregators/real-time-aggregation.service";

@Injectable()
export class FtsoProviderService {
  private readonly logger = new Logger(FtsoProviderService.name);

  constructor(
    private readonly dataFeed: BaseDataFeed,
    private readonly cacheService: RealTimeCacheService,
    private readonly aggregationService: RealTimeAggregationService
  ) {}

  async getValue(feed: FeedId): Promise<FeedValueData> {
    const startTime = performance.now();

    try {
      // Check cache first for real-time data
      const cachedPrice = this.cacheService.getPrice(feed);

      if (cachedPrice && this.isFreshData(cachedPrice.timestamp)) {
        const responseTime = performance.now() - startTime;
        this.logger.debug(`Cache hit for ${feed.name}: ${responseTime.toFixed(2)}ms`);

        return {
          feed,
          value: cachedPrice.value,
        };
      }

      // Get fresh data from aggregation service
      const aggregatedPrice = await this.aggregationService.getAggregatedPrice(feed);

      if (aggregatedPrice) {
        // Cache the fresh data
        this.cacheService.setPrice(feed, {
          value: aggregatedPrice.price,
          timestamp: aggregatedPrice.timestamp,
          sources: aggregatedPrice.sources,
          confidence: aggregatedPrice.confidence,
        });

        const responseTime = performance.now() - startTime;
        this.logger.debug(`Aggregated price for ${feed.name}: ${responseTime.toFixed(2)}ms`);

        return {
          feed,
          value: aggregatedPrice.price,
        };
      }

      // Fallback to base data feed
      const result = await this.dataFeed.getValue(feed);
      const responseTime = performance.now() - startTime;

      this.logger.debug(`Fallback data feed for ${feed.name}: ${responseTime.toFixed(2)}ms`);

      return result;
    } catch (error) {
      const responseTime = performance.now() - startTime;
      this.logger.error(`Error getting value for ${feed.name} (${responseTime.toFixed(2)}ms):`, error);

      // Final fallback to base data feed
      return this.dataFeed.getValue(feed);
    }
  }

  async getValues(feeds: FeedId[]): Promise<FeedValueData[]> {
    const startTime = performance.now();

    try {
      // Process feeds in parallel for better performance
      const promises = feeds.map(feed => this.getValue(feed));
      const results = await Promise.all(promises);

      const responseTime = performance.now() - startTime;
      this.logger.debug(`Got ${feeds.length} feed values in ${responseTime.toFixed(2)}ms`);

      return results;
    } catch (error) {
      const responseTime = performance.now() - startTime;
      this.logger.error(`Error getting multiple values (${responseTime.toFixed(2)}ms):`, error);

      // Fallback to base data feed
      return this.dataFeed.getValues(feeds);
    }
  }

  async getVolumes(feeds: FeedId[], volumeWindow: number): Promise<FeedVolumeData[]> {
    const startTime = performance.now();

    try {
      // Use existing CCXT volume processing with USDT conversion
      const results = await this.dataFeed.getVolumes(feeds, volumeWindow);

      const responseTime = performance.now() - startTime;
      this.logger.debug(
        `Got volumes for ${feeds.length} feeds (${volumeWindow}s window) in ${responseTime.toFixed(2)}ms`
      );

      // Log performance warning if exceeding target
      if (responseTime > 100) {
        this.logger.warn(
          `Volume processing took ${responseTime.toFixed(2)}ms, exceeding 100ms target for ${feeds.length} feeds`
        );
      }

      return results;
    } catch (error) {
      const responseTime = performance.now() - startTime;
      this.logger.error(`Error getting volumes (${responseTime.toFixed(2)}ms):`, error);
      throw error;
    }
  }

  // Helper methods

  private isFreshData(timestamp: number): boolean {
    const age = Date.now() - timestamp;
    return age <= 2000; // 2-second freshness requirement
  }

  // Performance monitoring methods

  async getPerformanceMetrics(): Promise<{
    cacheStats: any;
    aggregationStats: any;
    activeFeedCount: number;
  }> {
    return {
      cacheStats: this.cacheService.getStats(),
      aggregationStats: this.aggregationService.getCacheStats(),
      activeFeedCount: this.aggregationService.getActiveFeedCount(),
    };
  }

  // Health check method
  async healthCheck(): Promise<{
    status: "healthy" | "degraded" | "unhealthy";
    details: any;
  }> {
    try {
      const cacheStats = this.cacheService.getStats();
      const aggregationStats = this.aggregationService.getCacheStats();

      // Determine health based on cache hit rate and response times
      const isHealthy = cacheStats.hitRate > 0.5 && aggregationStats.averageAge < 5000;

      return {
        status: isHealthy ? "healthy" : "degraded",
        details: {
          cache: cacheStats,
          aggregation: aggregationStats,
          timestamp: Date.now(),
        },
      };
    } catch (error) {
      this.logger.error("Health check failed:", error);
      return {
        status: "unhealthy",
        details: {
          error: error.message,
          timestamp: Date.now(),
        },
      };
    }
  }
}
