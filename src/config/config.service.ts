import { Injectable, Logger } from "@nestjs/common";
import { readFileSync, watchFile, unwatchFile } from "fs";
import { join } from "path";
import { EnhancedFeedId } from "@/types";
import { FeedCategory } from "@/types/feed-category.enum";

export interface AdapterMapping {
  [exchange: string]: {
    hasCustomAdapter: boolean;
    adapterClass?: string;
    ccxtId?: string;
  };
}

export interface FeedConfiguration {
  feed: EnhancedFeedId;
  sources: {
    exchange: string;
    symbol: string;
    priority: number;
    weight: number;
  }[];
}

export interface ProductionFeedConfig {
  feeds: FeedConfiguration[];
}

export interface EnvironmentConfig {
  // Core application settings
  logLevel: string;
  port: number;
  basePath: string;
  nodeEnv: string;

  // Provider implementation settings (production only)
  useProductionIntegration: boolean;

  // Data processing settings
  medianDecay: number;
  tradesHistorySize: number;

  // Alerting configuration
  alerting: {
    email: {
      enabled: boolean;
      smtpHost: string;
      smtpPort: number;
      username: string;
      password: string;
      from: string;
      to: string[];
    };
    webhook: {
      enabled: boolean;
      url: string;
      headers: Record<string, string>;
      timeout: number;
    };
    maxAlertsPerHour: number;
    alertRetentionDays: number;
  };

  // Exchange API configuration
  exchangeApiKeys: Record<
    string,
    {
      apiKey?: string;
      secret?: string;
      passphrase?: string;
      sandbox?: boolean;
    }
  >;

  // Cache configuration
  cache: {
    ttlMs: number;
    maxEntries: number;
    warmupInterval: number;
  };

  // Monitoring configuration
  monitoring: {
    enabled: boolean;
    metricsPort: number;
    healthCheckInterval: number;
  };

  // Error handling configuration
  errorHandling: {
    maxRetries: number;
    retryDelayMs: number;
    circuitBreakerThreshold: number;
    circuitBreakerTimeout: number;
  };
}

export interface ConfigValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  missingRequired: string[];
  invalidValues: string[];
}

@Injectable()
export class ConfigService {
  private readonly logger = new Logger(ConfigService.name);
  private readonly adapterMappings: AdapterMapping;
  private feedConfigurations: FeedConfiguration[] = [];
  private environmentConfig: EnvironmentConfig;
  private feedsFilePath: string;
  private isWatchingFeeds = false;

  constructor() {
    this.feedsFilePath = join(__dirname, "feeds.json");
    this.adapterMappings = this.initializeAdapterMappings();
    this.environmentConfig = this.loadAndValidateEnvironmentConfig();
    this.loadFeedConfigurations();
  }

