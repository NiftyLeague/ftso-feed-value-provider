import { BaseExchangeAdapter } from "@/adapters/base/base-exchange-adapter";
import type {
  BinanceRestTickerData,
  BinanceTickerData,
  ExchangeCapabilities,
  ExchangeConnectionConfig,
} from "@/common/types/adapters";
import { ExchangeId } from "@/common/types/adapters";
import type { PriceUpdate, VolumeUpdate } from "@/common/types/core";
import { FeedCategory } from "@/common/types/core";

export class BinanceAdapter extends BaseExchangeAdapter {
  readonly exchangeName = ExchangeId.Binance;
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
    // For Binance, remove the slash
    return feedSymbol.replace("/", "");
  }

  protected async doConnect(): Promise<void> {
    const config = this.getConfig();
    // Use the all-ticker stream URL to get all symbols at once
    // This is more efficient than individual subscriptions and reduces rate limiting
    const wsUrl = config?.websocketUrl || "wss://stream.binance.com:9443/ws/!ticker@arr";

    await this.connectWebSocket(
      this.createWebSocketConfig(wsUrl, {
        // Binance doesn't require custom ping/pong, disable them
        pingInterval: 0,
        pongTimeout: 0,
        // Increase connection timeout for better stability
        connectionTimeout: 30000,
      })
    );
  }

  protected async doDisconnect(): Promise<void> {
    await this.disconnectWebSocket();
  }

  normalizePriceData(rawData: BinanceTickerData): PriceUpdate {
    const price = this.parseNumber(rawData.c);
    const volume = this.parseNumber(rawData.v);
    const timestamp = this.standardizeTimestamp(rawData.E);

    // Calculate spread for confidence using standardized method
    const bid = this.parseNumber(rawData.b);
    const ask = this.parseNumber(rawData.a);
    const spreadPercent = this.calculateSpreadForConfidence(bid, ask, price);

    return {
      symbol: this.normalizeSymbolFromExchange(rawData.s),
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

  normalizeVolumeData(rawData: BinanceTickerData): VolumeUpdate {
    return {
      symbol: this.normalizeSymbolFromExchange(rawData.s),
      volume: this.parseNumber(rawData.v),
      timestamp: rawData.E,
      source: this.exchangeName,
    };
  }

  validateResponse(rawData: unknown): boolean {
    if (!rawData || typeof rawData !== "object") {
      return false;
    }

    const tickerData = rawData as BinanceTickerData;

    try {
      return !!(
        tickerData.s && // Symbol
        tickerData.c && // Last price
        tickerData.E && // Event time
        !isNaN(this.parseNumber(tickerData.c))
      );
    } catch {
      return false;
    }
  }

  protected async doSubscribe(_symbols: string[]): Promise<void> {
    // Note: The all-ticker stream (!ticker@arr) provides all symbols
    // For individual subscriptions, we would need a different WebSocket connection
    // This implementation uses the all-ticker stream and filters client-side
    // No actual subscription needed as we get all tickers
  }

  protected async doUnsubscribe(_symbols: string[]): Promise<void> {
    // No actual unsubscription needed as we get all tickers
    // Subscriptions are managed by the base class
  }

  // Override subscription tracking to maintain lowercase behavior for Binance
  protected override trackSubscriptions(symbols: string[]): void {
    symbols.forEach(symbol => {
      const exchangeSymbol = this.getSymbolMapping(symbol);
      this.subscriptions.add(exchangeSymbol.toLowerCase());
    });
  }

  protected override untrackSubscriptions(symbols: string[]): void {
    symbols.forEach(symbol => {
      const exchangeSymbol = this.getSymbolMapping(symbol);
      this.subscriptions.delete(exchangeSymbol.toLowerCase());
    });
  }

  protected override isSubscribed(symbol: string): boolean {
    const exchangeSymbol = this.getSymbolMapping(symbol);
    return this.subscriptions.has(exchangeSymbol.toLowerCase());
  }

  // REST API fallback methods
  async fetchTickerREST(symbol: string): Promise<PriceUpdate> {
    const binanceSymbol = this.getSymbolMapping(symbol);
    const config = this.getConfig();
    const baseUrl = config?.restApiUrl || "https://api.binance.com";
    const url = `${baseUrl}/api/v3/ticker/24hr?symbol=${binanceSymbol}`;

    const response = await this.fetchRestApi(url, `Failed to fetch Binance ticker for ${symbol}`);
    const data: BinanceRestTickerData = await response.json();

    // Calculate spread for confidence
    const price = this.parseNumber(data.lastPrice);
    const bid = this.parseNumber(data.bidPrice);
    const ask = this.parseNumber(data.askPrice);
    const spreadPercent = this.calculateSpreadPercent(bid, ask, price);

    return {
      symbol: this.normalizeSymbolFromExchange(data.symbol),
      price,
      timestamp: data.closeTime,
      source: this.exchangeName,
      volume: this.parseNumber(data.volume),
      confidence: this.calculateConfidence(data, {
        latency: 0, // REST call, no latency penalty
        volume: this.parseNumber(data.volume),
        spread: spreadPercent,
      }),
    };
  }

  // Override symbol normalization for Binance format
  protected override normalizeSymbolFromExchange(exchangeSymbol: string): string {
    return this.standardizeSymbolFromExchange(exchangeSymbol, []);
  }

  // Override WebSocket event handlers from BaseExchangeAdapter
  protected override handleWebSocketMessage(data: unknown): void {
    try {
      const parsed = this.parseWebSocketData(data);
      if (!parsed) {
        this.logger.debug("Received non-parseable WebSocket data:", typeof data);
        return;
      }

      this.logger.debug(`Binance WebSocket message parsed: ${JSON.stringify(parsed)}`);

      // Handle stream format: { "stream": "!ticker@arr", "data": [...] }
      if (typeof parsed === "object" && parsed !== null) {
        const streamData = parsed as { stream?: string; data?: unknown };
        if (streamData.stream === "!ticker@arr" && Array.isArray(streamData.data)) {
          this.logger.debug(`Processing Binance ticker array with ${streamData.data.length} tickers`);
          streamData.data.forEach(ticker => {
            if (this.validateResponse(ticker)) {
              const tickerData = ticker as BinanceTickerData;
              // Only process symbols we're actually subscribed to
              if (this.subscriptions.has(tickerData.s.toLowerCase())) {
                this.logger.log(`Processing Binance ticker data for ${tickerData.s}: ${tickerData.c}`);
                const priceUpdate = this.normalizePriceData(ticker);
                this.onPriceUpdateCallback?.(priceUpdate);
              }
            }
          });
          return;
        }
      }

      // Handle array of tickers (from !ticker@arr stream)
      if (Array.isArray(parsed)) {
        parsed.forEach(ticker => {
          if (this.validateResponse(ticker)) {
            const tickerData = ticker as BinanceTickerData;
            // Only process symbols we're actually subscribed to
            if (this.subscriptions.has(tickerData.s.toLowerCase())) {
              const priceUpdate = this.normalizePriceData(ticker);
              this.onPriceUpdateCallback?.(priceUpdate);
            }
          }
        });
      } else if (this.validateResponse(parsed)) {
        const tickerData = parsed as BinanceTickerData;
        // Only process symbols we're actually subscribed to
        if (this.subscriptions.has(tickerData.s.toLowerCase())) {
          const priceUpdate = this.normalizePriceData(tickerData);
          this.onPriceUpdateCallback?.(priceUpdate);
        }
      }
    } catch (error) {
      this.logger.error("Error processing Binance WebSocket data:", error);
      this.onErrorCallback?.(error as Error);
    }
  }

  protected async doHealthCheck(): Promise<boolean> {
    const config = this.getConfig();
    const baseUrl = config?.restApiUrl || "https://api.binance.com";
    return this.performStandardHealthCheck(`${baseUrl}/api/v3/ping`);
  }
}
