import { AggregatedPrice } from "../services";
import { DataSource, CoreFeedId } from "../core";
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
  getCurrentPrice(feedId: CoreFeedId): Promise<AggregatedPrice>;
  getCurrentPrices(feedIds: CoreFeedId[]): Promise<AggregatedPrice[]>;
  subscribeToFeed(feedId: CoreFeedId): Promise<void>;
  unsubscribeFromFeed(feedId: CoreFeedId): Promise<void>;
  getConnectionHealth(): Promise<ConnectionHealth>;
  getDataFreshness(feedId: CoreFeedId): Promise<number>;
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
