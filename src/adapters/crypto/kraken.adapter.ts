import {
  ExchangeAdapter,
  ExchangeCapabilities,
  ExchangeConnectionConfig,
} from "@/interfaces/exchange-adapter.interface";
import { PriceUpdate, VolumeUpdate } from "@/interfaces/data-source.interface";
import { FeedCategory } from "@/types/feed-category.enum";

export interface KrakenTickerData {
  channelID: number;
  channelName: string;
  pair: string;
  data: {
    a: [string, string, string]; // Ask [price, whole lot volume, lot volume]
    b: [string, string, string]; // Bid [price, whole lot volume, lot volume]
    c: [string, string]; // Last trade closed [price, lot volume]
    v: [string, string]; // Volume [today, last 24 hours]
    p: [string, string]; // Volume weighted average price [today, last 24 hours]
    t: [number, number]; // Number of trades [today, last 24 hours]
    l: [string, string]; // Low [today, last 24 hours]
    h: [string, string]; // High [today, last 24 hours]
    o: [string, string]; // Opening price [today, last 24 hours]
  };
}

export interface KrakenRestTickerData {
  [pair: string]: {
    a: [string, string, string]; // Ask
    b: [string, string, string]; // Bid
    c: [string, string]; // Last trade closed
    v: [string, string]; // Volume
    p: [string, string]; // VWAP
    t: [number, number]; // Number of trades
    l: [string, string]; // Low
    h: [string, string]; // High
    o: string; // Opening price
  };
}

export class KrakenAdapter extends ExchangeAdapter {
  readonly exchangeName = "kraken";
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

  constructor(config?: ExchangeConnectionConfig) {
    super(config);
  }

  // Simple symbol mapping - use exact pairs from feeds.json
  getSymbolMapping(feedSymbol: string): string {
    // For WebSocket, remove the slash - use the exact symbol from feeds.json
    return feedSymbol.replace("/", "");
  }

