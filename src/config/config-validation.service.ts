import { Injectable, Logger } from "@nestjs/common";
import { EnhancedFeedId, FeedCategory } from "@/types";
import { ProductionFeedConfiguration, EnhancedSourceConfig } from "./production-feed-config.loader";

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ExchangeCompatibilityCheck {
  exchange: string;
  category: FeedCategory;
  isCompatible: boolean;
  supportedSymbols: string[];
  issues: string[];
}

@Injectable()
export class ConfigValidationService {
  private readonly logger = new Logger(ConfigValidationService.name);

  /**
   * Validate complete feed configuration
   * Requirements: 5.1, 5.2, 5.5
   */
  validateConfiguration(config: ProductionFeedConfiguration): ValidationResult {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
    };

    // Validate feed ID
    const feedValidation = this.validateFeedId(config.feed);
    result.errors.push(...feedValidation.errors);
    result.warnings.push(...feedValidation.warnings);

    // Validate sources
    const sourcesValidation = this.validateSources(config.sources, config.category);
    result.errors.push(...sourcesValidation.errors);
    result.warnings.push(...sourcesValidation.warnings);

    // Validate category-specific requirements
    const categoryValidation = this.validateCategoryRequirements(config);
    result.errors.push(...categoryValidation.errors);
    result.warnings.push(...categoryValidation.warnings);

    // Validate exchange-adapter compatibility
    const compatibilityValidation = this.validateExchangeCompatibility(config);
    result.errors.push(...compatibilityValidation.errors);
    result.warnings.push(...compatibilityValidation.warnings);

    result.isValid = result.errors.length === 0;

    if (!result.isValid) {
      this.logger.error(`Configuration validation failed for ${config.feed.name}:`, result.errors);
    }

    if (result.warnings.length > 0) {
      this.logger.warn(`Configuration warnings for ${config.feed.name}:`, result.warnings);
    }

