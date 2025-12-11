/**
 * Exchange adapter type definitions
 
 */

import { FeedCategory } from "../core/feed.types";
import { PriceUpdate, VolumeUpdate } from "../core/data-source.types";

export interface ExchangeConnectionConfig {
  websocketUrl?: string;
  restApiUrl?: string;
  // Enhanced rate limiting configuration
  rateLimiting?: {
    maxRetries?: number; // Maximum retry attempts for rate limited requests
    baseDelay?: number; // Base delay in milliseconds for exponential backoff
    multiplier?: number; // Multiplier for exponential backoff
    queueInterval?: number; // Minimum interval between queued requests in milliseconds
    enableQueue?: boolean; // Enable request queuing (recommended for strict rate limits)
  };
}

export interface ExchangeCapabilities {
  supportsWebSocket: boolean;
  supportsREST: boolean;
  supportsVolume: boolean;
  supportsOrderBook: boolean;
  supportedCategories: FeedCategory[];
}

export interface IExchangeAdapter {
  readonly exchangeName: string;
  readonly category: FeedCategory;
  readonly capabilities: ExchangeCapabilities;

  normalizePriceData(rawData: unknown): PriceUpdate;
  normalizeVolumeData(rawData: unknown): VolumeUpdate;
  validateResponse(rawData: unknown): boolean;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  subscribe(symbols: string[]): Promise<void>;
  unsubscribe(symbols: string[]): Promise<void>;
  onPriceUpdate(callback: (update: PriceUpdate) => void): void;

  onConnectionChange?(callback: (connected: boolean) => void): void;
  onError?(callback: (error: Error) => void): void;

  getSymbolMapping(feedSymbol: string): string;

  validateSymbol(feedSymbol: string): boolean;

  getConfig(): ExchangeConnectionConfig | undefined;

  updateConfig(config: Partial<ExchangeConnectionConfig>): void;
}
