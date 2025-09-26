import { Injectable } from "@nestjs/common";
import { StandardService } from "./common/base/composed.service";
import { RealTimeCacheService } from "./cache/real-time-cache.service";
import { RealTimeAggregationService, type IAggregationCacheStats } from "./aggregators/real-time-aggregation.service";

import type { AggregationStatistics, HealthCheckResult, HealthStatusType } from "./common/types/monitoring";
import type { FeedId, FeedValueData, FeedVolumeData } from "./common/types/http";
import type { CoreFeedId } from "./common/types/core";
import type { CacheStats } from "./common/types/cache";
import type {
  AggregatedPrice,
  IFtsoProviderService,
  ServiceHealthStatus,
  ServicePerformanceMetrics,
  IntegrationServiceInterface,
} from "./common/types/services";

@Injectable()
export class FtsoProviderService extends StandardService implements IFtsoProviderService {
  // Require both the public integration interface and the specific ops we use
  private integrationService?: IntegrationServiceInterface & IntegrationOps;

  constructor(
    private readonly cacheService: RealTimeCacheService,
    private readonly aggregationService: RealTimeAggregationService
  ) {
    super({ useEnhancedLogging: true });
  }

  // Method to set the integration service (called by the factory)
  setIntegrationService(integrationService: IntegrationServiceInterface): void {
    if (hasIntegrationOps(integrationService)) {
      this.integrationService = integrationService;
      this.logInitialization("Production integration service connected");
    } else {
      this.logError(new Error("Integration service does not implement required operations"), "setIntegrationService");
      throw new Error("Invalid integration service: missing required operations");
    }
  }

  async getValue(feed: FeedId): Promise<FeedValueData> {
    this.startTimer("getValue");

    try {
      // Always use production integration service
      if (!this.integrationService) {
        throw new Error("Production integration service not available");
      }

      const coreFeedId: CoreFeedId = {
        category: feed.category,
        name: feed.name,
      };

      const aggregatedPrice = await this.integrationService.getCurrentPrice(coreFeedId);

      const responseTime = this.endTimer("getValue");
      this.logPerformance(`getValue-${feed.name}`, responseTime);

      return {
        feed,
        value: aggregatedPrice.price,
      };
    } catch (error) {
      const responseTime = this.endTimer("getValue");
      this.logError(error instanceof Error ? error : new Error(String(error)), `getValue-${feed.name}`, {
        responseTime: responseTime.toFixed(2),
      });
      throw error;
    }
  }

  async getValues(feeds: FeedId[]): Promise<FeedValueData[]> {
    this.startTimer("getValues");

    try {
      // Always use production integration service
      if (!this.integrationService) {
        throw new Error("Production integration service not available");
      }

      const coreFeedIds: CoreFeedId[] = feeds.map(feed => ({
        category: feed.category,
        name: feed.name,
      }));

      const aggregatedPrices = await this.integrationService.getCurrentPrices(coreFeedIds);

      const results: FeedValueData[] = aggregatedPrices.map((price, index) => ({
        feed: feeds[index],
        value: price.price,
      }));

      const responseTime = this.endTimer("getValues");
      this.logPerformance(`getValues-${feeds.length}feeds`, responseTime);

      return results;
    } catch (error) {
      const responseTime = this.endTimer("getValues");
      this.logError(error instanceof Error ? error : new Error(String(error)), "getValues", {
        feedCount: feeds.length,
        responseTime: responseTime.toFixed(2),
      });
      throw error;
    }
  }

  async getVolumes(feeds: FeedId[], volumeWindow: number): Promise<FeedVolumeData[]> {
    this.startTimer("getVolumes");

    try {
      // Production integration mode - volume data would be handled by the integration service
      // For now, return empty volumes as this functionality is not yet implemented
      this.logger.debug("Volume data not yet implemented in production integration mode - returning empty volumes");

      const responseTime = this.endTimer("getVolumes");
      this.logPerformance(`getVolumes-${feeds.length}feeds-${volumeWindow}s`, responseTime);

      return feeds.map(feed => ({
        feed,
        volumes: [],
      }));
    } catch (error) {
      const responseTime = this.endTimer("getVolumes");
      this.logError(error instanceof Error ? error : new Error(String(error)), "getVolumes", {
        feedCount: feeds.length,
        volumeWindow,
        responseTime: responseTime.toFixed(2),
      });
      throw error;
    }
  }

  // Helper methods
  // Performance monitoring methods

