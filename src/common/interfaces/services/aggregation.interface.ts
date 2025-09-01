import { AggregatedPrice, QualityMetrics } from "@/aggregators/base/aggregation.interfaces";
import { EnhancedFeedId } from "../../types/feed.types";
import { PriceUpdate } from "../core/data-source.interface";
import { IBaseService } from "../common.interface";

/**
 * Interface for Price Aggregation Service
 * Defines methods for real-time price aggregation and caching
 * Requirements: 3.3, 3.4, 4.1, 4.2
 */
export interface IAggregationService extends IBaseService {
  /**
   * Get aggregated price for a feed with real-time caching
   * @param feedId - Enhanced feed identifier
   * @returns Promise resolving to aggregated price or null if unavailable
   */
  getAggregatedPrice(feedId: EnhancedFeedId): Promise<AggregatedPrice | null>;

  /**
   * Add new price update and trigger real-time recalculation
   * @param feedId - Enhanced feed identifier
   * @param update - Price update data
   */
  addPriceUpdate(feedId: EnhancedFeedId, update: PriceUpdate): void;

  /**
   * Subscribe to real-time price updates for a feed
   * @param feedId - Enhanced feed identifier
   * @param callback - Callback function for price updates
   * @returns Unsubscribe function
   */
  subscribe(feedId: EnhancedFeedId, callback: (price: AggregatedPrice) => void): () => void;

  /**
   * Get quality metrics for aggregated price
   * @param feedId - Enhanced feed identifier
   * @returns Promise resolving to quality metrics
   */
  getQualityMetrics(feedId: EnhancedFeedId): Promise<QualityMetrics>;

  /**
   * Get cache statistics
   * @returns Cache statistics object
   */
  getCacheStats(): {
    totalEntries: number;
    hitRate: number;
    missRate: number;
    evictionCount: number;
    averageAge: number;
  };

  /**
   * Get active feed count
   * @returns Number of active feeds
   */
  getActiveFeedCount(): number;

  /**
   * Process price update and trigger aggregation
   * @param update - Price update to process
   * @returns Promise that resolves when processing is complete
   */
  processPriceUpdate(update: PriceUpdate): Promise<void>;

  /**
   * Clear all cached data
   */
  clearCache(): void;
}
