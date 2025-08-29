import { Injectable, Logger } from "@nestjs/common";
import { FeedId, FeedValueData, FeedVolumeData } from "@/dto/provider-requests.dto";
import { RealTimeCacheService } from "@/cache/real-time-cache.service";
import { RealTimeAggregationService } from "@/aggregators/real-time-aggregation.service";
import { ProductionIntegrationService } from "@/integration/production-integration.service";
import { EnhancedFeedId } from "@/types";

@Injectable()
export class FtsoProviderService {
  private readonly logger = new Logger(FtsoProviderService.name);
  private integrationService?: ProductionIntegrationService;

  constructor(
    private readonly cacheService: RealTimeCacheService,
    private readonly aggregationService: RealTimeAggregationService
  ) {}

  // Method to set the integration service (called by the factory)
  setIntegrationService(integrationService: ProductionIntegrationService): void {
    this.integrationService = integrationService;
    this.logger.log("Production integration service connected");
  }

  async getValue(feed: FeedId): Promise<FeedValueData> {
    const startTime = performance.now();

    try {
      // Always use production integration service
      if (!this.integrationService) {
        throw new Error("Production integration service not available");
      }

      const enhancedFeedId: EnhancedFeedId = {
        category: feed.category,
        name: feed.name,
      };

      const aggregatedPrice = await this.integrationService.getCurrentPrice(enhancedFeedId);

      const responseTime = performance.now() - startTime;
      this.logger.debug(`Production integration for ${feed.name}: ${responseTime.toFixed(2)}ms`);

      return {
        feed,
        value: aggregatedPrice.price,
      };
    } catch (error) {
      const responseTime = performance.now() - startTime;
      this.logger.error(`Error getting value for ${feed.name} (${responseTime.toFixed(2)}ms):`, error);
      throw error;
    }
  }

  async getValues(feeds: FeedId[]): Promise<FeedValueData[]> {
    const startTime = performance.now();

    try {
      // Always use production integration service
      if (!this.integrationService) {
        throw new Error("Production integration service not available");
      }

      const enhancedFeedIds: EnhancedFeedId[] = feeds.map(feed => ({
        category: feed.category,
        name: feed.name,
      }));

      const aggregatedPrices = await this.integrationService.getCurrentPrices(enhancedFeedIds);

      const results: FeedValueData[] = aggregatedPrices.map((price, index) => ({
        feed: feeds[index],
        value: price.price,
      }));

      const responseTime = performance.now() - startTime;
      this.logger.debug(`Production integration for ${feeds.length} feeds: ${responseTime.toFixed(2)}ms`);

      return results;
    } catch (error) {
      const responseTime = performance.now() - startTime;
      this.logger.error(`Error getting multiple values (${responseTime.toFixed(2)}ms):`, error);
      throw error;
    }
  }

  async getVolumes(feeds: FeedId[], volumeWindow: number): Promise<FeedVolumeData[]> {
    const startTime = performance.now();

    try {
      // Production integration mode - volume data would be handled by the integration service
      // For now, return empty volumes as this functionality is not yet implemented
      this.logger.warn("Volume data not yet implemented in production integration mode");

      const responseTime = performance.now() - startTime;
      this.logger.debug(
        `Volume request for ${feeds.length} feeds (${volumeWindow}s window) processed in ${responseTime.toFixed(2)}ms`
      );

      return feeds.map(feed => ({
        feed,
        volumes: [],
      }));
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
      // Always use production integration health check
      if (!this.integrationService) {
        return {
          status: "unhealthy",
          details: {
            error: "Production integration service not available",
            timestamp: Date.now(),
          },
        };
      }

      const systemHealth = await this.integrationService.getSystemHealth();
      return {
        status: systemHealth.status,
        details: systemHealth,
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
