import {
  ExchangeAdapter,
  ExchangeCapabilities,
  ExchangeConnectionConfig,
} from "@/interfaces/exchange-adapter.interface";
import { PriceUpdate, VolumeUpdate } from "@/interfaces/data-source.interface";
import { FeedCategory } from "@/types/feed-category.enum";

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

export class CoinbaseAdapter extends ExchangeAdapter {
  readonly exchangeName = "coinbase";
  readonly category = FeedCategory.Crypto;
  readonly capabilities: ExchangeCapabilities = {
    supportsWebSocket: true,
    supportsREST: true,
    supportsVolume: true,
    supportsOrderBook: true,
    supportedCategories: [FeedCategory.Crypto],
  };

  private wsConnection?: WebSocket;
  private isConnectedFlag = false;
  private subscriptions = new Set<string>();

  // Simple symbol mapping - use exact pairs from feeds.json
  getSymbolMapping(feedSymbol: string): string {
    // For Coinbase, replace "/" with "-" - use the exact symbol from feeds.json
    return feedSymbol.replace("/", "-");
  }

  constructor(config?: ExchangeConnectionConfig) {
    super(config);
  }

  async connect(): Promise<void> {
    if (this.isConnectedFlag) {
      return;
    }

    const wsUrl = this.config?.websocketUrl || "wss://ws-feed.exchange.coinbase.com";

    return new Promise((resolve, reject) => {
      try {
        this.wsConnection = new WebSocket(wsUrl);

        this.wsConnection.onopen = () => {
          this.isConnectedFlag = true;
          this.onConnectionChangeCallback?.(true);
          resolve();
        };

        this.wsConnection.onerror = error => {
          this.isConnectedFlag = false;
          const connectionError = new Error(`Coinbase WebSocket connection failed: ${error}`);
          this.onErrorCallback?.(connectionError);
          this.onConnectionChangeCallback?.(false);
          reject(connectionError);
        };

        this.wsConnection.onclose = event => {
          this.isConnectedFlag = false;
          this.onConnectionChangeCallback?.(false);

          // Emit error if close was unexpected (only if event has code property)
          if (event && typeof event.code === "number" && event.code !== 1000) {
            // 1000 is normal closure
            const closeError = new Error(
              `Coinbase WebSocket closed unexpectedly: ${event.code} - ${event.reason || "Unknown reason"}`
            );
            this.onErrorCallback?.(closeError);
          }
        };

        this.wsConnection.onmessage = event => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === "ticker" && this.validateResponse(data)) {
              const priceUpdate = this.normalizePriceData(data);
              this.onPriceUpdateCallback?.(priceUpdate);
            }
          } catch (error) {
            const parseError = new Error(`Error processing Coinbase message: ${error}`);
            this.onErrorCallback?.(parseError);
          }
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  async disconnect(): Promise<void> {
    if (this.wsConnection) {
      this.wsConnection.close();
      this.wsConnection = undefined;
    }
    this.isConnectedFlag = false;
    this.subscriptions.clear();
  }

  isConnected(): boolean {
    return this.isConnectedFlag && this.wsConnection?.readyState === WebSocket.OPEN;
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

  validateResponse(rawData: any): boolean {
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

  // WebSocket subscription management
  async subscribe(symbols: string[]): Promise<void> {
    if (!this.isConnected()) {
      throw new Error("Not connected to Coinbase WebSocket");
    }

    const coinbaseSymbols = symbols.map(symbol => this.getSymbolMapping(symbol));

    const subscribeMessage = {
      type: "subscribe",
      product_ids: coinbaseSymbols,
      channels: ["ticker"],
    };

    this.wsConnection?.send(JSON.stringify(subscribeMessage));

    // Track subscriptions
    coinbaseSymbols.forEach(symbol => this.subscriptions.add(symbol));
  }

  async unsubscribe(symbols: string[]): Promise<void> {
    if (!this.isConnected()) {
      return;
    }

    const coinbaseSymbols = symbols.map(symbol => this.getSymbolMapping(symbol));

    const unsubscribeMessage = {
      type: "unsubscribe",
      product_ids: coinbaseSymbols,
      channels: ["ticker"],
    };

    this.wsConnection?.send(JSON.stringify(unsubscribeMessage));

    // Remove from tracked subscriptions
    coinbaseSymbols.forEach(symbol => this.subscriptions.delete(symbol));
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

  // Event handlers
  private onPriceUpdateCallback?: (update: PriceUpdate) => void;
  private onConnectionChangeCallback?: (connected: boolean) => void;
  private onErrorCallback?: (error: Error) => void;

  onPriceUpdate(callback: (update: PriceUpdate) => void): void {
    this.onPriceUpdateCallback = callback;
  }

  onConnectionChange(callback: (connected: boolean) => void): void {
    this.onConnectionChangeCallback = callback;
  }

  onError(callback: (error: Error) => void): void {
    this.onErrorCallback = callback;
  }

  // Helper method to convert exchange symbol back to normalized format
  private normalizeSymbolFromExchange(exchangeSymbol: string): string {
    // Coinbase uses format like "BTC-USD", convert to "BTC/USD"
    // Simple and reliable - we only support symbols from feeds.json
    return exchangeSymbol.replace("-", "/");
  }

  // Get current subscriptions
  getSubscriptions(): string[] {
    return Array.from(this.subscriptions);
  }

  // Health check method
  async healthCheck(): Promise<boolean> {
    try {
      if (this.isConnected()) {
        return true;
      }

      // Try REST API health check
      const baseUrl = this.config?.restApiUrl || "https://api.exchange.coinbase.com";
      const response = await fetch(`${baseUrl}/time`);
      return response.ok;
    } catch {
      return false;
    }
  }
}
