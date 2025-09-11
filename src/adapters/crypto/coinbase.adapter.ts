import { BaseExchangeAdapter } from "@/adapters/base/base-exchange-adapter";
import type { ExchangeCapabilities, ExchangeConnectionConfig } from "@/common/types/adapters";
import type { PriceUpdate, VolumeUpdate } from "@/common/types/core";
import { FeedCategory } from "@/common/types/core";

export interface CoinbaseTickerData {
  type: "ticker";
  sequence: number;
  product_id: string;
  price: string;
  open_24h: string;
  volume_24h: string;
  low_24h: string;
  high_24h: string;
  volume_30d: string;
  best_bid: string;
  best_ask: string;
  side: "buy" | "sell";
  time: string;
  trade_id: number;
  last_size: string;
}

export interface CoinbaseRestTickerData {
  ask: string;
  bid: string;
  volume: string;
  trade_id: number;
  price: string;
  size: string;
  time: string;
}

export class CoinbaseAdapter extends BaseExchangeAdapter {
  readonly exchangeName = "coinbase";
  readonly category = FeedCategory.Crypto;
  readonly capabilities: ExchangeCapabilities = {
    supportsWebSocket: true,
    supportsREST: true,
    supportsVolume: true,
    supportsOrderBook: true,
    supportedCategories: [FeedCategory.Crypto],
  };

  // Simple symbol mapping - use exact pairs from feeds.json
  override getSymbolMapping(feedSymbol: string): string {
    // For Coinbase, replace "/" with "-" - use the exact symbol from feeds.json
    return feedSymbol.replace("/", "-");
  }

  constructor(config?: ExchangeConnectionConfig) {
    super(config);
  }

  protected async doConnect(): Promise<void> {
    const wsUrl = this.config?.websocketUrl || "wss://ws-feed.exchange.coinbase.com";

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
    this.safeProcessData(
      data,
      rawData => {
        const parsed = JSON.parse(rawData as string);
        if (parsed.type === "ticker" && this.validateResponse(parsed)) {
          const priceUpdate = this.normalizePriceData(parsed);
          this.onPriceUpdateCallback?.(priceUpdate);
        }
      },
      "Coinbase message processing"
    );
  }

  normalizePriceData(rawData: CoinbaseTickerData): PriceUpdate {
    const price = this.parseNumber(rawData.price);
    const volume = rawData.volume_24h ? this.parseNumber(rawData.volume_24h) : undefined;
    const timestamp = this.normalizeTimestamp(rawData.time);

    // Calculate spread for confidence
    const bid = rawData.best_bid ? this.parseNumber(rawData.best_bid) : price;
    const ask = rawData.best_ask ? this.parseNumber(rawData.best_ask) : price;
    const spread = ask - bid;
    const spreadPercent = (spread / price) * 100;

    return {
      symbol: this.normalizeSymbolFromExchange(rawData.product_id),
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

  normalizeVolumeData(rawData: CoinbaseTickerData): VolumeUpdate {
    return {
      symbol: this.normalizeSymbolFromExchange(rawData.product_id),
      volume: this.parseNumber(rawData.volume_24h),
      timestamp: this.normalizeTimestamp(rawData.time),
      source: this.exchangeName,
    };
  }

  validateResponse(rawData: unknown): boolean {
    if (!rawData || typeof rawData !== "object") {
      return false;
    }

    const tickerData = rawData as CoinbaseTickerData;

    try {
      return !!(
        tickerData.type === "ticker" &&
        tickerData.product_id &&
        tickerData.price &&
        tickerData.time &&
        !isNaN(this.parseNumber(tickerData.price))
      );
    } catch {
      return false;
    }
  }

  protected async doSubscribe(symbols: string[]): Promise<void> {
    const coinbaseSymbols = symbols.map(symbol => this.getSymbolMapping(symbol));

    const subscribeMessage = {
      type: "subscribe",
      product_ids: coinbaseSymbols,
      channels: ["ticker"],
    };

    await this.sendWebSocketMessage(JSON.stringify(subscribeMessage));
  }

  protected async doUnsubscribe(symbols: string[]): Promise<void> {
    const coinbaseSymbols = symbols.map(symbol => this.getSymbolMapping(symbol));

    const unsubscribeMessage = {
      type: "unsubscribe",
      product_ids: coinbaseSymbols,
      channels: ["ticker"],
    };

    await this.sendWebSocketMessage(JSON.stringify(unsubscribeMessage));
  }

  // REST API fallback methods
  async fetchTickerREST(symbol: string): Promise<PriceUpdate> {
    const coinbaseSymbol = this.getSymbolMapping(symbol);
    const baseUrl = this.config?.restApiUrl || "https://api.exchange.coinbase.com";
    const url = `${baseUrl}/products/${coinbaseSymbol}/ticker`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: CoinbaseRestTickerData = await response.json();

      return {
        symbol: this.normalizeSymbolFromExchange(coinbaseSymbol),
        price: this.parseNumber(data.price),
        timestamp: this.normalizeTimestamp(data.time),
        source: this.exchangeName,
        volume: data.volume ? this.parseNumber(data.volume) : undefined,
        confidence: this.calculateConfidence(data, {
          latency: 0, // REST call, no latency penalty
          volume: data.volume ? this.parseNumber(data.volume) : undefined,
        }),
      };
    } catch (error) {
      throw new Error(`Failed to fetch Coinbase ticker for ${symbol}: ${error}`);
    }
  }

  // Event handlers are now provided by BaseExchangeAdapter

  // Helper method to convert exchange symbol back to normalized format
  private normalizeSymbolFromExchange(exchangeSymbol: string): string {
    // Coinbase uses format like "BTC-USD", convert to "BTC/USD"
    // Simple and reliable - we only support symbols from feeds.json
    return exchangeSymbol.replace("-", "/");
  }

  protected async doHealthCheck(): Promise<boolean> {
    try {
      // Try REST API health check
      const baseUrl = this.config?.restApiUrl || "https://api.exchange.coinbase.com";
      const response = await fetch(`${baseUrl}/time`);
      return response.ok;
    } catch {
      return false;
    }
  }
}
