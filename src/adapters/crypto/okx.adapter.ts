import {
  ExchangeAdapter,
  ExchangeCapabilities,
  ExchangeConnectionConfig,
} from "@/interfaces/exchange-adapter.interface";
import { PriceUpdate, VolumeUpdate } from "@/interfaces/data-source.interface";
import { FeedCategory } from "@/types/feed-category.enum";

export interface OkxTickerData {
  instType: string; // Instrument type
  instId: string; // Instrument ID (symbol)
  last: string; // Last traded price
  lastSz: string; // Last traded size
  askPx: string; // Best ask price
  askSz: string; // Best ask size
  bidPx: string; // Best bid price
  bidSz: string; // Best bid size
  open24h: string; // Open price in the past 24 hours
  high24h: string; // Highest price in the past 24 hours
  low24h: string; // Lowest price in the past 24 hours
  volCcy24h: string; // 24h trading volume in quote currency
  vol24h: string; // 24h trading volume in base currency
  ts: string; // Ticker data generation time
  sodUtc0: string; // Open price at UTC 0
  sodUtc8: string; // Open price at UTC 8
}

export interface OkxWebSocketMessage {
  arg: {
    channel: string;
    instId: string;
  };
  data: OkxTickerData[];
}

export interface OkxRestTickerData {
  instType: string;
  instId: string;
  last: string;
  lastSz: string;
  askPx: string;
  askSz: string;
  bidPx: string;
  bidSz: string;
  open24h: string;
  high24h: string;
  low24h: string;
  volCcy24h: string;
  vol24h: string;
  ts: string;
  sodUtc0: string;
  sodUtc8: string;
}

export interface OkxRestResponse {
  code: string;
  msg: string;
  data: OkxRestTickerData[];
}

export class OkxAdapter extends ExchangeAdapter {
  readonly exchangeName = "okx";
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

  constructor(config?: ExchangeConnectionConfig) {
    super(config);
    this.initializeSymbolConventions();
  }

  async connect(): Promise<void> {
    if (this.isConnectedFlag) {
      return;
    }

    const wsUrl = this.config?.websocketUrl || "wss://ws.okx.com:8443/ws/v5/public";

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
          this.onConnectionChangeCallback?.(false);
          reject(new Error(`OKX WebSocket connection failed: ${error}`));
        };

        this.wsConnection.onclose = () => {
          this.isConnectedFlag = false;
          this.stopPingInterval();
          this.onConnectionChangeCallback?.(false);
        };