  async connect(): Promise<void> {
    if (this.isConnectedFlag) {
      return;
    }

    const wsUrl = this.config?.websocketUrl || "wss://ws.kraken.com";

    return new Promise((resolve, reject) => {
      try {
        this.wsConnection = new WebSocket(wsUrl);

        this.wsConnection.onopen = () => {
          this.isConnectedFlag = true;
          this.onConnectionChangeCallback?.(true);
          resolve();
        };

        this.wsConnection.onerror = error => {
          this.isConnectedFlag = false;
          const connectionError = new Error(`Kraken WebSocket connection failed: ${error}`);
          this.onErrorCallback?.(connectionError);
          this.onConnectionChangeCallback?.(false);
          reject(connectionError);
        };

        this.wsConnection.onclose = event => {
          this.isConnectedFlag = false;
          this.onConnectionChangeCallback?.(false);

          // Emit error if close was unexpected (only if event has code property)
          if (event && typeof event.code === "number" && event.code !== 1000) {
            // 1000 is normal closure
            const closeError = new Error(
              `Kraken WebSocket closed unexpectedly: ${event.code} - ${event.reason || "Unknown reason"}`
            );
            this.onErrorCallback?.(closeError);
          }
        };

        this.wsConnection.onmessage = event => {
          try {
            const data = JSON.parse(event.data);

            // Handle different message types
            if (Array.isArray(data)) {
              // Ticker data format: [channelID, data, channelName, pair]
              if (data.length >= 4 && data[2] === "ticker") {
                const tickerData: KrakenTickerData = {
                  channelID: data[0],
                  channelName: data[2],
                  pair: data[3],
                  data: data[1],
                };

                if (this.validateResponse(tickerData)) {
                  const priceUpdate = this.normalizePriceData(tickerData);
                  this.onPriceUpdateCallback?.(priceUpdate);
                }
              }
            } else if (data.event === "systemStatus") {
              console.log("Kraken system status:", data.status);
            } else if (data.event === "subscriptionStatus") {
              if (data.status === "subscribed") {
                console.log("Kraken subscription confirmed:", data.pair);
              }
            }
          } catch (error) {
            const parseError = new Error(`Error processing Kraken message: ${error}`);
            this.onErrorCallback?.(parseError);
          }
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  async disconnect(): Promise<void> {
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

  normalizePriceData(rawData: KrakenTickerData): PriceUpdate {
    const price = this.parseNumber(rawData.data.c[0]); // Last trade price
    const volume = this.parseNumber(rawData.data.v[1]); // 24h volume
    const timestamp = Date.now(); // Kraken doesn't provide timestamp in ticker

    // Calculate spread for confidence
    const bid = this.parseNumber(rawData.data.b[0]);
    const ask = this.parseNumber(rawData.data.a[0]);
    const spread = ask - bid;
    const spreadPercent = (spread / price) * 100;

    return {
      symbol: this.normalizeSymbolFromExchange(rawData.pair),
      price,
      timestamp,
      source: this.exchangeName,
      volume,
      confidence: this.calculateConfidence(rawData, {
        latency: 0, // Real-time WebSocket data
        volume,
        spread: spreadPercent,
      }),
    };
  }

  normalizeVolumeData(rawData: KrakenTickerData): VolumeUpdate {
    return {
      symbol: this.normalizeSymbolFromExchange(rawData.pair),
      volume: this.parseNumber(rawData.data.v[1]), // 24h volume
      timestamp: Date.now(),
      source: this.exchangeName,
    };
  }

  validateResponse(rawData: any): boolean {
    if (!rawData || typeof rawData !== "object") {
      return false;
    }

    const tickerData = rawData as KrakenTickerData;

    try {
      return !!(
        tickerData.pair &&
        tickerData.data &&
        tickerData.data.c &&
        tickerData.data.c[0] &&
        !isNaN(this.parseNumber(tickerData.data.c[0]))
      );
    } catch {
      return false;
    }
  }

  // WebSocket subscription management
  async subscribe(symbols: string[]): Promise<void> {
    if (!this.isConnected()) {
      throw new Error("Not connected to Kraken WebSocket");
    }

    const krakenSymbols = symbols.map(symbol => this.getSymbolMapping(symbol));

    const subscribeMessage = {
      event: "subscribe",
      pair: krakenSymbols,
      subscription: {
        name: "ticker",
      },
    };

    this.wsConnection?.send(JSON.stringify(subscribeMessage));

    // Track subscriptions
    krakenSymbols.forEach(symbol => this.subscriptions.add(symbol));
  }

  async unsubscribe(symbols: string[]): Promise<void> {
    if (!this.isConnected()) {
      return;
    }

    const krakenSymbols = symbols.map(symbol => this.getSymbolMapping(symbol));

    const unsubscribeMessage = {
      event: "unsubscribe",
      pair: krakenSymbols,
      subscription: {
        name: "ticker",
      },
    };

    this.wsConnection?.send(JSON.stringify(unsubscribeMessage));

    // Remove from tracked subscriptions
    krakenSymbols.forEach(symbol => this.subscriptions.delete(symbol));
  }

  // REST API fallback methods
  async fetchTickerREST(symbol: string): Promise<PriceUpdate> {
    const krakenSymbol = this.getSymbolMapping(symbol);
    const baseUrl = this.config?.restApiUrl || "https://api.kraken.com";
    const url = `${baseUrl}/0/public/Ticker?pair=${krakenSymbol}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();

      if (result.error && result.error.length > 0) {
        throw new Error(`Kraken API error: ${result.error.join(", ")}`);
      }

      const data: KrakenRestTickerData = result.result;
      const pairData = Object.values(data)[0]; // Get first (and should be only) pair data

      if (!pairData) {
        throw new Error(`No data returned for symbol ${symbol}`);
      }

      // Calculate spread for confidence
      const price = this.parseNumber(pairData.c[0]);
      const bid = this.parseNumber(pairData.b[0]);
      const ask = this.parseNumber(pairData.a[0]);
      const spread = ask - bid;
      const spreadPercent = (spread / price) * 100;

      return {
        symbol: this.normalizeSymbolFromExchange(krakenSymbol),
        price,
        timestamp: Date.now(), // Kraken REST doesn't provide timestamp
        source: this.exchangeName,
        volume: this.parseNumber(pairData.v[1]), // 24h volume
        confidence: this.calculateConfidence(pairData, {
          latency: 0, // REST call, no latency penalty
          volume: this.parseNumber(pairData.v[1]),
          spread: spreadPercent,
        }),
      };
    } catch (error) {
      throw new Error(`Failed to fetch Kraken ticker for ${symbol}: ${error}`);
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
      const quotes = ["USD", "USDT", "USDC", "EUR"];

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
      const baseUrl = this.config?.restApiUrl || "https://api.kraken.com";
      const response = await fetch(`${baseUrl}/0/public/SystemStatus`);

      if (!response.ok) {
        return false;
      }

      const result = await response.json();
      return result.result?.status === "online";
    } catch {
      return false;
    }
  }
}
