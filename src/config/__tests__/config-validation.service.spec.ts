import { Test, TestingModule } from "@nestjs/testing";
import { ConfigValidationService, ValidationResult } from "../config-validation.service";
import { ProductionFeedConfiguration } from "../production-feed-config.loader";
import { FeedCategory } from "@/types/feed-category.enum";

describe("ConfigValidationService", () => {
  let service: ConfigValidationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ConfigValidationService],
    }).compile();

    service = module.get<ConfigValidationService>(ConfigValidationService);
  });

  describe("validateConfiguration", () => {
    it("should validate a correct crypto configuration", () => {
      // Arrange
      const config: ProductionFeedConfiguration = {
        feed: { category: FeedCategory.Crypto, name: "BTC/USD" },
        category: FeedCategory.Crypto,
        sources: [
          { exchange: "binance", symbol: "BTC/USDT", priority: 1, weight: 0.4, tier: 1 },
          { exchange: "coinbase", symbol: "BTC/USD", priority: 2, weight: 0.3, tier: 1 },
          { exchange: "kraken", symbol: "XBT/USD", priority: 3, weight: 0.3, tier: 1 },
        ],
      };

      // Act
      const result = service.validateConfiguration(config);

      // Assert
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should validate a correct forex configuration", () => {
      // Arrange
      const config: ProductionFeedConfiguration = {
        feed: { category: FeedCategory.Forex, name: "EUR/USD" },
        category: FeedCategory.Forex,
        sources: [
          { exchange: "oanda", symbol: "EUR/USD", priority: 1, weight: 0.6, tier: 2 },
          { exchange: "fxpro", symbol: "EURUSD", priority: 2, weight: 0.4, tier: 2 },
        ],
      };

      // Act
      const result = service.validateConfiguration(config);

      // Assert
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should fail validation for invalid feed ID", () => {
      // Arrange
      const config: ProductionFeedConfiguration = {
        feed: { category: 999 as FeedCategory, name: "INVALID" },
        category: FeedCategory.Crypto,
        sources: [{ exchange: "binance", symbol: "BTC/USDT", priority: 1, weight: 1.0, tier: 1 }],
      };

      // Act
      const result = service.validateConfiguration(config);

      // Assert
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes("Invalid feed category"))).toBe(true);
      expect(result.errors.some(e => e.includes("BASE/QUOTE format"))).toBe(true);
    });

    it("should fail validation for insufficient sources", () => {
      // Arrange
      const config: ProductionFeedConfiguration = {
        feed: { category: FeedCategory.Crypto, name: "BTC/USD" },
        category: FeedCategory.Crypto,
        sources: [
          { exchange: "binance", symbol: "BTC/USDT", priority: 1, weight: 1.0, tier: 1 },
          // Only 1 source, crypto requires 3
        ],
      };

      // Act
      const result = service.validateConfiguration(config);

      // Assert
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes("requires at least 3 sources"))).toBe(true);
    });

    it("should fail validation for incompatible exchange", () => {
      // Arrange
      const config: ProductionFeedConfiguration = {
        feed: { category: FeedCategory.Crypto, name: "BTC/USD" },
        category: FeedCategory.Crypto,
        sources: [
          { exchange: "binance", symbol: "BTC/USDT", priority: 1, weight: 0.4, tier: 1 },
          { exchange: "coinbase", symbol: "BTC/USD", priority: 2, weight: 0.3, tier: 1 },
          { exchange: "oanda", symbol: "BTC/USD", priority: 3, weight: 0.3, tier: 2 }, // Forex exchange for crypto
        ],
      };

      // Act
      const result = service.validateConfiguration(config);

      // Assert
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes("not compatible with category"))).toBe(true);
    });
  });

  describe("validateFeedId", () => {
    it("should validate correct feed IDs", () => {
      // Test cases for valid feed IDs
      const validFeedIds = [
        { category: FeedCategory.Crypto, name: "BTC/USD" },
        { category: FeedCategory.Forex, name: "EUR/USD" },
        { category: FeedCategory.Commodity, name: "GOLD/USD" },
        { category: FeedCategory.Stock, name: "AAPL/USD" },
      ];

      validFeedIds.forEach(feedId => {
        const config: ProductionFeedConfiguration = {
          feed: feedId,
          category: feedId.category,
          sources: [{ exchange: "binance", symbol: "BTC/USDT", priority: 1, weight: 1.0, tier: 1 }],
        };

        const result = service.validateConfiguration(config);
        expect(result.errors.filter(e => e.includes("Feed name") || e.includes("feed category")).length).toBe(0);
      });
    });

    it("should reject invalid feed ID formats", () => {
      const invalidFeedIds = [
        { category: FeedCategory.Crypto, name: "BTCUSD" }, // Missing separator
        { category: FeedCategory.Crypto, name: "BTC/USD/EUR" }, // Too many separators
        { category: FeedCategory.Crypto, name: "BTC/" }, // Empty quote
        { category: FeedCategory.Crypto, name: "/USD" }, // Empty base
        { category: FeedCategory.Crypto, name: "btc/usd" }, // Lowercase
        { category: FeedCategory.Crypto, name: "BTC-USD" }, // Wrong separator
      ];

      invalidFeedIds.forEach(feedId => {
        const config: ProductionFeedConfiguration = {
          feed: feedId,
          category: feedId.category,
          sources: [{ exchange: "binance", symbol: "BTC/USDT", priority: 1, weight: 1.0, tier: 1 }],
        };

        const result = service.validateConfiguration(config);
        expect(result.isValid).toBe(false);
      });
    });

    it("should warn about long feed names", () => {
      // Arrange
      const config: ProductionFeedConfiguration = {
        feed: { category: FeedCategory.Crypto, name: "VERYLONGCOINNAME/USD" }, // > 21 chars
        category: FeedCategory.Crypto,
        sources: [
          { exchange: "binance", symbol: "BTC/USDT", priority: 1, weight: 0.4, tier: 1 },
          { exchange: "coinbase", symbol: "BTC/USD", priority: 2, weight: 0.3, tier: 1 },
          { exchange: "kraken", symbol: "XBT/USD", priority: 3, weight: 0.3, tier: 1 },
        ],
      };

      // Act
      const result = service.validateConfiguration(config);

      // Assert
      expect(result.warnings.some(w => w.includes("longer than 21 characters"))).toBe(true);
    });
  });

  describe("validateSources", () => {
    it("should validate source fields", () => {
      // Arrange
      const config: ProductionFeedConfiguration = {
        feed: { category: FeedCategory.Crypto, name: "BTC/USD" },
        category: FeedCategory.Crypto,
        sources: [
          { exchange: "binance", symbol: "BTC/USDT", priority: 101, weight: 1.5, tier: 1 }, // Invalid priority and weight
          { exchange: "", symbol: "", priority: 1, weight: 0.3, tier: 1 }, // Empty exchange and symbol
          { exchange: "coinbase", symbol: "INVALID", priority: 1, weight: 0.3, tier: 1 }, // Invalid symbol format
        ],
      };

      // Act
      const result = service.validateConfiguration(config);

      // Assert
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes("priority must be between 1 and 100"))).toBe(true);
      expect(result.errors.some(e => e.includes("weight must be between 0 and 1"))).toBe(true);
      expect(result.errors.some(e => e.includes("exchange is required"))).toBe(true);
      expect(result.errors.some(e => e.includes("symbol is required"))).toBe(true);
      expect(result.errors.some(e => e.includes("invalid symbol format"))).toBe(true);
    });

    it("should warn about duplicate exchanges", () => {
      // Arrange
      const config: ProductionFeedConfiguration = {
        feed: { category: FeedCategory.Crypto, name: "BTC/USD" },
        category: FeedCategory.Crypto,
        sources: [
          { exchange: "binance", symbol: "BTC/USDT", priority: 1, weight: 0.4, tier: 1 },
          { exchange: "binance", symbol: "BTC/USD", priority: 2, weight: 0.3, tier: 1 }, // Duplicate
          { exchange: "kraken", symbol: "XBT/USD", priority: 3, weight: 0.3, tier: 1 },
        ],
      };

      // Act
      const result = service.validateConfiguration(config);

      // Assert
      expect(result.warnings.some(w => w.includes("Duplicate exchanges found"))).toBe(true);
    });

    it("should warn about incorrect weight distribution", () => {
      // Arrange
      const config: ProductionFeedConfiguration = {
        feed: { category: FeedCategory.Crypto, name: "BTC/USD" },
        category: FeedCategory.Crypto,
        sources: [
          { exchange: "binance", symbol: "BTC/USDT", priority: 1, weight: 0.2, tier: 1 },
          { exchange: "coinbase", symbol: "BTC/USD", priority: 2, weight: 0.2, tier: 1 },
          { exchange: "kraken", symbol: "XBT/USD", priority: 3, weight: 0.2, tier: 1 },
          // Total weight = 0.6, should be 1.0
        ],
      };

      // Act
      const result = service.validateConfiguration(config);

      // Assert
      expect(result.warnings.some(w => w.includes("Source weights should sum to 1.0"))).toBe(true);
    });
  });

  describe("checkExchangeCompatibility", () => {
    it("should correctly identify compatible exchanges", () => {
      // Test crypto exchanges
      const cryptoResult = service.checkExchangeCompatibility("binance", FeedCategory.Crypto);
      expect(cryptoResult.isCompatible).toBe(true);
      expect(cryptoResult.issues).toHaveLength(0);

      // Test forex exchanges
      const forexResult = service.checkExchangeCompatibility("oanda", FeedCategory.Forex);
      expect(forexResult.isCompatible).toBe(true);
      expect(forexResult.issues).toHaveLength(0);

      // Test commodity exchanges
      const commodityResult = service.checkExchangeCompatibility("quandl", FeedCategory.Commodity);
      expect(commodityResult.isCompatible).toBe(true);
      expect(commodityResult.issues).toHaveLength(0);

      // Test stock exchanges
      const stockResult = service.checkExchangeCompatibility("alpha-vantage", FeedCategory.Stock);
      expect(stockResult.isCompatible).toBe(true);
      expect(stockResult.issues).toHaveLength(0);
    });

    it("should correctly identify incompatible exchanges", () => {
      // Test forex exchange with crypto category
      const result = service.checkExchangeCompatibility("oanda", FeedCategory.Crypto);
      expect(result.isCompatible).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues[0]).toContain("not in supported crypto exchanges list");
    });
  });

  describe("validateSymbolFormat", () => {
    it("should validate correct symbol formats", () => {
      const validSymbols = ["BTC/USD", "ETH/USDT", "EUR/USD", "GOLD/USD", "AAPL/USD"];

      validSymbols.forEach(symbol => {
        const config: ProductionFeedConfiguration = {
          feed: { category: FeedCategory.Crypto, name: "BTC/USD" },
          category: FeedCategory.Crypto,
          sources: [
            { exchange: "binance", symbol, priority: 1, weight: 0.4, tier: 1 },
            { exchange: "coinbase", symbol: "BTC/USD", priority: 2, weight: 0.3, tier: 1 },
            { exchange: "kraken", symbol: "XBT/USD", priority: 3, weight: 0.3, tier: 1 },
          ],
        };

        const result = service.validateConfiguration(config);
        const symbolErrors = result.errors.filter(e => e.includes("invalid symbol format"));
        expect(symbolErrors).toHaveLength(0);
      });
    });

    it("should reject invalid symbol formats", () => {
      const invalidSymbols = [
        "BTCUSD", // No separator
        "BTC-USD", // Wrong separator
        "BTC/", // Empty quote
        "/USD", // Empty base
        "BTC/USD/EUR", // Too many parts
        "btc/usd", // Lowercase
        "BTC USD", // Space separator
      ];

      invalidSymbols.forEach(symbol => {
        const config: ProductionFeedConfiguration = {
          feed: { category: FeedCategory.Crypto, name: "BTC/USD" },
          category: FeedCategory.Crypto,
          sources: [
            { exchange: "binance", symbol, priority: 1, weight: 0.4, tier: 1 },
            { exchange: "coinbase", symbol: "BTC/USD", priority: 2, weight: 0.3, tier: 1 },
            { exchange: "kraken", symbol: "XBT/USD", priority: 3, weight: 0.3, tier: 1 },
          ],
        };

        const result = service.validateConfiguration(config);
        expect(result.errors.some(e => e.includes("invalid symbol format"))).toBe(true);
      });
    });
  });

  describe("validateConfigurations", () => {
    it("should validate multiple configurations", () => {
      // Arrange
      const configurations: ProductionFeedConfiguration[] = [
        {
          feed: { category: FeedCategory.Crypto, name: "BTC/USD" },
          category: FeedCategory.Crypto,
          sources: [
            { exchange: "binance", symbol: "BTC/USDT", priority: 1, weight: 0.4, tier: 1 },
            { exchange: "coinbase", symbol: "BTC/USD", priority: 2, weight: 0.3, tier: 1 },
            { exchange: "kraken", symbol: "XBT/USD", priority: 3, weight: 0.3, tier: 1 },
          ],
        },
        {
          feed: { category: FeedCategory.Forex, name: "EUR/USD" },
          category: FeedCategory.Forex,
          sources: [
            { exchange: "oanda", symbol: "EUR/USD", priority: 1, weight: 0.6, tier: 2 },
            { exchange: "fxpro", symbol: "EURUSD", priority: 2, weight: 0.4, tier: 2 },
          ],
        },
      ];

      // Act
      const result = service.validateConfigurations(configurations);

      // Assert
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should detect duplicate feed IDs", () => {
      // Arrange
      const configurations: ProductionFeedConfiguration[] = [
        {
          feed: { category: FeedCategory.Crypto, name: "BTC/USD" },
          category: FeedCategory.Crypto,
          sources: [
            { exchange: "binance", symbol: "BTC/USDT", priority: 1, weight: 0.4, tier: 1 },
            { exchange: "coinbase", symbol: "BTC/USD", priority: 2, weight: 0.3, tier: 1 },
            { exchange: "kraken", symbol: "XBT/USD", priority: 3, weight: 0.3, tier: 1 },
          ],
        },
        {
          feed: { category: FeedCategory.Crypto, name: "BTC/USD" }, // Duplicate
          category: FeedCategory.Crypto,
          sources: [
            { exchange: "bitmart", symbol: "BTC/USDT", priority: 1, weight: 0.5, tier: 2 },
            { exchange: "bybit", symbol: "BTC/USDT", priority: 2, weight: 0.3, tier: 2 },
            { exchange: "gate", symbol: "BTC/USDT", priority: 3, weight: 0.2, tier: 2 },
          ],
        },
      ];

      // Act
      const result = service.validateConfigurations(configurations);

      // Assert
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes("Duplicate feed IDs found"))).toBe(true);
    });

    it("should handle empty configurations array", () => {
      // Act
      const result = service.validateConfigurations([]);

      // Assert
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes("No configurations provided"))).toBe(true);
    });
  });

  describe("category-specific requirements", () => {
    it("should provide warnings for crypto feeds without major exchanges", () => {
      // Arrange
      const config: ProductionFeedConfiguration = {
        feed: { category: FeedCategory.Crypto, name: "BTC/USD" },
        category: FeedCategory.Crypto,
        sources: [
          { exchange: "bitmart", symbol: "BTC/USDT", priority: 1, weight: 0.4, tier: 2 },
          { exchange: "bybit", symbol: "BTC/USDT", priority: 2, weight: 0.3, tier: 2 },
          { exchange: "gate", symbol: "BTC/USDT", priority: 3, weight: 0.3, tier: 2 },
        ],
      };

      // Act
      const result = service.validateConfiguration(config);

      // Assert
      expect(result.warnings.some(w => w.includes("should include major exchanges like Binance or Coinbase"))).toBe(
        true
      );
    });

    it("should provide warnings for forex feeds without professional providers", () => {
      // Arrange
      const config: ProductionFeedConfiguration = {
        feed: { category: FeedCategory.Forex, name: "EUR/USD" },
        category: FeedCategory.Forex,
        sources: [
          { exchange: "currencylayer", symbol: "EUR/USD", priority: 1, weight: 0.6, tier: 2 },
          { exchange: "exchangerate-api", symbol: "EURUSD", priority: 2, weight: 0.4, tier: 2 },
        ],
      };

      // Act
      const result = service.validateConfiguration(config);

      // Assert
      expect(result.warnings.some(w => w.includes("should include professional forex providers"))).toBe(true);
    });
  });
});
