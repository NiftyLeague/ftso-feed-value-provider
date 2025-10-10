/**
 * Aggregation service type definitions
 */

import { CoreFeedId } from "../core/feed.types";
import { PriceUpdate } from "../core/data-source.types";
import { IBaseService } from "./base.types";

export interface AggregatedPrice {
  symbol: string;
  price: number;
  timestamp: number;
  sources: string[];
  confidence: number;
  consensusScore: number;
  votingRound?: number;
}

export interface QualityMetrics {
  accuracy: number; // Distance from consensus median
  latency: number; // Data freshness
  coverage: number; // Number of active sources
  reliability: number; // Historical uptime
  consensusAlignment: number; // How well aligned with expected consensus
}

export interface AggregationConfig {
  enabled: boolean;
  method: "weighted_median" | "consensus_optimized" | "median" | "mean" | "weighted";
  timeDecayFactor: number;
  minSources: number;
  maxStaleness: number;
  maxDeviation: number;
  timeout: number;
}

export interface PriceAggregator {
  aggregate(feedId: CoreFeedId, updates: PriceUpdate[]): Promise<AggregatedPrice>;
  getQualityMetrics(feedId: CoreFeedId): Promise<QualityMetrics>;
  validateUpdate(update: PriceUpdate): boolean;
}

/**
 * Interface for Price Aggregation Service
 * Defines methods for real-time price aggregation and caching
 
 */
export interface IAggregationService extends IBaseService {
  /**
   * Get aggregated price for a feed with real-time caching
   * @param feedId - Enhanced feed identifier
   * @returns Promise resolving to aggregated price or null if unavailable
   */
  getAggregatedPrice(feedId: CoreFeedId): Promise<AggregatedPrice | null>;

  /**
   * Add new price update and trigger real-time recalculation
   * @param feedId - Enhanced feed identifier
   * @param update - Price update data
   */
  addPriceUpdate(feedId: CoreFeedId, update: PriceUpdate): void;

  /**
   * Subscribe to real-time price updates for a feed
   * @param feedId - Enhanced feed identifier
   * @param callback - Callback function for price updates
   * @returns Unsubscribe function
   */
  subscribe(feedId: CoreFeedId, callback: (price: AggregatedPrice) => void): () => void;

  /**
   * Get quality metrics for aggregated price
   * @param feedId - Enhanced feed identifier
   * @returns Promise resolving to quality metrics
   */
  getQualityMetrics(feedId: CoreFeedId): Promise<QualityMetrics>;

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
