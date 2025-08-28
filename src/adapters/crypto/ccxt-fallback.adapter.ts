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

export interface CcxtFallbackConfig extends ExchangeConnectionConfig {
  fallbackDelay?: number; // Delay before falling back to CCXT (default: 50ms)
  tradesLimit?: number; // CCXT trades limit (default: 1000)
  lambda?: number; // Exponential decay parameter (default: 0.00005)
  retryBackoffMs?: number; // Retry backoff in milliseconds (default: 10000)
  enableUsdtConversion?: boolean; // Enable USDT to USD conversion (default: true)
}

export interface CcxtFallbackMetrics {
  fallbackCount: number;
  successfulFallbacks: number;
  failedFallbacks: number;
  averageFallbackTime: number;
  lastFallbackTime?: number;
}

export class CcxtFallbackAdapter extends ExchangeAdapter {
  readonly exchangeName = "ccxt-fallback";
  readonly category = FeedCategory.Crypto;
  readonly capabilities: ExchangeCapabilities = {
    supportsWebSocket: false, // CCXT fallback is REST-based
    supportsREST: true,
    supportsVolume: true,
    supportsOrderBook: false,
    supportedCategories: [FeedCategory.Crypto],
  };

  private readonly logger = new Logger(CcxtFallbackAdapter.name);
  private ccxtFeed: CcxtFeed;
  private isInitialized = false;
  private fallbackConfig: CcxtFallbackConfig;
  private metrics: CcxtFallbackMetrics = {
    fallbackCount: 0,
    successfulFallbacks: 0,
    failedFallbacks: 0,
    averageFallbackTime: 0,
  };

  // Critical USDT/USD feed for conversion
  private readonly usdtToUsdFeedId: EnhancedFeedId = {
    category: FeedCategory.Crypto,
    name: "USDT/USD",
  };

  constructor(config?: CcxtFallbackConfig) {
    super(config);
    this.fallbackConfig = {
      fallbackDelay: 50, // 50ms max delay for FTSO requirements
      tradesLimit: 1000,
      lambda: 0.00005,
      retryBackoffMs: 10000,
      enableUsdtConversion: true,
      ...config,
    };
    this.initializeSymbolConventions();
    this.ccxtFeed = new CcxtFeed();
  }

