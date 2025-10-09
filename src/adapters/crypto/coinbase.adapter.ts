import { BaseExchangeAdapter } from "@/adapters/base/base-exchange-adapter";
import type { ExchangeCapabilities, ExchangeConnectionConfig } from "@/common/types/adapters";
import type { PriceUpdate, VolumeUpdate } from "@/common/types/core";
import { FeedCategory } from "@/common/types/core";

export interface CoinbaseTickerData {
  type: "ticker";
  sequence: number;
  product_id: string;
  price: string;
  open_24h: string;
  volume_24h: string;
  low_24h: string;
  high_24h: string;
  volume_30d: string;
  best_bid: string;
  best_ask: string;
  side: "buy" | "sell";
  time: string;
  trade_id: number;
  last_size: string;
}

export interface CoinbaseRestTickerData {
  ask: string;
  bid: string;
  volume: string;
  trade_id: number;
  price: string;
  size: string;
  time: string;
}

export class CoinbaseAdapter extends BaseExchangeAdapter {
  readonly exchangeName = "coinbase";
  readonly category = FeedCategory.Crypto;
  readonly capabilities: ExchangeCapabilities = {
    supportsWebSocket: true,
    supportsREST: true,
    supportsVolume: true,
    supportsOrderBook: true,
    supportedCategories: [FeedCategory.Crypto],
  };

  constructor(config?: ExchangeConnectionConfig) {
    super({ connection: config });
  }

  override getSymbolMapping(feedSymbol: string): string {
    // For Coinbase, replace "/" with "-"
    return feedSymbol.replace("/", "-");
  }

  protected async doConnect(): Promise<void> {
    const config = this.getConfig();
    const wsUrl = config?.websocketUrl || "wss://ws-feed.exchange.coinbase.com";

    await this.connectWebSocket(
      this.createWebSocketConfig(wsUrl, {
        // Enhanced connection settings for better stability
        connectionTimeout: 30000,
        pingInterval: 25000, // Reduced from 30s to 25s for more frequent pings
        pongTimeout: 20000, // Increased from 10s to 20s for more tolerance
      })
    );
  }

  protected async doDisconnect(): Promise<void> {
    await this.disconnectWebSocket();
  }

  // Override WebSocket event handlers from BaseExchangeAdapter
  /**
   * Process ticker data from WebSocket message
   */
  private processTickerData(ticker: CoinbaseTickerData): void {
    const priceUpdate = this.normalizePriceData(ticker);
    this.onPriceUpdateCallback?.(priceUpdate);
  }

  protected override handleWebSocketMessage(data: unknown): void {
    if (!data) return;

    try {
      const message = this.parseWebSocketData(data);
      if (!message) return;

      this.logger.debug(`Coinbase WebSocket message parsed: ${JSON.stringify(message)}`);

      // Handle ping/pong for connection health
      if (
        message &&
        typeof message === "object" &&
        "type" in message &&
        (message as { type: string }).type === "pong"
      ) {
        this.onPongReceived();
        return;
      }

      // Handle different message types (ticker, subscription, etc.)
      if (
        message &&
        typeof message === "object" &&
        "type" in message &&
        (message as { type: string }).type === "ticker"
      ) {
        const ticker = message as CoinbaseTickerData;
        this.logger.log(`Processing ticker data for ${ticker.product_id}: ${ticker.price}`);
        this.processTickerData(ticker);
      } else if (
        message &&
        typeof message === "object" &&
        "type" in message &&
        (message as { type: string }).type === "error"
      ) {
        const errorMsg = message as { type: string; message?: string; reason?: string };

        // Handle the specific "No channels provided" error as a warning instead of error
        if (errorMsg.message === "Failed to subscribe" && errorMsg.reason === "No channels provided") {
          // Reduce logging frequency for this non-critical error
          if (Math.random() < 0.2) {
            // Only log 20% of these warnings to reduce noise
            this.logger.debug("Coinbase subscription warning (non-critical):", message);
          }
          // Don't call onErrorCallback for this specific error as it's not critical
        } else {
          this.logger.error("WebSocket error:", message);
          this.onErrorCallback?.(new Error(`WebSocket error: ${JSON.stringify(message)}`));
        }
      } else if (
        message &&
        typeof message === "object" &&
        "type" in message &&
        (message as { type: string }).type === "subscriptions"
      ) {
        this.logger.log(`Subscription confirmation: ${JSON.stringify(message)}`);
      }
    } catch (error) {
      this.logger.error("Error processing WebSocket message:", error);
      this.onErrorCallback?.(error as Error);
    }
  }

