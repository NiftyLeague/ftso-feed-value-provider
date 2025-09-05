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
    super(config);
  }

  // Simple symbol mapping - use exact pairs from feeds.json
  override getSymbolMapping(feedSymbol: string): string {
    // For WebSocket, remove the slash - use the exact symbol from feeds.json
    return feedSymbol.replace("/", "");
  }

  protected async doConnect(): Promise<void> {
    const wsUrl = this.config?.websocketUrl || "wss://ws.kraken.com";

    // Use integrated WebSocket functionality from BaseExchangeAdapter
    await this.connectWebSocket({
      url: wsUrl,
      reconnectDelay: 5000,
      reconnectInterval: 5000,
      maxReconnectAttempts: 5,
      pingInterval: 30000,
      pongTimeout: 10000,
    });
  }

  protected async doDisconnect(): Promise<void> {
    await this.disconnectWebSocket();
  }

  override isConnected(): boolean {
    return super.isConnected() && this.isWebSocketConnected();
  }

  // Override WebSocket event handlers from BaseExchangeAdapter
  protected override handleWebSocketMessage(data: unknown): void {
    try {
      // Handle different data types that might come from WebSocket
      let parsed: unknown;

      if (typeof data === "string") {
        parsed = JSON.parse(data);
      } else if (typeof data === "object" && data !== null) {
        // Data is already parsed (from WebSocketConnectionManager)
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
        }
        // Subscription status messages are valid and expected
        return;
      } else {
        this.logger.debug("Received unhandled Kraken message:", parsed);
      }
    } catch (error) {
      this.logger.error("Error processing Kraken WebSocket message:", error);
      this.onErrorCallback?.(error as Error);
    }
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

    this.sendWebSocketMessage(JSON.stringify(subscribeMessage));
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

    this.sendWebSocketMessage(JSON.stringify(unsubscribeMessage));
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

  // Event handlers are now provided by BaseExchangeAdapter

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

  protected async doHealthCheck(): Promise<boolean> {
    try {
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
