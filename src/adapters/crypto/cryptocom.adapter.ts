import { BaseExchangeAdapter } from "@/adapters/base/base-exchange-adapter";
import type { ExchangeCapabilities, ExchangeConnectionConfig } from "@/common/types/adapters";
import type { PriceUpdate, VolumeUpdate } from "@/common/types/core";
import { FeedCategory } from "@/common/types/core";

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

  private pingInterval: NodeJS.Timeout | null = null;
  private messageId = 1;
  private pingIntervalMs = 30000; // 30 seconds
  private readonly baseRestUrl = "https://api.crypto.com/v2";
  private readonly baseWsUrl = "wss://stream.crypto.com/v2/market";

  constructor(config?: ExchangeConnectionConfig) {
    super(config);
  }

  protected async doConnect(): Promise<void> {
    const wsUrl = this.config?.websocketUrl || this.baseWsUrl;

    await this.connectWebSocket({
      url: wsUrl,
      reconnectDelay: 5000,
      reconnectInterval: 5000,
      maxReconnectAttempts: 5,
      pingInterval: this.pingIntervalMs,
      pongTimeout: 10000,
    });

    this.startPingInterval();
    this.isConnectedFlag = true;
  }

  protected async doDisconnect(): Promise<void> {
    this.stopPingInterval();
    if (this.isWebSocketConnected()) {
      await this.disconnectWebSocket();
    }
    this.isConnectedFlag = false;
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
      if (message?.method === "subscribe" && message.code === 0) {
        return;
      }

      // Handle ticker data
      if (message?.method === "ticker" && message.result?.data) {
        const tickers = Array.isArray(message.result.data) ? message.result.data : [message.result.data];
        tickers.forEach((ticker: CryptocomTickerData) => {
          if (this.validateResponse(ticker)) {
            const priceUpdate = this.normalizePriceData(ticker);
            this.onPriceUpdateCallback?.(priceUpdate);
          }
        });
      }
    } catch (error) {
      const parseError = new Error(`Error processing Crypto.com message: ${error}`);
      this.onErrorCallback?.(parseError);
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

  normalizePriceData(rawData: CryptocomTickerData): PriceUpdate {
    const price = parseFloat(rawData.a);
    const volume = parseFloat(rawData.v);
    const timestamp = rawData.t;

    // Calculate spread for confidence
    const bid = parseFloat(rawData.b);
    const ask = parseFloat(rawData.k);
    const spread = ask - bid;
    const spreadPercent = (spread / price) * 100;

    const normalizedSymbol = this.normalizeSymbol(rawData.i);

    return {
      symbol: normalizedSymbol,
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
      symbol: this.normalizeSymbol(rawData.i),
      volume: parseFloat(rawData.v),
      timestamp: rawData.t,
      source: this.exchangeName,
    };
  }

  validateResponse(rawData: unknown): boolean {
    if (!rawData || typeof rawData !== "object") {
      return false;
    }

    const tickerData = rawData as CryptocomTickerData;

    try {
      return !!(
        tickerData.i && // Symbol
        tickerData.a && // Last price
        tickerData.t && // Timestamp
        !isNaN(parseFloat(tickerData.a))
      );
    } catch {
      return false;
    }
  }

  protected async doSubscribe(symbols: string[]): Promise<void> {
    if (!this.isConnected()) {
      throw new Error(`Cannot subscribe: not connected to ${this.exchangeName}`);
    }

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
    if (!this.isConnected()) {
      return;
    }

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

    // Update local subscriptions
    for (const sym of subscribedSymbols) {
      this.subscriptions.delete(sym);
    }
  }

  // REST API fallback methods
  async fetchTickerREST(symbol: string): Promise<PriceUpdate> {
    const cryptocomSymbol = this.getSymbolMapping(symbol);
    const url = `${this.baseRestUrl}/public/get-ticker?instrument_name=${cryptocomSymbol}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = (await response.json()) as CryptocomRestResponse;
      if (result.code !== 0) {
        throw new Error(`Crypto.com API error: ${result.code}`);
      }

      if (!result.result.data || result.result.data.length === 0) {
        throw new Error("Crypto.com API error: No data");
      }

      return this.normalizePriceData(result.result.data[0]);
    } catch (error) {
      this.logger.error(`Error fetching ticker for ${symbol}:`, error);
      // Re-throw the original error if it's already a formatted error
      if (
        error instanceof Error &&
        (error.message.includes("HTTP error!") || error.message.includes("Crypto.com API error:"))
      ) {
        throw error;
      }
      throw new Error(`Failed to fetch Crypto.com ticker for ${symbol}`);
    }
  }

  // Helper method to convert exchange symbol back to normalized format
  private normalizeSymbol(exchangeSymbol: string): string {
    // Convert from exchange format (e.g., "BTC_USDT") to normalized format (e.g., "BTC/USDT")
    return exchangeSymbol.replace("_", "/");
  }

  // Override symbol mapping for Crypto.com format
  public override getSymbolMapping(normalizedSymbol: string): string {
    // Convert from normalized format (e.g., "BTC/USDT") to exchange format (e.g., "BTC_USDT")
    return normalizedSymbol.replace("/", "_");
  }

  // Crypto.com requires periodic heartbeat to keep connection alive
  private startPingInterval(): void {
    this.stopPingInterval();

    this.pingInterval = setInterval(async () => {
      if (this.isWebSocketConnected()) {
        await this.sendWebSocketMessage(
          JSON.stringify({
            method: "public/heartbeat",
            id: this.messageId++,
          })
        );
      }
    }, this.pingIntervalMs);
  }

  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  protected async doHealthCheck(): Promise<boolean> {
    try {
      if (this.isConnected()) {
        return true;
      }

      // If not connected via WebSocket, try REST API
      const response = await fetch(`${this.baseRestUrl}/public/get-instruments`);
      const result = await response.json();
      return result.code === 0;
    } catch (error) {
      this.logger.error("Health check failed:", error);
      return false;
    }
  }
}
