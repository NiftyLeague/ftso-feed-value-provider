import {
  ExchangeAdapter,
  ExchangeCapabilities,
  ExchangeConnectionConfig,
} from "@/interfaces/exchange-adapter.interface";
import { PriceUpdate, VolumeUpdate } from "@/interfaces/data-source.interface";
import { FeedCategory } from "@/types/feed-category.enum";
import { EnhancedFeedId } from "@/types/enhanced-feed-id.types";
import { CcxtFeed } from "@/data-feeds/ccxt-provider-service";
import { Logger } from "@nestjs/common";

export interface CcxtMultiExchangeConfig extends ExchangeConnectionConfig {
  tradesLimit?: number; // CCXT trades limit (default: 1000)
  lambda?: number; // Exponential decay parameter (default: 0.00005)
  retryBackoffMs?: number; // Retry backoff in milliseconds (default: 10000)
  enableUsdtConversion?: boolean; // Enable USDT to USD conversion (default: true)
  tier1Exchanges?: string[]; // Exchanges handled by custom adapters (default: ["binance", "coinbase", "kraken", "okx"])
}

export interface CcxtMultiExchangeMetrics {
  priceExtractionCount: number;
  successfulExtractions: number;
  failedExtractions: number;
  averageExtractionTime: number;
  lastExtractionTime?: number;
  tier2ExchangeCount: number;
}

export interface ExchangePriceData {
  exchange: string;
  price: number;
  timestamp: number;
  confidence: number;
  volume?: number;
}

export class CcxtMultiExchangeAdapter extends ExchangeAdapter {
  readonly exchangeName = "ccxt-multi-exchange";
  readonly category = FeedCategory.Crypto;
  readonly capabilities: ExchangeCapabilities = {
    supportsWebSocket: true, // CCXT Pro supports WebSocket via watchTradesForSymbols/watchTrades
    supportsREST: true,
    supportsVolume: true,
    supportsOrderBook: false,
    supportedCategories: [FeedCategory.Crypto],
  };

  private readonly logger = new Logger(CcxtMultiExchangeAdapter.name);
  private ccxtFeed: CcxtFeed;
  private isInitialized = false;
  protected adapterConfig: CcxtMultiExchangeConfig; // Changed from private to protected to match base class
  private metrics: CcxtMultiExchangeMetrics = {
    priceExtractionCount: 0,
    successfulExtractions: 0,
    failedExtractions: 0,
    averageExtractionTime: 0,
    tier2ExchangeCount: 0,
  };

  // Critical USDT/USD feed for conversion
  private readonly usdtToUsdFeedId: EnhancedFeedId = {
    category: FeedCategory.Crypto,
    name: "USDT/USD",
  };

  constructor(config?: CcxtMultiExchangeConfig) {
    super(config);
    this.adapterConfig = {
      tradesLimit: 1000,
      lambda: 0.00005,
      retryBackoffMs: 10000,
      enableUsdtConversion: true,
      tier1Exchanges: ["binance", "coinbase", "kraken", "okx", "cryptocom"],
      ...config,
    };
    this.ccxtFeed = new CcxtFeed();
  }

