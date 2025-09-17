import { BaseExchangeAdapter } from "@/adapters/base/base-exchange-adapter";
import type { ExchangeCapabilities, ExchangeConnectionConfig } from "@/common/types/adapters";
import type { PriceUpdate, VolumeUpdate } from "@/common/types/core";
import { FeedCategory } from "@/common/types/core";

export interface BinanceTickerData {
  e: "24hrTicker"; // Event type
  E: number; // Event time
  s: string; // Symbol
  p: string; // Price change
  P: string; // Price change percent
  w: string; // Weighted average price
  x: string; // First trade(F)-1 price (first trade before the 24hr rolling window)
  c: string; // Last price
  Q: string; // Last quantity
  b: string; // Best bid price
  B: string; // Best bid quantity
  a: string; // Best ask price
  A: string; // Best ask quantity
  o: string; // Open price
  h: string; // High price
  l: string; // Low price
  v: string; // Total traded base asset volume
  q: string; // Total traded quote asset volume
  O: number; // Statistics open time
  C: number; // Statistics close time
  F: number; // First trade ID
  L: number; // Last trade Id
  n: number; // Total number of trades
}

export interface BinanceRestTickerData {
  symbol: string;
  priceChange: string;
  priceChangePercent: string;
  weightedAvgPrice: string;
  prevClosePrice: string;
  lastPrice: string;
  lastQty: string;
  bidPrice: string;
  bidQty: string;
  askPrice: string;
  askQty: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
  openTime: number;
  closeTime: number;
  firstId: number;
  lastId: number;
  count: number;
}

export class BinanceAdapter extends BaseExchangeAdapter {
  readonly exchangeName = "binance";
  readonly category = FeedCategory.Crypto;
  readonly capabilities: ExchangeCapabilities = {
    supportsWebSocket: true,
    supportsREST: true,
    supportsVolume: true,
    supportsOrderBook: true,
    supportedCategories: [FeedCategory.Crypto],
  };

  private pingInterval?: NodeJS.Timeout;

  // Simple symbol mapping - use exact pairs from feeds.json
  override getSymbolMapping(feedSymbol: string): string {
    // For Binance, remove the slash - use the exact symbol from feeds.json
    return feedSymbol.replace("/", "");
  }

  constructor(config?: ExchangeConnectionConfig) {
    super({ connection: config });
  }

  protected async doConnect(): Promise<void> {
    const config = this.getConfig();
    const wsUrl = config?.websocketUrl || "wss://stream.binance.com:9443/ws/!ticker@arr";

    // Use integrated WebSocket functionality from BaseExchangeAdapter
    await this.connectWebSocket({
      url: wsUrl,
      reconnectInterval: 5000,
      maxReconnectAttempts: 5,
      pingInterval: 30000, // Binance requires periodic ping
      pongTimeout: 10000, // Default pong timeout
    });

    this.startPingInterval();
  }

  protected async doDisconnect(): Promise<void> {
    this.stopPingInterval();
    await this.disconnectWebSocket();
  }

  override isConnected(): boolean {
    return super.isConnected() && this.isWebSocketConnected();
  }