    return result;
  }

  /**
   * Validate feed ID structure and format
   * Requirements: 5.2, 5.5
   */
  private validateFeedId(feedId: EnhancedFeedId): ValidationResult {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
    };

    // Validate category
    if (!Object.values(FeedCategory).includes(feedId.category)) {
      result.errors.push(`Invalid feed category: ${feedId.category}`);
    }

    // Validate name format
    if (!feedId.name || typeof feedId.name !== "string") {
      result.errors.push("Feed name must be a non-empty string");
    } else {
      // Check for proper pair format (BASE/QUOTE)
      if (!feedId.name.includes("/")) {
        result.errors.push(`Feed name must be in BASE/QUOTE format, got: ${feedId.name}`);
      } else {
        const parts = feedId.name.split("/");
        if (parts.length !== 2) {
          result.errors.push(`Feed name must have exactly one '/' separator, got: ${feedId.name}`);
        } else {
          const [base, quote] = parts;
          if (!base || !quote) {
            result.errors.push(`Both base and quote must be non-empty, got: ${feedId.name}`);
          }

          // Validate character set (alphanumeric only)
          if (!/^[A-Z0-9]+$/.test(base) || !/^[A-Z0-9]+$/.test(quote)) {
            result.errors.push(`Feed name must contain only uppercase letters and numbers, got: ${feedId.name}`);
          }
        }
      }

      // Check name length for hex encoding compatibility
      if (feedId.name.length > 21) {
        result.warnings.push(`Feed name is longer than 21 characters, may cause hex encoding issues: ${feedId.name}`);
      }
    }

    result.isValid = result.errors.length === 0;
    return result;
  }

  /**
   * Validate sources configuration
   * Requirements: 5.1, 5.2
   */
  private validateSources(sources: EnhancedSourceConfig[], category: FeedCategory): ValidationResult {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
    };

    if (!sources || sources.length === 0) {
      result.errors.push("Configuration must have at least one source");
      result.isValid = false;
      return result;
    }

    // Validate minimum sources based on category
    const minSources = this.getMinimumSourcesForCategory(category);
    if (sources.length < minSources) {
      result.errors.push(
        `Category ${FeedCategory[category]} requires at least ${minSources} sources, got ${sources.length}`
      );
    }

    // Validate each source
    sources.forEach((source, index) => {
      const sourceValidation = this.validateSingleSource(source, category, index);
      result.errors.push(...sourceValidation.errors);
      result.warnings.push(...sourceValidation.warnings);
    });

    // Check for duplicate exchanges
    const exchanges = sources.map(s => s.exchange);
    const duplicates = exchanges.filter((exchange, index) => exchanges.indexOf(exchange) !== index);
    if (duplicates.length > 0) {
      result.warnings.push(`Duplicate exchanges found: ${duplicates.join(", ")}`);
    }

    // Validate weight distribution
    const totalWeight = sources.reduce((sum, source) => sum + (source.weight || 0), 0);
    if (Math.abs(totalWeight - 1.0) > 0.01) {
      result.warnings.push(`Source weights should sum to 1.0, got ${totalWeight.toFixed(3)}`);
    }

    result.isValid = result.errors.length === 0;
    return result;
  }

  /**
   * Validate single source configuration
   * Requirements: 5.1, 5.2
   */
  private validateSingleSource(source: EnhancedSourceConfig, category: FeedCategory, index: number): ValidationResult {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
    };

    const prefix = `Source ${index + 1}`;

    // Validate required fields
    if (!source.exchange) {
      result.errors.push(`${prefix}: exchange is required`);
    }

    if (!source.symbol) {
      result.errors.push(`${prefix}: symbol is required`);
    }

    // Validate numeric fields
    if (source.priority !== undefined && (source.priority < 1 || source.priority > 100)) {
      result.errors.push(`${prefix}: priority must be between 1 and 100, got ${source.priority}`);
    }

    if (source.weight !== undefined && (source.weight < 0 || source.weight > 1)) {
      result.errors.push(`${prefix}: weight must be between 0 and 1, got ${source.weight}`);
    }

    if (source.rateLimit !== undefined && source.rateLimit < 1) {
      result.errors.push(`${prefix}: rateLimit must be positive, got ${source.rateLimit}`);
    }

    // Validate tier
    if (source.tier !== undefined && ![1, 2].includes(source.tier)) {
      result.errors.push(`${prefix}: tier must be 1 or 2, got ${source.tier}`);
    }

    // Validate symbol format
    if (source.symbol && !this.validateSymbolFormat(source.symbol)) {
      result.errors.push(`${prefix}: invalid symbol format '${source.symbol}'`);
    }

    // Validate exchange compatibility with category
    if (source.exchange && !this.isExchangeCompatibleWithCategory(source.exchange, category)) {
      result.errors.push(
        `${prefix}: exchange '${source.exchange}' is not compatible with category ${FeedCategory[category]}`
      );
    }

    result.isValid = result.errors.length === 0;
    return result;
  }

  /**
   * Validate category-specific requirements
   * Requirements: 5.1
   */
  private validateCategoryRequirements(config: ProductionFeedConfiguration): ValidationResult {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
    };

    const category = config.category;
    const sources = config.sources;

    switch (category) {
      case FeedCategory.Crypto:
        // Crypto-specific validations
        if (!sources.some(s => s.exchange === "binance" || s.exchange === "coinbase")) {
          result.warnings.push("Crypto feeds should include major exchanges like Binance or Coinbase");
        }

        // Check for USDT pairs and USD conversion capability
        const hasUsdtPairs = sources.some(s => s.symbol.includes("USDT"));
        const hasUsdPairs = sources.some(s => s.symbol.includes("USD") && !s.symbol.includes("USDT"));

        if (hasUsdtPairs && !hasUsdPairs) {
          result.warnings.push("USDT pairs detected but no USD pairs for conversion reference");
        }
        break;

      case FeedCategory.Forex:
        // Forex-specific validations
        if (!sources.some(s => ["oanda", "fxpro"].includes(s.exchange))) {
          result.warnings.push("Forex feeds should include professional forex providers like Oanda or FxPro");
        }
        break;

      case FeedCategory.Commodity:
        // Commodity-specific validations
        if (sources.length < 2) {
          result.errors.push("Commodity feeds require at least 2 sources for reliability");
        }
        break;

      case FeedCategory.Stock:
        // Stock-specific validations
        if (!sources.some(s => ["alpha-vantage", "iex-cloud", "polygon"].includes(s.exchange))) {
          result.warnings.push("Stock feeds should include established stock data providers");
        }
        break;
    }

    result.isValid = result.errors.length === 0;
    return result;
  }

  /**
   * Validate exchange-adapter compatibility
   * Requirements: 5.1, 5.2
   */
  private validateExchangeCompatibility(config: ProductionFeedConfiguration): ValidationResult {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
    };

    for (const source of config.sources) {
      const compatibility = this.checkExchangeCompatibility(source.exchange, config.category);

      if (!compatibility.isCompatible) {
        result.errors.push(
          `Exchange '${source.exchange}' is not compatible with category ${FeedCategory[config.category]}: ${compatibility.issues.join(", ")}`
        );
      }

      // Check if symbol is supported by the exchange
      if (compatibility.supportedSymbols.length > 0 && !compatibility.supportedSymbols.includes(source.symbol)) {
        result.warnings.push(`Symbol '${source.symbol}' may not be supported by exchange '${source.exchange}'`);
      }
    }

    result.isValid = result.errors.length === 0;
    return result;
  }

  /**
   * Check exchange compatibility with category
   * Requirements: 5.1, 5.2
   */
  checkExchangeCompatibility(exchange: string, category: FeedCategory): ExchangeCompatibilityCheck {
    const result: ExchangeCompatibilityCheck = {
      exchange,
      category,
      isCompatible: false,
      supportedSymbols: [],
      issues: [],
    };

    // Define exchange categories
    const cryptoExchanges = [
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
    ];

    const forexExchanges = ["oanda", "fxpro", "currencylayer", "exchangerate-api"];
    const commodityExchanges = ["quandl", "alpha-vantage", "marketstack", "commodity-api"];
    const stockExchanges = ["alpha-vantage", "iex-cloud", "polygon", "finnhub"];

    switch (category) {
      case FeedCategory.Crypto:
        result.isCompatible = cryptoExchanges.includes(exchange);
        if (!result.isCompatible) {
          result.issues.push(`Exchange not in supported crypto exchanges list`);
        }
        break;

      case FeedCategory.Forex:
        result.isCompatible = forexExchanges.includes(exchange);
        if (!result.isCompatible) {
          result.issues.push(`Exchange not in supported forex exchanges list`);
        }
        break;

      case FeedCategory.Commodity:
        result.isCompatible = commodityExchanges.includes(exchange);
        if (!result.isCompatible) {
          result.issues.push(`Exchange not in supported commodity exchanges list`);
        }
        break;

      case FeedCategory.Stock:
        result.isCompatible = stockExchanges.includes(exchange);
        if (!result.isCompatible) {
          result.issues.push(`Exchange not in supported stock exchanges list`);
        }
        break;

      default:
        result.issues.push(`Unknown category: ${category}`);
    }

    return result;
  }

  /**
   * Validate symbol format
   * Requirements: 5.5
   */
  private validateSymbolFormat(symbol: string): boolean {
    if (!symbol || typeof symbol !== "string") {
      return false;
    }

    // Must be in BASE/QUOTE format
    if (!symbol.includes("/")) {
      return false;
    }

    const parts = symbol.split("/");
    if (parts.length !== 2) {
      return false;
    }

    const [base, quote] = parts;

    // Both parts must be non-empty and alphanumeric
    if (!base || !quote) {
      return false;
    }

    // Must contain only uppercase letters and numbers
    return /^[A-Z0-9]+$/.test(base) && /^[A-Z0-9]+$/.test(quote);
  }

  /**
   * Check if exchange is compatible with category
   */
  private isExchangeCompatibleWithCategory(exchange: string, category: FeedCategory): boolean {
    return this.checkExchangeCompatibility(exchange, category).isCompatible;
  }

  /**
   * Get minimum sources required for category
   */
  private getMinimumSourcesForCategory(category: FeedCategory): number {
    switch (category) {
      case FeedCategory.Crypto:
        return 3;
      case FeedCategory.Forex:
        return 2;
      case FeedCategory.Commodity:
        return 2;
      case FeedCategory.Stock:
        return 2;
      default:
        return 1;
    }
  }

  /**
   * Validate multiple configurations
   * Requirements: 5.1, 5.2, 5.5
   */
  validateConfigurations(configurations: ProductionFeedConfiguration[]): ValidationResult {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
    };

    if (!configurations || configurations.length === 0) {
      result.errors.push("No configurations provided");
      result.isValid = false;
      return result;
    }

    // Validate each configuration
    configurations.forEach((config, index) => {
      const configValidation = this.validateConfiguration(config);

      // Prefix errors and warnings with configuration index
      const prefix = `Config ${index + 1} (${config.feed.name})`;
      result.errors.push(...configValidation.errors.map(error => `${prefix}: ${error}`));
      result.warnings.push(...configValidation.warnings.map(warning => `${prefix}: ${warning}`));
    });

    // Check for duplicate feed IDs
    const feedIds = configurations.map(c => `${c.feed.category}:${c.feed.name}`);
    const duplicates = feedIds.filter((id, index) => feedIds.indexOf(id) !== index);
    if (duplicates.length > 0) {
      result.errors.push(`Duplicate feed IDs found: ${duplicates.join(", ")}`);
    }

    result.isValid = result.errors.length === 0;

    this.logger.log(`Validated ${configurations.length} configurations: ${result.isValid ? "PASSED" : "FAILED"}`);
    if (result.errors.length > 0) {
      this.logger.error("Validation errors:", result.errors);
    }
    if (result.warnings.length > 0) {
      this.logger.warn("Validation warnings:", result.warnings);
    }

    return result;
  }
}
