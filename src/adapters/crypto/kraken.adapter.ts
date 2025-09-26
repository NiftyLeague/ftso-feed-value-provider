import { BaseExchangeAdapter } from "@/adapters/base/base-exchange-adapter";
import type { ExchangeCapabilities, ExchangeConnectionConfig } from "@/common/types/adapters";
import type { PriceUpdate, VolumeUpdate } from "@/common/types/core";
import { FeedCategory } from "@/common/types/core";

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

export class KrakenAdapter extends BaseExchangeAdapter {
  readonly exchangeName = "kraken";
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

  override getSymbolMapping(feedSymbol: string): string {
    // For WebSocket, remove the slash
    return feedSymbol.replace("/", "");
  }

  protected async doConnect(): Promise<void> {
    const config = this.getConfig();
    const wsUrl = config?.websocketUrl || "wss://ws.kraken.com";

    // Kraken-specific configuration with longer timeouts for stability
    await this.connectWebSocket(
      this.createWebSocketConfig(wsUrl, {
        pingInterval: 45000, // Increased ping interval for Kraken stability
        pongTimeout: 35000, // Increased pong timeout to match Kraken's response times
        connectionTimeout: 60000, // Longer connection timeout for initial connection
      })
    );
  }

  protected async doDisconnect(): Promise<void> {
    await this.disconnectWebSocket();
  }

