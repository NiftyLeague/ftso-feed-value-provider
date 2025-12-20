/**
 * Connection recovery type definitions
 */

import type { ExchangeId } from "../adapters";
import type { BaseServiceConfig } from "../services";
import type { CircuitBreakerState } from "./circuit-breaker.types";

export interface ConnectionRecoveryConfig extends BaseServiceConfig {
  maxFailoverTime: number; // Maximum time to complete failover (ms) - Requirement 7.2
  healthCheckInterval: number; // How often to check connection health (ms)
  reconnectDelay: number; // Initial delay before reconnection attempt (ms)
  maxReconnectDelay: number; // Maximum delay between reconnection attempts (ms)
  backoffMultiplier: number; // Exponential backoff multiplier
  maxReconnectAttempts: number; // Maximum number of reconnection attempts
  gracefulDegradationThreshold: number; // Minimum sources needed to avoid degradation
}

/**
 * Per-source connection health tracked by the connection recovery system.
 *
 * Note: This is distinct from `ConnectionHealth` metrics in the data-manager types,
 * which represent aggregated/summarized health.
 */
export interface SourceConnectionHealth {
  sourceId: string;
  isConnected: boolean;
  isHealthy: boolean;
  lastConnected?: number;
  lastDisconnected?: number;
  reconnectAttempts: number;
  consecutiveFailures: number;
  averageLatency: number;
  circuitBreakerState: CircuitBreakerState;
}

export interface FailoverResult {
  success: boolean;
  failoverTime: number;
  activatedSources: (ExchangeId | string)[];
  deactivatedSources: (ExchangeId | string)[];
  degradationLevel: "none" | "partial" | "severe";
}

export interface RecoveryStrategy {
  sourceId: string;
  strategy: "reconnect" | "failover" | "circuit_breaker" | "graceful_degradation";
  priority: number;
  estimatedRecoveryTime: number;
}
