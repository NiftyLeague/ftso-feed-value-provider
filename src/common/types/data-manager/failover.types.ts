/**
 * Failover management type definitions
 */

import type { CoreFeedId } from "../core";
import type { BaseServiceConfig } from "../services";
import { ExchangeId } from "@/common/types/adapters";

export interface FailoverConfig extends BaseServiceConfig {
  maxFailoverTime: number; // Maximum time to complete failover (ms)
  healthCheckInterval: number; // How often to check source health (ms)
  failureThreshold: number; // Number of failures before triggering failover
  recoveryThreshold: number; // Number of successful checks before considering recovered
  minFailureInterval: number; // Minimum time between failover attempts (ms)
}

export interface SourceHealth {
  sourceId: ExchangeId | string;
  isHealthy: boolean;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastHealthCheck: number;
  lastFailure?: number;
  averageLatency: number;
}

export interface FailoverGroup {
  feedId: CoreFeedId;
  primarySources: (ExchangeId | string)[];
  backupSources: (ExchangeId | string)[];
  activeSources: (ExchangeId | string)[];
  failedSources: (ExchangeId | string)[];
  lastFailoverTime?: number; // Timestamp of last failover to prevent loops
}
