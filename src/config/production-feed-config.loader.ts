import { Injectable, Logger } from "@nestjs/common";
import { readFileSync } from "fs";
import { join } from "path";
import { EnhancedFeedId, FeedCategory, isValidFeedCategory, isValidFeedId } from "@/types";
import { ValidationConfig, AggregationConfig } from "@/aggregators/base/aggregation.interfaces";

export interface EnhancedSourceConfig {
  exchange: string;
  symbol: string;
  priority?: number;
  weight?: number;
  websocketEndpoint?: string;
  restEndpoint?: string;
  apiKey?: string;
  rateLimit?: number;
  tier?: number; // 1 for custom adapters, 2 for CCXT
}

export interface ProductionFeedConfiguration {
  feed: EnhancedFeedId;
  sources: EnhancedSourceConfig[];
  category: FeedCategory;
  validation?: ValidationOverrides;
  aggregation?: AggregationOverrides;
  monitoring?: MonitoringOverrides;
}

export interface ValidationOverrides {
  maxAge?: number;
  priceRange?: { min: number; max: number };
  outlierThreshold?: number;
  consensusWeight?: number;
}

export interface AggregationOverrides {
  method?: "weighted_median" | "consensus_optimized";
  timeDecayFactor?: number;
  minSources?: number;
  maxStaleness?: number;
}

export interface MonitoringOverrides {
  accuracyThreshold?: number;
  latencyThreshold?: number;
  alertsEnabled?: boolean;
}

export interface ExchangeAdapterMapping {
  // Crypto exchanges (Tier 1 - Custom Adapters)
  binance: string;
  coinbase: string;
  kraken: string;
  okx: string;
  cryptocom: string;

  // Crypto exchanges (Tier 2 - CCXT Individual)
  bitmart: string;
  bybit: string;
  gate: string;
  kucoin: string;
  probit: string;
  mexc: string;
  htx: string;
  bitget: string;
  bitfinex: string;
  bitstamp: string;

  // Forex exchanges
  oanda: string;
  fxpro: string;
  currencylayer: string;
  "exchangerate-api": string;

  // Commodity exchanges
  quandl: string;
  "alpha-vantage": string;
  marketstack: string;
  "commodity-api": string;

  // Stock exchanges
  "iex-cloud": string;
  polygon: string;
  finnhub: string;
}

export interface CategoryValidationRules {
  [FeedCategory.Crypto]: {
    requiredSources: number;
    maxPriceDeviation: number;
    maxLatency: number;
    supportedExchanges: string[];
  };
  [FeedCategory.Forex]: {
    requiredSources: number;
    maxPriceDeviation: number;
    maxLatency: number;
    supportedExchanges: string[];
  };
  [FeedCategory.Commodity]: {
    requiredSources: number;
    maxPriceDeviation: number;
    maxLatency: number;
    supportedExchanges: string[];
  };
  [FeedCategory.Stock]: {
    requiredSources: number;
    maxPriceDeviation: number;
    maxLatency: number;
    supportedExchanges: string[];
  };
}

@Injectable()
export class ProductionFeedConfigLoader {
  private readonly logger = new Logger(ProductionFeedConfigLoader.name);
  private configurations: ProductionFeedConfiguration[] = [];
  private adapterMappings: Map<string, string> = new Map();
  private categoryRules: CategoryValidationRules;

  constructor() {
    this.initializeAdapterMappings();
    this.initializeCategoryRules();
  }

  /**
   * Load feed configurations from feeds.json with enhanced validation
   * Requirements: 5.1, 5.2, 5.5
   */
  async loadFeedConfigurations(configPath?: string): Promise<ProductionFeedConfiguration[]> {
    const feedsPath = configPath || join(process.cwd(), "src/config/feeds.json");

    try {
      this.logger.log(`Loading feed configurations from: ${feedsPath}`);
      const rawConfig = JSON.parse(readFileSync(feedsPath, "utf8"));

      if (!Array.isArray(rawConfig)) {
        throw new Error("Feed configuration must be an array");
      }

      this.configurations = [];

      for (const config of rawConfig) {
        try {
          const enhancedConfig = await this.validateAndEnhance(config);
          this.configurations.push(enhancedConfig);
        } catch (error) {
          this.logger.error(`Failed to process feed configuration: ${JSON.stringify(config)}`, error);
          throw error;
        }
      }

      this.logger.log(`Successfully loaded ${this.configurations.length} feed configurations`);
      return this.configurations;
    } catch (error) {
      this.logger.error(`Failed to load feed configurations from ${feedsPath}`, error);
      throw error;
    }
  }