        this.wsConnection.onmessage = event => {
          try {
            const message = JSON.parse(event.data);

            // Handle ping/pong
            if (message.event === "pong") {
              return;
            }

            // Handle subscription confirmation
            if (message.event === "subscribe") {
              return;
            }

            // Handle ticker data
            if (message.arg?.channel === "tickers" && message.data) {
              message.data.forEach((ticker: OkxTickerData) => {
                if (this.validateResponse(ticker)) {
                  const priceUpdate = this.normalizePriceData(ticker);
                  this.onPriceUpdateCallback?.(priceUpdate);
                }
              });
            }
          } catch (error) {
            console.error("Error processing OKX message:", error);
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

  normalizePriceData(rawData: OkxTickerData): PriceUpdate {
    const price = this.parseNumber(rawData.last);
    const volume = this.parseNumber(rawData.vol24h);
    const timestamp = parseInt(rawData.ts);

    // Calculate spread for confidence
    const bid = this.parseNumber(rawData.bidPx);
    const ask = this.parseNumber(rawData.askPx);
    const spread = ask - bid;
    const spreadPercent = (spread / price) * 100;

    return {
      symbol: this.normalizeSymbolFromExchange(rawData.instId),
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

  normalizeVolumeData(rawData: OkxTickerData): VolumeUpdate {
    return {
      symbol: this.normalizeSymbolFromExchange(rawData.instId),
      volume: this.parseNumber(rawData.vol24h),
      timestamp: parseInt(rawData.ts),
      source: this.exchangeName,
    };
  }

  validateResponse(rawData: any): boolean {
    if (!rawData || typeof rawData !== "object") {
      return false;
    }

    const tickerData = rawData as OkxTickerData;

    try {
      return !!(
        tickerData.instId && // Symbol
        tickerData.last && // Last price
        tickerData.ts && // Timestamp
        !isNaN(this.parseNumber(tickerData.last))
      );
    } catch {
      return false;
    }
  }

  // WebSocket subscription management
  async subscribe(symbols: string[]): Promise<void> {
    if (!this.isConnected()) {
      throw new Error("OKX WebSocket not connected");
    }

    const okxSymbols = symbols.map(symbol => this.getSymbolMapping(symbol));

    for (const symbol of okxSymbols) {
      if (!this.subscriptions.has(symbol)) {
        const subscribeMessage = {
          op: "subscribe",
          args: [
            {
              channel: "tickers",
              instId: symbol,
            },
          ],
        };

        this.wsConnection?.send(JSON.stringify(subscribeMessage));
        this.subscriptions.add(symbol);
      }
    }
  }

  async unsubscribe(symbols: string[]): Promise<void> {
    if (!this.isConnected()) {
      return;
    }

    const okxSymbols = symbols.map(symbol => this.getSymbolMapping(symbol));

    for (const symbol of okxSymbols) {
      if (this.subscriptions.has(symbol)) {
        const unsubscribeMessage = {
          op: "unsubscribe",
          args: [
            {
              channel: "tickers",
              instId: symbol,
            },
          ],
        };

        this.wsConnection?.send(JSON.stringify(unsubscribeMessage));
        this.subscriptions.delete(symbol);
      }
    }
  }

  // REST API fallback methods
  async fetchTickerREST(symbol: string): Promise<PriceUpdate> {
    const okxSymbol = this.getSymbolMapping(symbol);
    const baseUrl = this.config?.restApiUrl || "https://www.okx.com";
    const url = `${baseUrl}/api/v5/market/ticker?instId=${okxSymbol}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result: OkxRestResponse = await response.json();

      if (result.code !== "0" || !result.data || result.data.length === 0) {
        throw new Error(`OKX API error: ${result.msg || "No data"}`);
      }

      const data = result.data[0];

      // Calculate spread for confidence
      const price = this.parseNumber(data.last);
      const bid = this.parseNumber(data.bidPx);
      const ask = this.parseNumber(data.askPx);
      const spread = ask - bid;
      const spreadPercent = (spread / price) * 100;

      return {
        symbol: this.normalizeSymbolFromExchange(data.instId),
        price,
        timestamp: parseInt(data.ts),
        source: this.exchangeName,
        volume: this.parseNumber(data.vol24h),
        confidence: this.calculateConfidence(data, {
          latency: 0, // REST call, no latency penalty
          volume: this.parseNumber(data.vol24h),
          spread: spreadPercent,
        }),
      };
    } catch (error) {
      throw new Error(`Failed to fetch OKX ticker for ${symbol}: ${error}`);
    }
  }

  // Event handlers
  private onPriceUpdateCallback?: (update: PriceUpdate) => void;
  private onConnectionChangeCallback?: (connected: boolean) => void;

  onPriceUpdate(callback: (update: PriceUpdate) => void): void {
    this.onPriceUpdateCallback = callback;
  }

  onConnectionChange(callback: (connected: boolean) => void): void {
    this.onConnectionChangeCallback = callback;
  }

  // Helper method to convert exchange symbol back to normalized format
  private normalizeSymbolFromExchange(exchangeSymbol: string): string {
    // OKX uses format like "BTC-USDT", need to convert to "BTC/USDT"
    return exchangeSymbol.replace("-", "/");
  }

  // Override symbol mapping for OKX format
  getSymbolMapping(normalizedSymbol: string): string {
    // Convert "BTC/USDT" to "BTC-USDT" for OKX
    return normalizedSymbol.replace("/", "-");
  }

  // OKX requires periodic ping to keep connection alive
  private startPingInterval(): void {
    this.pingInterval = setInterval(() => {
      if (this.isConnected()) {
        const pingMessage = "ping";
        this.wsConnection?.send(pingMessage);
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
      const baseUrl = this.config?.restApiUrl || "https://www.okx.com";
      const response = await fetch(`${baseUrl}/api/v5/system/status`);

      if (!response.ok) {
        return false;
      }

      const result: OkxRestResponse = await response.json();
      return result.code === "0";
    } catch {
      return false;
    }
  }
}
