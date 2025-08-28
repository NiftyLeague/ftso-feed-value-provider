import { FeedCategory } from "@/types/feed-category.enum";

export interface SymbolMapping {
  feedSymbol: string;
  exchangeSymbol: string;
  category: FeedCategory;
}

export interface ExchangeSymbolConventions {
  separator: string; // e.g., "-", "/", ""
  baseFirst: boolean; // true for BTC/USD, false for USDBTC
  caseFormat: "upper" | "lower" | "mixed";
  specialMappings?: Map<string, string>; // For unique symbols like XBTUSD -> BTC/USD
}

export class SymbolMappingUtils {
  private static readonly COMMON_SYMBOL_MAPPINGS = new Map<string, string>([
    // Bitcoin variations
    ["XBT", "BTC"],
    ["XBTUSD", "BTC/USD"],
    ["XBTUSDT", "BTC/USDT"],

    // Ethereum variations
    ["ETH", "ETH"],
    ["ETHUSD", "ETH/USD"],
    ["ETHUSDT", "ETH/USDT"],

    // Common stablecoin mappings
    ["USDT", "USDT"],
    ["USDC", "USDC"],
    ["DAI", "DAI"],

    // Forex pairs - standard format
    ["EURUSD", "EUR/USD"],
    ["GBPUSD", "GBP/USD"],
    ["USDJPY", "USD/JPY"],
    ["AUDUSD", "AUD/USD"],
    ["USDCAD", "USD/CAD"],
    ["USDCHF", "USD/CHF"],
    ["NZDUSD", "NZD/USD"],

    // Commodity mappings
    ["XAUUSD", "XAU/USD"], // Gold
    ["XAGUSD", "XAG/USD"], // Silver
    ["WTIUSD", "WTI/USD"], // Oil
    ["BCOUSD", "BCO/USD"], // Brent Oil
  ]);

  /**
   * Normalize a feed symbol to standard format (BASE/QUOTE)
   */
  static normalizeFeedSymbol(symbol: string): string {
    // Check for direct mapping first
    const directMapping = this.COMMON_SYMBOL_MAPPINGS.get(symbol.toUpperCase());
    if (directMapping) {
      return directMapping;
    }

    // If already in BASE/QUOTE format, return as-is
    if (symbol.includes("/")) {
      return symbol.toUpperCase();
    }

    // Try to parse common formats
    return this.parseSymbolFormat(symbol);
  }

  /**
   * Convert a normalized feed symbol to exchange-specific format
   */
  static toExchangeFormat(feedSymbol: string, conventions: ExchangeSymbolConventions): string {
    // Check special mappings first
    if (conventions.specialMappings?.has(feedSymbol)) {
      return conventions.specialMappings.get(feedSymbol)!;
    }

    const normalized = this.normalizeFeedSymbol(feedSymbol);
    const [base, quote] = normalized.split("/");

    if (!base || !quote) {
      throw new Error(`Invalid symbol format: ${feedSymbol}`);
    }

    // Apply case formatting
    const formatCase = (str: string) => {
      switch (conventions.caseFormat) {
        case "upper":
          return str.toUpperCase();
        case "lower":
          return str.toLowerCase();
        case "mixed":
        default:
          return str;
      }
    };

    const formattedBase = formatCase(base);
    const formattedQuote = formatCase(quote);

    // Apply order and separator
    if (conventions.baseFirst) {
      return `${formattedBase}${conventions.separator}${formattedQuote}`;
    } else {
      return `${formattedQuote}${conventions.separator}${formattedBase}`;
    }
  }

  /**
   * Create exchange-specific symbol conventions
   */
  static createConventions(
    separator: string,
    baseFirst: boolean = true,
    caseFormat: "upper" | "lower" | "mixed" = "upper",
    specialMappings?: Map<string, string>
  ): ExchangeSymbolConventions {
    return {
      separator,
      baseFirst,
      caseFormat,
      specialMappings,
    };
  }

  /**
   * Get predefined conventions for common exchanges
   */
  static getExchangeConventions(exchangeName: string): ExchangeSymbolConventions {
    const exchange = exchangeName.toLowerCase();

    switch (exchange) {
      case "coinbase":
        return this.createConventions("-", true, "upper");

      case "binance":
        return this.createConventions("", true, "upper");

      case "kraken":
        const krakenSpecialMappings = new Map([
          ["BTC/USD", "XBTUSD"],
          ["BTC/USDT", "XBTUSDT"],
          ["ETH/USD", "ETHUSD"],
          ["ETH/USDT", "ETHUSDT"],
        ]);
        return this.createConventions("", true, "upper", krakenSpecialMappings);

      case "okx":
        return this.createConventions("-", true, "upper");

      case "kucoin":
        return this.createConventions("-", true, "upper");

      case "bybit":
        return this.createConventions("", true, "upper");

      case "gate":
        return this.createConventions("_", true, "upper");

      default:
        // Default format: BASE/QUOTE with slash separator
        return this.createConventions("/", true, "upper");
    }
  }