  /**
   * Load and validate environment configuration
   * Requirements: 5.1, 5.2, 5.4
   */
  private loadAndValidateEnvironmentConfig(): EnvironmentConfig {
    const config: EnvironmentConfig = {
      // Core application settings
      logLevel: process.env.LOG_LEVEL || "log",
      port: this.parseIntWithDefault(process.env.VALUE_PROVIDER_CLIENT_PORT, 3101),
      basePath: process.env.VALUE_PROVIDER_CLIENT_BASE_PATH || "",
      nodeEnv: process.env.NODE_ENV || "development",

      // Provider implementation settings (production only)
      useProductionIntegration: true, // Always use production integration

      // Data processing settings
      medianDecay: this.parseFloatWithDefault(process.env.MEDIAN_DECAY, 0.00005),
      tradesHistorySize: this.parseIntWithDefault(process.env.TRADES_HISTORY_SIZE, 1000),

      // Testing settings (no network configuration needed)

      // Alerting configuration
      alerting: {
        email: {
          enabled: process.env.ALERT_EMAIL_ENABLED === "true",
          smtpHost: process.env.ALERT_SMTP_HOST || "localhost",
          smtpPort: this.parseIntWithDefault(process.env.ALERT_SMTP_PORT, 587),
          username: process.env.ALERT_SMTP_USERNAME || "",
          password: process.env.ALERT_SMTP_PASSWORD || "",
          from: process.env.ALERT_EMAIL_FROM || "alerts@ftso-provider.com",
          to: (process.env.ALERT_EMAIL_TO || "").split(",").filter(Boolean),
        },
        webhook: {
          enabled: process.env.ALERT_WEBHOOK_ENABLED === "true",
          url: process.env.ALERT_WEBHOOK_URL || "",
          headers: this.parseJsonWithDefault(process.env.ALERT_WEBHOOK_HEADERS, {}),
          timeout: this.parseIntWithDefault(process.env.ALERT_WEBHOOK_TIMEOUT, 5000),
        },
        maxAlertsPerHour: this.parseIntWithDefault(process.env.ALERT_MAX_PER_HOUR, 20),
        alertRetentionDays: this.parseIntWithDefault(process.env.ALERT_RETENTION_DAYS, 30),
      },

      // Exchange API configuration
      exchangeApiKeys: this.loadExchangeApiKeys(),

      // Cache configuration
      cache: {
        ttlMs: this.parseIntWithDefault(process.env.CACHE_TTL_MS, 1000),
        maxEntries: this.parseIntWithDefault(process.env.CACHE_MAX_ENTRIES, 10000),
        warmupInterval: this.parseIntWithDefault(process.env.CACHE_WARMUP_INTERVAL_MS, 30000),
      },

      // Monitoring configuration
      monitoring: {
        enabled: process.env.MONITORING_ENABLED !== "false",
        metricsPort: this.parseIntWithDefault(process.env.MONITORING_METRICS_PORT, 9090),
        healthCheckInterval: this.parseIntWithDefault(process.env.MONITORING_HEALTH_CHECK_INTERVAL_MS, 5000),
      },

      // Error handling configuration
      errorHandling: {
        maxRetries: this.parseIntWithDefault(process.env.ERROR_HANDLING_MAX_RETRIES, 3),
        retryDelayMs: this.parseIntWithDefault(process.env.ERROR_HANDLING_RETRY_DELAY_MS, 1000),
        circuitBreakerThreshold: this.parseIntWithDefault(process.env.ERROR_HANDLING_CIRCUIT_BREAKER_THRESHOLD, 5),
        circuitBreakerTimeout: this.parseIntWithDefault(process.env.ERROR_HANDLING_CIRCUIT_BREAKER_TIMEOUT_MS, 60000),
      },
    };

    // Validate the configuration
    const validation = this.validateEnvironmentConfig(config);
    if (!validation.isValid) {
      this.logger.error("Environment configuration validation failed:");
      validation.errors.forEach(error => this.logger.error(`  - ${error}`));
      validation.missingRequired.forEach(missing => this.logger.error(`  - Missing required: ${missing}`));
      validation.invalidValues.forEach(invalid => this.logger.error(`  - Invalid value: ${invalid}`));

      if (validation.errors.length > 0 || validation.missingRequired.length > 0) {
        throw new Error("Critical configuration errors detected. Please fix the configuration and restart.");
      }
    }

    if (validation.warnings.length > 0) {
      this.logger.warn("Environment configuration warnings:");
      validation.warnings.forEach(warning => this.logger.warn(`  - ${warning}`));
    }

    this.logger.log("Environment configuration loaded and validated successfully");
    return config;
  }