  normalizePriceData(rawData: CoinbaseTickerData): PriceUpdate {
    const price = this.parseNumber(rawData.price);
    const volume = rawData.volume_24h ? this.parseNumber(rawData.volume_24h) : undefined;

    // Fix timestamp handling - Coinbase sends ISO strings, convert properly
    let timestamp: number;
    if (rawData.time) {
      const parsedTime = new Date(rawData.time).getTime();
      if (isNaN(parsedTime)) {
        this.logger.warn(`Invalid Coinbase timestamp: ${rawData.time}, using current time`);
        timestamp = Date.now();
      } else {
        timestamp = parsedTime;
      }
    } else {
      timestamp = Date.now();
    }

    // Improved timestamp validation with more lenient thresholds for real-time data
    const timeDiff = Date.now() - timestamp;
    const maxAllowedAge = 600000; // 10 minutes instead of 5 minutes

    if (Math.abs(timeDiff) > maxAllowedAge) {
      // Only warn for very stale data, but still use it if it's recent enough
      if (timeDiff > 0) {
        // Data is from the past - check if it's too old
        this.logger.debug(`Coinbase stale data: raw=${rawData.time}, age=${timeDiff}ms, using current time`);
        timestamp = Date.now();
      } else {
        // Data is from the future - likely clock skew, use as-is but log
        this.logger.debug(`Coinbase future timestamp: raw=${rawData.time}, diff=${Math.abs(timeDiff)}ms, accepting`);
      }
    }

    // Calculate spread for confidence using standardized method
    const bid = rawData.best_bid ? this.parseNumber(rawData.best_bid) : price;
    const ask = rawData.best_ask ? this.parseNumber(rawData.best_ask) : price;
    const spreadPercent = this.calculateSpreadForConfidence(bid, ask, price);

    return {
      symbol: this.normalizeSymbolFromExchange(rawData.product_id),
      price,
      timestamp,
      source: this.exchangeName,
      volume,
      confidence: this.calculateConfidence(rawData, {
        latency: Date.now() - timestamp,
        volume,
        spread: spreadPercent,
      }),
    };
  }

  normalizeVolumeData(rawData: CoinbaseTickerData): VolumeUpdate {
    return {
      symbol: this.normalizeSymbolFromExchange(rawData.product_id),
      volume: this.parseNumber(rawData.volume_24h),
      timestamp: this.normalizeTimestamp(rawData.time),
      source: this.exchangeName,
    };
  }

  validateResponse(rawData: unknown): boolean {
    if (!rawData || typeof rawData !== "object") {
      return false;
    }

    const tickerData = rawData as CoinbaseTickerData;

    try {
      return !!(
        tickerData.type === "ticker" &&
        tickerData.product_id &&
        tickerData.price &&
        tickerData.time &&
        !isNaN(this.parseNumber(tickerData.price))
      );
    } catch {
      return false;
    }
  }

  protected async doSubscribe(symbols: string[]): Promise<void> {
    this.logger.debug(`Coinbase doSubscribe called with symbols: ${JSON.stringify(symbols)}`);

    if (!symbols || symbols.length === 0) {
      this.logger.warn(`Coinbase subscription called with no symbols`);
      return;
    }

    const coinbaseSymbols = symbols.map(symbol => this.getSymbolMapping(symbol));
    this.logger.debug(`Coinbase symbols after mapping: ${JSON.stringify(coinbaseSymbols)}`);

    if (coinbaseSymbols.length === 0) {
      this.logger.warn(`Coinbase subscription: no valid symbols after mapping`);
      return;
    }

    // Validate that we have valid product IDs
    const validProductIds = coinbaseSymbols.filter(symbol => symbol && symbol.length > 0);
    if (validProductIds.length === 0) {
      this.logger.warn(`Coinbase subscription: no valid product IDs after filtering`);
      return;
    }

    const subscribeMessage = {
      type: "subscribe",
      product_ids: validProductIds,
      channels: ["ticker"],
    };

    this.logger.debug(`Coinbase subscription message: ${JSON.stringify(subscribeMessage)}`);

    try {
      // Check WebSocket state before sending
      if (!this.ws || this.ws.readyState !== 1) {
        // 1 = OPEN
        this.logger.warn(`Coinbase WebSocket not ready for subscription. State: ${this.ws?.readyState}`);
        return;
      }

      // Validate the message structure before sending
      if (!subscribeMessage.product_ids || subscribeMessage.product_ids.length === 0) {
        this.logger.error(`Coinbase subscription message has no product_ids: ${JSON.stringify(subscribeMessage)}`);
        return;
      }

      if (!subscribeMessage.channels || subscribeMessage.channels.length === 0) {
        this.logger.error(`Coinbase subscription message has no channels: ${JSON.stringify(subscribeMessage)}`);
        return;
      }

      // Add small delay to ensure WebSocket connection is fully established
      await new Promise(resolve => setTimeout(resolve, 100));

      const messageString = JSON.stringify(subscribeMessage);
      this.logger.debug(`Sending Coinbase subscription message: ${messageString}`);

      await this.sendWebSocketMessage(messageString);
      this.logger.log(`Subscribed to Coinbase symbols: ${validProductIds.join(", ")}`);
    } catch (error) {
      this.logger.warn(`Coinbase subscription error:`, error);
    }
  }

