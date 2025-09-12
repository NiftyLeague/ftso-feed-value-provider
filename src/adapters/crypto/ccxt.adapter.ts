import { BaseExchangeAdapter } from "@/adapters/base/base-exchange-adapter";
import { ServiceStatus } from "@/common/base/mixins/data-provider.mixin";
import type {
  ExchangeCapabilities,
  ExchangeConnectionConfig,
  RawPriceData,
  RawVolumeData,
} from "@/common/types/adapters";
import type { PriceUpdate, VolumeUpdate, CoreFeedId } from "@/common/types/core";
import { FeedCategory } from "@/common/types/core";

export interface CcxtMultiExchangeConnectionConfig extends ExchangeConnectionConfig {
  tradesLimit?: number; // CCXT trades limit (default: 1000)
  lambda?: number; // Exponential decay parameter (default: 0.00005)
  retryBackoffMs?: number; // Retry backoff in milliseconds (default: 10000)
  enableUsdtConversion?: boolean; // Enable USDT to USD conversion (default: true)
  tier1Exchanges?: string[]; // Exchanges handled by custom adapters (default: ["binance", "coinbase", "kraken", "okx"])
  useEnhancedLogging?: boolean; // Enable enhanced logging (default: false)
}

// For backward compatibility with tests
export type CcxtMultiExchangeConfig = CcxtMultiExchangeConnectionConfig;

export interface ExchangePriceData {
  exchange: string;
  price: number;
  timestamp: number;
  confidence: number;
  volume?: number;
}

export class CcxtMultiExchangeAdapter extends BaseExchangeAdapter {
  readonly exchangeName = "ccxt-multi-exchange";
  readonly category = FeedCategory.Crypto;
  readonly capabilities: ExchangeCapabilities = {
    supportsWebSocket: true, // CCXT Pro supports WebSocket via watchTradesForSymbols/watchTrades
    supportsREST: true,
    supportsVolume: true,
    supportsOrderBook: false,
    supportedCategories: [FeedCategory.Crypto],
  };

  protected adapterConfig: CcxtMultiExchangeConfig = {
    tradesLimit: 1000,
    lambda: 0.00005,
    retryBackoffMs: 10000,
    enableUsdtConversion: true,
    tier1Exchanges: ["binance", "coinbase", "kraken", "okx", "cryptocom"],
  };

  // Metrics tracking
  protected tier2ExchangeCount = 0;

  // Critical USDT/USD feed for conversion
  private readonly usdtToUsdFeedId: CoreFeedId = {
    category: FeedCategory.Crypto,
    name: "USDT/USD",
  };

  constructor(config?: CcxtMultiExchangeConfig) {
    super({ connection: {} });
    if (config) {
      this.adapterConfig = { ...this.adapterConfig, ...config };
    }
    this.initValidation();
    this.setConnectionStatus(ServiceStatus.Unknown);
  }

  // Method to create an adapter with custom configuration (for testing)
  static withConfig(config: Partial<CcxtMultiExchangeConfig>): CcxtMultiExchangeAdapter {
    return new CcxtMultiExchangeAdapter(config);
  }

  protected async doConnect(): Promise<void> {
    if (this.isConnected()) {
      return;
    }

    try {
      this.logger.log("Initializing CCXT multi-exchange adapter...");

      // Set environment variables for CCXT configuration
      if (this.adapterConfig.lambda) {
        process.env.MEDIAN_DECAY = this.adapterConfig.lambda.toString();
      }
      if (this.adapterConfig.tradesLimit) {
        process.env.TRADES_HISTORY_SIZE = this.adapterConfig.tradesLimit.toString();
      }

      this.setConnectionStatus(ServiceStatus.Connected);
      this.logger.log("CCXT multi-exchange adapter initialized successfully");
    } catch (error) {
      this.logger.error("Failed to initialize CCXT multi-exchange adapter:", error);
      throw error;
    }
  }

  protected async doDisconnect(): Promise<void> {
    this.setConnectionStatus(ServiceStatus.Disconnected);
    // CCXT doesn't have a clean shutdown method, but we can mark as disconnected
    this.logger.log("CCXT multi-exchange adapter disconnected");
  }

  override isConnected(): boolean {
    return this.getConnectionStatus() === ServiceStatus.Connected;
  }

