/**
 * Adapter type definitions
 */

// PriceUpdate import removed - no longer needed after removing AdapterWithRestFallback
import { FeedCategory } from "../core/feed.types";
import { IExchangeAdapter, ExchangeCapabilities } from "./exchange.types";

export interface RawExchangeData {
  symbol?: string;
  price?: number | string;
  timestamp?: number | string;
  volume?: number | string;
  bid?: number | string;
  ask?: number | string;
  high?: number | string;
  low?: number | string;
  open?: number | string;
  close?: number | string;
  change?: number | string;
  changePercent?: number | string;
  [key: string]: unknown;
}

export interface RawPriceData extends RawExchangeData {
  price: number | string;
  timestamp: number | string;
}

export interface RawVolumeData extends RawExchangeData {
  volume: number | string;
  timestamp: number | string;
}

export interface WebSocketMessage {
  type?: string;
  event?: string;
  channel?: string;
  data?: RawExchangeData | RawExchangeData[];
  symbol?: string;
  timestamp?: number;
  [key: string]: unknown;
}

export interface RestApiResponse {
  success?: boolean;
  data?: RawExchangeData | RawExchangeData[];
  error?: string;
  message?: string;
  timestamp?: number;
  [key: string]: unknown;
}

export interface IAdapterRegistryEntry {
  adapter: IExchangeAdapter;
  registeredAt: Date;
  lastActivity: Date;
  isActive: boolean;
}

export interface IAdapterFilter {
  category?: FeedCategory;
  capabilities?: Partial<ExchangeCapabilities>;
}

export interface AdapterHealthMetrics {
  uptime: number;
  connectionStatus: "connected" | "disconnected" | "connecting" | "error";
  lastUpdate: number;
  errorCount: number;
  successCount: number;
  averageLatency: number;
  reconnectAttempts: number;
}

export interface AdapterReconnectionResult {
  success: boolean;
  timestamp: number;
  error?: string;
  attempts: number;
}

export interface AdapterRestFallbackData {
  symbol: string;
  data: RawPriceData;
  timestamp: number;
  source: string;
}

export interface AdapterWithReconnection {
  attemptReconnection(): Promise<boolean>;
}

// REST fallback is now handled by DataSourceFactory's AdapterDataSource
// Adapters only need to implement fetchTickerREST

export interface AdapterWithHealthCheck {
  performHealthCheck(): Promise<boolean>;
  getHealthMetrics(): AdapterHealthMetrics;
}

export type AdapterCapabilities = AdapterWithReconnection | AdapterWithHealthCheck;