  async connect(): Promise<void> {
    if (this.isInitialized) {
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

      await this.ccxtFeed.start();
      this.isInitialized = true;
      this.logger.log("CCXT multi-exchange adapter initialized successfully");
    } catch (error) {
      this.logger.error("Failed to initialize CCXT multi-exchange adapter:", error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.isInitialized = false;
    // CCXT doesn't have a clean shutdown method, but we can mark as disconnected
    this.logger.log("CCXT multi-exchange adapter disconnected");
  }

  isConnected(): boolean {
    return this.isInitialized;
  }

  normalizePriceData(rawData: any): PriceUpdate {
    // CCXT adapter doesn't receive raw data in the traditional sense
    // This method is called internally after fetching from CCXT
    const { feedId, price, timestamp } = rawData;

    return {
      symbol: feedId.name,
      price,
      timestamp: timestamp || Date.now(),
      source: this.exchangeName,
      confidence: this.calculateConfidence(rawData, {
        latency: Date.now() - (timestamp || Date.now()),
      }),
    };
  }

  normalizeVolumeData(rawData: any): VolumeUpdate {
    const { feedId, volume, timestamp } = rawData;

    return {
      symbol: feedId.name,
      volume,
      timestamp: timestamp || Date.now(),
      source: this.exchangeName,
    };
  }

  validateResponse(rawData: any): boolean {
    return !!(
      rawData &&
      typeof rawData === "object" &&
      rawData.feedId &&
      typeof rawData.price === "number" &&
      !isNaN(rawData.price) &&
      rawData.price > 0
    );
  }

  // Get single price from CCXT (for backward compatibility)
  async getCcxtPrice(feedId: EnhancedFeedId): Promise<PriceUpdate> {
    const startTime = Date.now();
    this.metrics.priceExtractionCount++;

    try {
      // Ensure CCXT is initialized
      if (!this.isInitialized) {
        await this.connect();
      }

      // Convert EnhancedFeedId to CCXT FeedId format
      const ccxtFeedId = {
        category: feedId.category,
        name: feedId.name,
      };

      // Get price from CCXT
      const feedValueData = await this.ccxtFeed.getValue(ccxtFeedId);

      if (!feedValueData || feedValueData.value === undefined) {
        throw new Error(`No price data available for ${feedId.name}`);
      }

      const extractionTime = Date.now() - startTime;
      this.updateMetrics(extractionTime, true);

      // Create normalized price update
      const priceUpdate = this.normalizePriceData({
        feedId,
        price: feedValueData.value,
        timestamp: Date.now(),
      });

      this.logger.debug(
        `CCXT price extraction successful for ${feedId.name}: ${feedValueData.value} (${extractionTime}ms)`
      );

      return priceUpdate;
    } catch (error) {
      const extractionTime = Date.now() - startTime;
      this.updateMetrics(extractionTime, false);

      this.logger.error(`CCXT price extraction failed for ${feedId.name}:`, error);
      throw new Error(`CCXT price extraction failed: ${error}`);
    }
  }

  // NEW: Extract individual exchange prices from CCXT latestPrice Map
  async getIndividualPrices(feedId: EnhancedFeedId): Promise<ExchangePriceData[]> {
    const startTime = Date.now();

    try {
      // Ensure CCXT is initialized
      if (!this.isInitialized) {
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
  async getVolumeData(feedId: EnhancedFeedId, volumeWindow: number): Promise<VolumeUpdate> {
    try {
      if (!this.isInitialized) {
        await this.connect();
      }

      const ccxtFeedId = {
        category: feedId.category,
        name: feedId.name,
      };

      const volumeData = await this.ccxtFeed.getVolumes([ccxtFeedId], volumeWindow);

      if (!volumeData || volumeData.length === 0) {
        throw new Error(`No volume data available for ${feedId.name}`);
      }

      const totalVolume = volumeData[0].volumes.reduce((sum, vol) => sum + vol.volume, 0);

      return this.normalizeVolumeData({
        feedId,
        volume: totalVolume,
        timestamp: Date.now(),
      });
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
      this.logger.warn(`Failed to convert USDT to USD, using USDT price as-is:`, error);
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
  async getTier2Prices(feedId: EnhancedFeedId): Promise<ExchangePriceData[]> {
    try {
      const individualPrices = await this.getIndividualPrices(feedId);

      // Filter out Tier 1 exchanges (these should be handled by custom adapters)
      const tier1Exchanges = new Set(
        this.adapterConfig.tier1Exchanges || ["binance", "coinbase", "kraken", "okx", "cryptocom"]
      );
      const tier2Prices = individualPrices.filter(price => !tier1Exchanges.has(price.exchange.toLowerCase()));

      this.metrics.tier2ExchangeCount = tier2Prices.length;

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
  canProvideTier2Data(feedId: EnhancedFeedId): boolean {
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
  getAvailableTier2Exchanges(feedId: EnhancedFeedId): string[] {
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

  // Get metrics
  getMetrics(): CcxtMultiExchangeMetrics {
    return { ...this.metrics };
  }

  // Reset metrics
  resetMetrics(): void {
    this.metrics = {
      priceExtractionCount: 0,
      successfulExtractions: 0,
      failedExtractions: 0,
      averageExtractionTime: 0,
      tier2ExchangeCount: 0,
    };
  }

  // Health check using CCXT
  async healthCheck(): Promise<boolean> {
    try {
      if (!this.isInitialized) {
        return false;
      }

      // Try to get a price for a common pair to verify CCXT is working
      const testFeedId: EnhancedFeedId = {
        category: FeedCategory.Crypto,
        name: "BTC/USD",
      };

      const result = await this.getCcxtPrice(testFeedId);
      return result.price > 0;
    } catch {
      return false;
    }
  }

  // Get configuration
  getConfig(): CcxtMultiExchangeConfig {
    return { ...this.adapterConfig };
  }

  // Update configuration
  updateConfig(config: Partial<CcxtMultiExchangeConfig>): void {
    this.adapterConfig = { ...this.adapterConfig, ...config };
  }

  // Private helper methods
  private updateMetrics(extractionTime: number, success: boolean): void {
    if (success) {
      this.metrics.successfulExtractions++;
    } else {
      this.metrics.failedExtractions++;
    }

    // Update average extraction time
    const totalExtractions = this.metrics.successfulExtractions + this.metrics.failedExtractions;
    this.metrics.averageExtractionTime =
      (this.metrics.averageExtractionTime * (totalExtractions - 1) + extractionTime) / totalExtractions;

    this.metrics.lastExtractionTime = Date.now();
  }

  // Access CCXT's private latestPrice Map using reflection
  private getLatestPriceMap(): Map<string, Map<string, any>> {
    try {
      // Access the private latestPrice property from CcxtFeed
      const latestPriceMap = (this.ccxtFeed as any).latestPrice;
      if (!latestPriceMap || !(latestPriceMap instanceof Map)) {
        throw new Error("Unable to access CCXT latestPrice Map");
      }
      return latestPriceMap;
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
  private calculateIndividualConfidence(_priceInfo: any, dataAge: number, exchangeName: string): number {
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

  // Required abstract methods (not used in CCXT context)
  async subscribe(symbols: string[]): Promise<void> {
    // CCXT adapter doesn't use subscriptions - it uses the existing CCXT service
    this.logger.debug(`CCXT adapter doesn't support subscriptions for: ${symbols.join(", ")}`);
  }

  async unsubscribe(symbols: string[]): Promise<void> {
    // CCXT adapter doesn't use subscriptions
    this.logger.debug(`CCXT adapter doesn't support unsubscriptions for: ${symbols.join(", ")}`);
  }

  onPriceUpdate(_callback: (update: PriceUpdate) => void): void {
    // CCXT adapter is pull-based, not push-based
    this.logger.debug("CCXT adapter doesn't support price update callbacks");
  }

  onConnectionChange(_callback: (connected: boolean) => void): void {
    // CCXT adapter doesn't have connection state changes in the traditional sense
    this.logger.debug("CCXT adapter doesn't support connection change callbacks");
  }
}
