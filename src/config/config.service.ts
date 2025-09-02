import { Injectable } from "@nestjs/common";
import { BaseService } from "@/common/base/base.service";
import { readFileSync } from "fs";
import { join } from "path";
import { EnhancedFeedId, FeedCategory } from "@/common/types/feed.types";
import { IConfigurationService } from "@/common/interfaces/services/configuration.interface";

import { ConfigValidationService, EnvironmentConfig, ConfigValidationResult } from "./config-validation.service";
import { FileWatcherService } from "./file-watcher.service";

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
  }[];
}

export interface ProductionFeedConfig {
  feeds: FeedConfiguration[];
}

// Raw JSON structure from feeds.json - matches the actual file format
export interface RawFeedData {
  feed: {
    category: number;
    name: string;
  };
  sources: {
    exchange: string;
    symbol: string;
  }[];
}

// Re-export types from validation service for backward compatibility
export type { EnvironmentConfig, ConfigValidationResult } from "./config-validation.service";

@Injectable()
export class ConfigService extends BaseService implements IConfigurationService {
  private readonly adapterMappings: AdapterMapping;
  private feedConfigurations: FeedConfiguration[] = [];
  private environmentConfig: EnvironmentConfig;
  private feedsFilePath: string;
  private configValidationService: ConfigValidationService;
  private fileWatcherService: FileWatcherService;

  constructor() {
    super("ConfigService");
    this.feedsFilePath = join(__dirname, "feeds.json");
    this.adapterMappings = this.initializeAdapterMappings();
    this.configValidationService = new ConfigValidationService();
    this.fileWatcherService = new FileWatcherService();
    this.environmentConfig = this.configValidationService.loadAndValidateEnvironmentConfig();
    this.loadFeedConfigurations();
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
      const feedsJson = JSON.parse(feedsData) as RawFeedData[];

      // Validate the JSON structure
      const validation = this.configValidationService.validateFeedConfigurationStructure(feedsJson);
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

      this.logger.error("No feed configurations available - feeds.json is required");
      this.feedConfigurations = [];
    }
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

      const validation = this.configValidationService.validateSources(sources, this.adapterMappings);
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
  private parseFeedConfigurations(feedsJson: RawFeedData[]): FeedConfiguration[] {
    const configurations: FeedConfiguration[] = [];

    for (const feedData of feedsJson) {
      try {
        const config: FeedConfiguration = {
          feed: {
            category: feedData.feed.category,
            name: feedData.feed.name,
          },
          sources: feedData.sources,
        };

        configurations.push(config);
      } catch (error) {
        this.logger.error(`Failed to parse feed configuration for ${feedData.feed.name}:`, error);
      }
    }

    return configurations;
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
    if (this.fileWatcherService.isWatching(this.feedsFilePath)) {
      this.logger.warn("Feed configuration hot-reload is already enabled");
      return;
    }

    try {
      this.fileWatcherService.watchFile(
        this.feedsFilePath,
        () => {
          this.logger.log("Feed configuration file changed, reloading...");
          this.reloadFeedConfigurations();
        },
        { interval: 1000 }
      );

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
    if (!this.fileWatcherService.isWatching(this.feedsFilePath)) {
      return;
    }

    try {
      this.fileWatcherService.unwatchFile(this.feedsFilePath);
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
      const newConfig = this.configValidationService.loadAndValidateEnvironmentConfig();
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
    const envValidation = this.configValidationService.validateEnvironmentConfig(this.environmentConfig);

    return {
      environment: {
        isValid: envValidation.isValid,
        loadedAt: new Date(), // In a real implementation, you'd track this
        validationResult: envValidation,
      },
      feeds: {
        count: this.feedConfigurations.length,
        loadedAt: new Date(), // In a real implementation, you'd track this
        hotReloadEnabled: this.fileWatcherService.isWatching(this.feedsFilePath),
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
    const envValidation = this.configValidationService.validateEnvironmentConfig(this.environmentConfig);

    const feedValidations = this.feedConfigurations.map(feedConfig => {
      const sources = feedConfig.sources.map(s => ({ exchange: s.exchange, symbol: s.symbol }));
      const validation = this.configValidationService.validateSources(sources, this.adapterMappings);

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

  /**
   * Validate current configuration (alias for validateCurrentConfiguration)
   * Requirements: 5.1, 5.2
   */
  validateConfiguration(): {
    isValid: boolean;
    errors: string[];
    warnings: string[];
    missingRequired: string[];
    invalidValues: string[];
  } {
    const validation = this.validateCurrentConfiguration();

    return {
      isValid: validation.overall.isValid,
      errors: validation.environment.errors,
      warnings: validation.environment.warnings,
      missingRequired: validation.environment.missingRequired,
      invalidValues: validation.environment.invalidValues,
    };
  }

  /**
   * Reload configuration (alias for reloadFeedConfigurations)
   * Requirements: 5.4
   */
  reloadConfiguration(): void {
    this.reloadFeedConfigurations();
    this.reloadEnvironmentConfiguration();
  }

  getServiceName(): string {
    return "ConfigService";
  }

  // IBaseService interface methods
  async getPerformanceMetrics(): Promise<{
    responseTime: { average: number; min: number; max: number };
    throughput: { requestsPerSecond: number; totalRequests: number };
    errorRate: number;
    uptime: number;
  }> {
    const uptime = process.uptime();

    return {
      responseTime: {
        average: 5, // Mock values - config service is typically very fast
        min: 1,
        max: 20,
      },
      throughput: {
        requestsPerSecond: 1000, // Mock value
        totalRequests: 50000, // Mock value
      },
      errorRate: 0, // Mock value
      uptime,
    };
  }

  /**
   * Validate sources configuration
   */
  validateSources(sources: { exchange: string; symbol: string }[]) {
    return this.configValidationService.validateSources(sources, this.adapterMappings);
  }

  async getHealthStatus(): Promise<{
    status: "healthy" | "degraded" | "unhealthy";
    timestamp: number;
    details?: any;
  }> {
    const validation = this.validateConfiguration();

    let status: "healthy" | "degraded" | "unhealthy" = "healthy";

    if (!validation.isValid) {
      status = "unhealthy";
    } else if (validation.warnings.length > 0) {
      status = "degraded";
    }

    return {
      status,
      timestamp: Date.now(),
      details: {
        validation,
        feedCount: this.getFeedConfigurations().length,
        environment: this.getEnvironmentConfig().nodeEnv,
        fileWatcher: await this.fileWatcherService.getHealthStatus(),
      },
    };
  }
}
