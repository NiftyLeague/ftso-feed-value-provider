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
import { getFeedConfiguration } from "@/common/utils";
import * as ccxt from "ccxt";

export interface CcxtMultiExchangeConnectionConfig extends ExchangeConnectionConfig {
  tradesLimit?: number; // CCXT trades limit (default: 1000)
  lambda?: number; // Exponential decay parameter (default: 0.00005)
  retryBackoffMs?: number; // Retry backoff in milliseconds (default: 10000)
  tier1Exchanges?: string[]; // Exchanges handled by custom adapters (default: ["binance", "coinbase", "kraken", "okx"])
  useEnhancedLogging?: boolean; // Enable enhanced logging (default: false)
}

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

  protected adapterConfig: CcxtMultiExchangeConnectionConfig = {
    tradesLimit: ENV.CCXT.TRADES_LIMIT,
    lambda: ENV.CCXT.LAMBDA_DECAY,
    retryBackoffMs: ENV.CCXT.RETRY_BACKOFF_MS,

    tier1Exchanges: ["binance", "coinbase", "kraken", "okx", "cryptocom"],
  };

  // Metrics tracking
  protected tier2ExchangeCount = 0;

  // CCXT Pro exchange instances
  private exchanges: Map<string, ccxt.Exchange> = new Map();

  // CCXT connection tracking properties
  private ccxtConnectionStatus: Map<string, boolean> = new Map(); // exchange -> connected status
  private watchTradesActive: Map<string, boolean> = new Map(); // exchange -> watching status

  // Exchange-specific tracking
  private exchangeSubscriptions: Map<string, Set<string>> = new Map(); // exchange -> symbols
  private latestPrices: Map<string, Map<string, { value: number; time: number; exchange: string }>> = new Map(); // symbol -> exchange -> price info
  private lastSubscriptionAttempt: Map<string, number> = new Map(); // exchange -> timestamp
  private readonly SUBSCRIPTION_COOLDOWN_MS = 3000; // 3 second cooldown between subscription attempts per exchange (reduced)
  private recentSubscriptionCalls: Array<{ timestamp: number; symbols: string[] }> = []; // Track recent calls for debugging
  private pendingSubscriptions: Map<string, string[]> = new Map(); // exchange -> pending symbols
  private subscriptionBatchTimer: Map<string, NodeJS.Timeout> = new Map(); // exchange -> timer
  private readonly SUBSCRIPTION_BATCH_DELAY_MS = 200; // 200ms delay to batch subscriptions (reduced for faster response)

  constructor(
    config?: CcxtMultiExchangeConnectionConfig,
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

    // Initialize connection tracking
    this.ccxtConnectionStatus.clear();
    this.watchTradesActive.clear();

    this.initValidation();
    this.setConnectionStatus(ServiceStatus.Unknown);
  }

  /**
   * Check CCXT-specific connection status instead of base adapter WebSocket
   * Returns true when any CCXT exchange has active connections
   */
  private isCcxtWebSocketConnected(): boolean {
    // Handle edge case when no exchanges are configured
    if (this.ccxtConnectionStatus.size === 0) {
      return false;
    }

    // Return true when any CCXT exchange has active connections
    for (const [exchangeId, connected] of this.ccxtConnectionStatus) {
      if (connected && this.watchTradesActive.get(exchangeId)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Update exchange connection status
   */
  private setCcxtConnectionStatus(exchangeId: string, connected: boolean): void {
    this.ccxtConnectionStatus.set(exchangeId, connected);
    this.logger.debug(`CCXT connection status for ${exchangeId}: ${connected ? "connected" : "disconnected"}`);
  }

  /**
   * Start watching trades for an exchange
   */
  private startWatchingTrades(exchangeId: string): void {
    this.watchTradesActive.set(exchangeId, true);
    this.logger.debug(`Started watching trades for ${exchangeId}`);
  }

  /**
   * Stop watching trades for an exchange
   */
  private stopWatchingTrades(exchangeId: string): void {
    this.watchTradesActive.set(exchangeId, false);
    this.logger.debug(`Stopped watching trades for ${exchangeId}`);
  }

  /**
   * Clean up connection tracking when connections are closed
   */
  private cleanupConnectionTracking(exchangeId?: string): void {
    if (exchangeId) {
      // Clean up specific exchange
      this.ccxtConnectionStatus.delete(exchangeId);
      this.watchTradesActive.delete(exchangeId);
      this.logger.debug(`Cleaned up connection tracking for ${exchangeId}`);
    } else {
      // Clean up all exchanges
      this.ccxtConnectionStatus.clear();
      this.watchTradesActive.clear();
      this.logger.debug("Cleaned up all connection tracking");
    }
  }

  protected async doConnect(): Promise<void> {
    if (this.isConnected()) return;

    try {
      this.logger.log("Initializing CCXT Pro multi-exchange adapter...");

      // Initialize connection tracking Maps when adapter connects
      this.ccxtConnectionStatus.clear();
      this.watchTradesActive.clear();
      this.logger.debug("Initialized CCXT connection tracking maps");

      // Note: CCXT configuration is handled through the adapter config
      // The centralized ENV constants are used for application-wide settings

      // Initialize CCXT Pro exchanges
      await this.initializeExchanges();

      // Set up CCXT connection monitoring for initialized exchanges
      for (const [exchangeId] of this.exchanges) {
        this.setCcxtConnectionStatus(exchangeId, false); // Initially disconnected
        this.watchTradesActive.set(exchangeId, false); // Initially not watching
        this.logger.debug(`Set up connection monitoring for exchange: ${exchangeId}`);
      }

      this.setConnectionStatus(ServiceStatus.Connected);
      this.logger.log("CCXT Pro multi-exchange adapter initialized successfully");

      // Integrate with existing connection status reporting
      this.logger.debug(`CCXT adapter connected with ${this.exchanges.size} exchanges ready for monitoring`);
    } catch (error) {
      this.logger.error("Failed to initialize CCXT Pro multi-exchange adapter:", error);
      throw error;
    }
  }

  protected async doDisconnect(): Promise<void> {
    this.logger.log("Disconnecting CCXT Pro adapter...");

    // Stop all active watching loops gracefully
    for (const [exchangeId] of this.watchTradesActive) {
      this.stopWatchingTrades(exchangeId);
      this.logger.debug(`Stopped watching trades for ${exchangeId}`);
    }

    // Disconnect WebSocket if connected
    if (this.isWebSocketConnected()) {
      await this.disconnectWebSocket();
    }

    // Clear subscriptions
    this.exchangeSubscriptions.clear();

    // Clear price cache
    this.latestPrices.clear();

    // Clean up connection tracking when adapter disconnects
    this.cleanupConnectionTracking();
    this.logger.debug("Cleaned up all CCXT connection tracking");

    // Clear connection status for all exchanges
    for (const [exchangeId] of this.exchanges) {
      this.setCcxtConnectionStatus(exchangeId, false);
      this.logger.debug(`Cleared connection status for ${exchangeId}`);
    }

    this.setConnectionStatus(ServiceStatus.Disconnected);
    this.logger.log("CCXT Pro multi-exchange adapter disconnected");
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

    // Use current timestamp instead of exchange timestamp to avoid stale data issues
    const currentTimestamp = Date.now();

    return {
      symbol: (feedId as CoreFeedId).name, // Cast feedId to CoreFeedId
      price: numericPrice,
      timestamp: currentTimestamp, // Always use current timestamp for real-time data
      source: this.exchangeName,
      confidence: this.calculateConfidence(rawData, {
        latency: 0, // Real-time data
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
    try {
      // Ensure CCXT is connected
      if (!this.isConnected()) {
        await this.connect();
      }

      // Get price from CCXT using real exchange data
      const price = await this.fetchPriceFromExchanges(feedId);

      this.updateMetrics(true);

      return price;
    } catch (error) {
      this.updateMetrics(false);

      this.logger.error(`CCXT price extraction failed for ${feedId.name}:`, error);
      throw new Error(`CCXT price extraction failed: ${error}`);
    }
  }

  // NEW: Extract individual exchange prices from CCXT latestPrice Map
  async getIndividualPrices(feedId: CoreFeedId): Promise<ExchangePriceData[]> {
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

          // Calculate confidence based on data age
          const dataAge = Date.now() - priceInfo.time;
          const confidence = this.calculateIndividualConfidence(priceInfo, dataAge);

          individualPrices.push({
            exchange: exchangeName,
            price,
            timestamp: priceInfo.time,
            confidence,
          });
        } catch (error) {
          // Handle individual trade processing errors without stopping loops
          this.logger.warn(
            `Failed to process individual price for ${exchangeName} (continuing with other exchanges):`,
            {
              exchangeName,
              feedId: feedId.name,
              errorMessage: (error as Error).message,
              errorName: (error as Error).name,
              errorHandling: "continue with other exchanges",
              timestamp: new Date().toISOString(),
              // Log trade data parsing issues with context
              context: {
                priceInfo: priceInfo
                  ? {
                      hasValue: typeof priceInfo.value === "number",
                      hasTime: typeof priceInfo.time === "number",
                      dataAge: priceInfo.time ? Date.now() - priceInfo.time : "unknown",
                    }
                  : "no price info",
              },
            }
          );
          // Continue with other exchanges
        }
      }

      this.logger.debug(`Extracted ${individualPrices.length} individual prices for ${feedId.name}`);

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

  // Get metrics with additional CCXT-specific metrics
  override getMetrics(): Record<string, number> {
    const baseMetrics = super.getMetrics() || {};
    return {
      ...baseMetrics,
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

  /**
   * Reset CCXT-specific metrics
   */
  public resetMetrics(): void {
    this.tier2ExchangeCount = 0;
    // Use base class method to reset rate limit counters
    this.resetRateLimitCounters();
    this.logger.debug("CCXT metrics reset");
  }

  // Private helper methods
  private updateMetrics(success: boolean): void {
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

  // Calculate confidence for individual exchange prices - simplified since we no longer adjust based on age
  private calculateIndividualConfidence(_priceInfo: { value: number; time: number }, _dataAge: number): number {
    return ENV.CCXT.INITIAL_CONFIDENCE;
  }

  protected async doSubscribe(symbols: string[]): Promise<void> {
    // Filter out symbols we're already subscribed to
    const newSymbols = symbols.filter(symbol => !this.subscriptions.has(symbol));

    if (newSymbols.length === 0) {
      // Only log at debug level to reduce noise
      this.logger.debug(`All symbols already subscribed, skipping: ${symbols.join(", ")}`);
      return;
    }

    // Track recent subscription calls for debugging
    const now = Date.now();
    this.recentSubscriptionCalls.push({ timestamp: now, symbols: [...newSymbols] });

    // Keep only last 10 calls and clean up old ones (older than 30 seconds)
    this.recentSubscriptionCalls = this.recentSubscriptionCalls.filter(call => now - call.timestamp < 30000).slice(-10);

    // Check for rapid repeated calls (same symbols within 5 seconds)
    const recentSimilarCalls = this.recentSubscriptionCalls.filter(
      call =>
        now - call.timestamp < 5000 &&
        call.symbols.length === newSymbols.length &&
        call.symbols.every(symbol => newSymbols.includes(symbol))
    );

    if (recentSimilarCalls.length > 1) {
      this.logger.warn(
        `Detected ${recentSimilarCalls.length} similar subscription calls within 5 seconds for symbols: ${newSymbols.join(", ")}`
      );
    }

    // Log with context about the caller to help identify repeated calls
    this.logger.log(`CCXT adapter subscribing to ${newSymbols.length} symbols: ${newSymbols.join(", ")}`);

    // Add symbols to base adapter subscriptions
    for (const symbol of newSymbols) {
      this.subscriptions.add(symbol);
    }

    // Group symbols by exchange based on feeds.json configuration
    const exchangeToSymbols = this.groupSymbolsByExchange(newSymbols);

    if (exchangeToSymbols.size === 0) {
      this.logger.warn(`No CCXT exchanges found for symbols: ${newSymbols.join(", ")}`);
      return;
    }

    this.logger.debug(`Grouped ${newSymbols.length} symbols across ${exchangeToSymbols.size} exchanges`);

    // Subscribe to each exchange with batching
    for (const [exchangeId, exchangeSymbols] of exchangeToSymbols) {
      this.batchSubscriptionRequest(exchangeId, exchangeSymbols);
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
              newUpdates: true,
              enableRateLimit: true,
              timeout: ENV.TIMEOUTS.CCXT_MS,
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

  private batchSubscriptionRequest(exchangeId: string, symbols: string[]): void {
    // Add symbols to pending batch
    const pending = this.pendingSubscriptions.get(exchangeId) || [];
    const uniqueSymbols = [...new Set([...pending, ...symbols])]; // Remove duplicates
    this.pendingSubscriptions.set(exchangeId, uniqueSymbols);

    this.logger.debug(
      `Batching subscription request for ${exchangeId}: ${symbols.join(", ")} (total pending: ${uniqueSymbols.length})`
    );

    // Clear existing timer if any
    const existingTimer = this.subscriptionBatchTimer.get(exchangeId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.logger.debug(`Cleared existing batch timer for ${exchangeId}`);
    }

    // Set new timer to process batch
    const timer = setTimeout(async () => {
      const symbolsToSubscribe = this.pendingSubscriptions.get(exchangeId) || [];
      if (symbolsToSubscribe.length > 0) {
        this.logger.debug(`Processing batched subscription for ${exchangeId}: ${symbolsToSubscribe.join(", ")}`);
        this.pendingSubscriptions.delete(exchangeId);
        this.subscriptionBatchTimer.delete(exchangeId);
        await this.subscribeToExchange(exchangeId, symbolsToSubscribe);
      }
    }, this.SUBSCRIPTION_BATCH_DELAY_MS);

    this.subscriptionBatchTimer.set(exchangeId, timer);
  }

  private groupSymbolsByExchange(symbols: string[]): Map<string, string[]> {
    const exchangeToSymbols = new Map<string, string[]>();

    // Get all feeds from config to map symbols to exchanges
    const feeds = this.configService?.getFeedConfigurations?.() ?? [];

    for (const symbol of symbols) {
      const processedExchanges = new Set<string>(); // Prevent duplicate symbols per exchange

      for (const feed of feeds) {
        for (const source of feed.sources) {
          if (source.symbol === symbol) {
            const exchange = source.exchange;
            if (!this.configService?.hasCustomAdapter?.(exchange) && !processedExchanges.has(exchange)) {
              // This is a CCXT exchange and we haven't processed it yet for this symbol
              if (!exchangeToSymbols.has(exchange)) {
                exchangeToSymbols.set(exchange, []);
              }
              exchangeToSymbols.get(exchange)!.push(symbol);
              processedExchanges.add(exchange);
            }
          }
        }
      }
    }

    return exchangeToSymbols;
  }

  // Circuit breaker for failing exchanges
  private exchangeCircuitBreakers: Map<
    string,
    {
      failures: number;
      lastFailure: number;
      isOpen: boolean;
    }
  > = new Map();

  // Exchange-specific symbol limits for WebSocket subscriptions
  private readonly EXCHANGE_SYMBOL_LIMITS: Record<string, number> = {
    bitget: 25, // bitget has connection stability issues with too many symbols, limit to 25
    bitmart: 20, // bitmart watchTradesForSymbols() accepts a maximum of 20 symbols
    // Add other exchange limits as needed
  };

  private shouldSkipExchange(exchangeId: string): boolean {
    const breaker = this.exchangeCircuitBreakers.get(exchangeId);
    if (!breaker) return false;

    const resetTimeout = ENV.CCXT.CIRCUIT_BREAKER.RESET_TIMEOUT_MS;

    // Skip if circuit is open and not enough time has passed
    if (breaker.isOpen && Date.now() - breaker.lastFailure < resetTimeout) {
      return true;
    }

    // Reset circuit breaker if enough time has passed
    if (breaker.isOpen && Date.now() - breaker.lastFailure >= resetTimeout) {
      breaker.isOpen = false;
      breaker.failures = 0;

      // Log connection retry attempts and outcomes
      this.logger.log(`Circuit breaker automatic reset for ${exchangeId} after ${resetTimeout}ms timeout`, {
        exchangeId,
        resetTimeout,
        lastFailureTime: new Date(breaker.lastFailure).toISOString(),
        retryAttempt: true,
        exchangeStatus: {
          hasExchange: this.exchanges.has(exchangeId),
          connectionStatus: this.ccxtConnectionStatus.get(exchangeId) || false,
        },
      });
    }

    return false;
  }

  private recordExchangeFailure(exchangeId: string, error: Error): void {
    const breaker = this.exchangeCircuitBreakers.get(exchangeId) || {
      failures: 0,
      lastFailure: 0,
      isOpen: false,
    };

    breaker.failures++;
    breaker.lastFailure = Date.now();

    const failureThreshold = ENV.CCXT.CIRCUIT_BREAKER.FAILURE_THRESHOLD;
    const isCommonConnectionError =
      error.message?.includes("connection closed by remote server") && error.message?.includes("closing code 1006");

    // Use different log levels based on error type
    if (isCommonConnectionError) {
      // Log common WebSocket connection errors at debug level to reduce noise
      this.logger.debug(
        `WebSocket connection failure for ${exchangeId} (attempt ${breaker.failures}/${failureThreshold}):`,
        {
          exchangeId,
          errorType: "websocket_connection_closed",
          errorMessage: error.message,
          failureCount: breaker.failures,
          lastFailureTime: new Date(breaker.lastFailure).toISOString(),
          circuitBreakerStatus: breaker.isOpen ? "open" : "closed",
        }
      );
    } else {
      // Log other types of errors at error level with full details
      this.logger.error(
        `CCXT connection failure for ${exchangeId} (attempt ${breaker.failures}/${failureThreshold}):`,
        {
          exchangeId,
          errorMessage: error.message,
          errorStack: error.stack,
          errorName: error.name,
          failureCount: breaker.failures,
          lastFailureTime: new Date(breaker.lastFailure).toISOString(),
          circuitBreakerStatus: breaker.isOpen ? "open" : "closed",
          // Add exchange-specific error context
          exchangeContext: {
            hasExchange: this.exchanges.has(exchangeId),
            hasSubscriptions: this.exchangeSubscriptions.has(exchangeId),
            subscriptionCount: this.exchangeSubscriptions.get(exchangeId)?.size || 0,
            connectionStatus: this.ccxtConnectionStatus.get(exchangeId) || false,
            watchingTrades: this.watchTradesActive.get(exchangeId) || false,
          },
        }
      );
    }

    // Open circuit breaker after configured consecutive failures
    if (breaker.failures >= failureThreshold) {
      breaker.isOpen = true;
      this.logger.warn(
        `Circuit breaker opened for ${exchangeId} after ${breaker.failures} failures (threshold: ${failureThreshold}). ` +
          `Exchange will be temporarily disabled for ${ENV.CCXT.CIRCUIT_BREAKER.RESET_TIMEOUT_MS}ms`
      );
    }

    this.exchangeCircuitBreakers.set(exchangeId, breaker);
  }

  private resetCircuitBreaker(exchangeId: string): void {
    const breaker = this.exchangeCircuitBreakers.get(exchangeId);
    if (breaker) {
      const wasOpen = breaker.isOpen;
      breaker.failures = 0;
      breaker.isOpen = false;

      // Log connection retry attempts and outcomes
      if (wasOpen) {
        this.logger.log(`Circuit breaker reset for ${exchangeId} - connection restored after failure recovery`, {
          exchangeId,
          previousFailures: breaker.failures,
          recoveryTime: new Date().toISOString(),
          downtime: Date.now() - breaker.lastFailure,
        });
      }
    }
  }

  /**
   * Get the symbol limit for a specific exchange
   */
  private getExchangeSymbolLimit(exchangeId: string): number | undefined {
    return this.EXCHANGE_SYMBOL_LIMITS[exchangeId];
  }

  /**
   * Split an array into chunks of specified size
   */
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  private isExchangeInMaintenance(error: Error): boolean {
    const errorMessage = error?.message || String(error);
    return (
      errorMessage.includes("SERVER_MAINTANACE") ||
      errorMessage.includes("MAINTENANCE") ||
      errorMessage.includes("maintenance") ||
      errorMessage.includes("RequestTimeout")
    );
  }

  private async subscribeToExchange(exchangeId: string, symbols: string[]): Promise<void> {
    // Check circuit breaker first
    if (this.shouldSkipExchange(exchangeId)) {
      this.logger.warn(`Skipping ${exchangeId} due to circuit breaker`);
      return;
    }

    // Check subscription cooldown to prevent excessive attempts
    const lastAttempt = this.lastSubscriptionAttempt.get(exchangeId) || 0;
    const timeSinceLastAttempt = Date.now() - lastAttempt;
    if (timeSinceLastAttempt < this.SUBSCRIPTION_COOLDOWN_MS) {
      this.logger.debug(
        `Subscription cooldown active for ${exchangeId}, skipping (${this.SUBSCRIPTION_COOLDOWN_MS - timeSinceLastAttempt}ms remaining)`
      );
      return;
    }

    const exchange = this.exchanges.get(exchangeId);
    if (!exchange) {
      this.logger.warn(`Exchange ${exchangeId} not available for subscription`);
      return;
    }

    // Check if we already have subscriptions for these specific symbols
    const existingSubscriptions = this.exchangeSubscriptions.get(exchangeId) || new Set();
    const newSymbols = symbols.filter(symbol => !existingSubscriptions.has(symbol));

    if (newSymbols.length === 0) {
      this.logger.debug(`Exchange ${exchangeId} already subscribed to all requested symbols: ${symbols.join(", ")}`);
      return;
    }

    if (newSymbols.length < symbols.length) {
      this.logger.debug(
        `Exchange ${exchangeId} already subscribed to some symbols, subscribing to new ones: ${newSymbols.join(", ")}`
      );
    }

    // Update last subscription attempt timestamp
    this.lastSubscriptionAttempt.set(exchangeId, Date.now());

    try {
      // Load markets first
      await exchange.loadMarkets();

      // Get symbols for WebSocket subscription (use original symbol, not market.id)
      const symbolsForSubscription: string[] = [];
      for (const symbol of newSymbols) {
        const market = exchange.markets[symbol];
        if (market) {
          // Use the original symbol for WebSocket subscription, not market.id
          // market.id may have exchange-specific suffixes that break WebSocket subscriptions
          symbolsForSubscription.push(symbol);
          this.exchangeSubscriptions.get(exchangeId)?.add(symbol);
        } else {
          this.logger.warn(`Market not found for ${symbol} on ${exchangeId}`);
        }
      }

      if (symbolsForSubscription.length === 0) {
        this.logger.warn(`No valid markets found for ${exchangeId}`);
        return;
      }

      // Start WebSocket watching
      void this.watchTrades(exchange, symbolsForSubscription, exchangeId);

      this.logger.log(
        `Started WebSocket watching for ${symbolsForSubscription.length} markets on ${exchangeId} (symbols: ${newSymbols.join(", ")})`
      );

      // Reset circuit breaker on success
      this.resetCircuitBreaker(exchangeId);
    } catch (error) {
      // Record failure for circuit breaker
      this.recordExchangeFailure(exchangeId, error as Error);

      // Handle specific exchange maintenance errors gracefully
      if (this.isExchangeInMaintenance(error as Error)) {
        // Log detailed information when CCXT connections fail
        this.logger.warn(`Exchange ${exchangeId} is experiencing maintenance/timeout issues`, {
          exchangeId,
          errorType: "maintenance",
          errorMessage: (error as Error).message,
          retryStrategy: "will retry later",
          exchangeRemoved: true,
          timestamp: new Date().toISOString(),
        });
        // Mark exchange as temporarily unavailable
        this.exchanges.delete(exchangeId);
        return;
      }

      // Handle other common exchange errors gracefully
      const errorMessage = (error as Error)?.message || String(error);
      if (errorMessage.includes("doesn't support WebSocket trades")) {
        // Log when exchanges fall back to REST polling
        this.logger.log(`Exchange ${exchangeId} doesn't support WebSocket trades - falling back to REST polling`, {
          exchangeId,
          fallbackReason: "WebSocket not supported",
          errorMessage: errorMessage,
          symbols: symbols,
          fallbackStrategy: "REST polling",
          timestamp: new Date().toISOString(),
          // Add performance metrics for REST vs WebSocket data
          performanceContext: {
            expectedLatency: "higher than WebSocket",
            updateFrequency: "lower than WebSocket",
            dataFreshness: "polling-based",
            resourceUsage: "higher CPU for polling",
          },
        });
        this.startRestPolling(exchange, symbols, exchangeId);
        return;
      }

      // Log detailed connection error information
      this.logger.error(`Failed to subscribe to ${exchangeId} WebSocket:`, {
        exchangeId,
        errorMessage: (error as Error).message,
        errorStack: (error as Error).stack,
        errorName: (error as Error).name,
        symbols: symbols,
        fallbackStrategy: "REST polling",
        timestamp: new Date().toISOString(),
        exchangeContext: {
          hasMarkets: !!exchange.markets && Object.keys(exchange.markets).length > 0,
          supportsWebSocket: exchange.has["watchTrades"] || exchange.has["watchTradesForSymbols"],
          exchangeOptions: exchange.options,
        },
      });
      // Fall back to REST polling for other errors
      this.startRestPolling(exchange, symbols, exchangeId);
    }
  }

  private async watchTrades(exchange: ccxt.Exchange, symbols: string[], exchangeId: string): Promise<void> {
    try {
      if (exchange.has["watchTradesForSymbols"] && exchangeId !== "bybit") {
        // Handle exchange-specific symbol limits
        const symbolLimit = this.getExchangeSymbolLimit(exchangeId);
        if (symbolLimit && symbols.length > symbolLimit) {
          // Split symbols into batches for exchanges with limits
          this.logger.log(`Splitting ${symbols.length} symbols into batches of ${symbolLimit} for ${exchangeId}`);
          const symbolBatches = this.chunkArray(symbols, symbolLimit);
          for (const batch of symbolBatches) {
            void this.watchTradesForSymbols(exchange, batch, exchangeId);
          }
        } else {
          // Use batch watching if supported and no limit exceeded
          void this.watchTradesForSymbols(exchange, symbols, exchangeId);
        }
      } else if (exchange.has["watchTrades"]) {
        // Use individual symbol watching
        for (const symbol of symbols) {
          void this.watchTradesForSymbol(exchange, symbol, exchangeId);
        }
      } else {
        // Log when exchanges fall back to REST polling
        this.logger.log(`Exchange ${exchangeId} doesn't support WebSocket trades - falling back to REST polling`, {
          exchangeId,
          fallbackReason: "WebSocket capabilities not available",
          symbols: symbols,
          fallbackStrategy: "REST polling",
          timestamp: new Date().toISOString(),
          // Add performance metrics for REST vs WebSocket data
          performanceContext: {
            expectedLatency: "higher than WebSocket",
            updateFrequency: "polling-based updates",
            dataFreshness: "depends on polling interval",
            resourceUsage: "higher network requests",
          },
          exchangeCapabilities: {
            watchTrades: exchange.has["watchTrades"] || false,
            watchTradesForSymbols: exchange.has["watchTradesForSymbols"] || false,
            fetchTrades: exchange.has["fetchTrades"] || false,
          },
        });
        this.startRestPolling(exchange, symbols, exchangeId);
      }
    } catch (error) {
      // Log detailed information when CCXT connections fail
      this.logger.error(`Failed to start WebSocket watching for ${exchangeId}:`, {
        exchangeId,
        errorMessage: (error as Error).message,
        errorStack: (error as Error).stack,
        errorName: (error as Error).name,
        symbols,
        fallbackStrategy: "REST polling",
        timestamp: new Date().toISOString(),
        exchangeCapabilities: {
          watchTrades: exchange.has["watchTrades"],
          watchTradesForSymbols: exchange.has["watchTradesForSymbols"],
          fetchTrades: exchange.has["fetchTrades"],
        },
      });
      this.startRestPolling(exchange, symbols, exchangeId);
    }
  }

  private async watchTradesForSymbols(exchange: ccxt.Exchange, symbols: string[], exchangeId: string): Promise<void> {
    const sinceBySymbol = new Map<string, number>();
    let totalTradesProcessed = 0;
    let lastLogTime = Date.now();

    // Set connection status to active at start of method
    this.setCcxtConnectionStatus(exchangeId, true);
    this.startWatchingTrades(exchangeId);

    this.logger.log(`Starting watchTradesForSymbols for ${exchangeId} with ${symbols.length} markets`);

    while (this.isCcxtWebSocketConnected() && this.watchTradesActive.get(exchangeId)) {
      try {
        const trades = await exchange.watchTradesForSymbols(symbols);

        if (trades.length === 0) {
          // Simple delay like the working test script
          await new Promise(resolve => setTimeout(resolve, ENV.CCXT.WEBSOCKET_WAIT_DELAY_MS));
          continue;
        }

        // Log trade data reception with more details
        this.logger.debug(
          `Received ${trades.length} trades from ${exchangeId} for symbols: ${trades.map(t => t.symbol).join(", ")}`
        );

        // Process trades immediately like the working test - no complex filtering
        // Sort trades by timestamp for consistent processing
        trades.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

        // Process each trade to ensure we don't miss any data
        let tradesProcessed = 0;
        for (const trade of trades) {
          if (trade.symbol && trade.timestamp && trade.price) {
            // Check if this trade is newer than what we've seen for this symbol
            const lastSeen = sinceBySymbol.get(trade.symbol) ?? 0;
            if (trade.timestamp > lastSeen) {
              this.logger.debug(
                `Processing trade for ${trade.symbol} on ${exchangeId}: price=${trade.price}, timestamp=${trade.timestamp}`
              );
              this.setPrice(exchangeId, trade.symbol, trade.price);
              sinceBySymbol.set(trade.symbol, trade.timestamp);
              tradesProcessed++;
              totalTradesProcessed++;
            } else {
              this.logger.debug(
                `Skipping old trade for ${trade.symbol} on ${exchangeId}: timestamp=${trade.timestamp} <= lastSeen=${lastSeen}`
              );
            }
          }
        }

        // Log processing statistics
        if (tradesProcessed > 0) {
          this.logger.debug(`Processed ${tradesProcessed}/${trades.length} trades from ${exchangeId}`);
        } else {
          this.logger.debug(
            `No new trades to process from ${exchangeId} (${trades.length} trades received, all older than last seen)`
          );
        }

        // Process volume data for all trades
        if (trades.length > 0 && trades[0].symbol) {
          this.processVolume(exchangeId, trades[0].symbol, trades);
        }

        // Log processing statistics every 30 seconds
        const now = Date.now();
        if (now - lastLogTime > 30000) {
          this.logger.debug(
            `Trade processing stats for ${exchangeId}: ${totalTradesProcessed} trades processed in last 30s`
          );
          totalTradesProcessed = 0;
          lastLogTime = now;
        }
      } catch (error) {
        const errorObj = error as Error;
        const isConnectionError =
          errorObj.message?.includes("connection closed by remote server") &&
          errorObj.message?.includes("closing code 1006");

        if (isConnectionError) {
          // Log connection errors at debug level to reduce noise, but still track them
          this.logger.debug(`WebSocket connection closed for ${exchangeId} (code 1006), will retry:`, {
            exchangeId,
            errorType: "connection_closed",
            symbolCount: symbols.length,
            timestamp: new Date().toISOString(),
          });

          // Record the failure for circuit breaker tracking
          this.recordExchangeFailure(exchangeId, errorObj);

          // Set connection status to disconnected and stop watching
          this.setCcxtConnectionStatus(exchangeId, false);
          this.stopWatchingTrades(exchangeId);

          // Break the loop to allow reconnection attempt
          break;
        } else {
          // Handle other trade processing errors without stopping loops
          this.logger.warn(`Trade processing error for ${exchangeId} (continuing with other exchanges):`, {
            exchangeId,
            errorMessage: errorObj.message,
            errorName: errorObj.name,
            symbols,
            totalTradesProcessed,
            errorHandling: "continue processing",
            timestamp: new Date().toISOString(),
            // Log trade data parsing issues with context
            context: {
              marketCount: symbols.length,
              connectionActive: this.isCcxtWebSocketConnected(),
              watchingActive: this.watchTradesActive.get(exchangeId),
              lastProcessedCount: totalTradesProcessed,
            },
          });
        }

        // Continue processing other exchanges when one fails
        await new Promise(resolve => setTimeout(resolve, ENV.CCXT.WEBSOCKET_ERROR_DELAY_MS));
        // Continue the loop instead of breaking for non-connection errors
        if (!isConnectionError) {
          continue;
        }
      }
    }

    this.logger.debug(`Stopped watchTradesForSymbols for ${exchangeId}`);
  }

  private async watchTradesForSymbol(exchange: ccxt.Exchange, symbol: string, exchangeId: string): Promise<void> {
    let since: number | undefined;
    let tradesProcessedForSymbol = 0;
    let lastLogTime = Date.now();

    // Set connection status to active at start of method
    this.setCcxtConnectionStatus(exchangeId, true);
    this.startWatchingTrades(exchangeId);

    this.logger.debug(`Starting watchTradesForSymbol for ${exchangeId}/${symbol}`);

    while (this.isCcxtWebSocketConnected() && this.watchTradesActive.get(exchangeId)) {
      try {
        const trades = await exchange.watchTrades(symbol, since);

        if (trades.length === 0) {
          await new Promise(resolve => setTimeout(resolve, ENV.CCXT.WEBSOCKET_WAIT_DELAY_MS));
          continue;
        }

        // Log trade data reception
        this.logger.debug(`Received ${trades.length} trades from ${exchangeId}/${symbol}`);

        // Sort trades by timestamp
        trades.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

        // Process trade data immediately when available
        const lastTrade = trades[trades.length - 1];
        if (lastTrade.symbol && lastTrade.timestamp) {
          this.logger.debug(
            `Processing trade for ${lastTrade.symbol} on ${exchangeId}: price=${lastTrade.price}, timestamp=${lastTrade.timestamp}`
          );
          this.setPrice(exchangeId, lastTrade.symbol, lastTrade.price);
          since = lastTrade.timestamp + 1;
          tradesProcessedForSymbol++;
        }

        // Process volume data immediately
        if (lastTrade.symbol) {
          this.processVolume(exchangeId, lastTrade.symbol, trades);
        }

        // Log processing statistics every 30 seconds
        const now = Date.now();
        if (now - lastLogTime > 30000) {
          this.logger.debug(
            `Trade processing stats for ${exchangeId}/${symbol}: ${tradesProcessedForSymbol} trades processed in last 30s`
          );
          tradesProcessedForSymbol = 0;
          lastLogTime = now;
        }
      } catch (error) {
        // Handle individual trade processing errors without stopping the loop
        this.logger.warn(`Trade processing error for ${exchangeId}/${symbol} (continuing with other symbols):`, {
          exchangeId,
          symbol,
          errorMessage: (error as Error).message,
          errorName: (error as Error).name,
          tradesProcessed: tradesProcessedForSymbol,
          errorHandling: "continue processing other symbols",
          timestamp: new Date().toISOString(),
          // Log trade data parsing issues with context
          context: {
            connectionActive: this.isCcxtWebSocketConnected(),
            watchingActive: this.watchTradesActive.get(exchangeId),
            lastSince: since,
            lastProcessedCount: tradesProcessedForSymbol,
          },
        });

        // Continue processing other exchanges when one fails
        await new Promise(resolve =>
          setTimeout(
            resolve,
            ENV.CCXT.WEBSOCKET_SYMBOL_ERROR_DELAY_MS + Math.random() * ENV.CCXT.WEBSOCKET_ERROR_DELAY_MS
          )
        );
        // Continue the loop instead of breaking
        continue;
      }
    }

    this.logger.log(`Stopped watchTradesForSymbol for ${exchangeId}/${symbol}`);
  }

  private startRestPolling(exchange: ccxt.Exchange, symbols: string[], exchangeId: string): void {
    // Log when exchanges fall back to REST polling
    this.logger.log(`Starting REST polling fallback for ${exchangeId}`, {
      exchangeId,
      marketCount: symbols.length,
      symbols: symbols,
      fallbackReason: "WebSocket connection failed or not supported",
      pollingStrategy: "adaptive polling based on data freshness",
      timestamp: new Date().toISOString(),
      // Add performance metrics for REST vs WebSocket data
      performanceMetrics: {
        pollingInterval: `${ENV.CCXT.REST_POLLING_DELAY_MS}ms base interval`,
        adaptiveScaling: "0.5x to 2x based on data activity",
        expectedLatency: `${ENV.CCXT.REST_POLLING_DELAY_MS}ms average`,
        networkOverhead: "higher than WebSocket",
        dataFreshness: "polling-dependent",
      },
    });

    // ✅ Use adaptive polling based on data freshness instead of fixed intervals
    const adaptivePolling = async () => {
      if (!this.isCcxtWebSocketConnected()) {
        return;
      }

      try {
        let hasNewData = false;
        let tradesProcessed = 0;

        for (const symbol of symbols) {
          const trades = await exchange.fetchTrades(symbol);
          if (trades.length > 0) {
            this.logger.debug(`REST polling: received ${trades.length} trades from ${exchangeId}/${symbol}`, {
              exchangeId,
              symbol,
              tradesCount: trades.length,
              dataSource: "REST polling fallback",
              // Include reason for fallback in log messages
              fallbackContext: {
                reason: "WebSocket unavailable or failed",
                pollingType: "fetchTrades API call",
                // Add performance metrics for REST vs WebSocket data
                performanceMetrics: {
                  requestLatency: "REST API call latency",
                  dataFreshness: "depends on exchange update frequency",
                  comparedToWebSocket: "higher latency, batch updates",
                },
              },
            });

            trades.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            const latestTrade = trades[0];
            if (latestTrade.symbol && latestTrade.timestamp) {
              const currentPrice = this.latestPrices.get(latestTrade.symbol)?.get(exchangeId);

              if (!currentPrice || latestTrade.timestamp > currentPrice.time) {
                this.logger.debug(
                  `REST polling: processing new trade for ${latestTrade.symbol} on ${exchangeId}: price=${latestTrade.price}`,
                  {
                    exchangeId,
                    symbol: latestTrade.symbol,
                    price: latestTrade.price,
                    timestamp: latestTrade.timestamp,
                    dataSource: "REST polling fallback",
                    // Include reason for fallback in log messages
                    fallbackContext: {
                      reason: "WebSocket unavailable or failed",
                      dataFreshness: currentPrice ? Date.now() - currentPrice.time : "no previous data",
                      // Add performance metrics for REST vs WebSocket data
                      performanceImpact: {
                        latency: "higher than WebSocket",
                        frequency: "polling-based",
                        efficiency: "lower than real-time WebSocket",
                      },
                    },
                  }
                );
                this.setPrice(exchangeId, latestTrade.symbol, latestTrade.price);
                this.processVolume(exchangeId, latestTrade.symbol, [latestTrade]);
                hasNewData = true;
                tradesProcessed++;
              }
            }
          }
        }

        // Log REST polling statistics with performance metrics
        if (tradesProcessed > 0) {
          this.logger.debug(`REST polling stats for ${exchangeId}: processed ${tradesProcessed} new trades`, {
            exchangeId,
            tradesProcessed,
            marketCount: symbols.length,
            hasNewData,
            // Add performance metrics for REST vs WebSocket data
            performanceMetrics: {
              pollingEfficiency: hasNewData ? "high" : "low",
              dataLatency: "REST polling latency",
              nextPollingDelay: hasNewData ? "reduced (active)" : "increased (stale)",
              comparedToWebSocket: "higher latency, lower frequency",
            },
            timestamp: new Date().toISOString(),
          });
        }

        // Adaptive delay: shorter if we got new data, longer if stale
        const nextDelay = hasNewData
          ? ENV.CCXT.REST_POLLING_DELAY_MS * 0.8 // Slightly faster when active (was 0.5)
          : ENV.CCXT.REST_POLLING_DELAY_MS * 2.0; // Much slower when stale (was 1.5)

        // Schedule next poll with minimum delay to prevent excessive API calls
        const minDelay = ENV.CCXT.REST_POLLING_DELAY_MS * 0.5; // Minimum 50% of base delay
        const maxDelay = ENV.CCXT.REST_POLLING_DELAY_MS * 3.0; // Maximum 300% of base delay
        setTimeout(adaptivePolling, Math.max(minDelay, Math.min(nextDelay, maxDelay)));
      } catch (error) {
        // Handle individual trade processing errors without stopping loops
        this.logger.warn(`REST polling error for ${exchangeId} (will retry with backoff):`, {
          exchangeId,
          errorMessage: (error as Error).message,
          errorName: (error as Error).name,
          symbols,
          errorHandling: "retry with exponential backoff",
          retryDelay: ENV.CCXT.REST_POLLING_DELAY_MS * 2,
          timestamp: new Date().toISOString(),
          // Log trade data parsing issues with context
          context: {
            marketCount: symbols.length,
            pollingType: "REST fallback",
            adaptivePolling: true,
          },
        });

        // Continue processing other exchanges when one fails - retry with exponential backoff on error
        setTimeout(adaptivePolling, ENV.CCXT.REST_POLLING_DELAY_MS * 2);
      }
    };

    // Start adaptive polling
    void adaptivePolling();
  }

  private setPrice(exchangeId: string, symbol: string, price: number): void {
    const symbolPrices = this.latestPrices.get(symbol) || new Map();
    const currentTimestamp = Date.now(); // Use current timestamp for real-time data

    // Log when setPrice is called with trade information
    this.logger.debug(`setPrice called for ${symbol} on ${exchangeId}: price=${price}, timestamp=${currentTimestamp}`);

    symbolPrices.set(exchangeId, {
      value: price,
      time: currentTimestamp, // Use current timestamp instead of exchange timestamp
      exchange: exchangeId,
    });
    this.latestPrices.set(symbol, symbolPrices);

    // Emit price update callback
    if (this.onPriceUpdateCallback) {
      const priceUpdate: PriceUpdate = {
        symbol,
        price,
        timestamp: currentTimestamp, // Use current timestamp instead of exchange timestamp
        confidence: this.calculateConfidence({ price, timestamp: currentTimestamp, source: exchangeId }),
        source: exchangeId,
      };

      // Verify callback parameters match PriceUpdate interface
      this.validatePriceUpdateParameters(priceUpdate);

      this.logger.debug(`Triggering onPriceUpdateCallback for ${symbol} from ${exchangeId}`, {
        symbol: priceUpdate.symbol,
        price: priceUpdate.price,
        timestamp: priceUpdate.timestamp,
        confidence: priceUpdate.confidence,
        source: priceUpdate.source,
      });

      try {
        this.onPriceUpdateCallback(priceUpdate);
        this.logger.debug(`Successfully triggered price update callback for ${symbol} from ${exchangeId}`);
      } catch (error) {
        this.logger.error(`Error in onPriceUpdateCallback for ${symbol} from ${exchangeId}:`, error);
      }
    } else {
      this.logger.warn(
        `onPriceUpdateCallback is not set - price update for ${symbol} from ${exchangeId} will not be emitted`
      );
    }
  }

  /**
   * Validate that price update parameters match PriceUpdate interface
   */
  private validatePriceUpdateParameters(priceUpdate: PriceUpdate): void {
    const errors: string[] = [];

    if (!priceUpdate.symbol || typeof priceUpdate.symbol !== "string") {
      errors.push(`Invalid symbol: ${priceUpdate.symbol}`);
    }

    if (typeof priceUpdate.price !== "number" || isNaN(priceUpdate.price) || priceUpdate.price <= 0) {
      errors.push(`Invalid price: ${priceUpdate.price}`);
    }

    if (typeof priceUpdate.timestamp !== "number" || isNaN(priceUpdate.timestamp) || priceUpdate.timestamp <= 0) {
      errors.push(`Invalid timestamp: ${priceUpdate.timestamp}`);
    }

    if (!priceUpdate.source || typeof priceUpdate.source !== "string") {
      errors.push(`Invalid source: ${priceUpdate.source}`);
    }

    if (
      typeof priceUpdate.confidence !== "number" ||
      isNaN(priceUpdate.confidence) ||
      priceUpdate.confidence < 0 ||
      priceUpdate.confidence > 1
    ) {
      errors.push(`Invalid confidence: ${priceUpdate.confidence} (must be between 0 and 1)`);
    }

    if (errors.length > 0) {
      this.logger.error(`PriceUpdate validation failed for ${priceUpdate.symbol}:`, errors);
      throw new Error(`PriceUpdate validation failed: ${errors.join(", ")}`);
    }

    this.logger.debug(`PriceUpdate validation passed for ${priceUpdate.symbol} from ${priceUpdate.source}`);
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
        this.setPrice(message.exchange || "unknown", message.symbol, message.price);
      }
    } catch (error) {
      this.logger.debug(`Failed to process WebSocket message:`, error);
    }
  }

  protected override handleWebSocketClose(): boolean {
    this.logger.warn("CCXT Pro WebSocket connection closed");
    this.isConnected_ = false;
    this.onConnectionChangeCallback?.(false);
    return true; // We handled the logging
  }

  protected override handleWebSocketError(error: Error): void {
    this.logger.error("CCXT Pro WebSocket error:", error);
    this.onErrorCallback?.(error);
  }

  private async fetchPriceFromExchanges(feedId: CoreFeedId): Promise<PriceUpdate> {
    const symbol = feedId.name;
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
        // Handle individual trade processing errors without stopping loops
        this.logger.warn(`Failed to fetch price from ${exchangeId} (continuing with other exchanges):`, {
          exchangeId,
          symbol,
          errorMessage: (error as Error).message,
          errorName: (error as Error).name,
          errorHandling: "continue with other exchanges",
          timestamp: new Date().toISOString(),
          // Log trade data parsing issues with context
          context: {
            fetchType: "ticker price",
            aggregation: "multi-exchange average",
          },
        });
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
    // Get the exchange-specific symbol from feed configuration
    const feedConfig = getFeedConfiguration(feedId);
    const sourceConfig = feedConfig?.sources.find(s => s.exchange === exchangeId);
    const symbol = sourceConfig?.symbol || feedId.name;

    // First try to get price from WebSocket data
    const wsPrice = this.latestPrices.get(symbol)?.get(exchangeId);
    if (wsPrice) {
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
      this.setPrice(exchangeId, symbol, ticker.last);

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

  private async fetchVolumeFromExchanges(feedId: CoreFeedId, _volumeWindow: number): Promise<VolumeUpdate> {
    const symbol = feedId.name;
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
        // Handle individual trade processing errors without stopping loops
        this.logger.warn(`Failed to fetch volume from ${exchangeId} (continuing with other exchanges):`, {
          exchangeId,
          symbol,
          errorMessage: (error as Error).message,
          errorName: (error as Error).name,
          errorHandling: "continue with other exchanges",
          timestamp: new Date().toISOString(),
          // Log trade data parsing issues with context
          context: {
            fetchType: "ticker volume",
            aggregation: "multi-exchange total",
          },
        });
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
      const ccxtSymbol = symbol;

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
          // Handle individual trade processing errors without stopping loops
          this.logger.warn(`Failed to fetch ${symbol} from ${exchangeId} (continuing with other exchanges):`, {
            exchangeId,
            symbol,
            errorMessage: (error as Error).message,
            errorName: (error as Error).name,
            errorHandling: "continue with other exchanges",
            timestamp: new Date().toISOString(),
            // Log trade data parsing issues with context
            context: {
              fetchType: "price map ticker",
              aggregation: "individual exchange prices",
            },
          });
        }
      }

      if (exchangeMap.size > 0) {
        priceMap.set(symbol, exchangeMap);
      }
    }

    return priceMap;
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

  override async cleanup(): Promise<void> {
    // Clear all subscription batch timers
    for (const timer of this.subscriptionBatchTimer.values()) {
      clearTimeout(timer);
    }
    this.subscriptionBatchTimer.clear();
    this.pendingSubscriptions.clear();
    this.lastSubscriptionAttempt.clear();
    this.recentSubscriptionCalls = [];

    // Call parent cleanup
    await super.cleanup();
  }
}