  normalizePriceData(rawData: RawPriceData): PriceUpdate {
    // CCXT adapter doesn't receive raw data in the traditional sense
    // This method is called internally after fetching from CCXT
    const { feedId, price, timestamp } = rawData;

    const numericPrice = typeof price === "string" ? parseFloat(price) : price;
    const numericTimestamp = typeof timestamp === "string" ? parseInt(timestamp, 10) : timestamp;

    if (typeof numericPrice !== "number" || isNaN(numericPrice)) {
      throw new Error(`Invalid price received: ${price}`);
    }
    if (typeof numericTimestamp !== "number" || isNaN(numericTimestamp)) {
      throw new Error(`Invalid timestamp received: ${timestamp}`);
    }

    return {
      symbol: (feedId as CoreFeedId).name, // Cast feedId to CoreFeedId
      price: numericPrice,
      timestamp: numericTimestamp || Date.now(),
      source: this.exchangeName,
      confidence: this.calculateConfidence(rawData, {
        latency: Date.now() - (numericTimestamp || Date.now()),
      }),
    };
  }

  normalizeVolumeData(rawData: RawVolumeData): VolumeUpdate {
    const { feedId, volume, timestamp } = rawData;

    const numericVolume = typeof volume === "string" ? parseFloat(volume) : volume;
    const numericTimestamp = typeof timestamp === "string" ? parseInt(timestamp, 10) : timestamp;

    if (typeof numericVolume !== "number" || isNaN(numericVolume)) {
      throw new Error(`Invalid volume received: ${volume}`);
    }
    if (typeof numericTimestamp !== "number" || isNaN(numericTimestamp)) {
      throw new Error(`Invalid timestamp received: ${timestamp}`);
    }

    return {
      symbol: (feedId as CoreFeedId).name, // Cast feedId to CoreFeedId
      volume: numericVolume,
      timestamp: numericTimestamp || Date.now(),
      source: this.exchangeName,
    };
  }

  validateResponse(rawData: unknown): boolean {
    if (!rawData || typeof rawData !== "object") return false;
    const obj = rawData as { feedId?: unknown; price?: unknown };
    const hasFeedId = obj.feedId !== undefined && obj.feedId !== null;
    const priceVal = obj.price;
    const isNum = typeof priceVal === "number" && !Number.isNaN(priceVal) && priceVal > 0;
    return hasFeedId && isNum;
  }

  // Get single price from CCXT
  async getCcxtPrice(feedId: CoreFeedId): Promise<PriceUpdate> {
    const startTime = Date.now();

    try {
      // Ensure CCXT is connected
      if (!this.isConnected()) {
        await this.connect();
      }

      throw new Error("CCXT price extraction not yet implemented");
    } catch (error) {
      const extractionTime = Date.now() - startTime;
      this.updateMetrics(extractionTime, false);

      this.logger.error(`CCXT price extraction failed for ${feedId.name}:`, error);
      throw new Error(`CCXT price extraction failed: ${error}`);
    }
  }

