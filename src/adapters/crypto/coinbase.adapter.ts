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

    await this.connectWebSocket(this.createWebSocketConfig(wsUrl));
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
      // Process the message based on its type
      const message = data as Record<string, unknown>;

      // Handle ping/pong for connection health
      if (message.type === "pong") {
        this.onPongReceived();
        return;
      }

      // Handle different message types (ticker, subscription, etc.)
      if (message.type === "ticker") {
        const ticker = message as unknown as CoinbaseTickerData;
        this.processTickerData(ticker);
      } else if (message.type === "error") {
        this.logger.error("WebSocket error:", message);
        this.onErrorCallback?.(new Error(`WebSocket error: ${JSON.stringify(message)}`));
      }
    } catch (error) {
      this.logger.error("Error processing WebSocket message:", error);
      this.onErrorCallback?.(error as Error);
    }
  }

  normalizePriceData(rawData: CoinbaseTickerData): PriceUpdate {
    const price = this.parseNumber(rawData.price);
    const volume = rawData.volume_24h ? this.parseNumber(rawData.volume_24h) : undefined;
    const timestamp = this.standardizeTimestamp(rawData.time);

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
    const coinbaseSymbols = symbols.map(symbol => this.getSymbolMapping(symbol));

    const subscribeMessage = {
      type: "subscribe",
      product_ids: coinbaseSymbols,
      channels: ["ticker"],
    };

    try {
      await this.sendWebSocketMessage(JSON.stringify(subscribeMessage));
      this.logger.log(`Subscribed to Coinbase symbols: ${coinbaseSymbols.join(", ")}`);
    } catch (error) {
      this.logger.warn(`Coinbase subscription error:`, error);
    }
  }

  protected async doUnsubscribe(symbols: string[]): Promise<void> {
    const coinbaseSymbols = symbols.map(symbol => this.getSymbolMapping(symbol));

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
    const config = this.getConfig();
    const baseUrl = config?.restApiUrl || "https://api.exchange.coinbase.com";
    return this.performStandardHealthCheck(`${baseUrl}/time`);
  }
}