  protected async doUnsubscribe(symbols: string[]): Promise<void> {
    if (!symbols || symbols.length === 0) {
      this.logger.warn(`Coinbase unsubscription called with no symbols`);
      return;
    }

    const coinbaseSymbols = symbols.map(symbol => this.getSymbolMapping(symbol));

    if (coinbaseSymbols.length === 0) {
      this.logger.warn(`Coinbase unsubscription: no valid symbols after mapping`);
      return;
    }

    const unsubscribeMessage = {
      type: "unsubscribe",
      product_ids: coinbaseSymbols,
      channels: ["ticker"],
    };

    try {
      await this.sendWebSocketMessage(JSON.stringify(unsubscribeMessage));
      this.logger.log(`Unsubscribed from Coinbase symbols: ${coinbaseSymbols.join(", ")}`);
    } catch (error) {
      this.logger.warn(`Coinbase unsubscription error:`, error);
    }
  }

  // REST API fallback methods
  async fetchTickerREST(symbol: string): Promise<PriceUpdate> {
    const config = this.getConfig();
    const coinbaseSymbol = this.getSymbolMapping(symbol);
    const baseUrl = config?.restApiUrl || "https://api.exchange.coinbase.com";
    const url = `${baseUrl}/products/${coinbaseSymbol}/ticker`;

    const response = await this.fetchRestApi(url, `Failed to fetch Coinbase ticker for ${symbol}`);
    const data: CoinbaseRestTickerData = await response.json();

    return {
      symbol: this.normalizeSymbolFromExchange(coinbaseSymbol),
      price: this.parseNumber(data.price),
      timestamp: this.normalizeTimestamp(data.time),
      source: this.exchangeName,
      volume: data.volume ? this.parseNumber(data.volume) : undefined,
      confidence: this.calculateConfidence(data, {
        latency: 0, // REST call, no latency penalty
        volume: data.volume ? this.parseNumber(data.volume) : undefined,
      }),
    };
  }

  // Override symbol normalization for Coinbase format
  protected override normalizeSymbolFromExchange(exchangeSymbol: string): string {
    return this.standardizeSymbolFromExchange(exchangeSymbol, ["-"]);
  }

  // Override ping message for Coinbase-specific format
  protected override sendPingMessage(): void {
    if (this.isWebSocketConnected()) {
      try {
        void this.sendWebSocketMessage(JSON.stringify({ type: "ping" }));
        this.logger.log("✅ Sent ping to Coinbase WebSocket");
      } catch (error) {
        this.logger.warn("❌ Failed to send ping to Coinbase WebSocket:", error);
        this.handleWebSocketError(error as Error);
      }
    } else {
      this.logger.warn("⚠️  Cannot send ping to Coinbase - WebSocket not connected");
    }
  }

  protected async doHealthCheck(): Promise<boolean> {
    try {
      const config = this.getConfig();
      const baseUrl = config?.restApiUrl || "https://api.exchange.coinbase.com";

      // Use the standard health check method from base adapter
      return this.performStandardHealthCheck(`${baseUrl}/time`);
    } catch (error) {
      // Don't log health check failures as errors since they're expected during network issues
      this.logger.debug(`Coinbase health check failed: ${error instanceof Error ? error.message : "Unknown error"}`);
      return false;
    }
  }
}
