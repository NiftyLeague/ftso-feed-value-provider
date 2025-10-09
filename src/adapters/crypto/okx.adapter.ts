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

export interface OkxPongMessage {
  event?: "pong";
  op?: "pong";
}

export interface OkxSubscriptionMessage {
  event: "subscribe" | "subscription";
}

export interface OkxErrorMessage {
  event: "error";
  msg?: string;
  code?: string;
}

export type OkxMessage = OkxWebSocketMessage | OkxPongMessage | OkxSubscriptionMessage | OkxErrorMessage;

// Type guard functions
function isOkxPongMessage(message: unknown): message is OkxPongMessage {
  if (typeof message !== "object" || message === null) {
    return false;
  }

  const msg = message as Record<string, unknown>;
  return ("event" in msg && msg.event === "pong") || ("op" in msg && msg.op === "pong");
}

function isOkxSubscriptionMessage(message: unknown): message is OkxSubscriptionMessage {
  if (typeof message !== "object" || message === null) {
    return false;
  }

  const msg = message as Record<string, unknown>;
  return "event" in msg && (msg.event === "subscribe" || msg.event === "subscription");
}

function isOkxErrorMessage(message: unknown): message is OkxErrorMessage {
  if (typeof message !== "object" || message === null) {
    return false;
  }

  const msg = message as Record<string, unknown>;
  return "event" in msg && msg.event === "error";
}