  /**
   * Validate and enhance a single feed configuration
   * Requirements: 5.1, 5.2, 5.5
   */
  private async validateAndEnhance(config: any): Promise<ProductionFeedConfiguration> {
    // Validate basic structure
    if (!config.feed || !config.sources) {
      throw new Error("Feed configuration must have 'feed' and 'sources' properties");
    }

    // Validate feed ID
    if (!isValidFeedId(config.feed)) {
      throw new Error(`Invalid feed ID: ${JSON.stringify(config.feed)}`);
    }

    const feedId = config.feed as EnhancedFeedId;
    const category = feedId.category;

    // Validate category
    if (!isValidFeedCategory(category)) {
      throw new Error(`Invalid feed category: ${category}`);
    }

    // Validate sources
    if (!Array.isArray(config.sources) || config.sources.length === 0) {
      throw new Error("Feed must have at least one source");
    }

    // Enhance sources with adapter mappings and validation
    const enhancedSources: EnhancedSourceConfig[] = [];

    for (const source of config.sources) {
      const enhancedSource = await this.validateAndEnhanceSource(source, category);
      enhancedSources.push(enhancedSource);
    }

    // Validate minimum sources requirement
    const categoryRule = this.categoryRules[category];
    if (enhancedSources.length < categoryRule.requiredSources) {
      throw new Error(
        `Feed ${feedId.name} requires at least ${categoryRule.requiredSources} sources, got ${enhancedSources.length}`
      );
    }

    // Create enhanced configuration
    const enhancedConfig: ProductionFeedConfiguration = {
      feed: feedId,
      sources: enhancedSources,
      category,
      validation: this.createDefaultValidation(category, config.validation),
      aggregation: this.createDefaultAggregation(category, config.aggregation),
      monitoring: this.createDefaultMonitoring(category, config.monitoring),
    };

    // Validate exchange-adapter compatibility
    await this.validateExchangeAdapterCompatibility(enhancedConfig);

    return enhancedConfig;
  }

  /**
   * Validate and enhance a single source configuration
   * Requirements: 5.1, 5.2
   */
  private async validateAndEnhanceSource(source: any, category: FeedCategory): Promise<EnhancedSourceConfig> {
    if (!source.exchange || !source.symbol) {
      throw new Error("Source must have 'exchange' and 'symbol' properties");
    }

    // Validate exchange is supported for this category
    const categoryRule = this.categoryRules[category];
    if (!categoryRule.supportedExchanges.includes(source.exchange)) {
      throw new Error(`Exchange '${source.exchange}' is not supported for category ${FeedCategory[category]}`);
    }

    // Determine tier based on exchange
    const tier = this.determineExchangeTier(source.exchange);

    // Create enhanced source configuration
    const enhancedSource: EnhancedSourceConfig = {
      exchange: source.exchange,
      symbol: source.symbol,
      priority: source.priority || this.getDefaultPriority(source.exchange, tier),
      weight: source.weight || this.getDefaultWeight(source.exchange, tier),
      websocketEndpoint: source.websocketEndpoint,
      restEndpoint: source.restEndpoint,
      apiKey: source.apiKey,
      rateLimit: source.rateLimit || this.getDefaultRateLimit(source.exchange),
      tier,
    };

    return enhancedSource;
  }

  /**
   * Validate exchange-adapter compatibility
   * Requirements: 5.1, 5.2
   */
  private async validateExchangeAdapterCompatibility(config: ProductionFeedConfiguration): Promise<void> {
    for (const source of config.sources) {
      // Check if adapter mapping exists
      if (!this.adapterMappings.has(source.exchange)) {
        throw new Error(`No adapter mapping found for exchange: ${source.exchange}`);
      }

      // Validate symbol format for the exchange
      if (!this.validateSymbolFormat(source.symbol, source.exchange)) {
        throw new Error(`Invalid symbol format '${source.symbol}' for exchange '${source.exchange}'`);
      }
    }
  }

