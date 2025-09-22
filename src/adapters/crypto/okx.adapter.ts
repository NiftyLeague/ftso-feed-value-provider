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

  constructor(config?: ExchangeConnectionConfig) {
    super({ connection: config });
  }

  override getSymbolMapping(normalizedSymbol: string): string {
    // Convert "BTC/USDT" to "BTC-USDT" for OKX
    return normalizedSymbol.replace("/", "-");
  }

  protected async doConnect(): Promise<void> {
    const config = this.getConfig();
    const wsUrl = config?.websocketUrl || "wss://ws.okx.com:8443/ws/v5/public";

    await this.connectWebSocket({
      url: wsUrl,
      reconnectInterval: 5000,
      maxReconnectAttempts: 5,
      pingInterval: 30000, // OKX requires periodic ping
      pongTimeout: 10000,
    });
  }

  protected async doDisconnect(): Promise<void> {
    await this.disconnectWebSocket();
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

  normalizePriceData(rawData: OkxTickerData): PriceUpdate {
    const price = this.parseNumber(rawData.last);
    const volume = this.parseNumber(rawData.vol24h);
    const timestamp = parseInt(rawData.ts);

    // Calculate spread for confidence
    const bid = this.parseNumber(rawData.bidPx);
    const ask = this.parseNumber(rawData.askPx);
    const spreadPercent = this.calculateSpreadPercent(bid, ask, price);

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
    const config = this.getConfig();
    const baseUrl = config?.restApiUrl || "https://www.okx.com";
    const url = `${baseUrl}/api/v5/market/ticker?instId=${okxSymbol}`;

    const response = await this.fetchRestApi(url, `Failed to fetch OKX ticker for ${symbol}`);
    const result: OkxRestResponse = await response.json();

    if (result.code !== "0" || !result.data || result.data.length === 0) {
      throw new Error(`OKX API error: ${result.msg || "No data"}`);
    }

    const data = result.data[0];

    // Calculate spread for confidence
    const price = this.parseNumber(data.last);
    const bid = this.parseNumber(data.bidPx);
    const ask = this.parseNumber(data.askPx);
    const spreadPercent = this.calculateSpreadPercent(bid, ask, price);

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
  }

  // Override symbol normalization for OKX format
  protected override normalizeSymbolFromExchange(exchangeSymbol: string): string {
    // OKX uses format like "BTC-USDT", convert to "BTC/USDT"
    return exchangeSymbol.replace("-", "/");
  }

  // Override ping message for OKX-specific format
  protected override sendPingMessage(): void {
    if (this.isWebSocketConnected()) {
      void this.sendWebSocketMessage("ping");
    }
  }

  protected async doHealthCheck(): Promise<boolean> {
    try {
      const config = this.getConfig();
      const baseUrl = config?.restApiUrl || "https://www.okx.com";
      const response = await this.fetchRestApi(`${baseUrl}/api/v5/system/status`, "OKX health check failed");
      const result: OkxRestResponse = await response.json();
      return result.code === "0";
    } catch {
      return false;
    }
  }
}