function isOkxWebSocketMessage(message: unknown): message is OkxWebSocketMessage {
  if (typeof message !== "object" || message === null) {
    return false;
  }

  const msg = message as Record<string, unknown>;
  return (
    "arg" in msg &&
    "data" in msg &&
    typeof msg.arg === "object" &&
    msg.arg !== null &&
    "channel" in (msg.arg as Record<string, unknown>) &&
    Array.isArray(msg.data)
  );
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

    await this.connectWebSocket(
      this.createWebSocketConfig(wsUrl, {
        // OKX has its own 30s timeout mechanism and doesn't respond to pings
        // Send pings more frequently to keep connection alive
        pingInterval: 20000, // 20 seconds - well before OKX's 30s timeout
        pongTimeout: 40000, // 40 seconds - allow for OKX's timeout behavior
        connectionTimeout: 60000, // Longer connection timeout for stability
      })
    );
  }

  protected async doDisconnect(): Promise<void> {
    await this.disconnectWebSocket();
  }

  // Override WebSocket close handler for OKX-specific handling
  protected override handleWebSocketClose(code?: number, reason?: string): boolean {
    // Only log if not shutting down to reduce noise
    if (!this.isShuttingDown) {
      // Handle OKX-specific close codes with appropriate log levels
      if (code === 4004) {
        // OKX closes connections after 30s of no data - this is expected behavior
        this.logger.debug(`OKX WebSocket closed due to no data timeout (${code}) - normal behavior`, {
          component: "OkxAdapter",
          operation: "handleWebSocketClose",
          code,
          reason: "no data received in 30s",
          severity: "low",
        });
      } else if (code === 1006) {
        this.logger.warn(`OKX WebSocket closed abnormally (${code}) - connection lost`, {
          component: "OkxAdapter",
          operation: "handleWebSocketClose",
          code,
          reason: reason || "connection lost",
          severity: "medium",
          retryable: true,
        });
      } else if (code === 1000) {
        this.logger.debug(`OKX WebSocket closed normally (${code})`, {
          component: "OkxAdapter",
          operation: "handleWebSocketClose",
          code,
          reason: "normal closure",
        });
      } else {
        this.logger.warn(`OKX WebSocket closed with code ${code}: ${reason || "unknown reason"}`, {
          component: "OkxAdapter",
          operation: "handleWebSocketClose",
          code,
          reason: reason || "unknown",
          severity: "medium",
        });
      }
      // Return true to indicate we handled the logging
      return true;
    }
    // If shutting down, let base class handle it
    return super.handleWebSocketClose(code, reason);
  }

  // Override WebSocket event handlers from BaseExchangeAdapter
  protected override handleWebSocketMessage(data: unknown): void {
    try {
      const message = this.parseWebSocketData(data);
      if (!message) return;

      // Handle simple pong responses
      if (message === "pong") {
        this.onPongReceived();
        return;
      }

      // Handle ping responses
      if (message === "ping") {
        // OKX sometimes sends ping messages, just acknowledge them
        this.logger.debug("Received ping from OKX WebSocket");
        return;
      }

      this.logger.debug(`OKX WebSocket message parsed: ${JSON.stringify(message)}`);

      // Handle ping/pong in JSON format
      if (isOkxPongMessage(message)) {
        this.onPongReceived();
        return;
      }

      // Handle subscription confirmation - OKX uses different formats
      if (isOkxSubscriptionMessage(message)) {
        this.logger.debug("OKX subscription confirmation:", message);
        return;
      }

      // Handle errors with improved error handling
      if (isOkxErrorMessage(message)) {
        const errorMsg = message.msg || "Unknown error";
        const errorCode = message.code || "unknown";

        // Log server errors as warnings but don't treat as critical
        if (errorCode === "520" || errorMsg.includes("520")) {
          this.logger.warn(`OKX server error (${errorCode}): ${errorMsg} - will retry connection`);
        } else {
          this.logger.warn("OKX WebSocket error:", message);
        }
        return;
      }

      // Handle ticker data
      if (isOkxWebSocketMessage(message) && message.arg.channel === "tickers") {
        this.logger.debug(`OKX ticker data received for ${message.data.length} symbols`);
        message.data.forEach((ticker: OkxTickerData) => {
          if (this.validateResponse(ticker)) {
            this.logger.log(`Processing OKX ticker data for ${ticker.instId}: ${ticker.last}`);
            const priceUpdate = this.normalizePriceData(ticker);
            this.onPriceUpdateCallback?.(priceUpdate);
          } else {
            this.logger.debug("Invalid ticker data received from OKX:", ticker);
          }
        });
      }
    } catch (error) {
      // Don't treat connection errors as critical during normal operation
      if (error instanceof Error && error.message.includes("520")) {
        this.logger.warn("OKX connection error (520) - will retry:", error.message);
      } else {
        this.logger.error("Error processing OKX WebSocket message:", error);
        this.onErrorCallback?.(error as Error);
      }
    }
  }

  normalizePriceData(rawData: OkxTickerData): PriceUpdate {
    const price = this.parseNumber(rawData.last);
    const volume = this.parseNumber(rawData.vol24h);
    const timestamp = this.standardizeTimestamp(rawData.ts);

    // Calculate spread for confidence using standardized method
    const bid = this.parseNumber(rawData.bidPx);
    const ask = this.parseNumber(rawData.askPx);
    const spreadPercent = this.calculateSpreadForConfidence(bid, ask, price);

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

    try {
      // OKX supports multiple symbols in a single subscription message
      // This matches the efficient pattern used by other adapters like Crypto.com
      const subscribeMessage = {
        op: "subscribe",
        args: okxSymbols.map(symbol => ({
          channel: "tickers",
          instId: symbol,
        })),
      };

      await this.sendWebSocketMessage(JSON.stringify(subscribeMessage));
      this.logger.log(`Subscribed to OKX symbols: ${okxSymbols.join(", ")}`);
    } catch (error) {
      this.logger.warn(`OKX subscription error:`, error);
    }
  }

  protected async doUnsubscribe(symbols: string[]): Promise<void> {
    const okxSymbols = symbols.map(symbol => this.getSymbolMapping(symbol));

    try {
      // OKX supports multiple symbols in a single unsubscription message
      // This matches the efficient pattern used by other adapters
      const unsubscribeMessage = {
        op: "unsubscribe",
        args: okxSymbols.map(symbol => ({
          channel: "tickers",
          instId: symbol,
        })),
      };

      await this.sendWebSocketMessage(JSON.stringify(unsubscribeMessage));
      this.logger.log(`Unsubscribed from OKX symbols: ${okxSymbols.join(", ")}`);
    } catch (error) {
      this.logger.warn(`OKX unsubscription error:`, error);
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

    this.handleRestApiError(result, "OKX");

    if (!result.data || result.data.length === 0) {
      throw new Error("OKX API error: No data");
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
    return this.standardizeSymbolFromExchange(exchangeSymbol, ["-"]);
  }

  // Override ping message for OKX - they don't respond to pings but we can send them
  protected override sendPingMessage(): void {
    if (this.isWebSocketConnected()) {
      try {
        // OKX doesn't respond to pings, but sending them may help keep connection alive
        void this.sendWebSocketMessage("ping");
        this.logger.debug("✅ Sent ping to OKX WebSocket (no pong expected)");
      } catch (error) {
        this.logger.debug("❌ Failed to send ping to OKX WebSocket:", error);
        // Don't treat ping failure as critical for OKX since they don't respond
      }
    } else {
      this.logger.debug("⚠️  Cannot send ping to OKX - WebSocket not connected");
    }
  }

  // OKX uses its own 30s timeout mechanism and doesn't require ping/pong
  // The connection stays alive as long as data is flowing from subscriptions

  protected async doHealthCheck(): Promise<boolean> {
    const config = this.getConfig();
    const baseUrl = config?.restApiUrl || "https://www.okx.com";
    return this.performStandardHealthCheck(`${baseUrl}/api/v5/system/status`);
  }
}
