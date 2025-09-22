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
import { ENV } from "@/config/environment.constants";
import * as ccxt from "ccxt";

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
    tradesLimit: ENV.CCXT.TRADES_LIMIT,
    lambda: ENV.CCXT.LAMBDA_DECAY,
    retryBackoffMs: ENV.CCXT.RETRY_BACKOFF_MS,
    enableUsdtConversion: ENV.CCXT.ENABLE_USDT_CONVERSION,
    tier1Exchanges: ["binance", "coinbase", "kraken", "okx", "cryptocom"],
  };

  // Metrics tracking - override base class properties
  public override _requestCount = 0;
  public override _successCount = 0;
  public override _errorCount = 0;

  // Metrics tracking
  protected tier2ExchangeCount = 0;

  // Critical USDT/USD feed for conversion
  private readonly usdtToUsdFeedId: CoreFeedId = {
    category: FeedCategory.Crypto,
    name: "USDT/USD",
  };

  // CCXT Pro exchange instances
  private exchanges: Map<string, ccxt.Exchange> = new Map();

  // Exchange-specific tracking
  private exchangeSubscriptions: Map<string, Set<string>> = new Map(); // exchange -> symbols
  private latestPrices: Map<string, Map<string, { value: number; time: number; exchange: string }>> = new Map(); // symbol -> exchange -> price info

  constructor(
    config?: CcxtMultiExchangeConfig,
    private configService?: {
      hasCustomAdapter?: (exchange: string) => boolean;
      getCcxtExchangesFromFeeds?: () => string[];
      getFeedConfigurations?: () => Array<{ sources: Array<{ exchange: string; symbol: string }> }>;
    }
  ) {
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
    if (this.isConnected()) return;

    try {
      this.logger.log("Initializing CCXT Pro multi-exchange adapter...");

      // Note: CCXT configuration is handled through the adapter config
      // The centralized ENV constants are used for application-wide settings

      // Initialize CCXT Pro exchanges
      await this.initializeExchanges();

      this.setConnectionStatus(ServiceStatus.Connected);
      this.logger.log("CCXT Pro multi-exchange adapter initialized successfully");
    } catch (error) {
      this.logger.error("Failed to initialize CCXT Pro multi-exchange adapter:", error);
      throw error;
    }
  }

  protected async doDisconnect(): Promise<void> {
    this.logger.log("Disconnecting CCXT Pro adapter...");

    // Disconnect WebSocket if connected
    if (this.isWebSocketConnected()) {
      await this.disconnectWebSocket();
    }

    // Clear subscriptions
    this.exchangeSubscriptions.clear();

    // Clear price cache
    this.latestPrices.clear();

    this.setConnectionStatus(ServiceStatus.Disconnected);
    this.logger.log("CCXT Pro multi-exchange adapter disconnected");
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

      // Get price from CCXT using real exchange data
      const price = await this.fetchPriceFromExchanges(feedId);

      const extractionTime = Date.now() - startTime;
      this.updateMetrics(extractionTime, true);

      return price;
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
      const latestPriceMap = await this.getLatestPriceMap();
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

      // Get volume data from CCXT using real exchange data
      const volume = await this.fetchVolumeFromExchanges(feedId, _volumeWindow);

      return volume;
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
  async canProvideTier2Data(feedId: CoreFeedId): Promise<boolean> {
    // Only support crypto feeds for now
    if (feedId.category !== FeedCategory.Crypto) {
      return false;
    }

    // Check if CCXT is initialized and has data for this symbol
    try {
      const latestPriceMap = await this.getLatestPriceMap();
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
  async getAvailableTier2Exchanges(feedId: CoreFeedId): Promise<string[]> {
    try {
      const latestPriceMap = await this.getLatestPriceMap();
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
  private async getLatestPriceMap(): Promise<Map<string, Map<string, { value: number; time: number }>>> {
    try {
      // Access CCXT latestPrice Map using real exchange data
      return await this.fetchPriceMapFromExchanges();
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
    let confidence = ENV.CCXT.INITIAL_CONFIDENCE;

    // Reduce confidence based on data age (max 2 seconds for FTSO requirements)
    const maxAge = ENV.CCXT.MAX_DATA_AGE_MS;
    if (dataAge > maxAge) {
      const agePenalty = Math.min((dataAge - maxAge) / maxAge, ENV.CCXT.MAX_AGE_PENALTY);
      confidence -= agePenalty;
    }

    // Exchange-specific confidence adjustments (Tier 2 exchanges)
    const exchangeReliability = this.getExchangeReliability(exchangeName);
    confidence *= exchangeReliability;

    // Ensure confidence is between 0 and 1
    return Math.max(ENV.CCXT.MIN_CONFIDENCE, Math.min(ENV.CCXT.MAX_CONFIDENCE, confidence));
  }

  // Get exchange reliability factor for Tier 2 exchanges
  private getExchangeReliability(exchangeName: string): number {
    // Tier 2 exchange reliability factors (configured via environment)
    const reliabilityFactors: Record<string, number> = {
      bitmart: ENV.CCXT.EXCHANGE_RELIABILITY.BITMART,
      bybit: ENV.CCXT.EXCHANGE_RELIABILITY.BYBIT,
      gate: ENV.CCXT.EXCHANGE_RELIABILITY.GATE,
      kucoin: ENV.CCXT.EXCHANGE_RELIABILITY.KUCOIN,
      probit: ENV.CCXT.EXCHANGE_RELIABILITY.PROBIT,
      cryptocom: ENV.CCXT.EXCHANGE_RELIABILITY.CRYPTOCOM,
      // Add more exchanges as needed
    };

    return reliabilityFactors[exchangeName] || ENV.CCXT.EXCHANGE_RELIABILITY.DEFAULT;
  }

  protected async doSubscribe(symbols: string[]): Promise<void> {
    // Filter out symbols we're already subscribed to
    const newSymbols = symbols.filter(symbol => !this.subscriptions.has(symbol));

    if (newSymbols.length === 0) {
      this.logger.log(`All symbols already subscribed, skipping: ${symbols.join(", ")}`);
      return;
    }

    this.logger.log(`Subscribing to WebSocket feeds for symbols: ${newSymbols.join(", ")}`);

    // Add symbols to base adapter subscriptions
    for (const symbol of newSymbols) {
      this.subscriptions.add(symbol);
    }

    // Group symbols by exchange based on feeds.json configuration
    const exchangeToSymbols = this.groupSymbolsByExchange(newSymbols);

    // Subscribe to each exchange
    for (const [exchangeId, exchangeSymbols] of exchangeToSymbols) {
      await this.subscribeToExchange(exchangeId, exchangeSymbols);
    }
  }

  protected async doUnsubscribe(symbols: string[]): Promise<void> {
    this.logger.log(`Unsubscribing from WebSocket feeds for symbols: ${symbols.join(", ")}`);

    // Remove symbols from base adapter subscriptions
    for (const symbol of symbols) {
      this.subscriptions.delete(symbol);
    }

    // Remove symbols from exchange-specific subscriptions
    for (const [, exchangeSymbols] of this.exchangeSubscriptions) {
      for (const symbol of symbols) {
        exchangeSymbols.delete(symbol);
      }
    }
  }

  // Real CCXT Pro implementation methods
  private async initializeExchanges(): Promise<void> {
    // Get CCXT-only exchanges from feeds.json configuration
    const ccxtOnlyExchanges = this.configService?.getCcxtExchangesFromFeeds?.() ?? [];

    if (ccxtOnlyExchanges.length === 0) {
      this.logger.warn("No CCXT exchanges found in feeds.json configuration");
      return;
    }

    this.logger.log(`Initializing CCXT exchanges from feeds.json: ${ccxtOnlyExchanges.join(", ")}`);

    // Initialize exchanges in parallel
    const initPromises = ccxtOnlyExchanges.map(async exchangeId => {
      try {
        let exchange: ccxt.Exchange | null = null;

        // Try CCXT Pro first (if available)
        try {
          const ExchangeClass = (ccxt as { pro?: Record<string, typeof ccxt.Exchange> }).pro?.[
            exchangeId
          ] as typeof ccxt.Exchange;
          if (ExchangeClass) {
            exchange = new ExchangeClass({
              newUpdates: true, // Enable real-time updates
              enableRateLimit: true,
              timeout: ENV.TIMEOUTS.CCXT_MS,
              // Add API credentials if available
              apiKey: this.adapterConfig.apiKey,
              secret: this.adapterConfig.apiSecret,
            });
            this.logger.debug(`Initialized ${exchangeId} exchange via CCXT Pro`);
          }
        } catch {
          this.logger.debug(`CCXT Pro not available for ${exchangeId}, falling back to regular CCXT`);
        }

        // Fallback to regular CCXT if Pro failed or not available
        if (!exchange) {
          const ExchangeClass = ccxt[exchangeId as keyof typeof ccxt] as typeof ccxt.Exchange;
          if (ExchangeClass) {
            exchange = new ExchangeClass({
              enableRateLimit: true,
              timeout: ENV.TIMEOUTS.CCXT_MS,
              // Add API credentials if available
              apiKey: this.adapterConfig.apiKey,
              secret: this.adapterConfig.apiSecret,
            });
            this.logger.debug(`Initialized ${exchangeId} exchange via regular CCXT`);
          }
        }

        if (exchange) {
          // Set trades limit for volume calculations
          exchange.options["tradesLimit"] = this.adapterConfig.tradesLimit;

          this.exchanges.set(exchangeId, exchange);
          this.exchangeSubscriptions.set(exchangeId, new Set());

          this.logger.log(`Successfully initialized ${exchangeId} exchange`);
        } else {
          this.logger.warn(`Exchange ${exchangeId} not supported by CCXT library`);
        }
      } catch (error) {
        this.logger.error(`Failed to initialize ${exchangeId} exchange:`, error);
      }
    });

    await Promise.all(initPromises);

    // Log summary of initialized exchanges
    const initializedCount = this.exchanges.size;
    this.logger.log(`Successfully initialized ${initializedCount}/${ccxtOnlyExchanges.length} CCXT exchanges`);
  }

  private groupSymbolsByExchange(symbols: string[]): Map<string, string[]> {
    const exchangeToSymbols = new Map<string, string[]>();

    // Get all feeds from config to map symbols to exchanges
    const feeds = this.configService?.getFeedConfigurations?.() ?? [];

    for (const symbol of symbols) {
      for (const feed of feeds) {
        for (const source of feed.sources) {
          if (source.symbol === symbol) {
            const exchange = source.exchange;
            if (!this.configService?.hasCustomAdapter?.(exchange)) {
              // This is a CCXT exchange
              if (!exchangeToSymbols.has(exchange)) {
                exchangeToSymbols.set(exchange, []);
              }
              exchangeToSymbols.get(exchange)!.push(symbol);
            }
          }
        }
      }
    }

    return exchangeToSymbols;
  }

  private async subscribeToExchange(exchangeId: string, symbols: string[]): Promise<void> {
    const exchange = this.exchanges.get(exchangeId);
    if (!exchange) {
      this.logger.warn(`Exchange ${exchangeId} not available for subscription`);
      return;
    }

    // Check if we already have subscriptions for this exchange
    const existingSubscriptions = this.exchangeSubscriptions.get(exchangeId);
    if (existingSubscriptions && existingSubscriptions.size > 0) {
      this.logger.log(`Exchange ${exchangeId} already has active subscriptions, skipping`);
      return;
    }

    try {
      // Load markets first
      await exchange.loadMarkets();

      // Get market IDs for the symbols
      const marketIds: string[] = [];
      for (const symbol of symbols) {
        const market = exchange.markets[symbol];
        if (market) {
          marketIds.push(market.id);
          this.exchangeSubscriptions.get(exchangeId)?.add(symbol);
        } else {
          this.logger.warn(`Market not found for ${symbol} on ${exchangeId}`);
        }
      }

      if (marketIds.length === 0) {
        this.logger.warn(`No valid markets found for ${exchangeId}`);
        return;
      }

      // Start WebSocket watching
      void this.watchTrades(exchange, marketIds, exchangeId);

      this.logger.log(`Started WebSocket watching for ${marketIds.length} markets on ${exchangeId}`);
    } catch (error) {
      this.logger.error(`Failed to subscribe to ${exchangeId}:`, error);
      // Fall back to REST polling
      this.startRestPolling(exchange, symbols, exchangeId);
    }
  }

  private async watchTrades(exchange: ccxt.Exchange, marketIds: string[], exchangeId: string): Promise<void> {
    try {
      if (exchange.has["watchTradesForSymbols"] && exchangeId !== "bybit") {
        // Use batch watching if supported
        void this.watchTradesForSymbols(exchange, marketIds, exchangeId);
      } else if (exchange.has["watchTrades"]) {
        // Use individual symbol watching
        for (const marketId of marketIds) {
          void this.watchTradesForSymbol(exchange, marketId, exchangeId);
        }
      } else {
        // Fall back to REST polling
        this.logger.warn(`Exchange ${exchangeId} doesn't support WebSocket trades, falling back to REST polling`);
        this.startRestPolling(exchange, marketIds, exchangeId);
      }
    } catch (error) {
      this.logger.error(`Failed to start WebSocket watching for ${exchangeId}:`, error);
      this.startRestPolling(exchange, marketIds, exchangeId);
    }
  }

  private async watchTradesForSymbols(exchange: ccxt.Exchange, marketIds: string[], exchangeId: string): Promise<void> {
    const sinceBySymbol = new Map<string, number>();

    while (this.isWebSocketConnected()) {
      try {
        const trades = await exchange.watchTradesForSymbols(marketIds);

        if (trades.length === 0) {
          await new Promise(resolve => setTimeout(resolve, ENV.CCXT.WEBSOCKET_WAIT_DELAY_MS));
          continue;
        }

        // Filter new trades
        const since = sinceBySymbol.get(trades[0].symbol || "") ?? 0;
        const newTrades = trades
          .filter(trade => trade.timestamp && trade.timestamp > since)
          .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

        if (newTrades.length === 0) {
          await new Promise(resolve => setTimeout(resolve, ENV.CCXT.WEBSOCKET_WAIT_DELAY_MS));
          continue;
        }

        const lastTrade = newTrades[newTrades.length - 1];
        if (lastTrade.symbol && lastTrade.timestamp) {
          this.setPrice(exchangeId, lastTrade.symbol, lastTrade.price, lastTrade.timestamp);
          sinceBySymbol.set(lastTrade.symbol, lastTrade.timestamp);
        }

        // Process volume data
        if (lastTrade.symbol) {
          this.processVolume(exchangeId, lastTrade.symbol, newTrades);
        }
      } catch (error) {
        this.logger.debug(`WebSocket error for ${exchangeId}:`, error);
        await new Promise(resolve => setTimeout(resolve, ENV.CCXT.WEBSOCKET_ERROR_DELAY_MS));
      }
    }
  }

  private async watchTradesForSymbol(exchange: ccxt.Exchange, marketId: string, exchangeId: string): Promise<void> {
    let since: number | undefined;

    while (this.isWebSocketConnected()) {
      try {
        const trades = await exchange.watchTrades(marketId, since);

        if (trades.length === 0) {
          await new Promise(resolve => setTimeout(resolve, ENV.CCXT.WEBSOCKET_WAIT_DELAY_MS));
          continue;
        }

        // Sort trades by timestamp
        trades.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

        const lastTrade = trades[trades.length - 1];
        if (lastTrade.symbol && lastTrade.timestamp) {
          this.setPrice(exchangeId, lastTrade.symbol, lastTrade.price, lastTrade.timestamp);
          since = lastTrade.timestamp + 1;
        }

        // Process volume data
        if (lastTrade.symbol) {
          this.processVolume(exchangeId, lastTrade.symbol, trades);
        }
      } catch (error) {
        this.logger.debug(`WebSocket error for ${exchangeId}/${marketId}:`, error);
        await new Promise(resolve =>
          setTimeout(
            resolve,
            ENV.CCXT.WEBSOCKET_SYMBOL_ERROR_DELAY_MS + Math.random() * ENV.CCXT.WEBSOCKET_ERROR_DELAY_MS
          )
        );
      }
    }
  }

  private startRestPolling(exchange: ccxt.Exchange, marketIds: string[], exchangeId: string): void {
    this.logger.log(`Starting REST polling fallback for ${exchangeId}`);

    const pollInterval = setInterval(async () => {
      if (!this.isWebSocketConnected()) {
        clearInterval(pollInterval);
        return;
      }

      try {
        for (const marketId of marketIds) {
          const trades = await exchange.fetchTrades(marketId);
          if (trades.length > 0) {
            trades.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            const latestTrade = trades[0];
            if (latestTrade.symbol && latestTrade.timestamp) {
              const currentPrice = this.latestPrices.get(latestTrade.symbol)?.get(exchangeId);

              if (!currentPrice || latestTrade.timestamp > currentPrice.time) {
                this.setPrice(exchangeId, latestTrade.symbol, latestTrade.price, latestTrade.timestamp);
                this.processVolume(exchangeId, latestTrade.symbol, [latestTrade]);
              }
            }
          }
        }
      } catch (error) {
        this.logger.debug(`REST polling error for ${exchangeId}:`, error);
      }
    }, ENV.CCXT.REST_POLLING_DELAY_MS);
  }

  private setPrice(exchangeId: string, symbol: string, price: number, timestamp: number): void {
    const symbolPrices = this.latestPrices.get(symbol) || new Map();
    symbolPrices.set(exchangeId, {
      value: price,
      time: timestamp,
      exchange: exchangeId,
    });
    this.latestPrices.set(symbol, symbolPrices);

    // Emit price update callback
    if (this.onPriceUpdateCallback) {
      this.onPriceUpdateCallback({
        symbol,
        price,
        timestamp,
        confidence: this.calculateConfidence({ price, timestamp, source: exchangeId }),
        source: exchangeId,
      });
    }
  }

  private processVolume(exchangeId: string, symbol: string, trades: ccxt.Trade[]): void {
    // Volume processing logic can be implemented here
    // For now, we'll just log the volume data
    this.logger.debug(`Processed ${trades.length} trades for ${symbol} on ${exchangeId}`);
  }

  // WebSocket message handlers (override base adapter methods)
  protected override handleWebSocketMessage(data: unknown): void {
    try {
      // Parse CCXT Pro WebSocket message
      const message = data as { symbol?: string; price?: number; timestamp?: number; exchange?: string };

      if (message.symbol && message.price && message.timestamp) {
        this.setPrice(message.exchange || "unknown", message.symbol, message.price, message.timestamp);
      }
    } catch (error) {
      this.logger.debug(`Failed to process WebSocket message:`, error);
    }
  }

  protected override handleWebSocketClose(): void {
    this.logger.warn("CCXT Pro WebSocket connection closed");
    this.isConnected_ = false;
    this.onConnectionChangeCallback?.(false);
  }

  protected override handleWebSocketError(error: Error): void {
    this.logger.error("CCXT Pro WebSocket error:", error);
    this.onErrorCallback?.(error);
  }

  private async fetchPriceFromExchanges(feedId: CoreFeedId): Promise<PriceUpdate> {
    const symbol = this.normalizeSymbolForCCXT(feedId.name);
    const prices: number[] = [];
    const timestamps: number[] = [];

    // Fetch price from each exchange
    for (const [exchangeId, exchange] of this.exchanges) {
      try {
        const ticker = await exchange.fetchTicker(symbol);
        if (ticker && ticker.last) {
          prices.push(ticker.last);
          timestamps.push(ticker.timestamp || Date.now());
        }
      } catch (error) {
        this.logger.debug(`Failed to fetch price from ${exchangeId}:`, error);
      }
    }

    if (prices.length === 0) {
      throw new Error(`No price data available for ${feedId.name} from any exchange`);
    }

    // Calculate weighted average price
    const avgPrice = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    const latestTimestamp = Math.max(...timestamps);

    // Calculate confidence based on number of sources and price consistency
    const priceVariance = this.calculatePriceVariance(prices);
    const confidence = Math.max(ENV.CCXT.MIN_CONFIDENCE_VARIANCE, ENV.CCXT.MAX_CONFIDENCE - priceVariance / avgPrice);

    return {
      symbol: feedId.name,
      price: avgPrice,
      timestamp: latestTimestamp,
      confidence,
      source: this.exchangeName,
    };
  }

  /**
   * Get price from a specific exchange (for feed-specific requests)
   */
  async getPriceFromExchange(exchangeId: string, feedId: CoreFeedId): Promise<PriceUpdate | null> {
    const symbol = this.normalizeSymbolForCCXT(feedId.name);

    // First try to get price from WebSocket data
    const wsPrice = this.latestPrices.get(symbol)?.get(exchangeId);
    if (wsPrice && this.isFreshData(wsPrice.time)) {
      return {
        symbol: feedId.name,
        price: wsPrice.value,
        timestamp: wsPrice.time,
        confidence: this.calculateConfidence({ price: wsPrice.value, timestamp: wsPrice.time, source: exchangeId }),
        source: exchangeId,
      };
    }

    // Fall back to REST API if WebSocket data is stale or unavailable
    const exchange = this.exchanges.get(exchangeId);
    if (!exchange) {
      this.logger.debug(`Exchange ${exchangeId} not available in CCXT adapter, trying to reinitialize...`);

      // Try to reinitialize the exchange
      try {
        await this.initializeSingleExchange(exchangeId);
        const newExchange = this.exchanges.get(exchangeId);
        if (!newExchange) {
          this.logger.warn(`Failed to reinitialize exchange ${exchangeId}`);
          return null;
        }
        // Use the newly initialized exchange
        return this.fetchPriceFromExchange(newExchange, exchangeId, symbol, feedId);
      } catch (error) {
        this.logger.warn(`Failed to reinitialize exchange ${exchangeId}:`, error);
        return null;
      }
    }

    return this.fetchPriceFromExchange(exchange, exchangeId, symbol, feedId);
  }

  private async fetchPriceFromExchange(
    exchange: ccxt.Exchange,
    exchangeId: string,
    symbol: string,
    feedId: CoreFeedId
  ): Promise<PriceUpdate | null> {
    try {
      const ticker = await exchange.fetchTicker(symbol);

      if (!ticker || !ticker.last) {
        this.logger.debug(`No price data from ${exchangeId} for ${feedId.name}`);
        return null;
      }

      // Update our price cache
      this.setPrice(exchangeId, symbol, ticker.last, ticker.timestamp || Date.now());

      return {
        symbol: feedId.name,
        price: ticker.last,
        timestamp: ticker.timestamp || Date.now(),
        confidence: this.calculateConfidence({
          price: ticker.last,
          timestamp: ticker.timestamp || Date.now(),
          source: exchangeId,
        }),
        source: exchangeId,
      };
    } catch (error) {
      this.logger.debug(`Failed to fetch price from ${exchangeId} for ${feedId.name}:`, error);
      return null;
    }
  }

  private async initializeSingleExchange(exchangeId: string): Promise<void> {
    try {
      let exchange: ccxt.Exchange | null = null;

      // Try CCXT Pro first (if available)
      try {
        const ExchangeClass = (ccxt as { pro?: Record<string, typeof ccxt.Exchange> }).pro?.[
          exchangeId
        ] as typeof ccxt.Exchange;
        if (ExchangeClass) {
          exchange = new ExchangeClass({
            newUpdates: true,
            enableRateLimit: true,
            timeout: 10000,
            apiKey: this.adapterConfig.apiKey,
            secret: this.adapterConfig.apiSecret,
          });
        }
      } catch {
        // Fallback to regular CCXT
      }

      // Fallback to regular CCXT if Pro failed or not available
      if (!exchange) {
        const ExchangeClass = ccxt[exchangeId as keyof typeof ccxt] as typeof ccxt.Exchange;
        if (ExchangeClass) {
          exchange = new ExchangeClass({
            enableRateLimit: true,
            timeout: 10000,
            apiKey: this.adapterConfig.apiKey,
            secret: this.adapterConfig.apiSecret,
          });
        }
      }

      if (exchange) {
        exchange.options["tradesLimit"] = this.adapterConfig.tradesLimit;
        this.exchanges.set(exchangeId, exchange);
        this.exchangeSubscriptions.set(exchangeId, new Set());
        this.logger.debug(`Reinitialized ${exchangeId} exchange`);
      }
    } catch (error) {
      this.logger.error(`Failed to reinitialize exchange ${exchangeId}:`, error);
      throw error;
    }
  }

  private isFreshData(timestamp: number): boolean {
    const maxAge = ENV.CCXT.MAX_DATA_AGE_MS;
    return Date.now() - timestamp < maxAge;
  }

  private async fetchVolumeFromExchanges(feedId: CoreFeedId, _volumeWindow: number): Promise<VolumeUpdate> {
    const symbol = this.normalizeSymbolForCCXT(feedId.name);
    let totalVolume = 0;
    let latestTimestamp = Date.now();

    // Fetch volume from each exchange
    for (const [exchangeId, exchange] of this.exchanges) {
      try {
        const ticker = await exchange.fetchTicker(symbol);
        if (ticker && ticker.baseVolume) {
          totalVolume += ticker.baseVolume;
          if (ticker.timestamp) {
            latestTimestamp = Math.max(latestTimestamp, ticker.timestamp);
          }
        }
      } catch (error) {
        this.logger.debug(`Failed to fetch volume from ${exchangeId}:`, error);
      }
    }

    return {
      symbol: feedId.name,
      volume: totalVolume,
      timestamp: latestTimestamp,
      source: this.exchangeName,
    };
  }

  private async fetchPriceMapFromExchanges(): Promise<Map<string, Map<string, { value: number; time: number }>>> {
    const priceMap = new Map<string, Map<string, { value: number; time: number }>>();
    const symbols = ["BTC/USD", "ETH/USD", "XRP/USD", "ALGO/USD", "FLR/USD"];

    for (const symbol of symbols) {
      const exchangeMap = new Map<string, { value: number; time: number }>();
      const ccxtSymbol = this.normalizeSymbolForCCXT(symbol);

      for (const [exchangeId, exchange] of this.exchanges) {
        try {
          const ticker = await exchange.fetchTicker(ccxtSymbol);
          if (ticker && ticker.last) {
            exchangeMap.set(exchangeId, {
              value: ticker.last,
              time: ticker.timestamp || Date.now(),
            });
          }
        } catch (error) {
          this.logger.debug(`Failed to fetch ${symbol} from ${exchangeId}:`, error);
        }
      }

      if (exchangeMap.size > 0) {
        priceMap.set(symbol, exchangeMap);
      }
    }

    return priceMap;
  }

  private normalizeSymbolForCCXT(symbol: string): string {
    // CCXT uses the same format as FTSO (BTC/USD)
    return symbol;
  }

  private calculatePriceVariance(prices: number[]): number {
    if (prices.length <= 1) return 0;

    const mean = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    const variance = prices.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) / prices.length;
    return Math.sqrt(variance);
  }

  // Required methods for BaseExchangeAdapter
  protected override calculateConfidence(rawData: RawPriceData, _context?: unknown): number {
    // Simple confidence calculation based on data quality
    let confidence = ENV.CCXT.BASE_CONFIDENCE;

    if (rawData.price && typeof rawData.price === "number" && rawData.price > 0) {
      confidence += ENV.CCXT.PRICE_CONFIDENCE_BOOST;
    }

    if (
      rawData.timestamp &&
      typeof rawData.timestamp === "number" &&
      Date.now() - rawData.timestamp < ENV.CCXT.TIMESTAMP_FRESH_THRESHOLD_MS
    ) {
      confidence += ENV.CCXT.TIMESTAMP_CONFIDENCE_BOOST;
    }

    return Math.min(confidence, ENV.CCXT.MAX_CONFIDENCE);
  }

  public override recordSuccessfulRequest(): void {
    this._successCount++;
    this._requestCount++;
  }

  public override recordFailedRequest(): void {
    this._errorCount++;
    this._requestCount++;
  }
}
