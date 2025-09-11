import { CcxtMultiExchangeAdapter, CcxtMultiExchangeConfig } from "../ccxt.adapter";
import { FeedCategory } from "@/common/types/core";
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
  });

  describe("connection management", () => {
    it("should connect successfully", async () => {
      await adapter.connect();
      expect(adapter.isConnected()).toBe(true);
      expect(logger.log).toHaveBeenCalledWith("Initializing CCXT multi-exchange adapter...");
    });

    it("should disconnect successfully", async () => {
      await adapter.connect();
      await adapter.disconnect();
      expect(adapter.isConnected()).toBe(false);
      expect(logger.log).toHaveBeenCalledWith("CCXT multi-exchange adapter disconnected");
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

    it("should throw error for invalid price data", () => {
      const rawData = {
        feedId: { category: FeedCategory.Crypto, name: "BTC/USD" },
        price: "invalid",
        timestamp: "1630000000000",
      };

      expect(() => adapter.normalizePriceData(rawData)).toThrow("Invalid price received");
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
  });

  describe("tier 2 data handling", () => {
    it("should check if can provide tier 2 data", () => {
      const feedId = { category: FeedCategory.Crypto, name: "BTC/USD" };
      expect(adapter.canProvideTier2Data(feedId)).toBe(false);

      const invalidFeedId = { category: FeedCategory.Forex, name: "EUR/USD" };
      expect(adapter.canProvideTier2Data(invalidFeedId)).toBe(false);
    });

    it("should return available tier 2 exchanges", () => {
      const feedId = { category: FeedCategory.Crypto, name: "BTC/USD" };
      const exchanges = adapter.getAvailableTier2Exchanges(feedId);
      expect(Array.isArray(exchanges)).toBe(true);
    });
  });

  describe("metrics", () => {
    it("should track and reset metrics correctly", () => {
      const metrics = adapter.getMetrics();
      expect(metrics.priceExtractionCount).toBe(0);
      expect(metrics.successfulExtractions).toBe(0);
      expect(metrics.failedExtractions).toBe(0);

      adapter.resetMetrics();
      const resetMetrics = adapter.getMetrics();
      expect(resetMetrics.priceExtractionCount).toBe(0);
      expect(resetMetrics.successfulExtractions).toBe(0);
      expect(resetMetrics.failedExtractions).toBe(0);
    });
  });

  describe("health check", () => {
    it("should check health status", async () => {
      const result = await adapter.healthCheck();
      expect(typeof result).toBe("boolean");
    });
  });
});
