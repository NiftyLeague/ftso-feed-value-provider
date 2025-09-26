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

  constructor(config?: ExchangeConnectionConfig) {
    super({ connection: config });
  }

  override getSymbolMapping(feedSymbol: string): string {
    // For Crypto.com, replace "/" with "_"
    return feedSymbol.replace("/", "_");
  }

  protected async doConnect(): Promise<void> {
    const config = this.getConfig();
    const wsUrl = config?.websocketUrl || "wss://stream.crypto.com/v2/market";

    await this.connectWebSocket(this.createWebSocketConfig(wsUrl));
  }

  protected async doDisconnect(): Promise<void> {
    await this.disconnectWebSocket();
  }

  // Override WebSocket close handler for Crypto.com-specific handling
  protected override handleWebSocketClose(): boolean {
    // Only log if not shutting down to reduce noise
    if (!this.isShuttingDown) {
      this.logger.warn(`Crypto.com WebSocket connection closed`);
      return true; // We handled the logging
    }
    return super.handleWebSocketClose();
  }

  // Override WebSocket event handlers from BaseExchangeAdapter
  protected override handleWebSocketMessage(data: unknown): void {
    try {
      const message = typeof data === "string" ? JSON.parse(data) : data;

      // Handle heartbeat response
      if (message?.method === "public/heartbeat") {
        this.onPongReceived();
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

  normalizePriceData(rawData: ICryptocomTickerData): PriceUpdate {
    const price = this.parseNumber(rawData.a);
    const volume = this.parseNumber(rawData.v);
    const timestamp = this.standardizeTimestamp(rawData.t);

    // Calculate spread for confidence using standardized method
    const bid = this.parseNumber(rawData.b);
    const ask = this.parseNumber(rawData.k);
    const spreadPercent = this.calculateSpreadForConfidence(bid, ask, price);

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

    const subscribeMessage = {
      id: this.messageId++,
      method: "subscribe",
      params: {
        channels: cryptocomSymbols.map(sym => `ticker.${sym}`),
      },
    };

    try {
      await this.sendWebSocketMessage(JSON.stringify(subscribeMessage));
      this.logger.log(`Subscribed to Crypto.com symbols: ${cryptocomSymbols.join(", ")}`);
    } catch (error) {
      this.logger.warn(`Crypto.com subscription error:`, error);
    }
  }

  protected async doUnsubscribe(symbols: string[]): Promise<void> {
    const cryptocomSymbols = symbols.map(symbol => this.getSymbolMapping(symbol));

    const unsubscribeMessage = {
      id: this.messageId++,
      method: "unsubscribe",
      params: {
        channels: cryptocomSymbols.map(sym => `ticker.${sym}`),
      },
    };

    try {
      await this.sendWebSocketMessage(JSON.stringify(unsubscribeMessage));
      this.logger.log(`Unsubscribed from Crypto.com symbols: ${cryptocomSymbols.join(", ")}`);
    } catch (error) {
      this.logger.warn(`Crypto.com unsubscription error:`, error);
    }
  }

  // REST API fallback methods
  async fetchTickerREST(symbol: string): Promise<PriceUpdate> {
    const cryptocomSymbol = this.getSymbolMapping(symbol);
    const config = this.getConfig();
    const baseUrl = config?.restApiUrl || "https://api.crypto.com/v2";
    const url = `${baseUrl}/public/get-ticker?instrument_name=${cryptocomSymbol}`;

    const response = await this.fetchRestApi(url, `Failed to fetch Crypto.com ticker for ${symbol}`);
    const result = (await response.json()) as ICryptocomRestResponse;

    this.handleRestApiError(result, "Crypto.com");

    if (!result.result.data || result.result.data.length === 0) {
      throw new Error("Crypto.com API error: No data");
    }

    return this.normalizePriceData(result.result.data[0]);
  }

  // Override symbol normalization for Crypto.com format
  protected override normalizeSymbolFromExchange(exchangeSymbol: string): string {
    return this.standardizeSymbolFromExchange(exchangeSymbol, ["_"]);
  }

  // Override ping message for Crypto.com-specific heartbeat format
  protected override sendPingMessage(): void {
    if (this.isWebSocketConnected()) {
      try {
        void this.sendWebSocketMessage(
          JSON.stringify({
            id: this.messageId++,
            method: "public/heartbeat",
          })
        );
        this.logger.log("✅ Sent heartbeat to Crypto.com WebSocket");
      } catch (error) {
        this.logger.warn("❌ Failed to send heartbeat to Crypto.com WebSocket:", error);
        // If heartbeat fails, the connection might be stale, trigger reconnection
        this.handleWebSocketError(error as Error);
      }
    } else {
      this.logger.warn("⚠️  Cannot send heartbeat to Crypto.com - WebSocket not connected");
    }
  }

  protected async doHealthCheck(): Promise<boolean> {
    if (this.isConnected()) {
      return true;
    }

    // If not connected via WebSocket, try REST API
    const config = this.getConfig();
    const baseUrl = config?.restApiUrl || "https://api.crypto.com/v2";
    return this.performStandardHealthCheck(`${baseUrl}/public/get-instruments`);
  }
}
