import { EnhancedFeedId } from "@/types/enhanced-feed-id.types";
import { PriceUpdate } from "@/interfaces/data-source.interface";

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
  method: "weighted_median" | "consensus_optimized";
  timeDecayFactor: number;
  minSources: number;
  maxStaleness: number;
}

export interface ValidationConfig {
  maxAge: number; // 2000ms
  priceRange: { min: number; max: number };
  outlierThreshold: number;
  consensusWeight: number;
}

export interface PriceAggregator {
  aggregate(feedId: EnhancedFeedId, updates: PriceUpdate[]): Promise<AggregatedPrice>;
  getQualityMetrics(feedId: EnhancedFeedId): Promise<QualityMetrics>;
  validateUpdate(update: PriceUpdate): boolean;
}
