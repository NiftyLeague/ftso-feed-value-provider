import { Injectable, Logger } from "@nestjs/common";

export interface AdapterMapping {
  [exchange: string]: {
    hasCustomAdapter: boolean;
    adapterClass?: string;
    ccxtId?: string;
  };
}

@Injectable()
export class ConfigService {
  private readonly logger = new Logger(ConfigService.name);
  private readonly adapterMappings: AdapterMapping;

  constructor() {
    this.adapterMappings = this.initializeAdapterMappings();
  }

  /**
   * Initialize adapter mappings - simple detection of which exchanges have custom adapters
   * Requirements: 1.1, 1.4
   */
  private initializeAdapterMappings(): AdapterMapping {
    return {
      // Crypto Exchanges with custom adapters (Tier 1)
      binance: { hasCustomAdapter: true, adapterClass: "BinanceAdapter" },
      coinbase: { hasCustomAdapter: true, adapterClass: "CoinbaseAdapter" },
      cryptocom: { hasCustomAdapter: true, adapterClass: "CryptocomAdapter" },
      kraken: { hasCustomAdapter: true, adapterClass: "KrakenAdapter" },
      okx: { hasCustomAdapter: true, adapterClass: "OkxAdapter" },

      // All other Crypto Exchanges use CCXT (Tier 2)
      bitmart: { hasCustomAdapter: false, ccxtId: "bitmart" },
      bybit: { hasCustomAdapter: false, ccxtId: "bybit" },
      gate: { hasCustomAdapter: false, ccxtId: "gate" },
      kucoin: { hasCustomAdapter: false, ccxtId: "kucoin" },
      probit: { hasCustomAdapter: false, ccxtId: "probit" },
      mexc: { hasCustomAdapter: false, ccxtId: "mexc" },
      htx: { hasCustomAdapter: false, ccxtId: "htx" },
      bitget: { hasCustomAdapter: false, ccxtId: "bitget" },
      bitfinex: { hasCustomAdapter: false, ccxtId: "bitfinex" },
      bitstamp: { hasCustomAdapter: false, ccxtId: "bitstamp" },
      // Add more exchanges as needed - they'll automatically use CCXT
    };
  }

  /**
   * Check if exchange has a custom adapter
   * Requirements: 1.1
   */
  hasCustomAdapter(exchange: string): boolean {
    return this.adapterMappings[exchange]?.hasCustomAdapter ?? false;
  }

  /**
   * Get adapter class name for custom adapter exchanges
   * Requirements: 1.1
   */
  getAdapterClass(exchange: string): string | undefined {
    const mapping = this.adapterMappings[exchange];
    return mapping?.hasCustomAdapter ? mapping.adapterClass : undefined;
  }

  /**
   * Get CCXT ID for CCXT exchanges
   * Requirements: 1.4
   */
  getCcxtId(exchange: string): string | undefined {
    const mapping = this.adapterMappings[exchange];
    return !mapping?.hasCustomAdapter ? mapping?.ccxtId || exchange : undefined;
  }

  /**
   * Get all exchanges with custom adapters
   * Requirements: 1.1
   */
  getCustomAdapterExchanges(): string[] {
    return Object.entries(this.adapterMappings)
      .filter(([_, mapping]) => mapping.hasCustomAdapter)
      .map(([exchange, _]) => exchange);
  }

  /**
   * Get all exchanges using CCXT
   * Requirements: 1.4
   */
  getCcxtExchanges(): string[] {
    return Object.entries(this.adapterMappings)
      .filter(([_, mapping]) => !mapping.hasCustomAdapter)
      .map(([exchange, _]) => exchange);
  }

  /**
   * Add new exchange mapping (for dynamic configuration)
   * Requirements: 1.1, 1.4
   */
  addExchange(exchange: string, hasCustomAdapter: boolean, adapterClass?: string, ccxtId?: string): void {
    this.adapterMappings[exchange] = {
      hasCustomAdapter,
      adapterClass: hasCustomAdapter ? adapterClass : undefined,
      ccxtId: !hasCustomAdapter ? ccxtId || exchange : undefined,
    };

    this.logger.log(`Added exchange ${exchange} with ${hasCustomAdapter ? "custom adapter" : "CCXT"}`);
  }

  /**
   * Get hybrid configuration summary for a feed
   * Requirements: 1.1, 1.4
   */
  getHybridSummary(sources: { exchange: string; symbol: string }[]): {
    customAdapterSources: string[];
    ccxtSources: string[];
    totalSources: number;
    hybridMode: boolean;
  } {
    const customAdapterSources = sources
      .filter(source => this.hasCustomAdapter(source.exchange))
      .map(source => source.exchange);

    const ccxtSources = sources
      .filter(source => !this.hasCustomAdapter(source.exchange))
      .map(source => source.exchange);

    return {
      customAdapterSources,
      ccxtSources,
      totalSources: sources.length,
      hybridMode: customAdapterSources.length > 0 && ccxtSources.length > 0,
    };
  }

  /**
   * Validate that all exchanges in sources are supported
   * Requirements: 1.1, 1.4
   */
  validateSources(sources: { exchange: string; symbol: string }[]): {
    isValid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const result = {
      isValid: true,
      errors: [] as string[],
      warnings: [] as string[],
    };

    for (const source of sources) {
      const mapping = this.adapterMappings[source.exchange];

      if (!mapping) {
        // Unknown exchange - will be treated as CCXT by default
        result.warnings.push(
          `Exchange '${source.exchange}' not in known mappings, will use CCXT with ID '${source.exchange}'`
        );

        // Auto-add to mappings
        this.addExchange(source.exchange, false, undefined, source.exchange);
      }
    }

    return result;
  }

  /**
   * Get configuration for hybrid data provider
   * Requirements: 1.1, 1.4
   */
  getHybridProviderConfig(): {
    customAdapterExchanges: string[];
    ccxtExchanges: string[];
    ccxtParameters: {
      lambda: number;
      tradesLimit: number;
      retryBackoffMs: number;
    };
  } {
    return {
      customAdapterExchanges: this.getCustomAdapterExchanges(),
      ccxtExchanges: this.getCcxtExchanges(),
      ccxtParameters: {
        lambda: 0.00005, // Same as existing CCXT implementation
        tradesLimit: 1000, // Same as existing CCXT implementation
        retryBackoffMs: 10000, // Same as existing CCXT implementation
      },
    };
  }
}