  /**
   * Validate if a symbol mapping is valid for a given category
   */
  static validateSymbolForCategory(symbol: string, category: FeedCategory): boolean {
    const normalized = this.normalizeFeedSymbol(symbol);

    switch (category) {
      case FeedCategory.Crypto:
        return this.isCryptoSymbol(normalized);
      case FeedCategory.Forex:
        return this.isForexSymbol(normalized);
      case FeedCategory.Commodity:
        return this.isCommoditySymbol(normalized);
      case FeedCategory.Stock:
        return this.isStockSymbol(normalized);
      default:
        return false;
    }
  }

  private static parseSymbolFormat(symbol: string): string {
    // Common patterns for different symbol formats
    const upperSymbol = symbol.toUpperCase();

    // Handle common crypto pairs (6-8 characters)
    if (upperSymbol.length >= 6 && upperSymbol.length <= 8) {
      // Try common splits
      const commonQuotes = ["USD", "USDT", "USDC", "BTC", "ETH"];

      for (const quote of commonQuotes) {
        if (upperSymbol.endsWith(quote)) {
          const base = upperSymbol.slice(0, -quote.length);
          if (base.length >= 2) {
            return `${base}/${quote}`;
          }
        }
      }
    }

    // If we can't parse it, return as-is
    return symbol.toUpperCase();
  }

  private static isCryptoSymbol(symbol: string): boolean {
    // First check if it's a forex symbol (more specific)
    if (this.isForexSymbol(symbol)) {
      return false;
    }

    // Check if it's a commodity symbol
    if (this.isCommoditySymbol(symbol)) {
      return false;
    }

    // Crypto symbols: 1-10 characters for base, 2-10 for quote
    // Allow single character tokens like "S" which are legitimate crypto tokens
    const cryptoPattern = /^[A-Z]{1,10}\/[A-Z]{2,10}$/;
    if (!cryptoPattern.test(symbol)) {
      return false;
    }

    // Additional check: if quote is a common crypto quote currency, it's likely crypto
    const [base, quote] = symbol.split("/");
    const cryptoQuotes = new Set(["USDT", "USDC", "BTC", "ETH", "BNB", "USD"]);

    // If quote is a crypto quote currency, it's crypto regardless of base length
    if (cryptoQuotes.has(quote)) {
      return true;
    }

    // For other quotes, require at least 2 characters for base to avoid conflicts with forex
    return base.length >= 2;
  }

  private static isForexSymbol(symbol: string): boolean {
    // Forex symbols: exactly 3 characters for both base and quote (currency codes)
    const forexPattern = /^[A-Z]{3}\/[A-Z]{3}$/;
    if (!forexPattern.test(symbol)) {
      return false;
    }

    // Additional check: common forex currency codes
    const commonCurrencies = new Set([
      "USD",
      "EUR",
      "GBP",
      "JPY",
      "AUD",
      "CAD",
      "CHF",
      "NZD",
      "SEK",
      "NOK",
      "DKK",
      "PLN",
      "CZK",
      "HUF",
      "TRY",
      "ZAR",
      "MXN",
      "SGD",
      "HKD",
      "KRW",
      "CNY",
      "INR",
      "BRL",
      "RUB",
    ]);

    const [base, quote] = symbol.split("/");
    return commonCurrencies.has(base) && commonCurrencies.has(quote);
  }

  private static isCommoditySymbol(symbol: string): boolean {
    const commodityPattern = /^(XAU|XAG|WTI|BCO|XPT|XPD)\/[A-Z]{3}$/;
    return commodityPattern.test(symbol);
  }

  private static isStockSymbol(symbol: string): boolean {
    // First check if it's a commodity symbol (more specific)
    if (this.isCommoditySymbol(symbol)) {
      return false;
    }

    // First check if it's a forex symbol (more specific)
    if (this.isForexSymbol(symbol)) {
      return false;
    }

    // Stock symbols: 1-5 characters for ticker, exactly 3 for quote currency
    const stockPattern = /^[A-Z]{1,5}\/[A-Z]{3}$/;
    if (!stockPattern.test(symbol)) {
      return false;
    }

    // Additional check: quote should be a currency, not a commodity
    const [, quote] = symbol.split("/");
    const commodityQuotes = new Set(["XAU", "XAG", "WTI", "BCO", "XPT", "XPD"]);
    return !commodityQuotes.has(quote);
  }
}
