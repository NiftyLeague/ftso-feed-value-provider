/**
 * Failover management type definitions
 */

import { EnhancedFeedId } from "../core";

export interface FailoverConfig {
  maxFailoverTime: number; // Maximum time to complete failover (ms)
  healthCheckInterval: number; // How often to check source health (ms)
  failureThreshold: number; // Number of failures before triggering failover
  recoveryThreshold: number; // Number of successful checks before considering recovered
}

export interface SourceHealth {
  sourceId: string;
  isHealthy: boolean;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastHealthCheck: number;
  lastFailure?: number;
  averageLatency: number;
}

export interface FailoverGroup {
  feedId: EnhancedFeedId;
  primarySources: string[];
  backupSources: string[];
  activeSources: string[];
  failedSources: string[];
}
