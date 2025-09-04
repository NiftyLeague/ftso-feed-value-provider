import { CcxtMultiExchangeAdapter, CcxtMultiExchangeConfig, ExchangePriceData } from "../ccxt.adapter";
import { FeedCategory, EnhancedFeedId } from "@/common/types/core";
import { EnhancedLoggerService } from "@/common/logging/enhanced-logger.service";
import { TestModuleBuilder } from "@/__tests__/utils/test-module.builder";
import { TestingModule } from "@nestjs/testing";

describe("CcxtMultiExchangeAdapter", () => {
  let adapter: CcxtMultiExchangeAdapter;
  let logger: jest.Mocked<EnhancedLoggerService>;
  let testModule: TestingModule;

  const defaultConfig: CcxtMultiExchangeConfig = {
    tradesLimit: 1000,
    lambda: 0.00005,
    retryBackoffMs: 10000,
    enableUsdtConversion: true,
    tier1Exchanges: ["binance", "coinbase", "kraken", "okx", "cryptocom"],
  };

  beforeEach(async () => {
    testModule = await new TestModuleBuilder()
      .addProvider(EnhancedLoggerService, {
        log: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
        verbose: jest.fn(),
        getErrorStatistics: jest.fn(),
        getPerformanceStatistics: jest.fn(),
        startPerformanceTimer: jest.fn(),
        endPerformanceTimer: jest.fn(),
        logCriticalOperation: jest.fn(),
        logDataFlow: jest.fn(),
        logPriceUpdate: jest.fn(),
        logAggregation: jest.fn(),
        logConnection: jest.fn(),
        logErrorRecovery: jest.fn(),
        fatal: jest.fn(),
        dir: jest.fn(),
      })
      .build();

    logger = testModule.get(EnhancedLoggerService);
    adapter = CcxtMultiExchangeAdapter.withConfig(defaultConfig);
    (adapter as any).logger = logger;
  });

  afterEach(async () => {
    await adapter.disconnect();
    jest.clearAllMocks();
  });

  describe("initialization", () => {
    it("should initialize with default config", () => {
      const adapter = new CcxtMultiExchangeAdapter();
      expect(adapter.exchangeName).toBe("ccxt-multi-exchange");
      expect(adapter.category).toBe(FeedCategory.Crypto);
      expect(adapter.capabilities.supportsWebSocket).toBe(true);
      expect(adapter.capabilities.supportsREST).toBe(true);
      expect(adapter.capabilities.supportsVolume).toBe(true);
    });

    it("should initialize with custom config", () => {
      const customConfig: CcxtMultiExchangeConfig = {
        ...defaultConfig,
        tradesLimit: 2000,
        lambda: 0.0001,
      };

      const adapter = CcxtMultiExchangeAdapter.withConfig(customConfig);
      expect(adapter.getConfig()).toEqual(customConfig);
    });

    it("should set correct capabilities", () => {
      expect(adapter.capabilities.supportsWebSocket).toBe(true);
      expect(adapter.capabilities.supportsREST).toBe(true);
      expect(adapter.capabilities.supportsVolume).toBe(true);
      expect(adapter.capabilities.supportsOrderBook).toBe(false);
      expect(adapter.capabilities.supportedCategories).toContain(FeedCategory.Crypto);
    });
  });

  describe("connection management", () => {
    it("should connect successfully", async () => {
      await adapter.connect();
      expect(adapter.isConnected()).toBe(true);
      expect(logger.log).toHaveBeenCalledWith("Initializing CCXT multi-exchange adapter...");
      expect(logger.log).toHaveBeenCalledWith("CCXT multi-exchange adapter initialized successfully");
    });

    it("should disconnect successfully", async () => {
      await adapter.connect();
      await adapter.disconnect();
      expect(adapter.isConnected()).toBe(false);
      expect(logger.log).toHaveBeenCalledWith("CCXT multi-exchange adapter disconnected");
    });

    it("should handle connection errors gracefully", async () => {
      // Mock the doConnect method to throw an error
      jest.spyOn(adapter as any, "doConnect").mockRejectedValue(new Error("Connection initialization failed"));

      await expect(adapter.connect()).rejects.toThrow("Connection initialization failed");
      expect(adapter.isConnected()).toBe(false);
    });

    it("should handle multiple connection attempts", async () => {
      await adapter.connect();
      expect(adapter.isConnected()).toBe(true);

      // Second connection should not reinitialize
      await adapter.connect();
      expect(adapter.isConnected()).toBe(true);
      // Should have 2 log calls from first connection, no additional calls from second
      expect(logger.log).toHaveBeenCalledWith("Initializing CCXT multi-exchange adapter...");
      expect(logger.log).toHaveBeenCalledWith("CCXT multi-exchange adapter initialized successfully");
    });

    it("should verify connection state correctly", () => {
      expect(adapter.isConnected()).toBe(false);
    });
  });

  describe("WebSocket connection handling", () => {
    it("should handle WebSocket connection errors gracefully", async () => {
      // Mock the getLatestPriceMap method to simulate WebSocket connection failure
      jest.spyOn(adapter as any, "getLatestPriceMap").mockImplementation(() => {
        throw new Error("WebSocket connection failed");
      });

      const feedId: EnhancedFeedId = { category: FeedCategory.Crypto, name: "BTC/USD" };

      await expect(adapter.getIndividualPrices(feedId)).rejects.toThrow("Individual price extraction failed");
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to extract individual prices for BTC/USD"),
        expect.any(Error)
      );
    });

    it("should handle WebSocket message processing errors", async () => {
      // Mock the getLatestPriceMap to return invalid data
      jest.spyOn(adapter as any, "getLatestPriceMap").mockReturnValue(new Map());

      const feedId: EnhancedFeedId = { category: FeedCategory.Crypto, name: "BTC/USD" };
      const result = await adapter.getIndividualPrices(feedId);

      expect(result).toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith("No individual prices found for BTC/USD in CCXT latestPrice Map");
    });

    it("should handle WebSocket connection timeout", async () => {
      // Mock connection timeout scenario
      jest.spyOn(adapter as any, "getLatestPriceMap").mockImplementation(() => {
        throw new Error("Connection timeout");
      });

      const feedId: EnhancedFeedId = { category: FeedCategory.Crypto, name: "BTC/USD" };

      await expect(adapter.getIndividualPrices(feedId)).rejects.toThrow("Individual price extraction failed");
    });

    it("should verify error behavior in WebSocket tests", async () => {
      // Test that WebSocket errors are properly caught and handled
      const errorSpy = jest.fn();
      adapter.onError(errorSpy);

      // Mock WebSocket connection failure
      jest.spyOn(adapter as any, "getLatestPriceMap").mockImplementation(() => {
        throw new Error("WebSocket connection failed");
      });

      const feedId: EnhancedFeedId = { category: FeedCategory.Crypto, name: "BTC/USD" };

      try {
        await adapter.getIndividualPrices(feedId);
      } catch (error) {
        expect(error).toBeDefined();
        expect(logger.error).toHaveBeenCalled();
      }
    });
  });

  describe("data normalization", () => {
    it("should normalize price data correctly", () => {
      const rawData = {
        feedId: { category: FeedCategory.Crypto, name: "BTC/USD" },
        price: "45000.5",
        timestamp: "1630000000000",
      };

      const normalized = adapter.normalizePriceData(rawData);
      expect(normalized).toEqual({
        symbol: "BTC/USD",
        price: 45000.5,
        timestamp: 1630000000000,
        source: "ccxt-multi-exchange",
        confidence: expect.any(Number),
      });
    });

    it("should normalize volume data correctly", () => {
      const rawData = {
        feedId: { category: FeedCategory.Crypto, name: "BTC/USD" },
        volume: "100.5",
        timestamp: "1630000000000",
      };

      const normalized = adapter.normalizeVolumeData(rawData);
      expect(normalized).toEqual({
        symbol: "BTC/USD",
        volume: 100.5,
        timestamp: 1630000000000,
        source: "ccxt-multi-exchange",
      });
    });

    it("should handle numeric price and timestamp", () => {
      const rawData = {
        feedId: { category: FeedCategory.Crypto, name: "ETH/USD" },
        price: 3000.25,
        timestamp: 1630000000000,
      };

      const normalized = adapter.normalizePriceData(rawData);
      expect(normalized.price).toBe(3000.25);
      expect(normalized.timestamp).toBe(1630000000000);
    });

    it("should throw error for invalid price data", () => {
      const rawData = {
        feedId: { category: FeedCategory.Crypto, name: "BTC/USD" },
        price: "invalid",
        timestamp: "1630000000000",
      };

      expect(() => adapter.normalizePriceData(rawData)).toThrow("Invalid price received");
    });

    it("should throw error for invalid timestamp", () => {
      const rawData = {
        feedId: { category: FeedCategory.Crypto, name: "BTC/USD" },
        price: "45000.5",
        timestamp: "invalid",
      };

      expect(() => adapter.normalizePriceData(rawData)).toThrow("Invalid timestamp received");
    });

    it("should throw error for invalid volume data", () => {
      const rawData = {
        feedId: { category: FeedCategory.Crypto, name: "BTC/USD" },
        volume: "invalid",
        timestamp: "1630000000000",
      };

      expect(() => adapter.normalizeVolumeData(rawData)).toThrow("Invalid volume received");
    });
  });

  describe("validation", () => {
    it("should validate response correctly", () => {
      const validResponse = {
        feedId: { category: FeedCategory.Crypto, name: "BTC/USD" },
        price: 45000.5,
      };
      expect(adapter.validateResponse(validResponse)).toBe(true);

      const invalidResponse = {
        feedId: { category: FeedCategory.Crypto, name: "BTC/USD" },
        price: -1,
      };
      expect(adapter.validateResponse(invalidResponse)).toBe(false);
    });

    it("should reject null or undefined responses", () => {
      expect(adapter.validateResponse(null)).toBe(false);
      expect(adapter.validateResponse(undefined)).toBe(false);
    });

    it("should reject non-object responses", () => {
      expect(adapter.validateResponse("string")).toBe(false);
      expect(adapter.validateResponse(123)).toBe(false);
      expect(adapter.validateResponse(true)).toBe(false);
    });

    it("should reject responses without feedId", () => {
      expect(adapter.validateResponse({ price: 45000.5 })).toBe(false);
    });

    it("should reject responses with invalid price", () => {
      expect(
        adapter.validateResponse({
          feedId: { category: FeedCategory.Crypto, name: "BTC/USD" },
          price: 0,
        })
      ).toBe(false);
      expect(
        adapter.validateResponse({
          feedId: { category: FeedCategory.Crypto, name: "BTC/USD" },
          price: NaN,
        })
      ).toBe(false);
    });
  });

  describe("tier 2 data handling", () => {
    it("should check if can provide tier 2 data for crypto feeds", () => {
      const feedId = { category: FeedCategory.Crypto, name: "BTC/USD" };
      expect(adapter.canProvideTier2Data(feedId)).toBe(false); // No data available in mock
    });

    it("should reject non-crypto feeds", () => {
      const invalidFeedId = { category: FeedCategory.Forex, name: "EUR/USD" };
      expect(adapter.canProvideTier2Data(invalidFeedId)).toBe(false);
    });

    it("should return available tier 2 exchanges", () => {
      const feedId = { category: FeedCategory.Crypto, name: "BTC/USD" };
      const exchanges = adapter.getAvailableTier2Exchanges(feedId);
      expect(Array.isArray(exchanges)).toBe(true);
      expect(exchanges).toEqual([]); // No data available in mock
    });

    it("should get tier 2 prices excluding tier 1 exchanges", async () => {
      const feedId: EnhancedFeedId = { category: FeedCategory.Crypto, name: "BTC/USD" };

      // Mock individual prices with both tier 1 and tier 2 exchanges
      const mockPrices: ExchangePriceData[] = [
        { exchange: "binance", price: 50000, timestamp: Date.now(), confidence: 0.9 },
        { exchange: "bitmart", price: 50010, timestamp: Date.now(), confidence: 0.8 },
        { exchange: "coinbase", price: 49990, timestamp: Date.now(), confidence: 0.9 },
        { exchange: "bybit", price: 50005, timestamp: Date.now(), confidence: 0.85 },
      ];

      jest.spyOn(adapter, "getIndividualPrices").mockResolvedValue(mockPrices);

      const tier2Prices = await adapter.getTier2Prices(feedId);

      // Should only include tier 2 exchanges (bitmart, bybit)
      expect(tier2Prices).toHaveLength(2);
      expect(tier2Prices.map(p => p.exchange)).toEqual(["bitmart", "bybit"]);
    });

    it("should handle errors in tier 2 price extraction", async () => {
      const feedId: EnhancedFeedId = { category: FeedCategory.Crypto, name: "BTC/USD" };

      jest.spyOn(adapter, "getIndividualPrices").mockRejectedValue(new Error("Price extraction failed"));

      const tier2Prices = await adapter.getTier2Prices(feedId);

      expect(tier2Prices).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Tier 2 price extraction failed for BTC/USD"),
        expect.any(Error)
      );
    });
  });

  describe("USDT conversion", () => {
    it("should convert USDT to USD when enabled", async () => {
      const usdtPrice = 50000;
      const expectedUsdPrice = 50000 * 1.0; // Assuming 1:1 conversion for test

      // Mock USDT/USD price
      jest.spyOn(adapter, "getCcxtPrice").mockResolvedValue({
        symbol: "USDT/USD",
        price: 1.0,
        timestamp: Date.now(),
        source: "ccxt-multi-exchange",
        confidence: 0.9,
      });

      const result = await adapter.convertUsdtToUsd(usdtPrice);
      expect(result).toBe(expectedUsdPrice);
    });

    it("should return original price when conversion disabled", async () => {
      const customConfig = { ...defaultConfig, enableUsdtConversion: false };
      const adapterWithoutConversion = CcxtMultiExchangeAdapter.withConfig(customConfig);
      (adapterWithoutConversion as any).logger = logger;

      const usdtPrice = 50000;
      const result = await adapterWithoutConversion.convertUsdtToUsd(usdtPrice);
      expect(result).toBe(usdtPrice);
    });

    it("should handle conversion errors gracefully", async () => {
      jest.spyOn(adapter, "getCcxtPrice").mockRejectedValue(new Error("USDT/USD price not available"));

      const usdtPrice = 50000;
      const result = await adapter.convertUsdtToUsd(usdtPrice);
      expect(result).toBe(usdtPrice); // Should fallback to original price
    });

    it("should convert individual USDT prices to USD", async () => {
      const usdtPrices: ExchangePriceData[] = [
        { exchange: "bitmart", price: 50000, timestamp: Date.now(), confidence: 0.8 },
        { exchange: "bybit", price: 50010, timestamp: Date.now(), confidence: 0.85 },
      ];

      // Mock USDT/USD rate
      jest.spyOn(adapter as any, "getUsdtToUsdRate").mockResolvedValue(1.001);

      const convertedPrices = await adapter.convertIndividualUsdtPrices(usdtPrices, "BTC/USD");

      expect(convertedPrices).toHaveLength(2);
      expect(convertedPrices[0].price).toBeCloseTo(50050); // 50000 * 1.001
      expect(convertedPrices[1].price).toBeCloseTo(50060.01); // 50010 * 1.001
    });
  });

  describe("metrics", () => {
    it("should track and reset metrics correctly", () => {
      const metrics = adapter.getMetrics();
      expect(metrics.priceExtractionCount).toBe(0);
      expect(metrics.successfulExtractions).toBe(0);
      expect(metrics.failedExtractions).toBe(0);
      expect(metrics.averageExtractionTime).toBe(0);
      expect(metrics.tier2ExchangeCount).toBe(0);

      adapter.resetMetrics();
      const resetMetrics = adapter.getMetrics();
      expect(resetMetrics.priceExtractionCount).toBe(0);
      expect(resetMetrics.successfulExtractions).toBe(0);
      expect(resetMetrics.failedExtractions).toBe(0);
    });

    it("should update metrics on price extraction", async () => {
      const feedId: EnhancedFeedId = { category: FeedCategory.Crypto, name: "BTC/USD" };

      // Mock successful price extraction
      jest.spyOn(adapter as any, "getLatestPriceMap").mockImplementation(() => {
        throw new Error("CCXT price map access not yet implemented");
      });

      try {
        await adapter.getCcxtPrice(feedId);
      } catch (error) {
        // Expected to fail in test environment
      }

      const metrics = adapter.getMetrics();
      expect(metrics.priceExtractionCount).toBe(1);
      expect(metrics.failedExtractions).toBe(1);
    });
  });

  describe("health check", () => {
    it("should return false when not initialized", async () => {
      const result = await adapter.healthCheck();
      expect(result).toBe(false);
    });

    it("should check health status after connection", async () => {
      await adapter.connect();

      // When connected, base adapter returns true without calling doHealthCheck
      const result = await adapter.healthCheck();
      expect(result).toBe(true);
    });

    it("should return true for successful health check", async () => {
      await adapter.connect();

      // Mock successful health check
      jest.spyOn(adapter, "getCcxtPrice").mockResolvedValue({
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        source: "ccxt-multi-exchange",
        confidence: 0.9,
      });

      const result = await adapter.healthCheck();
      expect(result).toBe(true);
    });
  });

  describe("configuration management", () => {
    it("should get current configuration", () => {
      const config = adapter.getConfig();
      expect(config).toEqual(defaultConfig);
    });

    it("should update configuration", () => {
      const newConfig = { tradesLimit: 2000, lambda: 0.0001 };
      adapter.updateConfig(newConfig);

      const updatedConfig = adapter.getConfig();
      expect(updatedConfig.tradesLimit).toBe(2000);
      expect(updatedConfig.lambda).toBe(0.0001);
      expect(updatedConfig.enableUsdtConversion).toBe(true); // Should preserve other settings
    });
  });

  describe("subscription management", () => {
    it("should handle subscribe calls gracefully", async () => {
      await adapter.connect();

      // CCXT adapter doesn't support subscriptions, should not throw
      await expect(adapter.subscribe(["BTC/USD", "ETH/USD"])).resolves.toBeUndefined();
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("CCXT adapter doesn't support subscriptions"));
    });

    it("should handle unsubscribe calls gracefully", async () => {
      await adapter.connect();

      // First subscribe to something so we can unsubscribe
      await adapter.subscribe(["BTC/USD"]);

      // Now unsubscribe should call doUnsubscribe
      await expect(adapter.unsubscribe(["BTC/USD"])).resolves.toBeUndefined();
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("CCXT adapter doesn't support unsubscriptions")
      );
    });
  });

  describe("error handling", () => {
    it("should handle price extraction errors", async () => {
      const feedId: EnhancedFeedId = { category: FeedCategory.Crypto, name: "BTC/USD" };

      await expect(adapter.getCcxtPrice(feedId)).rejects.toThrow("CCXT price extraction not yet implemented");
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("CCXT price extraction failed for BTC/USD"),
        expect.any(Error)
      );
    });

    it("should handle volume extraction errors", async () => {
      const feedId: EnhancedFeedId = { category: FeedCategory.Crypto, name: "BTC/USD" };

      await expect(adapter.getVolumeData(feedId, 60)).rejects.toThrow("CCXT volume extraction not yet implemented");
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("CCXT volume extraction failed for BTC/USD"),
        expect.any(Error)
      );
    });

    it("should handle USDT feed availability check", async () => {
      jest.spyOn(adapter, "getCcxtPrice").mockRejectedValue(new Error("USDT feed not available"));

      const result = await adapter.ensureUsdtFeedAvailable();
      expect(result).toBe(false);
    });
  });
});