  // NEW: Extract individual exchange prices from CCXT latestPrice Map
  async getIndividualPrices(feedId: CoreFeedId): Promise<ExchangePriceData[]> {
    const startTime = Date.now();

    try {
      // Ensure CCXT is connected
      if (!this.isConnected()) {
        await this.connect();
      }

      // Access the private latestPrice Map from CCXT service
      const latestPriceMap = this.getLatestPriceMap();
      const symbolPrices = latestPriceMap.get(feedId.name);

      if (!symbolPrices || symbolPrices.size === 0) {
        this.logger.warn(`No individual prices found for ${feedId.name} in CCXT latestPrice Map`);
        return [];
      }

      const individualPrices: ExchangePriceData[] = [];

      // Extract individual prices from each exchange
      for (const [exchangeName, priceInfo] of symbolPrices) {
        try {
          const price = priceInfo.value;

          // Calculate confidence based on data age and exchange reliability
          const dataAge = Date.now() - priceInfo.time;
          const confidence = this.calculateIndividualConfidence(priceInfo, dataAge, exchangeName);

          individualPrices.push({
            exchange: exchangeName,
            price,
            timestamp: priceInfo.time,
            confidence,
          });
        } catch (error) {
          this.logger.warn(`Failed to process individual price for ${exchangeName}:`, error);
          // Continue with other exchanges
        }
      }

      // If no direct USD prices found and USDT conversion is enabled, try USDT prices
      if (individualPrices.length === 0 && feedId.name.endsWith("/USD") && this.adapterConfig.enableUsdtConversion) {
        const usdtSymbol = feedId.name.replace("/USD", "/USDT");
        const usdtPriceMap = latestPriceMap.get(usdtSymbol);

        if (usdtPriceMap && usdtPriceMap.size > 0) {
          // Get USDT/USD conversion rate
          const usdtToUsd = await this.getUsdtToUsdRate();

          if (usdtToUsd !== undefined) {
            for (const [exchangeName, usdtPriceInfo] of usdtPriceMap) {
              try {
                const convertedPrice = usdtPriceInfo.value * usdtToUsd;
                const dataAge = Date.now() - usdtPriceInfo.time;
                const confidence = this.calculateIndividualConfidence(usdtPriceInfo, dataAge, exchangeName);

                individualPrices.push({
                  exchange: exchangeName,
                  price: convertedPrice,
                  timestamp: usdtPriceInfo.time,
                  confidence,
                });

                this.logger.debug(
                  `Converted ${usdtSymbol} price ${usdtPriceInfo.value} to USD: ${convertedPrice} (rate: ${usdtToUsd}) for ${exchangeName}`
                );
              } catch (error) {
                this.logger.warn(`Failed to convert USDT price for ${exchangeName}:`, error);
              }
            }
          }
        }
      }

      const processingTime = Date.now() - startTime;
      this.logger.debug(
        `Extracted ${individualPrices.length} individual prices for ${feedId.name} in ${processingTime}ms`
      );

      return individualPrices;
    } catch (error) {
      this.logger.error(`Failed to extract individual prices for ${feedId.name}:`, error);
      throw new Error(`Individual price extraction failed: ${error}`);
    }
  }

  // Volume data method
  async getVolumeData(feedId: CoreFeedId, _volumeWindow: number): Promise<VolumeUpdate> {
    try {
      if (!this.isConnected()) {
        await this.connect();
      }

      throw new Error("CCXT volume extraction not yet implemented");
    } catch (error) {
      this.logger.error(`CCXT volume extraction failed for ${feedId.name}:`, error);
      throw new Error(`CCXT volume extraction failed: ${error}`);
    }
  }

  // USDT to USD conversion using CCXT's existing logic
  async convertUsdtToUsd(usdtPrice: number): Promise<number> {
    if (!this.adapterConfig.enableUsdtConversion) {
      return usdtPrice; // Return as-is if conversion disabled
    }

    try {
      const usdtToUsdPrice = await this.getCcxtPrice(this.usdtToUsdFeedId);
      return usdtPrice * usdtToUsdPrice.price;
    } catch (error) {
      if (this.logger && typeof this.logger.warn === "function") {
        this.logger.warn(`Failed to convert USDT to USD, using USDT price as-is:`, error);
      }
      return usdtPrice; // Fallback to original price
    }
  }

  // NEW: Convert individual USDT prices to USD for hybrid integration
  async convertIndividualUsdtPrices(
    usdtPrices: ExchangePriceData[],
    targetSymbol: string
  ): Promise<ExchangePriceData[]> {
    if (!this.adapterConfig.enableUsdtConversion) {
      return usdtPrices;
    }

    try {
      // Get USDT/USD conversion rate
      const usdtToUsdRate = await this.getUsdtToUsdRate();
      if (!usdtToUsdRate) {
        this.logger.warn("USDT/USD rate not available, returning original USDT prices");
        return usdtPrices;
      }

      // Convert each individual price
      const convertedPrices = usdtPrices.map(priceData => ({
        ...priceData,
        price: priceData.price * usdtToUsdRate,
      }));

      this.logger.debug(
        `Converted ${usdtPrices.length} individual USDT prices to USD for ${targetSymbol} using rate ${usdtToUsdRate}`
      );

      return convertedPrices;
    } catch (error) {
      this.logger.warn(`Failed to convert individual USDT prices to USD:`, error);
      return usdtPrices;
    }
  }

  // Check if USDT/USD feed is available and prioritized
  async ensureUsdtFeedAvailable(): Promise<boolean> {
    try {
      const usdtPrice = await this.getCcxtPrice(this.usdtToUsdFeedId);
      return usdtPrice.price > 0;
    } catch {
      return false;
    }
  }

