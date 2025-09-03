import { AggregatedPrice } from "../services";
import { DataSource, EnhancedFeedId } from "../core";
import { ConnectionHealth } from "./connection.types";

/**
 * Defines the contract for the production-level data manager.
 *
 * This interface centralizes data retrieval, subscription management, and health
 * monitoring for all data sources, ensuring a unified approach to data handling.
 */
export interface ProductionDataManager {
  addDataSource(source: DataSource): Promise<void>;
  removeDataSource(sourceId: string): Promise<void>;
  getConnectedSources(): DataSource[];
  getCurrentPrice(feedId: EnhancedFeedId): Promise<AggregatedPrice>;
  getCurrentPrices(feedIds: EnhancedFeedId[]): Promise<AggregatedPrice[]>;
  subscribeToFeed(feedId: EnhancedFeedId): Promise<void>;
  unsubscribeFromFeed(feedId: EnhancedFeedId): Promise<void>;
  getConnectionHealth(): Promise<ConnectionHealth>;
  getDataFreshness(feedId: EnhancedFeedId): Promise<number>;
}

/**
 * Specifies the policy for data freshness, ensuring that the system uses
 * timely and relevant data.
 */
export interface DataFreshnessPolicy {
  rejectStaleData: boolean;
  staleThresholdMs: number;
  realTimePriority: boolean;
  cacheBypassOnFreshData: boolean;
}

/**
 * Defines the context for errors that occur within the data manager.
 *
 * This interface provides detailed information for logging, debugging, and
 * alerting on data-related issues.
 */
export interface DataManagerErrorContext {
  sourceId: string;
  operation: string;
  timestamp: number;
  errorType: "CONNECTION" | "DATA" | "TIMEOUT" | "VALIDATION" | "UNKNOWN";
  severity: "low" | "medium" | "high" | "critical";
  recoverable: boolean;
  metadata?: Record<string, unknown>;
}