  async connect(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      this.logger.log("Initializing CCXT fallback adapter...");

      // Set environment variables for CCXT configuration
      if (this.fallbackConfig.lambda) {
        process.env.MEDIAN_DECAY = this.fallbackConfig.lambda.toString();
      }
      if (this.fallbackConfig.tradesLimit) {
        process.env.TRADES_HISTORY_SIZE = this.fallbackConfig.tradesLimit.toString();
      }

      await this.ccxtFeed.start();
      this.isInitialized = true;
      this.logger.log("CCXT fallback adapter initialized successfully");
    } catch (error) {
      this.logger.error("Failed to initialize CCXT fallback adapter:", error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.isInitialized = false;
    // CCXT doesn't have a clean shutdown method, but we can mark as disconnected
    this.logger.log("CCXT fallback adapter disconnected");
  }

  isConnected(): boolean {
    return this.isInitialized;
  }

  normalizePriceData(rawData: any): PriceUpdate {
    // CCXT fallback doesn't receive raw data in the traditional sense
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

  // Main fallback method - called when WebSocket adapters fail
  async fallbackToCcxt(feedId: EnhancedFeedId): Promise<PriceUpdate> {
    const startTime = Date.now();
    this.metrics.fallbackCount++;

    try {
      // Ensure CCXT is initialized
      if (!this.isInitialized) {
        await this.connect();
      }

      // Add fallback delay if configured (for FTSO timing requirements)
      if (this.fallbackConfig.fallbackDelay && this.fallbackConfig.fallbackDelay > 0) {
        await this.sleep(this.fallbackConfig.fallbackDelay);
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

      const fallbackTime = Date.now() - startTime;
      this.updateMetrics(fallbackTime, true);

      // Create normalized price update
      const priceUpdate = this.normalizePriceData({
        feedId,
        price: feedValueData.value,
        timestamp: Date.now(),
      });

      this.logger.debug(`CCXT fallback successful for ${feedId.name}: ${feedValueData.value} (${fallbackTime}ms)`);

      return priceUpdate;
    } catch (error) {
      const fallbackTime = Date.now() - startTime;
      this.updateMetrics(fallbackTime, false);

      this.logger.error(`CCXT fallback failed for ${feedId.name}:`, error);
      throw new Error(`CCXT fallback failed: ${error}`);
    }
  }

  // Volume fallback method
  async fallbackToVolumeData(feedId: EnhancedFeedId, volumeWindow: number): Promise<VolumeUpdate> {
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
      this.logger.error(`CCXT volume fallback failed for ${feedId.name}:`, error);
      throw new Error(`CCXT volume fallback failed: ${error}`);
    }
  }

  // USDT to USD conversion using CCXT's existing logic
  async convertUsdtToUsd(usdtPrice: number): Promise<number> {
    if (!this.fallbackConfig.enableUsdtConversion) {
      return usdtPrice; // Return as-is if conversion disabled
    }

    try {
      const usdtToUsdPrice = await this.fallbackToCcxt(this.usdtToUsdFeedId);
      return usdtPrice * usdtToUsdPrice.price;
    } catch (error) {
      this.logger.warn(`Failed to convert USDT to USD, using USDT price as-is:`, error);
      return usdtPrice; // Fallback to original price
    }
  }

  // Check if USDT/USD feed is available and prioritized
  async ensureUsdtFeedAvailable(): Promise<boolean> {
    try {
      const usdtPrice = await this.fallbackToCcxt(this.usdtToUsdFeedId);
      return usdtPrice.price > 0;
    } catch {
      return false;
    }
  }

  // Seamless fallback from WebSocket to CCXT REST using same exchanges
  async seamlessFallback(feedId: EnhancedFeedId, primaryAdapterName: string, error: Error): Promise<PriceUpdate> {
    this.logger.warn(
      `Primary adapter ${primaryAdapterName} failed for ${feedId.name}, falling back to CCXT: ${error.message}`
    );

    try {
      return await this.fallbackToCcxt(feedId);
    } catch (fallbackError) {
      this.logger.error(
        `Both primary adapter ${primaryAdapterName} and CCXT fallback failed for ${feedId.name}:`,
        fallbackError
      );
      throw new Error(
        `Complete failure: Primary (${primaryAdapterName}): ${error.message}, Fallback (CCXT): ${fallbackError}`
      );
    }
  }

  // Get fallback metrics
  getMetrics(): CcxtFallbackMetrics {
    return { ...this.metrics };
  }

  // Reset metrics
  resetMetrics(): void {
    this.metrics = {
      fallbackCount: 0,
      successfulFallbacks: 0,
      failedFallbacks: 0,
      averageFallbackTime: 0,
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

      const result = await this.fallbackToCcxt(testFeedId);
      return result.price > 0;
    } catch {
      return false;
    }
  }

  // Get configuration
  getFallbackConfig(): CcxtFallbackConfig {
    return { ...this.fallbackConfig };
  }

  // Update configuration
  updateFallbackConfig(config: Partial<CcxtFallbackConfig>): void {
    this.fallbackConfig = { ...this.fallbackConfig, ...config };
  }

  // Private helper methods
  private updateMetrics(fallbackTime: number, success: boolean): void {
    if (success) {
      this.metrics.successfulFallbacks++;
    } else {
      this.metrics.failedFallbacks++;
    }

    // Update average fallback time
    const totalFallbacks = this.metrics.successfulFallbacks + this.metrics.failedFallbacks;
    this.metrics.averageFallbackTime =
      (this.metrics.averageFallbackTime * (totalFallbacks - 1) + fallbackTime) / totalFallbacks;

    this.metrics.lastFallbackTime = Date.now();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Required abstract methods (not used in fallback context)
  async subscribe(symbols: string[]): Promise<void> {
    // CCXT fallback doesn't use subscriptions
    this.logger.debug(`CCXT fallback adapter doesn't support subscriptions for: ${symbols.join(", ")}`);
  }

  async unsubscribe(symbols: string[]): Promise<void> {
    // CCXT fallback doesn't use subscriptions
    this.logger.debug(`CCXT fallback adapter doesn't support unsubscriptions for: ${symbols.join(", ")}`);
  }

  onPriceUpdate(callback: (update: PriceUpdate) => void): void {
    // CCXT fallback is pull-based, not push-based
    this.logger.debug("CCXT fallback adapter doesn't support price update callbacks");
  }

  onConnectionChange(callback: (connected: boolean) => void): void {
    // CCXT fallback doesn't have connection state changes in the traditional sense
    this.logger.debug("CCXT fallback adapter doesn't support connection change callbacks");
  }
}
