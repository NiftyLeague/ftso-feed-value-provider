/**
 * Provider service type definitions
 */

import type { FeedId, FeedValueData, FeedVolumeData } from "../http";
import type { IBaseService, ServicePerformanceMetrics, ServiceHealthStatus } from "./base.types";
import type { AggregationStatistics } from "../monitoring";
import type { CacheStats } from "../cache";

export interface IntegrationServiceInterface {
  isHealthy(): boolean;
  getStatus(): string;
  getMetrics(): Record<string, number | string>;
}

/**
 * Interface for the main FTSO Provider Service
 * Defines the core business logic for feed value provision
 
 */
export interface IFtsoProviderService extends IBaseService {
  /**
   * Get current value for a single feed
   * @param feed - Feed identifier
   * @returns Promise resolving to feed value data
   */
  getValue(feed: FeedId): Promise<FeedValueData>;

  /**
   * Get current values for multiple feeds
   * @param feeds - Array of feed identifiers
   * @returns Promise resolving to array of feed value data
   */
  getValues(feeds: FeedId[]): Promise<FeedValueData[]>;

  /**
   * Get volume data for feeds within a time window
   * @param feeds - Array of feed identifiers
   * @param volumeWindow - Time window in seconds
   * @returns Promise resolving to array of feed volume data
   */
  getVolumes(feeds: FeedId[], volumeWindow: number): Promise<FeedVolumeData[]>;

  /**
   * Perform health check on the service
   * @returns Promise resolving to health status
   */
  healthCheck(): Promise<ServiceHealthStatus>;

  /**
   * Get performance metrics for the service
   * @returns Promise resolving to performance metrics
   */
  getPerformanceMetrics(): Promise<
    ServicePerformanceMetrics & {
      cacheStats: CacheStats;
      aggregationStats: AggregationStatistics;
      activeFeedCount: number;
    }
  >;

  /**
   * Set the integration service (for dependency injection)
   * @param integrationService - Integration service instance
   */
  setIntegrationService(integrationService: IntegrationServiceInterface): void;
}