  normalizePriceData(rawData: BinanceTickerData): PriceUpdate {
    const price = this.parseNumber(rawData.c);
    const volume = this.parseNumber(rawData.v);
    const timestamp = rawData.E;

    // Calculate spread for confidence
    const bid = this.parseNumber(rawData.b);
    const ask = this.parseNumber(rawData.a);
    const spread = ask - bid;
    const spreadPercent = (spread / price) * 100;

    return {
      symbol: this.normalizeSymbolFromExchange(rawData.s),
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

  normalizeVolumeData(rawData: BinanceTickerData): VolumeUpdate {
    return {
      symbol: this.normalizeSymbolFromExchange(rawData.s),
      volume: this.parseNumber(rawData.v),
      timestamp: rawData.E,
      source: this.exchangeName,
    };
  }

  validateResponse(rawData: unknown): boolean {
    if (!rawData || typeof rawData !== "object") {
      return false;
    }

    const tickerData = rawData as BinanceTickerData;

    try {
      return !!(
        tickerData.s && // Symbol
        tickerData.c && // Last price
        tickerData.E && // Event time
        !isNaN(this.parseNumber(tickerData.c))
      );
    } catch {
      return false;
    }
  }

  protected async doSubscribe(_symbols: string[]): Promise<void> {
    // Note: The all-ticker stream (!ticker@arr) provides all symbols
    // For individual subscriptions, we would need a different WebSocket connection
    // This implementation uses the all-ticker stream and filters client-side
    // No actual subscription needed as we get all tickers
  }

  protected async doUnsubscribe(_symbols: string[]): Promise<void> {
    // No actual unsubscription needed as we get all tickers
    // Subscriptions are managed by the base class
  }

  // Override subscription tracking to maintain lowercase behavior for Binance
  protected override trackSubscriptions(symbols: string[]): void {
    symbols.forEach(symbol => {
      const exchangeSymbol = this.getSymbolMapping(symbol);
      this.subscriptions.add(exchangeSymbol.toLowerCase());
    });
  }

  protected override untrackSubscriptions(symbols: string[]): void {
    symbols.forEach(symbol => {
      const exchangeSymbol = this.getSymbolMapping(symbol);
      this.subscriptions.delete(exchangeSymbol.toLowerCase());
    });
  }

  protected override isSubscribed(symbol: string): boolean {
    const exchangeSymbol = this.getSymbolMapping(symbol);
    return this.subscriptions.has(exchangeSymbol.toLowerCase());
  }

  // REST API fallback methods
  async fetchTickerREST(symbol: string): Promise<PriceUpdate> {
    const binanceSymbol = this.getSymbolMapping(symbol);
    const baseUrl = this.config?.restApiUrl || "https://api.binance.com";
    const url = `${baseUrl}/api/v3/ticker/24hr?symbol=${binanceSymbol}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: BinanceRestTickerData = await response.json();

      // Calculate spread for confidence
      const price = this.parseNumber(data.lastPrice);
      const bid = this.parseNumber(data.bidPrice);
      const ask = this.parseNumber(data.askPrice);
      const spread = ask - bid;
      const spreadPercent = (spread / price) * 100;

      return {
        symbol: this.normalizeSymbolFromExchange(data.symbol),
        price,
        timestamp: data.closeTime,
        source: this.exchangeName,
        volume: this.parseNumber(data.volume),
        confidence: this.calculateConfidence(data, {
          latency: 0, // REST call, no latency penalty
          volume: this.parseNumber(data.volume),
          spread: spreadPercent,
        }),
      };
    } catch (error) {
      throw new Error(`Failed to fetch Binance ticker for ${symbol}: ${error}`);
    }
  }

  // Simple method to convert exchange symbol back to normalized format
  private normalizeSymbolFromExchange(exchangeSymbol: string): string {
    // Add slash if not present (WebSocket format comes without slash)
    if (!exchangeSymbol.includes("/")) {
      // Simple approach: find the slash position by trying common quote currencies
      const quotes = ["USDT", "USDC", "USD", "EUR"];

      for (const quote of quotes) {
        if (exchangeSymbol.endsWith(quote)) {
          const base = exchangeSymbol.slice(0, -quote.length);
          if (base.length > 0) {
            return `${base}/${quote}`;
          }
        }
      }
    }

    return exchangeSymbol;
  }

  // Override WebSocket event handlers from BaseExchangeAdapter
  protected override handleWebSocketMessage(data: unknown): void {
    try {
      let parsed: unknown;

      if (typeof data === "string") {
        parsed = JSON.parse(data);
      } else if (typeof data === "object" && data !== null) {
        parsed = data;
      } else {
        this.logger.debug("Received non-parseable WebSocket data:", typeof data);
        return;
      }

      // Handle array of tickers (from !ticker@arr stream)
      if (Array.isArray(parsed)) {
        parsed.forEach(ticker => {
          if (this.validateResponse(ticker)) {
            const priceUpdate = this.normalizePriceData(ticker);
            this.onPriceUpdateCallback?.(priceUpdate);
          }
        });
      } else if (this.validateResponse(parsed)) {
        const priceUpdate = this.normalizePriceData(parsed as BinanceTickerData);
        this.onPriceUpdateCallback?.(priceUpdate);
      }
    } catch (error) {
      this.logger.error("Error processing Binance WebSocket data:", error);
      this.onErrorCallback?.(error as Error);
    }
  }

  protected override handleWebSocketClose(): void {
    this.stopPingInterval();
    super.handleWebSocketClose(); // Call base implementation
  }

  protected override handleWebSocketError(error: Error): void {
    this.stopPingInterval();
    super.handleWebSocketError(error); // Call base implementation
  }

  // Binance requires periodic ping to keep connection alive
  private startPingInterval(): void {
    this.pingInterval = setInterval(async () => {
      if (this.isConnected()) {
        // Use integrated WebSocket functionality
        await this.sendWebSocketMessage(JSON.stringify({ method: "ping" }));
      }
    }, 30000); // Ping every 30 seconds
  }

  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = undefined;
    }
  }

  // Subscription management is now provided by BaseExchangeAdapter

  protected async doHealthCheck(): Promise<boolean> {
    try {
      // Try REST API health check
      const baseUrl = this.config?.restApiUrl || "https://api.binance.com";
      const response = await fetch(`${baseUrl}/api/v3/ping`);
      return response.ok;
    } catch {
      return false;
    }
  }
}
