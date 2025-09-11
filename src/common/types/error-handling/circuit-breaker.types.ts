import type { BaseServiceConfig } from "../services/base.types";

export enum CircuitBreakerState {
  CLOSED = "closed",
  OPEN = "open",
  HALF_OPEN = "half_open",
}

export interface CircuitBreakerConfig extends BaseServiceConfig {
  failureThreshold: number;
  recoveryTimeout: number;
  successThreshold: number;
  timeout: number;
  monitoringWindow: number;
}

export interface CircuitBreakerStats {
  state: CircuitBreakerState;
  failureCount: number;
  successCount: number;
  lastFailureTime?: number;
  lastSuccessTime?: number;
  totalRequests: number;
  totalFailures: number;
  totalSuccesses: number;
  uptime: number;
}

export interface CircuitBreakerMetrics {
  requestCount: number;
  failureRate: number;
  averageResponseTime: number;
  lastStateChange: number;
}
