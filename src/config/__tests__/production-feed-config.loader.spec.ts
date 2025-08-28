import { Test, TestingModule } from "@nestjs/testing";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import { ProductionFeedConfigLoader, ProductionFeedConfiguration } from "../production-feed-config.loader";
import { ConfigValidationService } from "../config-validation.service";
import { FeedCategory } from "@/types/feed-category.enum";

describe("ProductionFeedConfigLoader", () => {
  let loader: ProductionFeedConfigLoader;
  let validationService: ConfigValidationService;
  let testConfigPath: string;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProductionFeedConfigLoader, ConfigValidationService],
    }).compile();

    loader = module.get<ProductionFeedConfigLoader>(ProductionFeedConfigLoader);
    validationService = module.get<ConfigValidationService>(ConfigValidationService);
    testConfigPath = join(__dirname, "test-feeds.json");
  });

  afterEach(() => {
    // Clean up test files
    if (existsSync(testConfigPath)) {
      unlinkSync(testConfigPath);
    }
  });

  describe("loadFeedConfigurations", () => {
    it("should load valid feed configurations successfully", async () => {
      // Arrange
      const testConfig = [
        {
          feed: { category: 1, name: "BTC/USD" },
          sources: [
            { exchange: "binance", symbol: "BTC/USDT" },
            { exchange: "coinbase", symbol: "BTC/USD" },
            { exchange: "kraken", symbol: "XBT/USD" },
          ],
        },
        {
          feed: { category: 2, name: "EUR/USD" },
          sources: [
            { exchange: "oanda", symbol: "EUR/USD" },
            { exchange: "fxpro", symbol: "EURUSD" },
          ],
        },
      ];

      writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));

      // Act
      const configurations = await loader.loadFeedConfigurations(testConfigPath);

      // Assert
      expect(configurations).toHaveLength(2);

      const btcConfig = configurations.find(c => c.feed.name === "BTC/USD");
      expect(btcConfig).toBeDefined();
      expect(btcConfig!.category).toBe(FeedCategory.Crypto);
      expect(btcConfig!.sources).toHaveLength(3);
      expect(btcConfig!.sources[0].tier).toBe(1); // Binance is Tier 1
      expect(btcConfig!.sources[0].weight).toBeGreaterThan(0);

      const eurConfig = configurations.find(c => c.feed.name === "EUR/USD");
      expect(eurConfig).toBeDefined();
      expect(eurConfig!.category).toBe(FeedCategory.Forex);
      expect(eurConfig!.sources).toHaveLength(2);
    });

    it("should throw error for invalid JSON", async () => {
      // Arrange
      writeFileSync(testConfigPath, "invalid json");

      // Act & Assert
      await expect(loader.loadFeedConfigurations(testConfigPath)).rejects.toThrow();
    });

    it("should throw error for non-array configuration", async () => {
      // Arrange
      writeFileSync(testConfigPath, JSON.stringify({ invalid: "config" }));

      // Act & Assert
      await expect(loader.loadFeedConfigurations(testConfigPath)).rejects.toThrow(
        "Feed configuration must be an array"
      );
    });

    it("should throw error for missing required fields", async () => {
      // Arrange
      const testConfig = [
        {
          feed: { category: 1, name: "BTC/USD" },
          // Missing sources
        },
      ];

      writeFileSync(testConfigPath, JSON.stringify(testConfig));

      // Act & Assert
      await expect(loader.loadFeedConfigurations(testConfigPath)).rejects.toThrow();
    });

    it("should throw error for invalid feed category", async () => {
      // Arrange
      const testConfig = [
        {
          feed: { category: 999, name: "BTC/USD" },
          sources: [{ exchange: "binance", symbol: "BTC/USDT" }],
        },
      ];

      writeFileSync(testConfigPath, JSON.stringify(testConfig));

      // Act & Assert
      await expect(loader.loadFeedConfigurations(testConfigPath)).rejects.toThrow("Invalid feed ID");
    });

    it("should throw error for insufficient sources", async () => {
      // Arrange
      const testConfig = [
        {
          feed: { category: 1, name: "BTC/USD" },
          sources: [
            { exchange: "binance", symbol: "BTC/USDT" },
            // Only 1 source, but crypto requires 3
          ],
        },
      ];

      writeFileSync(testConfigPath, JSON.stringify(testConfig));

      // Act & Assert
      await expect(loader.loadFeedConfigurations(testConfigPath)).rejects.toThrow("requires at least 3 sources");
    });

    it("should throw error for unsupported exchange", async () => {
      // Arrange
      const testConfig = [
        {
          feed: { category: 1, name: "BTC/USD" },
          sources: [
            { exchange: "binance", symbol: "BTC/USDT" },
            { exchange: "coinbase", symbol: "BTC/USD" },
            { exchange: "unsupported-exchange", symbol: "BTC/USD" },
          ],
        },
      ];

      writeFileSync(testConfigPath, JSON.stringify(testConfig));

      // Act & Assert
      await expect(loader.loadFeedConfigurations(testConfigPath)).rejects.toThrow("is not supported for category");
    });
  });

  describe("validateAndEnhance", () => {
    it("should enhance sources with default values", async () => {
      // Arrange
      const testConfig = [
        {
          feed: { category: 1, name: "BTC/USD" },
          sources: [
            { exchange: "binance", symbol: "BTC/USDT" },
            { exchange: "coinbase", symbol: "BTC/USD" },
            { exchange: "kraken", symbol: "XBT/USD" },
          ],
        },
      ];

      writeFileSync(testConfigPath, JSON.stringify(testConfig));

      // Act
      const configurations = await loader.loadFeedConfigurations(testConfigPath);

      // Assert
      const config = configurations[0];
      expect(config.sources[0].priority).toBeDefined();
      expect(config.sources[0].weight).toBeDefined();
      expect(config.sources[0].tier).toBe(1); // Binance is Tier 1
      expect(config.sources[0].rateLimit).toBeDefined();
      expect(config.validation).toBeDefined();
      expect(config.aggregation).toBeDefined();
      expect(config.monitoring).toBeDefined();
    });

    it("should preserve custom values when provided", async () => {
      // Arrange
      const testConfig = [
        {
          feed: { category: 1, name: "BTC/USD" },
          sources: [
            {
              exchange: "binance",
              symbol: "BTC/USDT",
              priority: 5,
              weight: 0.5,
              rateLimit: 2000,
            },
            { exchange: "coinbase", symbol: "BTC/USD" },
            { exchange: "kraken", symbol: "XBT/USD" },
          ],
        },
      ];

      writeFileSync(testConfigPath, JSON.stringify(testConfig));

      // Act
      const configurations = await loader.loadFeedConfigurations(testConfigPath);

      // Assert
      const config = configurations[0];
      expect(config.sources[0].priority).toBe(5);
      expect(config.sources[0].weight).toBe(0.5);
      expect(config.sources[0].rateLimit).toBe(2000);
    });
  });

  describe("tier assignment", () => {
    it("should assign Tier 1 to custom adapter exchanges", async () => {
      // Arrange
      const testConfig = [
        {
          feed: { category: 1, name: "BTC/USD" },
          sources: [
            { exchange: "binance", symbol: "BTC/USDT" },
            { exchange: "coinbase", symbol: "BTC/USD" },
            { exchange: "kraken", symbol: "XBT/USD" },
          ],
        },
      ];

      writeFileSync(testConfigPath, JSON.stringify(testConfig));

      // Act
      const configurations = await loader.loadFeedConfigurations(testConfigPath);

      // Assert
      const config = configurations[0];
      config.sources.forEach(source => {
        expect(source.tier).toBe(1);
      });
    });

    it("should assign Tier 2 to CCXT exchanges", async () => {
      // Arrange
      const testConfig = [
        {
          feed: { category: 1, name: "BTC/USD" },
          sources: [
            { exchange: "binance", symbol: "BTC/USDT" },
            { exchange: "coinbase", symbol: "BTC/USD" },
            { exchange: "bitmart", symbol: "BTC/USDT" }, // Tier 2
          ],
        },
      ];

      writeFileSync(testConfigPath, JSON.stringify(testConfig));

      // Act
      const configurations = await loader.loadFeedConfigurations(testConfigPath);

      // Assert
      const config = configurations[0];
      expect(config.sources[0].tier).toBe(1); // binance
      expect(config.sources[1].tier).toBe(1); // coinbase
      expect(config.sources[2].tier).toBe(2); // bitmart
    });
  });

  describe("category-specific validation", () => {
    it("should validate crypto category requirements", async () => {
      // Arrange
      const testConfig = [
        {
          feed: { category: 1, name: "BTC/USD" },
          sources: [
            { exchange: "binance", symbol: "BTC/USDT" },
            { exchange: "coinbase", symbol: "BTC/USD" },
            { exchange: "kraken", symbol: "XBT/USD" },
          ],
        },
      ];

      writeFileSync(testConfigPath, JSON.stringify(testConfig));

      // Act
      const configurations = await loader.loadFeedConfigurations(testConfigPath);

      // Assert
      const config = configurations[0];
      expect(config.category).toBe(FeedCategory.Crypto);
      expect(config.validation!.maxAge).toBe(2000); // 2 seconds for crypto
      expect(config.validation!.outlierThreshold).toBe(0.005); // 0.5% for crypto
    });

    it("should validate forex category requirements", async () => {
      // Arrange
      const testConfig = [
        {
          feed: { category: 2, name: "EUR/USD" },
          sources: [
            { exchange: "oanda", symbol: "EUR/USD" },
            { exchange: "fxpro", symbol: "EURUSD" },
          ],
        },
      ];

      writeFileSync(testConfigPath, JSON.stringify(testConfig));

      // Act
      const configurations = await loader.loadFeedConfigurations(testConfigPath);

      // Assert
      const config = configurations[0];
      expect(config.category).toBe(FeedCategory.Forex);
      expect(config.validation!.maxAge).toBe(5000); // 5 seconds for forex
      expect(config.validation!.outlierThreshold).toBe(0.001); // 0.1% for forex
    });
  });

  describe("adapter mapping", () => {
    it("should provide correct adapter mappings", () => {
      // Act & Assert
      expect(loader.getAdapterMapping("binance")).toBe("BinanceAdapter");
      expect(loader.getAdapterMapping("coinbase")).toBe("CoinbaseAdapter");
      expect(loader.getAdapterMapping("bitmart")).toBe("CcxtIndividualAdapter");
      expect(loader.getAdapterMapping("oanda")).toBe("OandaAdapter");
      expect(loader.getAdapterMapping("unknown")).toBeUndefined();
    });
  });

  describe("configuration retrieval", () => {
    beforeEach(async () => {
      const testConfig = [
        {
          feed: { category: 1, name: "BTC/USD" },
          sources: [
            { exchange: "binance", symbol: "BTC/USDT" },
            { exchange: "coinbase", symbol: "BTC/USD" },
            { exchange: "kraken", symbol: "XBT/USD" },
          ],
        },
        {
          feed: { category: 2, name: "EUR/USD" },
          sources: [
            { exchange: "oanda", symbol: "EUR/USD" },
            { exchange: "fxpro", symbol: "EURUSD" },
          ],
        },
      ];

      writeFileSync(testConfigPath, JSON.stringify(testConfig));
      await loader.loadFeedConfigurations(testConfigPath);
    });

    it("should get configurations by category", () => {
      // Act
      const cryptoConfigs = loader.getConfigurationsByCategory(FeedCategory.Crypto);
      const forexConfigs = loader.getConfigurationsByCategory(FeedCategory.Forex);

      // Assert
      expect(cryptoConfigs).toHaveLength(1);
      expect(cryptoConfigs[0].feed.name).toBe("BTC/USD");
      expect(forexConfigs).toHaveLength(1);
      expect(forexConfigs[0].feed.name).toBe("EUR/USD");
    });

    it("should get configuration by feed ID", () => {
      // Act
      const btcConfig = loader.getConfigurationByFeedId({ category: FeedCategory.Crypto, name: "BTC/USD" });
      const eurConfig = loader.getConfigurationByFeedId({ category: FeedCategory.Forex, name: "EUR/USD" });
      const nonExistent = loader.getConfigurationByFeedId({ category: FeedCategory.Crypto, name: "ETH/USD" });

      // Assert
      expect(btcConfig).toBeDefined();
      expect(btcConfig!.feed.name).toBe("BTC/USD");
      expect(eurConfig).toBeDefined();
      expect(eurConfig!.feed.name).toBe("EUR/USD");
      expect(nonExistent).toBeUndefined();
    });

    it("should get all configurations", () => {
      // Act
      const allConfigs = loader.getAllConfigurations();

      // Assert
      expect(allConfigs).toHaveLength(2);
    });
  });

  describe("hot reload", () => {
    it("should reload configurations successfully", async () => {
      // Arrange
      const initialConfig = [
        {
          feed: { category: 1, name: "BTC/USD" },
          sources: [
            { exchange: "binance", symbol: "BTC/USDT" },
            { exchange: "coinbase", symbol: "BTC/USD" },
            { exchange: "kraken", symbol: "XBT/USD" },
          ],
        },
      ];

      writeFileSync(testConfigPath, JSON.stringify(initialConfig));
      await loader.loadFeedConfigurations(testConfigPath);

      expect(loader.getAllConfigurations()).toHaveLength(1);

      // Update configuration
      const updatedConfig = [
        ...initialConfig,
        {
          feed: { category: 2, name: "EUR/USD" },
          sources: [
            { exchange: "oanda", symbol: "EUR/USD" },
            { exchange: "fxpro", symbol: "EURUSD" },
          ],
        },
      ];

      writeFileSync(testConfigPath, JSON.stringify(updatedConfig));

      // Act
      const reloadedConfigs = await loader.reloadConfigurations(testConfigPath);

      // Assert
      expect(reloadedConfigs).toHaveLength(2);
      expect(loader.getAllConfigurations()).toHaveLength(2);
    });
  });
});
