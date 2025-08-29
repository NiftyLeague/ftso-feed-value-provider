import {
  ExchangeAdapter,
  ExchangeCapabilities,
  ExchangeConnectionConfig,
} from "@/interfaces/exchange-adapter.interface";
import { PriceUpdate, VolumeUpdate } from "@/interfaces/data-source.interface";
import { FeedCategory } from "@/types/feed-category.enum";

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

export class BinanceAdapter extends ExchangeAdapter {
  readonly exchangeName = "binance";
  readonly category = FeedCategory.Crypto;
  readonly capabilities: ExchangeCapabilities = {
    supportsWebSocket: true,
    supportsREST: true,
    supportsVolume: true,
    supportsOrderBook: true,
    supportedCategories: [FeedCategory.Crypto],
  };

  private wsConnection?: WebSocket;
  private isConnectedFlag = false;
  private subscriptions = new Set<string>();
  private pingInterval?: NodeJS.Timeout;

  // Simple symbol mapping - use exact pairs from feeds.json
  getSymbolMapping(feedSymbol: string): string {
    // For Binance, remove the slash - use the exact symbol from feeds.json
    return feedSymbol.replace("/", "");
  }

  constructor(config?: ExchangeConnectionConfig) {
    super(config);
  }

  async connect(): Promise<void> {
    if (this.isConnectedFlag) {
      return;
    }

    const wsUrl = this.config?.websocketUrl || "wss://stream.binance.com:9443/ws/!ticker@arr";

    return new Promise((resolve, reject) => {
      try {
        this.wsConnection = new WebSocket(wsUrl);

        this.wsConnection.onopen = () => {
          this.isConnectedFlag = true;
          this.startPingInterval();
          this.onConnectionChangeCallback?.(true);
          resolve();
        };

        this.wsConnection.onerror = error => {
          this.isConnectedFlag = false;
          this.stopPingInterval();
          const connectionError = new Error(`Binance WebSocket connection failed: ${error}`);
          this.onErrorCallback?.(connectionError);
          this.onConnectionChangeCallback?.(false);
          reject(connectionError);
        };

        this.wsConnection.onclose = event => {
          this.isConnectedFlag = false;
          this.stopPingInterval();
          this.onConnectionChangeCallback?.(false);

          // Emit error if close was unexpected (only if event has code property)
          if (event && typeof event.code === "number" && event.code !== 1000) {
            // 1000 is normal closure
            const closeError = new Error(
              `Binance WebSocket closed unexpectedly: ${event.code} - ${event.reason || "Unknown reason"}`
            );
            this.onErrorCallback?.(closeError);
          }
        };

        this.wsConnection.onmessage = event => {
          try {
            const data = JSON.parse(event.data);

            // Handle array of tickers (from !ticker@arr stream)
            if (Array.isArray(data)) {
              data.forEach(ticker => {
                if (this.validateResponse(ticker)) {
                  const priceUpdate = this.normalizePriceData(ticker);
                  this.onPriceUpdateCallback?.(priceUpdate);
                }
              });
            } else if (this.validateResponse(data)) {
              const priceUpdate = this.normalizePriceData(data);
              this.onPriceUpdateCallback?.(priceUpdate);
            }
          } catch (error) {
            const parseError = new Error(`Error processing Binance message: ${error}`);
            this.onErrorCallback?.(parseError);
          }
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  async disconnect(): Promise<void> {
    this.stopPingInterval();

    if (this.wsConnection) {
      this.wsConnection.close();
      this.wsConnection = undefined;
    }
    this.isConnectedFlag = false;
    this.subscriptions.clear();
  }

  isConnected(): boolean {
    return this.isConnectedFlag && this.wsConnection?.readyState === WebSocket.OPEN;
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

  validateResponse(rawData: any): boolean {
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

  // WebSocket subscription management for individual symbols
  async subscribe(symbols: string[]): Promise<void> {
    // Note: The all-ticker stream (!ticker@arr) provides all symbols
    // For individual subscriptions, we would need a different WebSocket connection
    // This implementation uses the all-ticker stream and filters client-side

    const binanceSymbols = symbols.map(symbol => this.getSymbolMapping(symbol));
    binanceSymbols.forEach(symbol => this.subscriptions.add(symbol.toLowerCase()));
  }

  async unsubscribe(symbols: string[]): Promise<void> {
    const binanceSymbols = symbols.map(symbol => this.getSymbolMapping(symbol));
    binanceSymbols.forEach(symbol => this.subscriptions.delete(symbol.toLowerCase()));
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

  // Event handlers
  private onPriceUpdateCallback?: (update: PriceUpdate) => void;
  private onConnectionChangeCallback?: (connected: boolean) => void;
  private onErrorCallback?: (error: Error) => void;

  onPriceUpdate(callback: (update: PriceUpdate) => void): void {
    this.onPriceUpdateCallback = callback;
  }

  onConnectionChange(callback: (connected: boolean) => void): void {
    this.onConnectionChangeCallback = callback;
  }

  onError(callback: (error: Error) => void): void {
    this.onErrorCallback = callback;
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

  // Binance requires periodic ping to keep connection alive
  private startPingInterval(): void {
    this.pingInterval = setInterval(() => {
      if (this.isConnected()) {
        // Send ping frame (WebSocket ping method may not be available in all environments)
        try {
          (this.wsConnection as any)?.ping?.();
        } catch {
          // Fallback: send ping message
          this.wsConnection?.send(JSON.stringify({ method: "ping" }));
        }
      }
    }, 30000); // Ping every 30 seconds
  }

  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = undefined;
    }
  }

  // Get current subscriptions
  getSubscriptions(): string[] {
    return Array.from(this.subscriptions);
  }

  // Health check method
  async healthCheck(): Promise<boolean> {
    try {
      if (this.isConnected()) {
        return true;
      }

      // Try REST API health check
      const baseUrl = this.config?.restApiUrl || "https://api.binance.com";
      const response = await fetch(`${baseUrl}/api/v3/ping`);
      return response.ok;
    } catch {
      return false;
    }
  }
}
