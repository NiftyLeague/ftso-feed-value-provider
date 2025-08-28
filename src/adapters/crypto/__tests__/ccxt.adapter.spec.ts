import { CcxtMultiExchangeAdapter, CcxtMultiExchangeConfig } from "../ccxt.adapter";
import { FeedCategory } from "@/types/feed-category.enum";
import { EnhancedFeedId } from "@/types/enhanced-feed-id.types";
import { CcxtFeed } from "@/data-feeds/ccxt-provider-service";
import { Logger } from "@nestjs/common";

// Mock the CcxtFeed
jest.mock("@/data-feeds/ccxt-provider-service");

// Mock NestJS Logger
jest.mock("@nestjs/common", () => ({
  ...jest.requireActual("@nestjs/common"),
  Logger: jest.fn().mockImplementation(() => ({
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
}));

describe("CcxtMultiExchangeAdapter", () => {
  let adapter: CcxtMultiExchangeAdapter;
  let mockCcxtFeed: jest.Mocked<CcxtFeed>;
  let loggerErrorSpy: jest.SpyInstance;

  const testFeedId: EnhancedFeedId = {
    category: FeedCategory.Crypto,
    name: "BTC/USD",
  };

  const usdtFeedId: EnhancedFeedId = {
    category: FeedCategory.Crypto,
    name: "USDT/USD",
  };

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Create mock CCXT feed
    mockCcxtFeed = {
      start: jest.fn().mockResolvedValue(undefined),
      getValue: jest.fn(),
      getValues: jest.fn(),
      getVolumes: jest.fn(),
    } as any;

    // Mock the CcxtFeed constructor
    (CcxtFeed as jest.MockedClass<typeof CcxtFeed>).mockImplementation(() => mockCcxtFeed);

    adapter = new CcxtMultiExchangeAdapter();

    // Suppress logger errors for cleaner test output
    loggerErrorSpy = jest.spyOn((adapter as any).logger, "error").mockImplementation();
  });

  afterEach(() => {
    // Restore logger after each test
    if (loggerErrorSpy) {
      loggerErrorSpy.mockRestore();
    }
  });

  describe("initialization", () => {
    it("should initialize with correct properties", () => {
      expect(adapter.exchangeName).toBe("ccxt-multi-exchange");
      expect(adapter.category).toBe(FeedCategory.Crypto);
      expect(adapter.capabilities.supportsWebSocket).toBe(true);
      expect(adapter.capabilities.supportsREST).toBe(true);
      expect(adapter.capabilities.supportsVolume).toBe(true);
    });

    it("should initialize with default configuration", () => {
      const config = adapter.getConfig();
      expect(config.tradesLimit).toBe(1000);
      expect(config.lambda).toBe(0.00005);
      expect(config.retryBackoffMs).toBe(10000);
      expect(config.enableUsdtConversion).toBe(true);
      expect(config.tier1Exchanges).toEqual(["binance", "coinbase", "kraken", "okx", "cryptocom"]);
    });

    it("should initialize with custom configuration", () => {
      const customConfig: CcxtMultiExchangeConfig = {
        tradesLimit: 2000,
        lambda: 0.0001,
        retryBackoffMs: 20000,
        enableUsdtConversion: false,
        tier1Exchanges: ["binance", "coinbase"],
      };

      const customAdapter = new CcxtMultiExchangeAdapter(customConfig);
      const config = customAdapter.getConfig();

      expect(config.tradesLimit).toBe(2000);
      expect(config.lambda).toBe(0.0001);
      expect(config.retryBackoffMs).toBe(20000);
      expect(config.enableUsdtConversion).toBe(false);
      expect(config.tier1Exchanges).toEqual(["binance", "coinbase"]);
    });
  });

  describe("connection management", () => {
    it("should connect successfully", async () => {
      mockCcxtFeed.start.mockResolvedValue(undefined);

      await adapter.connect();

      expect(mockCcxtFeed.start).toHaveBeenCalledTimes(1);
      expect(adapter.isConnected()).toBe(true);
    });

    it("should handle connection errors", async () => {
      const error = new Error("Connection failed");
      mockCcxtFeed.start.mockRejectedValue(error);

      await expect(adapter.connect()).rejects.toThrow("Connection failed");
      expect(adapter.isConnected()).toBe(false);
    });

    it("should not reconnect if already connected", async () => {
      mockCcxtFeed.start.mockResolvedValue(undefined);

      await adapter.connect();
      await adapter.connect(); // Second call

      expect(mockCcxtFeed.start).toHaveBeenCalledTimes(1);
    });

    it("should disconnect properly", async () => {
      await adapter.connect();
      expect(adapter.isConnected()).toBe(true);

      await adapter.disconnect();
      expect(adapter.isConnected()).toBe(false);
    });
  });

  describe("data normalization", () => {
    it("should normalize price data correctly", () => {
      const rawData = {
        feedId: testFeedId,
        price: 50000,
        timestamp: Date.now(),
      };

      const result = adapter.normalizePriceData(rawData);

      expect(result.symbol).toBe("BTC/USD");
      expect(result.price).toBe(50000);
      expect(result.source).toBe("ccxt-multi-exchange");
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it("should normalize volume data correctly", () => {
      const rawData = {
        feedId: testFeedId,
        volume: 1000,
        timestamp: Date.now(),
      };

      const result = adapter.normalizeVolumeData(rawData);

      expect(result.symbol).toBe("BTC/USD");
      expect(result.volume).toBe(1000);
      expect(result.source).toBe("ccxt-multi-exchange");
    });
  });

  describe("response validation", () => {
    it("should validate correct data", () => {
      const validData = {
        feedId: testFeedId,
        price: 50000,
      };

      expect(adapter.validateResponse(validData)).toBe(true);
    });

    it("should reject invalid data", () => {
      expect(adapter.validateResponse(null)).toBe(false);
      expect(adapter.validateResponse({})).toBe(false);
      expect(adapter.validateResponse({ feedId: testFeedId })).toBe(false);
      expect(adapter.validateResponse({ price: 50000 })).toBe(false);
      expect(adapter.validateResponse({ feedId: testFeedId, price: "invalid" })).toBe(false);
      expect(adapter.validateResponse({ feedId: testFeedId, price: -100 })).toBe(false);
      expect(adapter.validateResponse({ feedId: testFeedId, price: NaN })).toBe(false);
    });
  });

  describe("CCXT price extraction functionality", () => {
    beforeEach(async () => {
      mockCcxtFeed.start.mockResolvedValue(undefined);
      await adapter.connect();
    });

    it("should extract price from CCXT successfully", async () => {
      const mockFeedValue = {
        feed: testFeedId,
        value: 50000,
      };

      mockCcxtFeed.getValue.mockResolvedValue(mockFeedValue);

      const result = await adapter.getCcxtPrice(testFeedId);

      expect(result.symbol).toBe("BTC/USD");
      expect(result.price).toBe(50000);
      expect(result.source).toBe("ccxt-multi-exchange");
      expect(mockCcxtFeed.getValue).toHaveBeenCalledWith({
        category: testFeedId.category,
        name: testFeedId.name,
      });
    });

    it("should handle CCXT price extraction errors", async () => {
      mockCcxtFeed.getValue.mockRejectedValue(new Error("CCXT error"));

      await expect(adapter.getCcxtPrice(testFeedId)).rejects.toThrow("CCXT price extraction failed");
    });

    it("should handle missing price data", async () => {
      mockCcxtFeed.getValue.mockResolvedValue({ feed: testFeedId, value: undefined });

      await expect(adapter.getCcxtPrice(testFeedId)).rejects.toThrow("No price data available");
    });

    it("should update metrics on successful extraction", async () => {
      const mockFeedValue = {
        feed: testFeedId,
        value: 50000,
      };

      mockCcxtFeed.getValue.mockResolvedValue(mockFeedValue);

      await adapter.getCcxtPrice(testFeedId);

      const metrics = adapter.getMetrics();
      expect(metrics.priceExtractionCount).toBe(1);
      expect(metrics.successfulExtractions).toBe(1);
      expect(metrics.failedExtractions).toBe(0);
      expect(metrics.averageExtractionTime).toBeGreaterThanOrEqual(0);
    });

    it("should update metrics on failed extraction", async () => {
      mockCcxtFeed.getValue.mockRejectedValue(new Error("CCXT error"));

      try {
        await adapter.getCcxtPrice(testFeedId);
      } catch {
        // Expected to fail
      }

      const metrics = adapter.getMetrics();
      expect(metrics.priceExtractionCount).toBe(1);
      expect(metrics.successfulExtractions).toBe(0);
      expect(metrics.failedExtractions).toBe(1);
    });
  });

  describe("volume extraction functionality", () => {
    beforeEach(async () => {
      mockCcxtFeed.start.mockResolvedValue(undefined);
      await adapter.connect();
    });

    it("should extract volume data successfully", async () => {
      const mockVolumeData = [
        {
          feed: testFeedId,
          volumes: [
            { exchange: "binance", volume: 500 },
            { exchange: "coinbase", volume: 300 },
          ],
        },
      ];

      mockCcxtFeed.getVolumes.mockResolvedValue(mockVolumeData);

      const result = await adapter.getVolumeData(testFeedId, 3600);

      expect(result.symbol).toBe("BTC/USD");
      expect(result.volume).toBe(800); // 500 + 300
      expect(result.source).toBe("ccxt-multi-exchange");
      expect(mockCcxtFeed.getVolumes).toHaveBeenCalledWith(
        [
          {
            category: testFeedId.category,
            name: testFeedId.name,
          },
        ],
        3600
      );
    });

    it("should handle volume extraction errors", async () => {
      mockCcxtFeed.getVolumes.mockRejectedValue(new Error("Volume error"));

      await expect(adapter.getVolumeData(testFeedId, 3600)).rejects.toThrow("CCXT volume extraction failed");
    });
  });

  describe("USDT conversion functionality", () => {
    beforeEach(async () => {
      mockCcxtFeed.start.mockResolvedValue(undefined);
      await adapter.connect();
    });

    it("should convert USDT to USD", async () => {
      const mockUsdtValue = {
        feed: usdtFeedId,
        value: 0.999,
      };

      mockCcxtFeed.getValue.mockResolvedValue(mockUsdtValue);

      const result = await adapter.convertUsdtToUsd(1000);

      expect(result).toBe(999); // 1000 * 0.999
    });

    it("should handle USDT conversion errors gracefully", async () => {
      mockCcxtFeed.getValue.mockRejectedValue(new Error("USDT conversion error"));

      const result = await adapter.convertUsdtToUsd(1000);

      expect(result).toBe(1000); // Should return original price
    });

    it("should skip conversion when disabled", async () => {
      const configWithoutConversion: CcxtMultiExchangeConfig = {
        enableUsdtConversion: false,
      };

      const adapterWithoutConversion = new CcxtMultiExchangeAdapter(configWithoutConversion);

      const result = await adapterWithoutConversion.convertUsdtToUsd(1000);

      expect(result).toBe(1000);
      expect(mockCcxtFeed.getValue).not.toHaveBeenCalled();
    });

    it("should check USDT feed availability", async () => {
      const mockUsdtValue = {
        feed: usdtFeedId,
        value: 0.999,
      };

      mockCcxtFeed.getValue.mockResolvedValue(mockUsdtValue);

      const isAvailable = await adapter.ensureUsdtFeedAvailable();

      expect(isAvailable).toBe(true);
    });

    it("should handle USDT feed unavailability", async () => {
      mockCcxtFeed.getValue.mockRejectedValue(new Error("USDT not available"));

      const isAvailable = await adapter.ensureUsdtFeedAvailable();

      expect(isAvailable).toBe(false);
    });
  });

  describe("health check", () => {
    it("should return false when not initialized", async () => {
      const isHealthy = await adapter.healthCheck();
      expect(isHealthy).toBe(false);
    });

    it("should return true when healthy", async () => {
      mockCcxtFeed.start.mockResolvedValue(undefined);
      await adapter.connect();

      const mockFeedValue = {
        feed: { category: FeedCategory.Crypto, name: "BTC/USD" },
        value: 50000,
      };

      mockCcxtFeed.getValue.mockResolvedValue(mockFeedValue);

      const isHealthy = await adapter.healthCheck();
      expect(isHealthy).toBe(true);
    });

    it("should return false when unhealthy", async () => {
      mockCcxtFeed.start.mockResolvedValue(undefined);
      await adapter.connect();

      mockCcxtFeed.getValue.mockRejectedValue(new Error("Health check failed"));

      const isHealthy = await adapter.healthCheck();
      expect(isHealthy).toBe(false);
    });
  });

  describe("metrics management", () => {
    it("should reset metrics", () => {
      const metrics = adapter.getMetrics();
      // Simulate some activity by directly modifying (for testing purposes)
      (metrics as any).priceExtractionCount = 5;
      (metrics as any).successfulExtractions = 3;
      (metrics as any).failedExtractions = 2;

      adapter.resetMetrics();

      const resetMetrics = adapter.getMetrics();
      expect(resetMetrics.priceExtractionCount).toBe(0);
      expect(resetMetrics.successfulExtractions).toBe(0);
      expect(resetMetrics.failedExtractions).toBe(0);
      expect(resetMetrics.averageExtractionTime).toBe(0);
    });
  });

  describe("individual price extraction", () => {
    beforeEach(async () => {
      mockCcxtFeed.start.mockResolvedValue(undefined);
      await adapter.connect();
    });

    it("should extract individual exchange prices from CCXT latestPrice Map", async () => {
      // Mock the latestPrice Map structure
      const mockLatestPriceMap = new Map();
      const mockBtcPrices = new Map();
      mockBtcPrices.set("binance", { value: 50000, time: Date.now(), exchange: "binance" });
      mockBtcPrices.set("bitmart", { value: 50100, time: Date.now(), exchange: "bitmart" });
      mockBtcPrices.set("bybit", { value: 49950, time: Date.now(), exchange: "bybit" });
      mockLatestPriceMap.set("BTC/USD", mockBtcPrices);

      // Mock access to private latestPrice property
      (adapter as any).ccxtFeed.latestPrice = mockLatestPriceMap;

      const individualPrices = await adapter.getIndividualPrices(testFeedId);

      expect(individualPrices).toHaveLength(3);
      expect(individualPrices[0].exchange).toBe("binance");
      expect(individualPrices[0].price).toBe(50000);
      expect(individualPrices[1].exchange).toBe("bitmart");
      expect(individualPrices[1].price).toBe(50100);
      expect(individualPrices[2].exchange).toBe("bybit");
      expect(individualPrices[2].price).toBe(49950);

      // All should have confidence scores
      individualPrices.forEach(price => {
        expect(price.confidence).toBeGreaterThan(0);
        expect(price.confidence).toBeLessThanOrEqual(1);
      });
    });

    it("should handle empty latestPrice Map", async () => {
      const mockLatestPriceMap = new Map();
      (adapter as any).ccxtFeed.latestPrice = mockLatestPriceMap;

      const individualPrices = await adapter.getIndividualPrices(testFeedId);

      expect(individualPrices).toHaveLength(0);
    });

    it("should handle USDT to USD conversion for individual prices", async () => {
      const mockLatestPriceMap = new Map();

      // Mock BTC/USD prices (direct USD prices)
      const mockBtcUsdPrices = new Map();
      mockBtcUsdPrices.set("binance", { value: 50000, time: Date.now(), exchange: "binance" });
      mockLatestPriceMap.set("BTC/USD", mockBtcUsdPrices);

      // Mock USDT prices for conversion
      const mockBtcUsdtPrices = new Map();
      mockBtcUsdtPrices.set("binance", { value: 50000, time: Date.now(), exchange: "binance" });
      mockLatestPriceMap.set("BTC/USDT", mockBtcUsdtPrices);

      // Mock USDT/USD rate
      const mockUsdtUsdPrices = new Map();
      mockUsdtUsdPrices.set("binance", { value: 0.999, time: Date.now(), exchange: "binance" });
      mockLatestPriceMap.set("USDT/USD", mockUsdtUsdPrices);

      (adapter as any).ccxtFeed.latestPrice = mockLatestPriceMap;

      // Mock the USDT/USD extraction
      const mockUsdtValue = { feed: usdtFeedId, value: 0.999 };
      mockCcxtFeed.getValue.mockResolvedValue(mockUsdtValue);

      const btcUsdFeedId: EnhancedFeedId = {
        category: FeedCategory.Crypto,
        name: "BTC/USD",
      };

      const individualPrices = await adapter.getIndividualPrices(btcUsdFeedId);

      expect(individualPrices).toHaveLength(1);
      expect(individualPrices[0].price).toBe(50000); // Direct USD price, no conversion needed
    });
  });

  describe("Tier 2 data source functionality", () => {
    beforeEach(async () => {
      mockCcxtFeed.start.mockResolvedValue(undefined);
      await adapter.connect();
    });

    it("should filter out Tier 1 exchanges and return only Tier 2 prices", async () => {
      const mockLatestPriceMap = new Map();
      const mockBtcPrices = new Map();

      // Mix of Tier 1 and Tier 2 exchanges
      mockBtcPrices.set("binance", { value: 50000, time: Date.now(), exchange: "binance" }); // Tier 1
      mockBtcPrices.set("coinbase", { value: 50050, time: Date.now(), exchange: "coinbase" }); // Tier 1
      mockBtcPrices.set("bitmart", { value: 50100, time: Date.now(), exchange: "bitmart" }); // Tier 2
      mockBtcPrices.set("bybit", { value: 49950, time: Date.now(), exchange: "bybit" }); // Tier 2
      mockBtcPrices.set("gate", { value: 50025, time: Date.now(), exchange: "gate" }); // Tier 2

      mockLatestPriceMap.set("BTC/USD", mockBtcPrices);
      (adapter as any).ccxtFeed.latestPrice = mockLatestPriceMap;

      const tier2Prices = await adapter.getTier2Prices(testFeedId);

      expect(tier2Prices).toHaveLength(3); // Only Tier 2 exchanges
      const exchangeNames = tier2Prices.map(p => p.exchange);
      expect(exchangeNames).toContain("bitmart");
      expect(exchangeNames).toContain("bybit");
      expect(exchangeNames).toContain("gate");
      expect(exchangeNames).not.toContain("binance");
      expect(exchangeNames).not.toContain("coinbase");
    });

    it("should check if adapter can provide Tier 2 data", async () => {
      const mockLatestPriceMap = new Map();
      const mockBtcPrices = new Map();
      mockBtcPrices.set("bitmart", { value: 50100, time: Date.now(), exchange: "bitmart" });
      mockLatestPriceMap.set("BTC/USD", mockBtcPrices);
      (adapter as any).ccxtFeed.latestPrice = mockLatestPriceMap;

      const canProvide = adapter.canProvideTier2Data(testFeedId);
      expect(canProvide).toBe(true);
    });

    it("should return false for non-crypto feeds", async () => {
      const forexFeedId: EnhancedFeedId = {
        category: FeedCategory.Forex,
        name: "EUR/USD",
      };

      const canProvide = adapter.canProvideTier2Data(forexFeedId);
      expect(canProvide).toBe(false);
    });

    it("should get available Tier 2 exchanges", async () => {
      const mockLatestPriceMap = new Map();
      const mockBtcPrices = new Map();
      mockBtcPrices.set("binance", { value: 50000, time: Date.now(), exchange: "binance" }); // Tier 1
      mockBtcPrices.set("bitmart", { value: 50100, time: Date.now(), exchange: "bitmart" }); // Tier 2
      mockBtcPrices.set("bybit", { value: 49950, time: Date.now(), exchange: "bybit" }); // Tier 2
      mockLatestPriceMap.set("BTC/USD", mockBtcPrices);
      (adapter as any).ccxtFeed.latestPrice = mockLatestPriceMap;

      const tier2Exchanges = adapter.getAvailableTier2Exchanges(testFeedId);

      expect(tier2Exchanges).toHaveLength(2);
      expect(tier2Exchanges).toContain("bitmart");
      expect(tier2Exchanges).toContain("bybit");
      expect(tier2Exchanges).not.toContain("binance");
    });
  });

  describe("individual USDT conversion", () => {
    beforeEach(async () => {
      mockCcxtFeed.start.mockResolvedValue(undefined);
      await adapter.connect();
    });

    it("should convert individual USDT prices to USD", async () => {
      const usdtPrices = [
        { exchange: "bitmart", price: 50000, timestamp: Date.now(), confidence: 0.9 },
        { exchange: "bybit", price: 50100, timestamp: Date.now(), confidence: 0.85 },
      ];

      // Mock USDT/USD rate
      const mockUsdtValue = { feed: usdtFeedId, value: 0.999 };
      mockCcxtFeed.getValue.mockResolvedValue(mockUsdtValue);

      const convertedPrices = await adapter.convertIndividualUsdtPrices(usdtPrices, "BTC/USD");

      expect(convertedPrices).toHaveLength(2);
      expect(convertedPrices[0].price).toBeCloseTo(49950); // 50000 * 0.999
      expect(convertedPrices[1].price).toBeCloseTo(50049.9); // 50100 * 0.999
      expect(convertedPrices[0].exchange).toBe("bitmart");
      expect(convertedPrices[1].exchange).toBe("bybit");
    });

    it("should handle conversion errors gracefully", async () => {
      const usdtPrices = [{ exchange: "bitmart", price: 50000, timestamp: Date.now(), confidence: 0.9 }];

      mockCcxtFeed.getValue.mockRejectedValue(new Error("USDT rate unavailable"));

      const convertedPrices = await adapter.convertIndividualUsdtPrices(usdtPrices, "BTC/USD");

      expect(convertedPrices).toHaveLength(1);
      expect(convertedPrices[0].price).toBe(50000); // Original price unchanged
    });
  });

  describe("configuration management", () => {
    it("should update configuration", () => {
      const newConfig: Partial<CcxtMultiExchangeConfig> = {
        tradesLimit: 3000,
        lambda: 0.0002,
      };

      adapter.updateConfig(newConfig);

      const config = adapter.getConfig();
      expect(config.tradesLimit).toBe(3000);
      expect(config.lambda).toBe(0.0002);
      // Other values should remain unchanged
      expect(config.retryBackoffMs).toBe(10000);
    });
  });

  describe("subscription methods", () => {
    it("should handle subscribe gracefully", async () => {
      // Should not throw, just log
      await expect(adapter.subscribe(["BTC/USD", "ETH/USD"])).resolves.toBeUndefined();
    });

    it("should handle unsubscribe gracefully", async () => {
      // Should not throw, just log
      await expect(adapter.unsubscribe(["BTC/USD", "ETH/USD"])).resolves.toBeUndefined();
    });

    it("should handle price update callback gracefully", () => {
      const callback = jest.fn();
      // Should not throw, just log
      expect(() => adapter.onPriceUpdate(callback)).not.toThrow();
    });

    it("should handle connection change callback gracefully", () => {
      const callback = jest.fn();
      // Should not throw, just log
      expect(() => adapter.onConnectionChange(callback)).not.toThrow();
    });
  });
});