  // Work as Tier 2 data source alongside custom Tier 1 adapters
  async getTier2Prices(feedId: CoreFeedId): Promise<ExchangePriceData[]> {
    try {
      const individualPrices = await this.getIndividualPrices(feedId);

      // Filter out Tier 1 exchanges (these should be handled by custom adapters)
      const tier1Exchanges = new Set(
        this.adapterConfig.tier1Exchanges || ["binance", "coinbase", "kraken", "okx", "cryptocom"]
      );
      const tier2Prices = individualPrices.filter(price => !tier1Exchanges.has(price.exchange.toLowerCase()));

      this.tier2ExchangeCount = tier2Prices.length;

      this.logger.debug(
        `Tier 2 data source returning ${tier2Prices.length} prices for ${feedId.name} (filtered out ${
          individualPrices.length - tier2Prices.length
        } Tier 1 exchanges)`
      );

      return tier2Prices;
    } catch (error) {
      this.logger.error(`Tier 2 price extraction failed for ${feedId.name}:`, error);
      return [];
    }
  }

  // Check if this adapter can provide data for a specific feed as Tier 2 source
  canProvideTier2Data(feedId: CoreFeedId): boolean {
    // Only support crypto feeds for now
    if (feedId.category !== FeedCategory.Crypto) {
      return false;
    }

    // Check if CCXT is initialized and has data for this symbol
    try {
      const latestPriceMap = this.getLatestPriceMap();
      const symbolPrices = latestPriceMap.get(feedId.name);

      if (!symbolPrices || symbolPrices.size === 0) {
        return false;
      }

      // Check if we have any Tier 2 exchanges (non-Tier 1)
      const tier1Exchanges = new Set(
        this.adapterConfig.tier1Exchanges || ["binance", "coinbase", "kraken", "okx", "cryptocom"]
      );
      const hasTier2Data = Array.from(symbolPrices.keys()).some(
        exchange => !tier1Exchanges.has(exchange.toLowerCase())
      );

      return hasTier2Data;
    } catch {
      return false;
    }
  }

  // Get list of available Tier 2 exchanges for a feed
  getAvailableTier2Exchanges(feedId: CoreFeedId): string[] {
    try {
      const latestPriceMap = this.getLatestPriceMap();
      const symbolPrices = latestPriceMap.get(feedId.name);

      if (!symbolPrices) {
        return [];
      }

      const tier1Exchanges = new Set(
        this.adapterConfig.tier1Exchanges || ["binance", "coinbase", "kraken", "okx", "cryptocom"]
      );
      return Array.from(symbolPrices.keys()).filter(exchange => !tier1Exchanges.has(exchange.toLowerCase()));
    } catch {
      return [];
    }
  }

  // Get metrics with additional CCXT-specific metrics
  override getMetrics(): Record<string, number> {
    const baseMetrics = super.getMetrics() || {};
    const total = this._successCount + this._errorCount;
    return {
      ...baseMetrics,
      priceExtractionCount: this._requestCount,
      successfulExtractions: this._successCount,
      failedExtractions: this._errorCount,
      successRate: total === 0 ? 0 : this._successCount / total,
      tier2ExchangeCount: this.tier2ExchangeCount,
    };
  }

  protected async doHealthCheck(): Promise<boolean> {
    try {
      if (!this.isConnected()) {
        return false;
      }

      // Try to get a price for a common pair to verify CCXT is working
      const testFeedId: CoreFeedId = {
        category: FeedCategory.Crypto,
        name: "BTC/USD",
      };

      const result = await this.getCcxtPrice(testFeedId);
      return result.price > 0;
    } catch {
      return false;
    }
  }

  // Get configuration with proper type handling
  getCcxtConfig(): Readonly<CcxtMultiExchangeConnectionConfig> {
    return { ...this.adapterConfig };
  }

  /**
   * Reset all metrics and statistics
   */
  public resetMetrics(): void {
    // Reset any metrics or statistics being tracked
    this._requestCount = 0;
    this._successCount = 0;
    this._errorCount = 0;
    this.tier2ExchangeCount = 0;
    this.logger.debug("Metrics reset");
  }

