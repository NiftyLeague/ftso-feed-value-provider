import { BaseExchangeAdapter } from "@/adapters/base/base-exchange-adapter";
import type { ExchangeCapabilities, ExchangeConnectionConfig } from "@/common/types/adapters";
import type { PriceUpdate, VolumeUpdate } from "@/common/types/core";
import { FeedCategory } from "@/common/types/core";

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

export class OkxAdapter extends BaseExchangeAdapter {
  readonly exchangeName = "okx";
  readonly category = FeedCategory.Crypto;
  readonly capabilities: ExchangeCapabilities = {
    supportsWebSocket: true,
    supportsREST: true,
    supportsVolume: true,
    supportsOrderBook: true,
    supportedCategories: [FeedCategory.Crypto],
  };

  private pingInterval?: NodeJS.Timeout;

  constructor(config?: ExchangeConnectionConfig) {
    super({ connection: config });
  }

  protected async doConnect(): Promise<void> {
    const config = this.getConfig();
    const wsUrl = config?.websocketUrl || "wss://ws.okx.com:8443/ws/v5/public";

    // Use integrated WebSocket functionality from BaseExchangeAdapter
    await this.connectWebSocket({
      url: wsUrl,
      protocols: [],
      reconnectInterval: 5000,
      maxReconnectAttempts: 5,
      pingInterval: 30000, // OKX requires periodic ping
      pongTimeout: 10000,
      reconnectDelay: 5000,
      headers: {},
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

      // Handle ping/pong
      if (message?.event === "pong") {
        return;
      }

      // Handle subscription confirmation
      if (message?.event === "subscribe") {
        return;
      }

      // Handle ticker data
      if (message?.arg?.channel === "tickers" && message?.data) {
        message.data.forEach((ticker: OkxTickerData) => {
          if (this.validateResponse(ticker)) {
            const priceUpdate = this.normalizePriceData(ticker);
            this.onPriceUpdateCallback?.(priceUpdate);
          } else {
            this.logger.debug("Invalid ticker data received from OKX:", ticker);
          }
        });
      }
    } catch (error) {
      this.logger.error("Error processing OKX WebSocket message:", error);
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

  validateResponse(rawData: unknown): boolean {
    if (!rawData || typeof rawData !== "object") {
      return false;
    }

    try {
      const tickerData = rawData as OkxTickerData;
      return !!(
        tickerData.instId && // Symbol
        tickerData.last && // Last price
        tickerData.ts && // Timestamp (string)
        typeof tickerData.ts === "string" && // Ensure ts is a string
        !isNaN(this.parseNumber(tickerData.last))
      );
    } catch {
      return false;
    }
  }

  protected async doSubscribe(symbols: string[]): Promise<void> {
    const okxSymbols = symbols.map(symbol => this.getSymbolMapping(symbol));

    for (const symbol of okxSymbols) {
      const subscribeMessage = {
        op: "subscribe",
        args: [
          {
            channel: "tickers",
            instId: symbol,
          },
        ],
      };

      await this.sendWebSocketMessage(JSON.stringify(subscribeMessage));
    }
  }

  protected async doUnsubscribe(symbols: string[]): Promise<void> {
    const okxSymbols = symbols.map(symbol => this.getSymbolMapping(symbol));

    for (const symbol of okxSymbols) {
      const unsubscribeMessage = {
        op: "unsubscribe",
        args: [
          {
            channel: "tickers",
            instId: symbol,
          },
        ],
      };

      await this.sendWebSocketMessage(JSON.stringify(unsubscribeMessage));
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

  // Event handlers are now provided by BaseExchangeAdapter

  // Helper method to convert exchange symbol back to normalized format
  private normalizeSymbolFromExchange(exchangeSymbol: string): string {
    // OKX uses format like "BTC-USDT", convert to "BTC/USDT"
    // Simple and reliable - we only support symbols from feeds.json
    return exchangeSymbol.replace("-", "/");
  }

  // Override symbol mapping for OKX format
  override getSymbolMapping(normalizedSymbol: string): string {
    // Convert "BTC/USDT" to "BTC-USDT" for OKX
    return normalizedSymbol.replace("/", "-");
  }

  // OKX requires periodic ping to keep connection alive
  private startPingInterval(): void {
    this.pingInterval = setInterval(async () => {
      if (this.isConnected()) {
        const pingMessage = "ping";
        await this.sendWebSocketMessage(pingMessage);
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
