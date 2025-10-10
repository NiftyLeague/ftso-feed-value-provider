/**
 * Hybrid error handling types
 */

import type { CoreFeedId } from "@/common/types/core";

export enum DataSourceTier {
  TIER_1_CUSTOM = 1, // Custom adapters (Binance, Coinbase, Kraken, OKX, Crypto.com)
  TIER_2_CCXT = 2, // CCXT individual exchanges (Bitmart, Bybit, Gate, Kucoin, etc.)
}

export enum ErrorClassification {
  CONNECTION_ERROR = "connection_error",
  DATA_VALIDATION_ERROR = "data_validation_error",
  TIMEOUT_ERROR = "timeout_error",
  RATE_LIMIT_ERROR = "rate_limit_error",
  AUTHENTICATION_ERROR = "authentication_error",
  EXCHANGE_ERROR = "exchange_error",
  PARSING_ERROR = "parsing_error",
  STALE_DATA_ERROR = "stale_data_error",
}

export interface DataSourceError {
  sourceId: string;
  tier: DataSourceTier;
  classification: ErrorClassification;
  error: Error;
  timestamp: number;
  feedId?: CoreFeedId;
  severity: "low" | "medium" | "high" | "critical";
  recoverable: boolean;
}

export interface HybridErrorResponse {
  strategy: "retry" | "failover" | "ccxt_backup" | "tier_fallback" | "graceful_degradation";
  action: string;
  estimatedRecoveryTime: number;
  fallbackSources: string[];
  degradationLevel: "none" | "partial" | "severe";
}

export interface HybridErrorStats {
  tier1Errors: number;
  tier2Errors: number;
  totalErrors: number;
  errorsByClassification: Record<ErrorClassification, number>;
  recoveryAttempts: number;
  successfulRecoveries: number;
  failoverEvents: number;
  ccxtBackupActivations: number;
}

export interface TierFailoverConfig {
  tier1ToTier2Delay: number; // Delay before falling back to Tier 2 (ms)
  tier2ToCcxtDelay: number; // Delay before using CCXT backup (ms)
  maxTier1Failures: number; // Max failures before tier failover
  maxTier2Failures: number; // Max failures before CCXT backup
  recoveryCheckInterval: number; // How often to check for recovery (ms)
}