  // Update adapter configuration
  protected updateAdapterConfig(config?: Partial<CcxtMultiExchangeConfig>): void {
    if (!config) return;

    // Create a clean config object with only the properties we want to pass to the parent
    const connectionConfig: ExchangeConnectionConfig = {};

    // Copy base connection properties that exist in ExchangeConnectionConfig
    if ("websocketUrl" in config) {
      connectionConfig.websocketUrl = config.websocketUrl;
      this.adapterConfig.websocketUrl = config.websocketUrl;
    }
    if ("apiKey" in config) {
      connectionConfig.apiKey = config.apiKey;
      this.adapterConfig.apiKey = config.apiKey;
    }
    if ("apiSecret" in config) {
      connectionConfig.apiSecret = config.apiSecret;
      this.adapterConfig.apiSecret = config.apiSecret;
    }

    // Only call parent if we have any connection config to update
    if (Object.keys(connectionConfig).length > 0) {
      super.updateConnectionConfig(connectionConfig);
    }

    // Update the adapter config properties that aren't part of the connection config
    if ("tradesLimit" in config) this.adapterConfig.tradesLimit = config.tradesLimit;
    if ("lambda" in config) this.adapterConfig.lambda = config.lambda;
    if ("retryBackoffMs" in config) this.adapterConfig.retryBackoffMs = config.retryBackoffMs;
    if ("enableUsdtConversion" in config) this.adapterConfig.enableUsdtConversion = config.enableUsdtConversion;
    if ("tier1Exchanges" in config) this.adapterConfig.tier1Exchanges = config.tier1Exchanges;
    if ("useEnhancedLogging" in config) this.adapterConfig.useEnhancedLogging = config.useEnhancedLogging;
  }

  // Private helper methods
  private updateMetrics(_extractionTime: number, success: boolean): void {
    if (success) {
      this.recordSuccessfulRequest();
    } else {
      this.recordFailedRequest();
    }
  }

  // Access CCXT's private latestPrice Map using reflection
  private getLatestPriceMap(): Map<string, Map<string, { value: number; time: number }>> {
    try {
      throw new Error("CCXT price map access not yet implemented");
    } catch (error) {
      this.logger.error("Failed to access CCXT latestPrice Map:", error);
      throw new Error("Cannot access individual price data from CCXT");
    }
  }

  // Get USDT/USD conversion rate
  private async getUsdtToUsdRate(): Promise<number | undefined> {
    try {
      const usdtPriceUpdate = await this.getCcxtPrice(this.usdtToUsdFeedId);
      return usdtPriceUpdate.price;
    } catch (error) {
      this.logger.warn("Failed to get USDT/USD conversion rate:", error);
      return undefined;
    }
  }

  // Calculate confidence for individual exchange prices
  private calculateIndividualConfidence(
    _priceInfo: { value: number; time: number },
    dataAge: number,
    exchangeName: string
  ): number {
    let confidence = 1.0;

    // Reduce confidence based on data age (max 2 seconds for FTSO requirements)
    const maxAge = 2000; // 2 seconds
    if (dataAge > maxAge) {
      const agePenalty = Math.min((dataAge - maxAge) / maxAge, 0.8); // Max 80% penalty
      confidence -= agePenalty;
    }

    // Exchange-specific confidence adjustments (Tier 2 exchanges)
    const exchangeReliability = this.getExchangeReliability(exchangeName);
    confidence *= exchangeReliability;

    // Ensure confidence is between 0 and 1
    return Math.max(0.0, Math.min(1.0, confidence));
  }

  // Get exchange reliability factor for Tier 2 exchanges
  private getExchangeReliability(exchangeName: string): number {
    // Tier 2 exchange reliability factors (can be configured)
    const reliabilityFactors: Record<string, number> = {
      bitmart: 0.85,
      bybit: 0.9,
      gate: 0.85,
      kucoin: 0.88,
      probit: 0.8,
      cryptocom: 0.87,
      // Add more exchanges as needed
    };

    return reliabilityFactors[exchangeName] || 0.8; // Default reliability for unknown exchanges
  }

  protected async doSubscribe(symbols: string[]): Promise<void> {
    // CCXT adapter doesn't use subscriptions - it uses the existing CCXT service
    this.logger.debug(`CCXT adapter doesn't support subscriptions for: ${symbols.join(", ")}`);
  }

  protected async doUnsubscribe(symbols: string[]): Promise<void> {
    // CCXT adapter doesn't use subscriptions
    this.logger.debug(`CCXT adapter doesn't support unsubscriptions for: ${symbols.join(", ")}`);
  }
}
