import { BaseExchangeAdapter } from "@/adapters/base/base-exchange-adapter";
import type { ExchangeCapabilities, ExchangeConnectionConfig } from "@/common/types/adapters";
import type { PriceUpdate, VolumeUpdate } from "@/common/types/core";
import { FeedCategory } from "@/common/types/core";

export interface ICryptocomTickerData {
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

export interface ICryptocomWebSocketMessage {
  id?: number;
  method: string;
  code?: number;
  result?: {
    channel: string;
    subscription: string;
    data: ICryptocomTickerData[];
  };
}

export interface ICryptocomRestTickerData {
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

export interface ICryptocomRestResponse {
  id: number;
  method: string;
  code: number;
  result: {
    data: ICryptocomRestTickerData[];
  };
}

export class CryptocomAdapter extends BaseExchangeAdapter {
  readonly exchangeName = "cryptocom";
  readonly category = FeedCategory.Crypto;
  readonly capabilities: ExchangeCapabilities = {
    supportsWebSocket: true,
    supportsREST: true,
    supportsVolume: true,
    supportsOrderBook: true,
    supportedCategories: [FeedCategory.Crypto],
  };

  private messageId = 0; // Used for message IDs
  private pingInterval?: NodeJS.Timeout;
  private readonly baseWsUrl = "wss://stream.crypto.com/v2/market";
  private readonly baseRestUrl = "https://api.crypto.com/v2";

  constructor(config?: ExchangeConnectionConfig) {
    super({ connection: config });
  }

  // Simple symbol mapping - use exact pairs from feeds.json
  override getSymbolMapping(feedSymbol: string): string {
    // For Crypto.com, replace "/" with "_" - use the exact symbol from feeds.json
    return feedSymbol.replace("/", "_");
  }

  protected async doConnect(): Promise<void> {
    const wsUrl = this.config?.websocketUrl || this.baseWsUrl;

    // Ensure we have a valid WebSocket URL
    if (typeof wsUrl !== "string") {
      throw new Error("WebSocket URL must be a string");
    }

    // Use integrated WebSocket functionality from BaseExchangeAdapter
    await this.connectWebSocket({
      url: wsUrl,
      reconnectDelay: 5000,
      reconnectInterval: 5000,
      maxReconnectAttempts: 5,
      pingInterval: 30000,
      pongTimeout: 10000,
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

  // Override WebSocket event handlers from BaseExchangeAdapter
  protected override handleWebSocketMessage(data: unknown): void {
    try {
      const message = typeof data === "string" ? JSON.parse(data) : data;

      // Handle pong response
      if (message?.method === "public/heartbeat") {
        return;
      }

      // Handle subscription confirmation
      if (message?.method === "subscribe" && message?.result) {
        this.logger.debug(`Subscribed to ${message.result.channel}`);
        return;
      }

      // Handle ticker data
      if (message?.method === "ticker" && message?.result?.data) {
        const tickerData = message.result.data[0];
        if (this.validateResponse(tickerData)) {
          const priceUpdate = this.normalizePriceData(tickerData);
          this.onPriceUpdateCallback?.(priceUpdate);
        } else {
          this.logger.debug("Invalid ticker data received from Crypto.com:", tickerData);
        }
      }
    } catch (error) {
      this.logger.error("Error processing Crypto.com WebSocket message:", error);
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

  normalizePriceData(rawData: ICryptocomTickerData): PriceUpdate {
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

  normalizeVolumeData(rawData: ICryptocomTickerData): VolumeUpdate {
    return {
      symbol: this.normalizeSymbolFromExchange(rawData.i),
      volume: this.parseNumber(rawData.v),
      timestamp: rawData.t,
      source: this.exchangeName,
    };
  }

  validateResponse(rawData: unknown): boolean {
    if (!rawData || typeof rawData !== "object") {
      return false;
    }

    const tickerData = rawData as ICryptocomTickerData;

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

  protected async doSubscribe(symbols: string[]): Promise<void> {
    const cryptocomSymbols = symbols.map(symbol => this.getSymbolMapping(symbol));
    const newSymbols = cryptocomSymbols.filter(sym => !this.subscriptions.has(sym));

    if (newSymbols.length === 0) {
      return; // Already subscribed to all symbols
    }

    const subscribeMessage = {
      id: this.messageId++,
      method: "subscribe",
      params: {
        channels: newSymbols.map(sym => `ticker.${sym}`),
      },
    };

    await this.sendWebSocketMessage(JSON.stringify(subscribeMessage));
  }

  protected async doUnsubscribe(symbols: string[]): Promise<void> {
    const cryptocomSymbols = symbols.map(symbol => this.getSymbolMapping(symbol));
    const subscribedSymbols = cryptocomSymbols.filter(sym => this.subscriptions.has(sym));

    if (subscribedSymbols.length === 0) {
      return; // Not subscribed to any of these symbols
    }

    const unsubscribeMessage = {
      id: this.messageId++,
      method: "unsubscribe",
      params: {
        channels: subscribedSymbols.map(sym => `ticker.${sym}`),
      },
    };

    await this.sendWebSocketMessage(JSON.stringify(unsubscribeMessage));
  }

  // REST API fallback methods
  async fetchTickerREST(symbol: string): Promise<PriceUpdate> {
    const cryptocomSymbol = this.getSymbolMapping(symbol);
    const baseUrl = this.config?.restApiUrl || this.baseRestUrl;
    const url = `${baseUrl}/public/get-ticker?instrument_name=${cryptocomSymbol}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = (await response.json()) as ICryptocomRestResponse;
      if (result.code !== 0) {
        throw new Error(`Crypto.com API error: ${result.code}`);
      }

      if (!result.result.data || result.result.data.length === 0) {
        throw new Error("Crypto.com API error: No data");
      }

      return this.normalizePriceData(result.result.data[0]);
    } catch (error) {
      throw new Error(`Failed to fetch Crypto.com ticker for ${symbol}: ${error}`);
    }
  }

  // Helper method to convert exchange symbol back to normalized format
  private normalizeSymbolFromExchange(exchangeSymbol: string): string {
    // Convert from exchange format (e.g., "BTC_USDT") to normalized format (e.g., "BTC/USDT")
    return exchangeSymbol.replace("_", "/");
  }

  // Crypto.com requires periodic heartbeat to keep connection alive
  private startPingInterval(): void {
    this.pingInterval = setInterval(async () => {
      if (this.isConnected()) {
        // Use integrated WebSocket functionality
        await this.sendWebSocketMessage(JSON.stringify({ method: "public/heartbeat" }));
      }
    }, 30000); // Ping every 30 seconds
  }

  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = undefined;
    }
  }

  protected async doHealthCheck(): Promise<boolean> {
    try {
      if (this.isConnected()) {
        return true;
      }

      // If not connected via WebSocket, try REST API
      const baseUrl = this.config?.restApiUrl || this.baseRestUrl;
      const response = await fetch(`${baseUrl}/public/get-instruments`);
      const result = await response.json();
      return result.code === 0;
    } catch (error) {
      this.logger.error("Health check failed:", error);
      return false;
    }
  }
}
