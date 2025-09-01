import { Injectable } from "@nestjs/common";
import { BaseService } from "@/common/base/base.service";
import { FeedId, FeedValueData, FeedVolumeData } from "@/dto/provider-requests.dto";
import { RealTimeCacheService } from "@/cache/real-time-cache.service";
import { RealTimeAggregationService } from "@/aggregators/real-time-aggregation.service";
import { IntegrationService } from "@/integration/integration.service";
import { EnhancedFeedId } from "@/types";
import { IFtsoProviderService, ServiceHealthStatus, ServicePerformanceMetrics } from "@/interfaces/service.interfaces";

@Injectable()
export class FtsoProviderService extends BaseService implements IFtsoProviderService {
  private integrationService?: IntegrationService;

  constructor(
    private readonly cacheService: RealTimeCacheService,
    private readonly aggregationService: RealTimeAggregationService
  ) {
    super("FtsoProviderService", true); // Enable enhanced logging
  }

  // Method to set the integration service (called by the factory)
  setIntegrationService(integrationService: IntegrationService): void {
    this.integrationService = integrationService;
    this.logInitialization("Production integration service connected");
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
      this.logPerformance(`getValue-${feed.name}`, responseTime);

      return {
        feed,
        value: aggregatedPrice.price,
      };
    } catch (error) {
      const responseTime = performance.now() - startTime;
      this.logError(error as Error, `getValue-${feed.name}`, { responseTime: responseTime.toFixed(2) });
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
      this.logPerformance(`getValues-${feeds.length}feeds`, responseTime);

      return results;
    } catch (error) {
      const responseTime = performance.now() - startTime;
      this.logError(error as Error, "getValues", {
        feedCount: feeds.length,
        responseTime: responseTime.toFixed(2),
      });
      throw error;
    }
  }

  async getVolumes(feeds: FeedId[], volumeWindow: number): Promise<FeedVolumeData[]> {
    const startTime = performance.now();

    try {
      // Production integration mode - volume data would be handled by the integration service
      // For now, return empty volumes as this functionality is not yet implemented
      this.logWarning("Volume data not yet implemented in production integration mode", "getVolumes");

      const responseTime = performance.now() - startTime;
      this.logPerformance(`getVolumes-${feeds.length}feeds-${volumeWindow}s`, responseTime);

      return feeds.map(feed => ({
        feed,
        volumes: [],
      }));
    } catch (error) {
      const responseTime = performance.now() - startTime;
      this.logError(error as Error, "getVolumes", {
        feedCount: feeds.length,
        volumeWindow,
        responseTime: responseTime.toFixed(2),
      });
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
      this.logError(error as Error, "healthCheck");
      return {
        status: "unhealthy",
        details: {
          error: error.message,
          timestamp: Date.now(),
        },
      };
    }
  }

  // IBaseService interface methods
  async getHealthStatus(): Promise<ServiceHealthStatus> {
    const healthCheck = await this.healthCheck();
    return {
      status: healthCheck.status,
      timestamp: Date.now(),
      details: healthCheck.details,
    };
  }

  async getServicePerformanceMetrics(): Promise<ServicePerformanceMetrics> {
    // Convert to standardized format
    return {
      responseTime: {
        average: 0, // Would be calculated from actual metrics
        min: 0,
        max: 0,
      },
      throughput: {
        requestsPerSecond: 0, // Would be calculated from actual metrics
        totalRequests: 0,
      },
      errorRate: 0, // Would be calculated from actual metrics
      uptime: Date.now(), // Would track actual uptime
    };
  }

  getServiceName(): string {
    return "FtsoProviderService";
  }
}