  async getPerformanceMetrics(): Promise<
    ServicePerformanceMetrics & {
      cacheStats: CacheStats;
      aggregationStats: AggregationStatistics;
      activeFeedCount: number;
    }
  > {
    const uptime = process.uptime();

    return {
      uptime,
      responseTime: {
        average: 50, // Mock values - should be calculated from actual metrics
        p95: 150,
        max: 200,
      },
      requestsPerSecond: 100, // Mock value
      errorRate: 0.01, // Mock value
      cacheStats: this.mapCacheStats(this.cacheService.getStats()),
      aggregationStats: this.mapAggregationStats(this.aggregationService.getCacheStats()),
      activeFeedCount: this.aggregationService.getActiveFeedCount(),
    };
  }

  // Health check method
  async healthCheck(): Promise<ServiceHealthStatus> {
    try {
      // Always use production integration health check
      if (!this.integrationService) {
        const now = Date.now();
        const details: HealthCheckResult = {
          isHealthy: false,
          timestamp: now,
          details: {
            component: "integration",
            status: "unhealthy" as HealthStatusType,
            timestamp: now,
          },
        };
        return { status: "unhealthy", timestamp: now, details: [details] };
      }

      const systemHealth = await this.integrationService.getSystemHealth();
      const now = Date.now();
      const details: HealthCheckResult = {
        isHealthy: systemHealth.status === "healthy",
        timestamp: now,
        details: {
          component: "integration",
          status: systemHealth.status as HealthStatusType,
          timestamp: now,
          connections: systemHealth.connections,
          adapters: systemHealth.adapters,
          metrics: {
            uptime: process.uptime(),
            memoryUsage: process.memoryUsage().rss,
            cpuUsage: 0,
            connectionCount: systemHealth.connections,
          },
        },
      };
      return { status: systemHealth.status, timestamp: now, details: [details] };
    } catch (error) {
      this.logError(error instanceof Error ? error : new Error(String(error)), "healthCheck");
      const now = Date.now();
      const details: HealthCheckResult = {
        isHealthy: false,
        timestamp: now,
        details: {
          component: "integration",
          status: "unhealthy" as HealthStatusType,
          timestamp: now,
        },
      };
      return { status: "unhealthy", timestamp: now, details: [details] };
    }
  }

  // Helper methods for type mapping
  private mapCacheStats(cacheStats: CacheStats): CacheStats {
    return {
      hitRate: cacheStats.hitRate || 0,
      missRate: cacheStats.missRate || 0,
      size: cacheStats.totalEntries || 0,
      evictions: 0, // Not tracked in current implementation
      averageGetTime: 0, // Not tracked in current implementation
      averageSetTime: 0, // Not tracked in current implementation
      averageResponseTime: cacheStats.averageResponseTime || 0,
      memoryUsage: cacheStats.memoryUsage || 0,
      totalRequests: cacheStats.totalRequests || 0,
      hits: cacheStats.hits || 0,
      misses: cacheStats.misses || 0,
      totalEntries: cacheStats.totalEntries || 0,
    };
  }

  private mapAggregationStats(cacheStats: IAggregationCacheStats): AggregationStatistics {
    return {
      totalAggregations: 0, // Not tracked in current implementation
      averageAggregationTime: 0, // Not tracked in current implementation
      sourceCount: cacheStats.totalEntries || 0,
      consensusRate: cacheStats.hitRate || 0,
      qualityScore: cacheStats.hitRate || 0,
    };
  }

  async getServicePerformanceMetrics(): Promise<ServicePerformanceMetrics> {
    // Convert to standardized format
    return {
      uptime: process.uptime(),
      responseTime: {
        average: 0,
        p95: 0,
        max: 0,
      },
      requestsPerSecond: 0,
      errorRate: 0,
    };
  }

  getServiceName(): string {
    return "FtsoProviderService";
  }
}

// Local minimal integration operations we rely on
type IntegrationOps = {
  getCurrentPrice(feedId: CoreFeedId): Promise<AggregatedPrice>;
  getCurrentPrices(feedIds: CoreFeedId[]): Promise<AggregatedPrice[]>;
  getSystemHealth(): Promise<{
    status: HealthStatusType;
    connections: number;
    adapters: number;
    cache: { hitRate: number; entries: number };
  }>;
};

function hasIntegrationOps(svc: IntegrationServiceInterface): svc is IntegrationServiceInterface & IntegrationOps {
  return (
    typeof (svc as unknown as { getCurrentPrice?: unknown }).getCurrentPrice === "function" &&
    typeof (svc as unknown as { getCurrentPrices?: unknown }).getCurrentPrices === "function" &&
    typeof (svc as unknown as { getSystemHealth?: unknown }).getSystemHealth === "function"
  );
}
