import { FeedCategory } from "@/types/feed-category.enum";
import { PriceUpdate, VolumeUpdate } from "./data-source.interface";
import { SymbolMappingUtils, ExchangeSymbolConventions } from "@/adapters/base/symbol-mapping.utils";

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

export abstract class ExchangeAdapter {
  abstract readonly exchangeName: string;
  abstract readonly category: FeedCategory;
  abstract readonly capabilities: ExchangeCapabilities;

  protected symbolConventions: ExchangeSymbolConventions;
  protected config?: ExchangeConnectionConfig;

  constructor(config?: ExchangeConnectionConfig) {
    this.config = config;
    // Initialize with default conventions, will be set properly in child constructor
    this.symbolConventions = SymbolMappingUtils.getExchangeConventions("default");
  }

  // Method to initialize symbol conventions after exchangeName is available
  protected initializeSymbolConventions(): void {
    this.symbolConventions = SymbolMappingUtils.getExchangeConventions(this.exchangeName);
  }

  // Core normalization methods - must be implemented by each adapter
  abstract normalizePriceData(rawData: any): PriceUpdate;
  abstract normalizeVolumeData(rawData: any): VolumeUpdate;
  abstract validateResponse(rawData: any): boolean;

  // Connection management methods
  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract isConnected(): boolean;

  // Symbol mapping with built-in utilities
  getSymbolMapping(feedSymbol: string): string {
    try {
      return SymbolMappingUtils.toExchangeFormat(feedSymbol, this.symbolConventions);
    } catch (error) {
      // Fallback to custom mapping if standard conversion fails
      return this.getCustomSymbolMapping(feedSymbol);
    }
  }

  // Override this method for exchange-specific symbol mappings
  protected getCustomSymbolMapping(feedSymbol: string): string {
    return feedSymbol;
  }

  // Validate symbol compatibility with this adapter
  validateSymbol(feedSymbol: string): boolean {
    try {
      const exchangeSymbol = this.getSymbolMapping(feedSymbol);
      return SymbolMappingUtils.validateSymbolForCategory(feedSymbol, this.category);
    } catch {
      return false;
    }
  }

  // Enhanced confidence calculation with multiple factors
  protected calculateConfidence(
    rawData: any,
    additionalFactors?: {
      latency?: number;
      volume?: number;
      spread?: number;
    }
  ): number {
    let confidence = 1.0;

    // Base confidence from data quality
    if (!rawData || typeof rawData !== "object") {
      return 0.0;
    }

    // Adjust for latency (lower confidence for older data)
    if (additionalFactors?.latency) {
      const latencyPenalty = Math.min(additionalFactors.latency / 1000, 0.5); // Max 50% penalty
      confidence -= latencyPenalty;
    }

    // Adjust for volume (higher volume = higher confidence)
    if (additionalFactors?.volume) {
      const volumeBonus = Math.min(Math.log10(additionalFactors.volume) / 10, 0.2); // Max 20% bonus
      confidence += volumeBonus;
    }

    // Adjust for spread (tighter spread = higher confidence)
    if (additionalFactors?.spread) {
      const spreadPenalty = Math.min(additionalFactors.spread / 10, 0.3); // Max 30% penalty, more sensitive
      confidence -= spreadPenalty;
    }

    return Math.max(0.0, Math.min(1.0, confidence));
  }

  // Utility method to normalize timestamps
  protected normalizeTimestamp(timestamp: any): number {
    if (typeof timestamp === "number") {
      // Handle both seconds and milliseconds
      return timestamp > 1e12 ? timestamp : timestamp * 1000;
    }

    if (typeof timestamp === "string") {
      return new Date(timestamp).getTime();
    }

    if (timestamp instanceof Date) {
      return timestamp.getTime();
    }

    // Fallback to current time
    return Date.now();
  }

  // Utility method to safely parse numeric values
  protected parseNumber(value: any): number {
    if (typeof value === "number") {
      return value;
    }

    if (typeof value === "string") {
      const parsed = parseFloat(value);
      if (isNaN(parsed)) {
        throw new Error(`Invalid numeric value: ${value}`);
      }
      return parsed;
    }

    throw new Error(`Cannot parse number from: ${typeof value}`);
  }

  // Get adapter configuration
  getConfig(): ExchangeConnectionConfig | undefined {
    return this.config;
  }

  // Update adapter configuration
  updateConfig(config: Partial<ExchangeConnectionConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
