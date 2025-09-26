/**
 * Data manager connection type definitions
 */

import { CoreFeedId } from "../core";

import { AdapterWithReconnection, AdapterWithRestFallback, AdapterWithHealthCheck } from "../adapters";

export interface EnhancedDataSource {
  type: "websocket" | "rest" | "hybrid";
  id: string;
  name: string;
  status: "active" | "inactive" | "error" | "reconnecting";
}

export function hasReconnectionCapability(source: unknown): source is AdapterWithReconnection {
  return typeof source === "object" && source !== null && "attemptReconnection" in source;
}

export function hasRestFallbackCapability(source: unknown): source is AdapterWithRestFallback {
  return typeof source === "object" && source !== null && "fetchPriceViaREST" in source;
}

export function hasHealthCheckCapability(source: unknown): source is AdapterWithHealthCheck {
  return typeof source === "object" && source !== null && "performHealthCheck" in source;
}

export interface ConnectionMetrics {
  sourceId: string;
  isHealthy: boolean;
  lastUpdate: number;
  errorCount: number;
  successCount: number;
  reconnectAttempts: number;
  averageLatency: number;
  latency: number;
  uptime: number;
}

export interface ReconnectionTimer {
  sourceId: string;
  timerId: NodeJS.Timeout;
  attempts: number;
  nextAttempt: number;
  maxAttempts: number;
}

export interface SourceSubscription {
  sourceId: string;
  feedId: CoreFeedId;
  symbols: string[];
  timestamp: number;
  lastUpdate: number;
  active: boolean;
}

export interface SourceHealthCheck {
  sourceId: string;
  healthy: boolean;
  timestamp: number;
  responseTime: number;
  error?: string;
  details?: Record<string, unknown>;
}

export interface ConnectionHealth {
  totalSources: number;
  connectedSources: number;
  averageLatency: number;
  failedSources: string[];
  healthScore: number;
}

export interface ConnectionStats {
  connectionId: string;
  connectedAt?: number;
  lastPingAt?: number;
  lastPongAt?: number;
  reconnectAttempts: number;
  messagesReceived: number;
  messagesSent: number;
  bytesReceived: number;
  bytesSent: number;
  totalMessages: number;
  totalErrors: number;
}

export interface WSConnectionConfig {
  url: string;
  protocols?: string[];
  reconnectInterval: number;
  maxReconnectAttempts: number;
  pingInterval: number;
  pongTimeout: number;
  headers?: Record<string, string>;
  reconnectDelay?: number;
  connectionTimeout?: number; // Timeout for initial connection attempt
}

export interface WSConnectionStats extends ConnectionStats {
  wsState: "connecting" | "open" | "closing" | "closed";
  lastMessageAt?: number;
  pingLatency?: number;
  lastError?: Error;
  lastErrorAt?: number; // Timestamp of last error
}
