import { FeedCategory } from "@/common/types/feed.types";
import { PriceUpdate, VolumeUpdate } from "@/common/interfaces/core/data-source.interface";

export interface ExchangeConnectionConfig {
  websocketUrl?: string;
  restApiUrl?: string;
  apiKey?: string;
  apiSecret?: string;
  sandbox?: boolean;
  rateLimit?: number; // requests per second
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

  // Core normalization methods - must be implemented by each adapter
  normalizePriceData(rawData: any): PriceUpdate;
  normalizeVolumeData(rawData: any): VolumeUpdate;
  validateResponse(rawData: unknown): boolean;

  // Connection management methods
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  // Subscription management methods
  subscribe(symbols: string[]): Promise<void>;
  unsubscribe(symbols: string[]): Promise<void>;
  onPriceUpdate(callback: (update: PriceUpdate) => void): void;

  // Optional event handlers for enhanced integration
  onConnectionChange?(callback: (connected: boolean) => void): void;
  onError?(callback: (error: Error) => void): void;

  // Symbol mapping - override if exchange needs symbol transformation
  getSymbolMapping(feedSymbol: string): string;

  // Validate symbol compatibility with this adapter
  validateSymbol(feedSymbol: string): boolean;

  // Get adapter configuration
  getConfig(): ExchangeConnectionConfig | undefined;

  // Update adapter configuration
  updateConfig(config: Partial<ExchangeConnectionConfig>): void;
}
