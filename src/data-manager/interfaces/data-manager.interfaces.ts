import { EnhancedFeedId } from "@/types";
import { PriceUpdate, DataSource } from "@/interfaces";
import { AggregatedPrice } from "@/aggregators/base/aggregation.interfaces";

export interface ProductionDataManager {
  // Connection management
  addDataSource(source: DataSource): Promise<void>;
  removeDataSource(sourceId: string): Promise<void>;
  getConnectedSources(): DataSource[];

  // Data retrieval
  getCurrentPrice(feedId: EnhancedFeedId): Promise<AggregatedPrice>;
  getCurrentPrices(feedIds: EnhancedFeedId[]): Promise<AggregatedPrice[]>;

  // Real-time data management
  subscribeToFeed(feedId: EnhancedFeedId): Promise<void>;
  unsubscribeFromFeed(feedId: EnhancedFeedId): Promise<void>;

  // Health monitoring
  getConnectionHealth(): Promise<ConnectionHealth>;
  getDataFreshness(feedId: EnhancedFeedId): Promise<number>;
}

export interface ConnectionHealth {
  totalSources: number;
  connectedSources: number;
  averageLatency: number;
  failedSources: string[];
  healthScore: number;
}

export interface RealTimeDataManager {
  // Maximum data age enforcement (Requirement 6.1)
  maxDataAge: 2000; // milliseconds

  // Cache TTL limits (Requirement 6.2)
  maxCacheTTL: 1000; // milliseconds

  // Real-time prioritization (Requirement 6.3)
  prioritizeRealTimeData(): boolean;

  // Immediate processing (Requirement 6.4)
  processUpdateImmediately(update: PriceUpdate): void;

  // Historical data management (Requirement 6.5)
  maintainVotingRoundHistory(rounds: number): void;
}

export interface DataFreshnessPolicy {
  // Reject stale data beyond threshold
  rejectStaleData: true;
  staleThresholdMs: 2000;

  // Prioritize real-time over cached
  realTimePriority: true;
  cacheBypassOnFreshData: true;

  // Immediate webhook/stream processing
  immediateProcessing: true;
  streamingConnectionPreferred: true;

  // Voting round precision
  preciseTimestamps: true;
  votingRoundTracking: true;
}