  // Override WebSocket close handler for Kraken-specific handling
  protected override handleWebSocketClose(code?: number, reason?: string): boolean {
    // Only log if not shutting down to reduce noise
    if (!this.isShuttingDown) {
      // Provide more context about the close reason and reduce log level for expected disconnections
      if (code === 1006) {
        // 1006 is common for network issues, log as warning but with context
        this.logger.warn(`Kraken WebSocket closed abnormally (${code}) - connection lost`, {
          component: "KrakenAdapter",
          operation: "handleWebSocketClose",
          code,
          reason: reason || "connection lost",
          severity: "medium",
          retryable: true,
        });
      } else if (code === 1001) {
        this.logger.warn(`Kraken WebSocket closed due to pong timeout (${code})`, {
          component: "KrakenAdapter",
          operation: "handleWebSocketClose",
          code,
          reason: "pong timeout",
          severity: "medium",
          retryable: true,
        });
      } else if (code === 1000) {
        // Normal closure should be debug level
        this.logger.debug(`Kraken WebSocket closed normally (${code})`, {
          component: "KrakenAdapter",
          operation: "handleWebSocketClose",
          code,
          reason: "normal closure",
        });
      } else if (code === 4004) {
        // Kraken-specific: No data received in 30s
        this.logger.debug(`Kraken WebSocket closed due to inactivity (${code})`, {
          component: "KrakenAdapter",
          operation: "handleWebSocketClose",
          code,
          reason: "no data received",
          severity: "low",
        });
      } else {
        this.logger.warn(`Kraken WebSocket closed with code ${code}: ${reason || "unknown reason"}`, {
          component: "KrakenAdapter",
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

  // Override WebSocket error handler for Kraken-specific error handling
  protected override handleWebSocketError(error: Error): void {
    const errorMessage = error.message.toLowerCase();

    // Handle Kraken-specific 503 errors with extended backoff
    if (errorMessage.includes("503") || errorMessage.includes("service unavailable")) {
      this.logger.warn(
        `Kraken service temporarily unavailable (503), will retry with extended backoff: ${error.message}`
      );
      // Mark connection as lost and trigger recovery with error context
      this.isConnected_ = false;
      this.onConnectionChangeCallback?.(false);
      this.onErrorCallback?.(error);
      return;
    }

    // Handle other unexpected server responses
    if (errorMessage.includes("unexpected server response")) {
      const statusMatch = errorMessage.match(/unexpected server response: (\d+)/);
      if (statusMatch) {
        const statusCode = parseInt(statusMatch[1]);
        if (statusCode >= 500) {
          this.logger.warn(`Kraken server error (${statusCode}), will retry: ${error.message}`);
          // Mark connection as lost for server errors
          this.isConnected_ = false;
          this.onConnectionChangeCallback?.(false);
          this.onErrorCallback?.(error);
          return;
        }
      }
    }

    // Call parent handler for all other errors
    super.handleWebSocketError(error);
  }

  // Override WebSocket event handlers from BaseExchangeAdapter
  protected override handleWebSocketMessage(data: unknown): void {
    try {
      // Handle different data types that might come from WebSocket
      let parsed: unknown;

      if (typeof data === "string") {
        parsed = JSON.parse(data);
      } else if (typeof data === "object" && data !== null) {
        // Data is already parsed (from WebSocket)
        parsed = data;
      } else {
        this.logger.debug("Received non-parseable WebSocket data:", typeof data);
        return;
      }

      // Handle different message types
      if (Array.isArray(parsed)) {
        // Ticker data format: [channelID, data, channelName, pair]
        if (parsed.length >= 4 && parsed[2] === "ticker") {
          const tickerData: KrakenTickerData = {
            channelID: parsed[0],
            channelName: parsed[2],
            pair: parsed[3],
            data: parsed[1],
          };

          if (this.validateResponse(tickerData)) {
            const priceUpdate = this.normalizePriceData(tickerData);
            this.onPriceUpdateCallback?.(priceUpdate);
          }
        }
      } else if (typeof parsed === "object" && parsed !== null) {
        const parsedObj = parsed as { event?: string; status?: string; pair?: string; errorMessage?: string };
        if (parsedObj.event === "systemStatus") {
          this.logger.debug("Kraken system status:", parsedObj.status);
          // System status messages are valid and expected
          return;
        } else if (parsedObj.event === "subscriptionStatus") {
          if (parsedObj.status === "subscribed") {
            this.logger.debug("Kraken subscription confirmed:", parsedObj.pair);
          } else if (parsedObj.status === "error") {
            this.logger.warn("Kraken subscription error:", parsedObj.errorMessage);
          }
        } else if (parsedObj.event === "pong") {
          this.onPongReceived();
          return;
        }
        // System messages are valid and expected
        return;
      } else {
        this.logger.debug("Received unhandled Kraken message:", parsed);
      }
    } catch (error) {
      // Reduce error logging for parsing issues that don't affect functionality
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes("JSON") || errorMessage.includes("parse")) {
        this.logger.debug("Kraken message parsing issue (non-critical):", {
          component: "KrakenAdapter",
          operation: "handleWebSocketMessage",
          error: errorMessage,
          data: typeof data === "string" ? data.substring(0, 100) : "non-string data",
          severity: "low",
        });
      } else {
        this.logger.warn("Error processing Kraken WebSocket message:", {
          component: "KrakenAdapter",
          operation: "handleWebSocketMessage",
          error: errorMessage,
          severity: "medium",
        });
      }

      // Only call error callback for critical errors
      if (!errorMessage.includes("JSON") && !errorMessage.includes("parse")) {
        this.onErrorCallback?.(error as Error);
      }
    }
  }

  normalizePriceData(rawData: KrakenTickerData): PriceUpdate {
    const price = this.parseNumber(rawData.data.c[0]); // Last trade price
    const volume = this.parseNumber(rawData.data.v[1]); // 24h volume
    const timestamp = this.standardizeTimestamp(undefined); // Kraken doesn't provide timestamp in ticker

    // Calculate spread for confidence using standardized method
    const bid = this.parseNumber(rawData.data.b[0]);
    const ask = this.parseNumber(rawData.data.a[0]);
    const spreadPercent = this.calculateSpreadForConfidence(bid, ask, price);

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

  validateResponse(rawData: unknown): boolean {
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

  protected async doSubscribe(symbols: string[]): Promise<void> {
    const krakenSymbols = symbols.map(symbol => this.getSymbolMapping(symbol));

    const subscribeMessage = {
      event: "subscribe",
      pair: krakenSymbols,
      subscription: {
        name: "ticker",
      },
    };

    try {
      await this.sendWebSocketMessage(JSON.stringify(subscribeMessage));
      this.logger.log(`Subscribed to Kraken symbols: ${krakenSymbols.join(", ")}`);
    } catch (error) {
      this.logger.warn(`Kraken subscription error:`, error);
    }
  }

  protected async doUnsubscribe(symbols: string[]): Promise<void> {
    const krakenSymbols = symbols.map(symbol => this.getSymbolMapping(symbol));

    const unsubscribeMessage = {
      event: "unsubscribe",
      pair: krakenSymbols,
      subscription: {
        name: "ticker",
      },
    };

    try {
      await this.sendWebSocketMessage(JSON.stringify(unsubscribeMessage));
      this.logger.log(`Unsubscribed from Kraken symbols: ${krakenSymbols.join(", ")}`);
    } catch (error) {
      this.logger.warn(`Kraken unsubscription error:`, error);
    }
  }

  // REST API fallback methods
  async fetchTickerREST(symbol: string): Promise<PriceUpdate> {
    const krakenSymbol = this.getSymbolMapping(symbol);
    const config = this.getConfig();
    const baseUrl = config?.restApiUrl || "https://api.kraken.com";
    const url = `${baseUrl}/0/public/Ticker?pair=${krakenSymbol}`;

    const response = await this.fetchRestApi(url, `Failed to fetch Kraken ticker for ${symbol}`);
    const result = await response.json();

    this.handleRestApiError(result, "Kraken");

    const data: KrakenRestTickerData = result.result;
    const pairData = Object.values(data)[0]; // Get first (and should be only) pair data

    if (!pairData) {
      throw new Error(`No data returned for symbol ${symbol}`);
    }

    // Calculate spread for confidence
    const price = this.parseNumber(pairData.c[0]);
    const bid = this.parseNumber(pairData.b[0]);
    const ask = this.parseNumber(pairData.a[0]);
    const spreadPercent = this.calculateSpreadPercent(bid, ask, price);

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
  }

  // Override symbol normalization for Kraken format
  protected override normalizeSymbolFromExchange(exchangeSymbol: string): string {
    return this.standardizeSymbolFromExchange(exchangeSymbol, []);
  }

  // Override ping message for Kraken-specific format
  protected override sendPingMessage(): void {
    if (this.isWebSocketConnected()) {
      try {
        void this.sendWebSocketMessage(JSON.stringify({ event: "ping" }));
        this.logger.log("✅ Sent ping to Kraken WebSocket");
      } catch (error) {
        this.logger.warn("❌ Failed to send ping to Kraken WebSocket:", error);
        // If ping fails, the connection might be stale, trigger reconnection
        this.handleWebSocketError(error as Error);
      }
    } else {
      this.logger.warn("⚠️  Cannot send ping to Kraken - WebSocket not connected");
    }
  }

  protected async doHealthCheck(): Promise<boolean> {
    const config = this.getConfig();
    const baseUrl = config?.restApiUrl || "https://api.kraken.com";
    return this.performStandardHealthCheck(`${baseUrl}/0/public/SystemStatus`);
  }
}
