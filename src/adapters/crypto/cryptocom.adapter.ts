import {
  ExchangeAdapter,
  ExchangeCapabilities,
  ExchangeConnectionConfig,
} from "@/interfaces/exchange-adapter.interface";
import { PriceUpdate, VolumeUpdate } from "@/interfaces/data-source.interface";
import { FeedCategory } from "@/types/feed-category.enum";

export interface CryptocomTickerData {
  i: string; // Instrument name (symbol)
  b: string; // Best bid price
  k: string; // Best ask price
  a: string; // Last traded price
  t: number; // Timestamp
  v: string; // 24h volume
  h: string; // 24h high
  l: string; // 24h low
  c: string; // 24h change
}

export interface CryptocomWebSocketMessage {
  id?: number;
  method: string;
  code?: number;
  result?: {
    channel: string;
    subscription: string;
    data: CryptocomTickerData[];
  };
}

export interface CryptocomRestTickerData {
  i: string; // Instrument name
  b: string; // Best bid price
  k: string; // Best ask price
  a: string; // Last traded price
  t: number; // Timestamp
  v: string; // 24h volume
  h: string; // 24h high
  l: string; // 24h low
  c: string; // 24h change
}

export interface CryptocomRestResponse {
  id: number;
  method: string;
  code: number;
  result: {
    data: CryptocomRestTickerData[];
  };
}

export class CryptocomAdapter extends ExchangeAdapter {
  readonly exchangeName = "cryptocom";
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
  private messageId = 1;

  constructor(config?: ExchangeConnectionConfig) {
    super(config);
    this.initializeSymbolConventions();
  }

  async connect(): Promise<void> {
    if (this.isConnectedFlag) {
      return;
    }

    const wsUrl = this.config?.websocketUrl || "wss://stream.crypto.com/v2/market";

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
          reject(new Error(`Crypto.com WebSocket connection failed: ${error}`));
        };

        this.wsConnection.onclose = () => {
          this.isConnectedFlag = false;
          this.stopPingInterval();
          this.onConnectionChangeCallback?.(false);
        };

        this.wsConnection.onmessage = event => {
          try {
            const message: CryptocomWebSocketMessage = JSON.parse(event.data);

            // Handle pong response
            if (message.method === "public/heartbeat") {
              return;
            }

            // Handle subscription confirmation
            if (message.method === "subscribe" && message.code === 0) {
              return;
            }

            // Handle ticker data
            if (message.result?.channel === "ticker" && message.result.data) {
              message.result.data.forEach((ticker: CryptocomTickerData) => {
                if (this.validateResponse(ticker)) {
                  const priceUpdate = this.normalizePriceData(ticker);
                  this.onPriceUpdateCallback?.(priceUpdate);
                }
              });
            }
          } catch (error) {
            console.error("Error processing Crypto.com message:", error);
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

  normalizePriceData(rawData: CryptocomTickerData): PriceUpdate {
    const price = this.parseNumber(rawData.a);
    const volume = this.parseNumber(rawData.v);
    const timestamp = rawData.t;

    // Calculate spread for confidence
    const bid = this.parseNumber(rawData.b);
    const ask = this.parseNumber(rawData.k);
    const spread = ask - bid;
    const spreadPercent = (spread / price) * 100;

    return {
      symbol: this.normalizeSymbolFromExchange(rawData.i),
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

  normalizeVolumeData(rawData: CryptocomTickerData): VolumeUpdate {
    return {
      symbol: this.normalizeSymbolFromExchange(rawData.i),
      volume: this.parseNumber(rawData.v),
      timestamp: rawData.t,
      source: this.exchangeName,
    };
  }

  validateResponse(rawData: any): boolean {
    if (!rawData || typeof rawData !== "object") {
      return false;
    }

    const tickerData = rawData as CryptocomTickerData;

    try {
      return !!(
        tickerData.i && // Symbol
        tickerData.a && // Last price
        tickerData.t && // Timestamp
        !isNaN(this.parseNumber(tickerData.a))
      );
    } catch {
      return false;
    }
  }

  // WebSocket subscription management
  async subscribe(symbols: string[]): Promise<void> {
    if (!this.isConnected()) {
      throw new Error("Crypto.com WebSocket not connected");
    }

    const cryptocomSymbols = symbols.map(symbol => this.getSymbolMapping(symbol));

    for (const symbol of cryptocomSymbols) {
      if (!this.subscriptions.has(symbol)) {
        const subscribeMessage = {
          id: this.messageId++,
          method: "subscribe",
          params: {
            channels: [`ticker.${symbol}`],
          },
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

    const cryptocomSymbols = symbols.map(symbol => this.getSymbolMapping(symbol));

    for (const symbol of cryptocomSymbols) {
      if (this.subscriptions.has(symbol)) {
        const unsubscribeMessage = {
          id: this.messageId++,
          method: "unsubscribe",
          params: {
            channels: [`ticker.${symbol}`],
          },
        };

        this.wsConnection?.send(JSON.stringify(unsubscribeMessage));
        this.subscriptions.delete(symbol);
      }
    }
  }

  // REST API fallback methods
  async fetchTickerREST(symbol: string): Promise<PriceUpdate> {
    const cryptocomSymbol = this.getSymbolMapping(symbol);
    const baseUrl = this.config?.restApiUrl || "https://api.crypto.com";
    const url = `${baseUrl}/v2/public/get-ticker?instrument_name=${cryptocomSymbol}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result: CryptocomRestResponse = await response.json();

      if (result.code !== 0 || !result.result?.data || result.result.data.length === 0) {
        throw new Error(`Crypto.com API error: ${result.code || "No data"}`);
      }

      const data = result.result.data[0];

      // Calculate spread for confidence
      const price = this.parseNumber(data.a);
      const bid = this.parseNumber(data.b);
      const ask = this.parseNumber(data.k);
      const spread = ask - bid;
      const spreadPercent = (spread / price) * 100;

      return {
        symbol: this.normalizeSymbolFromExchange(data.i),
        price,
        timestamp: data.t,
        source: this.exchangeName,
        volume: this.parseNumber(data.v),
        confidence: this.calculateConfidence(data, {
          latency: 0, // REST call, no latency penalty
          volume: this.parseNumber(data.v),
          spread: spreadPercent,
        }),
      };
    } catch (error) {
      throw new Error(`Failed to fetch Crypto.com ticker for ${symbol}: ${error}`);
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
    // Crypto.com uses format like "BTC_USDT", need to convert to "BTC/USDT"
    return exchangeSymbol.replace("_", "/");
  }

  // Override symbol mapping for Crypto.com format
  getSymbolMapping(normalizedSymbol: string): string {
    // Convert "BTC/USDT" to "BTC_USDT" for Crypto.com
    return normalizedSymbol.replace("/", "_");
  }

  // Crypto.com requires periodic heartbeat to keep connection alive
  private startPingInterval(): void {
    this.pingInterval = setInterval(() => {
      if (this.isConnected()) {
        const heartbeatMessage = {
          id: this.messageId++,
          method: "public/heartbeat",
          params: {},
        };
        this.wsConnection?.send(JSON.stringify(heartbeatMessage));
      }
    }, 30000); // Heartbeat every 30 seconds
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
      const baseUrl = this.config?.restApiUrl || "https://api.crypto.com";
      const response = await fetch(`${baseUrl}/v2/public/get-instruments`);

      if (!response.ok) {
        return false;
      }

      const result: CryptocomRestResponse = await response.json();
      return result.code === 0;
    } catch {
      return false;
    }
  }
}