  /**
   * Parse integer with default value and validation
   * Requirements: 5.2
   */
  private parseIntWithDefault(value: string | undefined, defaultValue: number): number {
    if (!value) return defaultValue;
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) {
      this.logger.warn(`Invalid integer value "${value}", using default ${defaultValue}`);
      return defaultValue;
    }
    return parsed;
  }

  /**
   * Parse float with default value and validation
   * Requirements: 5.2
   */
  private parseFloatWithDefault(value: string | undefined, defaultValue: number): number {
    if (!value) return defaultValue;
    const parsed = parseFloat(value);
    if (isNaN(parsed)) {
      this.logger.warn(`Invalid float value "${value}", using default ${defaultValue}`);
      return defaultValue;
    }
    return parsed;
  }

  /**
   * Parse JSON with default value and validation
   * Requirements: 5.2
   */
  private parseJsonWithDefault<T>(value: string | undefined, defaultValue: T): T {
    if (!value) return defaultValue;
    try {
      return JSON.parse(value);
    } catch (error) {
      this.logger.warn(`Invalid JSON value "${value}", using default`, error);
      return defaultValue;
    }
  }

  /**
   * Load exchange API keys from environment variables
   * Requirements: 5.1, 5.2
   */
  private loadExchangeApiKeys(): Record<
    string,
    { apiKey?: string; secret?: string; passphrase?: string; sandbox?: boolean }
  > {
    const apiKeys: Record<string, { apiKey?: string; secret?: string; passphrase?: string; sandbox?: boolean }> = {};

    // Common exchange patterns
    const exchanges = ["binance", "coinbase", "cryptocom", "kraken", "okx"];

    for (const exchange of exchanges) {
      const upperExchange = exchange.toUpperCase();
      const apiKey = process.env[`${upperExchange}_API_KEY`];
      const secret = process.env[`${upperExchange}_SECRET`];
      const passphrase = process.env[`${upperExchange}_PASSPHRASE`];
      const sandbox = process.env[`${upperExchange}_SANDBOX`] === "true";

      if (apiKey || secret || passphrase) {
        apiKeys[exchange] = {
          apiKey,
          secret,
          passphrase,
          sandbox,
        };
      }
    }

    return apiKeys;
  }

  /**
   * Validate environment configuration
   * Requirements: 5.1, 5.2
   */
  private validateEnvironmentConfig(config: EnvironmentConfig): ConfigValidationResult {
    const result: ConfigValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      missingRequired: [],
      invalidValues: [],
    };

    // Validate log level
    const validLogLevels = ["error", "warn", "log", "debug", "verbose"];
    if (!validLogLevels.includes(config.logLevel)) {
      result.invalidValues.push(
        `LOG_LEVEL: "${config.logLevel}" is not valid. Must be one of: ${validLogLevels.join(", ")}`
      );
    }

    // Validate port range
    if (config.port < 1 || config.port > 65535) {
      result.invalidValues.push(`VALUE_PROVIDER_CLIENT_PORT: ${config.port} is not a valid port number (1-65535)`);
    }

    // Validate node environment
    const validNodeEnvs = ["development", "production", "test"];
    if (!validNodeEnvs.includes(config.nodeEnv)) {
      result.warnings.push(
        `NODE_ENV: "${config.nodeEnv}" is not a standard value. Expected: ${validNodeEnvs.join(", ")}`
      );
    }

    // Production integration is always enabled - no validation needed

    // Validate numeric ranges
    if (config.medianDecay <= 0 || config.medianDecay > 1) {
      result.invalidValues.push(`MEDIAN_DECAY: ${config.medianDecay} must be between 0 and 1`);
    }

    if (config.tradesHistorySize < 1 || config.tradesHistorySize > 10000) {
      result.invalidValues.push(`TRADES_HISTORY_SIZE: ${config.tradesHistorySize} must be between 1 and 10000`);
    }

    // Validate alerting configuration
    if (config.alerting.email.enabled) {
      if (!config.alerting.email.smtpHost) {
        result.missingRequired.push("ALERT_SMTP_HOST is required when email alerting is enabled");
      }
      if (config.alerting.email.to.length === 0) {
        result.missingRequired.push("ALERT_EMAIL_TO is required when email alerting is enabled");
      }
    }

    if (config.alerting.webhook.enabled) {
      if (!config.alerting.webhook.url) {
        result.missingRequired.push("ALERT_WEBHOOK_URL is required when webhook alerting is enabled");
      }
    }

    // Validate cache configuration
    if (config.cache.ttlMs < 100 || config.cache.ttlMs > 10000) {
      result.warnings.push(`CACHE_TTL_MS: ${config.cache.ttlMs}ms may not be optimal. Recommended range: 100-10000ms`);
    }

    if (config.cache.maxEntries < 100) {
      result.warnings.push(`CACHE_MAX_ENTRIES: ${config.cache.maxEntries} may be too low for production use`);
    }

    // Validate monitoring configuration
    if (config.monitoring.metricsPort === config.port) {
      result.errors.push("MONITORING_METRICS_PORT cannot be the same as VALUE_PROVIDER_CLIENT_PORT");
    }

    // Set overall validity
    result.isValid = result.errors.length === 0 && result.missingRequired.length === 0;

    return result;
  }

  /**
   * Get environment configuration
   * Requirements: 5.1, 5.2
   */
  getEnvironmentConfig(): EnvironmentConfig {
    return { ...this.environmentConfig };
  }

  /**
   * Get specific environment configuration section
   * Requirements: 5.1
   */
  getAlertingConfig() {
    return { ...this.environmentConfig.alerting };
  }

  getCacheConfig() {
    return { ...this.environmentConfig.cache };
  }

  getMonitoringConfig() {
    return { ...this.environmentConfig.monitoring };
  }

  getErrorHandlingConfig() {
    return { ...this.environmentConfig.errorHandling };
  }

  getExchangeApiKeys() {
    return { ...this.environmentConfig.exchangeApiKeys };
  }

  /**
   * Get API key for specific exchange
   * Requirements: 5.1
   */
  getExchangeApiKey(exchange: string) {
    return this.environmentConfig.exchangeApiKeys[exchange.toLowerCase()];
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
      binanceus: { hasCustomAdapter: false, ccxtId: "binanceus" },
      bingx: { hasCustomAdapter: false, ccxtId: "bingx" },
      bitfinex: { hasCustomAdapter: false, ccxtId: "bitfinex" },
      bitget: { hasCustomAdapter: false, ccxtId: "bitget" },
      bitmart: { hasCustomAdapter: false, ccxtId: "bitmart" },
      bitrue: { hasCustomAdapter: false, ccxtId: "bitrue" },
      bitstamp: { hasCustomAdapter: false, ccxtId: "bitstamp" },
      bybit: { hasCustomAdapter: false, ccxtId: "bybit" },
      gate: { hasCustomAdapter: false, ccxtId: "gate" },
      htx: { hasCustomAdapter: false, ccxtId: "htx" },
      kucoin: { hasCustomAdapter: false, ccxtId: "kucoin" },
      mexc: { hasCustomAdapter: false, ccxtId: "mexc" },
      probit: { hasCustomAdapter: false, ccxtId: "probit" },
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

  /**
   * Load feed configurations from feeds.json with comprehensive error handling
   * Requirements: 5.1, 5.2, 5.4
   */
  private loadFeedConfigurations(): void {
    try {
      this.logger.log(`Loading feed configurations from ${this.feedsFilePath}`);

      const feedsData = readFileSync(this.feedsFilePath, "utf8");
      const feedsJson = JSON.parse(feedsData);

      // Validate the JSON structure
      const validation = this.validateFeedConfigurationStructure(feedsJson);
      if (!validation.isValid) {
        this.logger.error("Feed configuration validation failed:");
        validation.errors.forEach(error => this.logger.error(`  - ${error}`));

        if (validation.errors.length > 0) {
          throw new Error("Critical feed configuration errors detected");
        }
      }

      if (validation.warnings.length > 0) {
        this.logger.warn("Feed configuration warnings:");
        validation.warnings.forEach(warning => this.logger.warn(`  - ${warning}`));
      }

      this.feedConfigurations = this.parseFeedConfigurations(feedsJson);
      this.logger.log(`Successfully loaded ${this.feedConfigurations.length} feed configurations`);

      // Validate all sources in the configurations
      this.validateAllFeedSources();
    } catch (error) {
      this.logger.error("Failed to load feed configurations:", error);

      if (error instanceof SyntaxError) {
        this.logger.error("feeds.json contains invalid JSON syntax");
      } else if (error.code === "ENOENT") {
        this.logger.error(`feeds.json file not found at ${this.feedsFilePath}`);
      }

      this.logger.warn("Falling back to default feed configurations");
      this.feedConfigurations = this.getDefaultFeedConfigurations();
    }
  }

  /**
   * Validate feed configuration JSON structure
   * Requirements: 5.1, 5.2
   */
  private validateFeedConfigurationStructure(feedsJson: any): ConfigValidationResult {
    const result: ConfigValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      missingRequired: [],
      invalidValues: [],
    };

    // Check if it's an array (the expected format)
    if (!Array.isArray(feedsJson)) {
      result.errors.push("feeds.json must contain an array of feed configurations");
      result.isValid = false;
      return result;
    }

    // Validate each feed configuration
    feedsJson.forEach((feedConfig, index) => {
      const feedPrefix = `Feed ${index + 1}`;

      // Check required fields
      if (!feedConfig.feed) {
        result.errors.push(`${feedPrefix}: Missing 'feed' object`);
      } else {
        if (typeof feedConfig.feed.category !== "number") {
          result.errors.push(`${feedPrefix}: feed.category must be a number`);
        }
        if (typeof feedConfig.feed.name !== "string" || !feedConfig.feed.name.trim()) {
          result.errors.push(`${feedPrefix}: feed.name must be a non-empty string`);
        }
      }

      if (!Array.isArray(feedConfig.sources)) {
        result.errors.push(`${feedPrefix}: 'sources' must be an array`);
      } else if (feedConfig.sources.length === 0) {
        result.warnings.push(`${feedPrefix}: No sources defined for feed ${feedConfig.feed?.name || "unknown"}`);
      } else {
        // Validate each source
        feedConfig.sources.forEach((source, sourceIndex) => {
          const sourcePrefix = `${feedPrefix}, Source ${sourceIndex + 1}`;

          if (typeof source.exchange !== "string" || !source.exchange.trim()) {
            result.errors.push(`${sourcePrefix}: exchange must be a non-empty string`);
          }
          if (typeof source.symbol !== "string" || !source.symbol.trim()) {
            result.errors.push(`${sourcePrefix}: symbol must be a non-empty string`);
          }

          // Check for optional fields with correct types
          if (source.priority !== undefined && typeof source.priority !== "number") {
            result.warnings.push(`${sourcePrefix}: priority should be a number`);
          }
          if (source.weight !== undefined && typeof source.weight !== "number") {
            result.warnings.push(`${sourcePrefix}: weight should be a number`);
          }
        });
      }
    });

    result.isValid = result.errors.length === 0;
    return result;
  }

  /**
   * Validate all sources in feed configurations
   * Requirements: 5.1, 5.2
   */
  private validateAllFeedSources(): void {
    let totalSources = 0;
    let validatedSources = 0;
    let warningCount = 0;

    for (const feedConfig of this.feedConfigurations) {
      const sources = feedConfig.sources.map(s => ({ exchange: s.exchange, symbol: s.symbol }));
      totalSources += sources.length;

      const validation = this.validateSources(sources);
      if (validation.isValid) {
        validatedSources += sources.length;
      }
      warningCount += validation.warnings.length;

      if (validation.warnings.length > 0) {
        this.logger.debug(`Feed ${feedConfig.feed.name} validation warnings:`, validation.warnings);
      }
    }

    this.logger.log(`Feed source validation complete: ${validatedSources}/${totalSources} sources validated`);
    if (warningCount > 0) {
      this.logger.warn(`Total validation warnings: ${warningCount}`);
    }
  }

  /**
   * Parse feed configurations from feeds.json format
   * Requirements: 5.1, 5.2
   */
  private parseFeedConfigurations(feedsJson: unknown): FeedConfiguration[] {
    const configurations: FeedConfiguration[] = [];

    // Handle both array format (current feeds.json) and object format with feeds array
    const feedsArray = Array.isArray(feedsJson) ? feedsJson : (feedsJson as unknown)?.feeds || [];

    if (Array.isArray(feedsArray)) {
      for (const feedData of feedsArray) {
        try {
          const config: FeedConfiguration = {
            feed: {
              category: feedData.feed?.category || FeedCategory.Crypto,
              name: feedData.feed?.name || feedData.name,
            },
            sources: feedData.sources || [],
          };

          // Add default priority and weight if not specified
          config.sources = config.sources.map(source => ({
            exchange: source.exchange,
            symbol: source.symbol,
            priority: source.priority || 1,
            weight: source.weight || 1.0 / config.sources.length, // Equal weight by default
          }));

          configurations.push(config);
        } catch (error) {
          this.logger.error(
            `Failed to parse feed configuration for ${feedData.feed?.name || feedData.name || "unknown"}:`,
            error
          );
        }
      }
    } else {
      this.logger.warn("feeds.json does not contain a valid array of feed configurations");
    }

    return configurations;
  }

  /**
   * Get default feed configurations for common crypto pairs
   * Requirements: 5.1, 5.2
   */
  private getDefaultFeedConfigurations(): FeedConfiguration[] {
    return [
      {
        feed: { category: FeedCategory.Crypto, name: "BTC/USD" },
        sources: [
          { exchange: "binance", symbol: "BTCUSDT", priority: 1, weight: 0.25 },
          { exchange: "coinbase", symbol: "BTC-USD", priority: 1, weight: 0.25 },
          { exchange: "kraken", symbol: "XBTUSD", priority: 1, weight: 0.2 },
          { exchange: "okx", symbol: "BTC-USDT", priority: 1, weight: 0.15 },
          { exchange: "cryptocom", symbol: "BTC_USDT", priority: 1, weight: 0.15 },
        ],
      },
      {
        feed: { category: FeedCategory.Crypto, name: "ETH/USD" },
        sources: [
          { exchange: "binance", symbol: "ETHUSDT", priority: 1, weight: 0.25 },
          { exchange: "coinbase", symbol: "ETH-USD", priority: 1, weight: 0.25 },
          { exchange: "kraken", symbol: "ETHUSD", priority: 1, weight: 0.2 },
          { exchange: "okx", symbol: "ETH-USDT", priority: 1, weight: 0.15 },
          { exchange: "cryptocom", symbol: "ETH_USDT", priority: 1, weight: 0.15 },
        ],
      },
    ];
  }

  /**
   * Get all feed configurations
   * Requirements: 5.1, 5.2
   */
  getFeedConfigurations(): FeedConfiguration[] {
    return this.feedConfigurations;
  }

  /**
   * Get feed configuration by feed ID
   * Requirements: 5.1, 5.2
   */
  getFeedConfiguration(feedId: EnhancedFeedId): FeedConfiguration | undefined {
    return this.feedConfigurations.find(
      config => config.feed.category === feedId.category && config.feed.name === feedId.name
    );
  }

  /**
   * Get feed configurations by category
   * Requirements: 5.1
   */
  getFeedConfigurationsByCategory(category: FeedCategory): FeedConfiguration[] {
    return this.feedConfigurations.filter(config => config.feed.category === category);
  }

  /**
   * Enable hot-reload functionality for feed configurations
   * Requirements: 5.4
   */
  enableFeedConfigurationHotReload(): void {
    if (this.isWatchingFeeds) {
      this.logger.warn("Feed configuration hot-reload is already enabled");
      return;
    }

    try {
      watchFile(this.feedsFilePath, { interval: 1000 }, (curr, prev) => {
        if (curr.mtime !== prev.mtime) {
          this.logger.log("Feed configuration file changed, reloading...");
          this.reloadFeedConfigurations();
        }
      });

      this.isWatchingFeeds = true;
      this.logger.log("Feed configuration hot-reload enabled");
    } catch (error) {
      this.logger.error("Failed to enable feed configuration hot-reload:", error);
    }
  }

  /**
   * Disable hot-reload functionality for feed configurations
   * Requirements: 5.4
   */
  disableFeedConfigurationHotReload(): void {
    if (!this.isWatchingFeeds) {
      return;
    }

    try {
      unwatchFile(this.feedsFilePath);
      this.isWatchingFeeds = false;
      this.logger.log("Feed configuration hot-reload disabled");
    } catch (error) {
      this.logger.error("Failed to disable feed configuration hot-reload:", error);
    }
  }

  /**
   * Reload feed configurations (for hot-reload capability)
   * Requirements: 5.4
   */
  reloadFeedConfigurations(): void {
    this.logger.log("Reloading feed configurations...");

    const previousCount = this.feedConfigurations.length;

    try {
      this.loadFeedConfigurations();
      const newCount = this.feedConfigurations.length;

      if (newCount !== previousCount) {
        this.logger.log(`Feed configuration count changed: ${previousCount} -> ${newCount}`);
      }

      this.logger.log("Feed configurations reloaded successfully");
    } catch (error) {
      this.logger.error("Failed to reload feed configurations:", error);
      this.logger.warn("Keeping previous feed configurations");
    }
  }

  /**
   * Reload environment configuration (for hot-reload capability)
   * Requirements: 5.4
   */
  reloadEnvironmentConfiguration(): void {
    this.logger.log("Reloading environment configuration...");

    try {
      const newConfig = this.loadAndValidateEnvironmentConfig();
      this.environmentConfig = newConfig;
      this.logger.log("Environment configuration reloaded successfully");
    } catch (error) {
      this.logger.error("Failed to reload environment configuration:", error);
      this.logger.warn("Keeping previous environment configuration");
    }
  }

  /**
   * Get configuration status and health information
   * Requirements: 5.1, 5.2
   */
  getConfigurationStatus(): {
    environment: {
      isValid: boolean;
      loadedAt: Date;
      validationResult: ConfigValidationResult;
    };
    feeds: {
      count: number;
      loadedAt: Date;
      hotReloadEnabled: boolean;
      filePath: string;
    };
    adapters: {
      customAdapterCount: number;
      ccxtAdapterCount: number;
      totalExchanges: number;
    };
  } {
    const envValidation = this.validateEnvironmentConfig(this.environmentConfig);

    return {
      environment: {
        isValid: envValidation.isValid,
        loadedAt: new Date(), // In a real implementation, you'd track this
        validationResult: envValidation,
      },
      feeds: {
        count: this.feedConfigurations.length,
        loadedAt: new Date(), // In a real implementation, you'd track this
        hotReloadEnabled: this.isWatchingFeeds,
        filePath: this.feedsFilePath,
      },
      adapters: {
        customAdapterCount: this.getCustomAdapterExchanges().length,
        ccxtAdapterCount: this.getCcxtExchanges().length,
        totalExchanges: Object.keys(this.adapterMappings).length,
      },
    };
  }

  /**
   * Validate current configuration and return detailed report
   * Requirements: 5.1, 5.2
   */
  validateCurrentConfiguration(): {
    overall: {
      isValid: boolean;
      criticalErrors: number;
      warnings: number;
    };
    environment: ConfigValidationResult;
    feeds: {
      totalFeeds: number;
      totalSources: number;
      validationResults: Array<{
        feedName: string;
        isValid: boolean;
        errors: string[];
        warnings: string[];
      }>;
    };
  } {
    const envValidation = this.validateEnvironmentConfig(this.environmentConfig);

    const feedValidations = this.feedConfigurations.map(feedConfig => {
      const sources = feedConfig.sources.map(s => ({ exchange: s.exchange, symbol: s.symbol }));
      const validation = this.validateSources(sources);

      return {
        feedName: feedConfig.feed.name,
        isValid: validation.isValid,
        errors: validation.errors,
        warnings: validation.warnings,
      };
    });

    const totalSources = this.feedConfigurations.reduce((sum, feed) => sum + feed.sources.length, 0);
    const criticalErrors =
      envValidation.errors.length +
      envValidation.missingRequired.length +
      feedValidations.reduce((sum, feed) => sum + feed.errors.length, 0);
    const warnings =
      envValidation.warnings.length +
      envValidation.invalidValues.length +
      feedValidations.reduce((sum, feed) => sum + feed.warnings.length, 0);

    return {
      overall: {
        isValid: envValidation.isValid && feedValidations.every(f => f.isValid),
        criticalErrors,
        warnings,
      },
      environment: envValidation,
      feeds: {
        totalFeeds: this.feedConfigurations.length,
        totalSources,
        validationResults: feedValidations,
      },
    };
  }
}