  /**
   * Initialize adapter mappings for all supported exchanges
   * Requirements: 5.1, 5.2
   */
  private initializeAdapterMappings(): void {
    // Tier 1 - Custom Adapters
    this.adapterMappings.set("binance", "BinanceAdapter");
    this.adapterMappings.set("coinbase", "CoinbaseAdapter");
    this.adapterMappings.set("kraken", "KrakenAdapter");
    this.adapterMappings.set("okx", "OkxAdapter");
    this.adapterMappings.set("cryptocom", "CryptocomAdapter");

    // Tier 2 - CCXT Individual
    this.adapterMappings.set("bitmart", "CcxtIndividualAdapter");
    this.adapterMappings.set("bybit", "CcxtIndividualAdapter");
    this.adapterMappings.set("gate", "CcxtIndividualAdapter");
    this.adapterMappings.set("kucoin", "CcxtIndividualAdapter");
    this.adapterMappings.set("probit", "CcxtIndividualAdapter");
    this.adapterMappings.set("mexc", "CcxtIndividualAdapter");
    this.adapterMappings.set("htx", "CcxtIndividualAdapter");
    this.adapterMappings.set("bitget", "CcxtIndividualAdapter");
    this.adapterMappings.set("bitfinex", "CcxtIndividualAdapter");
    this.adapterMappings.set("bitstamp", "CcxtIndividualAdapter");

    // Forex exchanges
    this.adapterMappings.set("oanda", "OandaAdapter");
    this.adapterMappings.set("fxpro", "FxProAdapter");
    this.adapterMappings.set("currencylayer", "CurrencyLayerAdapter");
    this.adapterMappings.set("exchangerate-api", "ExchangeRateApiAdapter");

    // Commodity exchanges
    this.adapterMappings.set("quandl", "QuandlAdapter");
    this.adapterMappings.set("alpha-vantage", "AlphaVantageAdapter");
    this.adapterMappings.set("marketstack", "MarketstackAdapter");
    this.adapterMappings.set("commodity-api", "CommodityApiAdapter");

    // Stock exchanges
    this.adapterMappings.set("iex-cloud", "IexCloudAdapter");
    this.adapterMappings.set("polygon", "PolygonAdapter");
    this.adapterMappings.set("finnhub", "FinnhubAdapter");
  }

  /**
   * Initialize category-specific validation rules
   * Requirements: 5.1, 5.5
   */
  private initializeCategoryRules(): void {
    this.categoryRules = {
      [FeedCategory.Crypto]: {
        requiredSources: 3,
        maxPriceDeviation: 0.005, // 0.5%
        maxLatency: 2000, // 2 seconds
        supportedExchanges: [
          "binance",
          "coinbase",
          "kraken",
          "okx",
          "cryptocom",
          "bitmart",
          "bybit",
          "gate",
          "kucoin",
          "probit",
          "mexc",
          "htx",
          "bitget",
          "bitfinex",
          "bitstamp",
        ],
      },
      [FeedCategory.Forex]: {
        requiredSources: 2,
        maxPriceDeviation: 0.001, // 0.1%
        maxLatency: 5000, // 5 seconds
        supportedExchanges: ["oanda", "fxpro", "currencylayer", "exchangerate-api"],
      },
      [FeedCategory.Commodity]: {
        requiredSources: 2,
        maxPriceDeviation: 0.01, // 1%
        maxLatency: 10000, // 10 seconds
        supportedExchanges: ["quandl", "alpha-vantage", "marketstack", "commodity-api"],
      },
      [FeedCategory.Stock]: {
        requiredSources: 2,
        maxPriceDeviation: 0.005, // 0.5%
        maxLatency: 5000, // 5 seconds
        supportedExchanges: ["alpha-vantage", "iex-cloud", "polygon", "finnhub"],
      },
    };
  }

  /**
   * Determine exchange tier (1 for custom adapters, 2 for CCXT)
   */
  private determineExchangeTier(exchange: string): number {
    const tier1Exchanges = ["binance", "coinbase", "kraken", "okx", "cryptocom"];
    return tier1Exchanges.includes(exchange) ? 1 : 2;
  }

  /**
   * Get default priority based on exchange and tier
   */
  private getDefaultPriority(exchange: string, tier: number): number {
    if (tier === 1) {
      // Higher priority for Tier 1 exchanges
      const priorities = { binance: 1, coinbase: 2, kraken: 3, okx: 4, cryptocom: 5 };
      return priorities[exchange] || 10;
    }
    return 20; // Lower priority for Tier 2
  }

  /**
   * Get default weight based on exchange and tier
   */
  private getDefaultWeight(exchange: string, tier: number): number {
    if (tier === 1) {
      // Higher weights for Tier 1 exchanges
      const weights = { binance: 0.25, coinbase: 0.25, kraken: 0.2, okx: 0.15, cryptocom: 0.15 };
      return weights[exchange] || 0.1;
    }
    return 0.05; // Lower weight for Tier 2
  }

  /**
   * Get default rate limit for exchange
   */
  private getDefaultRateLimit(exchange: string): number {
    const rateLimits = {
      binance: 1200,
      coinbase: 10,
      kraken: 1,
      okx: 20,
      cryptocom: 100,
    };
    return rateLimits[exchange] || 10;
  }

  /**
   * Validate symbol format for specific exchange
   * Requirements: 5.5
   */
  private validateSymbolFormat(symbol: string, exchange: string): boolean {
    if (!symbol) {
      return false;
    }

    // Exchange-specific symbol format validation
    switch (exchange) {
      case "kraken":
        // Kraken uses XBTUSD format for BTC, allow both formats
        return /^[A-Z0-9]+\/[A-Z0-9]+$/.test(symbol) || /^[A-Z0-9]+$/.test(symbol);

      case "binance":
      case "coinbase":
      case "okx":
      case "cryptocom":
      case "bitmart":
      case "bybit":
      case "gate":
      case "kucoin":
      case "probit":
      case "mexc":
      case "htx":
      case "bitget":
      case "bitfinex":
      case "bitstamp":
        // Crypto exchanges require BASE/QUOTE format
        if (!symbol.includes("/")) {
          return false;
        }
        const [base, quote] = symbol.split("/");
        if (!base || !quote) {
          return false;
        }
        return /^[A-Z0-9]+\/[A-Z0-9]+$/.test(symbol);

      case "oanda":
      case "fxpro":
      case "currencylayer":
      case "exchangerate-api":
        // Forex exchanges can use different formats
        // Allow both EUR/USD and EURUSD formats
        if (symbol.includes("/")) {
          const [base, quote] = symbol.split("/");
          if (!base || !quote) {
            return false;
          }
          return /^[A-Z0-9]+\/[A-Z0-9]+$/.test(symbol);
        } else {
          // Allow EURUSD format for forex
          return /^[A-Z]{6}$/.test(symbol); // 3 chars base + 3 chars quote
        }

      case "quandl":
      case "alpha-vantage":
      case "marketstack":
      case "commodity-api":
      case "iex-cloud":
      case "polygon":
      case "finnhub":
        // Commodity and stock exchanges - flexible format
        return symbol.length > 0 && /^[A-Z0-9\/]+$/.test(symbol);

      default:
        // Generic validation - require BASE/QUOTE format
        if (!symbol.includes("/")) {
          return false;
        }
        const [base2, quote2] = symbol.split("/");
        if (!base2 || !quote2) {
          return false;
        }
        return /^[A-Z0-9]+\/[A-Z0-9]+$/.test(symbol);
    }
  }

  /**
   * Create default validation configuration
   */
  private createDefaultValidation(category: FeedCategory, overrides?: ValidationOverrides): ValidationConfig {
    const categoryRule = this.categoryRules[category];

    return {
      maxAge: overrides?.maxAge || categoryRule.maxLatency,
      priceRange: overrides?.priceRange || { min: 0, max: Number.MAX_SAFE_INTEGER },
      outlierThreshold: overrides?.outlierThreshold || categoryRule.maxPriceDeviation,
      consensusWeight: overrides?.consensusWeight || 0.8,
    };
  }

  /**
   * Create default aggregation configuration
   */
  private createDefaultAggregation(category: FeedCategory, overrides?: AggregationOverrides): AggregationConfig {
    const categoryRule = this.categoryRules[category];

    return {
      method: overrides?.method || "weighted_median",
      timeDecayFactor: overrides?.timeDecayFactor || 0.00005,
      minSources: overrides?.minSources || categoryRule.requiredSources,
      maxStaleness: overrides?.maxStaleness || categoryRule.maxLatency,
    };
  }

  /**
   * Create default monitoring configuration
   */
  private createDefaultMonitoring(category: FeedCategory, overrides?: MonitoringOverrides): MonitoringOverrides {
    const categoryRule = this.categoryRules[category];

    return {
      accuracyThreshold: overrides?.accuracyThreshold || categoryRule.maxPriceDeviation,
      latencyThreshold: overrides?.latencyThreshold || categoryRule.maxLatency,
      alertsEnabled: overrides?.alertsEnabled !== undefined ? overrides.alertsEnabled : true,
    };
  }

  /**
   * Get configurations by category
   * Requirements: 5.1
   */
  getConfigurationsByCategory(category: FeedCategory): ProductionFeedConfiguration[] {
    return this.configurations.filter(config => config.category === category);
  }

  /**
   * Get configuration by feed ID
   * Requirements: 5.2
   */
  getConfigurationByFeedId(feedId: EnhancedFeedId): ProductionFeedConfiguration | undefined {
    return this.configurations.find(
      config => config.feed.category === feedId.category && config.feed.name === feedId.name
    );
  }

  /**
   * Get adapter mapping for exchange
   * Requirements: 5.1, 5.2
   */
  getAdapterMapping(exchange: string): string | undefined {
    return this.adapterMappings.get(exchange);
  }

  /**
   * Get all configurations
   */
  getAllConfigurations(): ProductionFeedConfiguration[] {
    return [...this.configurations];
  }

  /**
   * Reload configurations (hot-reload capability)
   * Requirements: 5.3 (referenced in design)
   */
  async reloadConfigurations(configPath?: string): Promise<ProductionFeedConfiguration[]> {
    this.logger.log("Reloading feed configurations...");
    return this.loadFeedConfigurations(configPath);
  }
}
