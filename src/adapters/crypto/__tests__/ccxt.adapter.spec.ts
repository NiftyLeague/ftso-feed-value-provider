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

    // Clear all mock history before each test
    jest.clearAllMocks();

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
      expect(adapter.getCcxtConfig()).toEqual(customConfig);
    });

    it("should properly update adapter config", () => {
      const newConfig: Partial<CcxtMultiExchangeConfig> = {
        tradesLimit: 3000,
        websocketUrl: "wss://new-ws-url.com",
        apiKey: "new-api-key",
      };

      adapter.updateConnectionConfig({
        websocketUrl: newConfig.websocketUrl,
        apiKey: newConfig.apiKey,
      });

      (adapter as any).updateAdapterConfig(newConfig);
      const updatedConfig = adapter.getCcxtConfig();

      // Check that the new config values are set
      expect(updatedConfig.websocketUrl).toBe("wss://new-ws-url.com");
      expect(updatedConfig.apiKey).toBe("new-api-key");
      expect(updatedConfig.tradesLimit).toBe(3000);

      // Check that other config values remain unchanged
      expect(updatedConfig.lambda).toBe(defaultConfig.lambda);
      expect(updatedConfig.retryBackoffMs).toBe(defaultConfig.retryBackoffMs);
    });
  });

  describe("metrics", () => {
    it("should handle metrics correctly", () => {
      // Simulate some metrics activity by calling protected methods through type cast
      const adapterWithMetrics = adapter as any;
      adapterWithMetrics._requestCount = 10;
      adapterWithMetrics._successCount = 8;
      adapterWithMetrics._errorCount = 2;
      adapterWithMetrics.tier2ExchangeCount = 5;

      // Get metrics
      const metrics = adapter.getMetrics();

      // Check metrics values
      expect(metrics.priceExtractionCount).toBe(10);
      expect(metrics.successfulExtractions).toBe(8);
      expect(metrics.failedExtractions).toBe(2);
      expect(metrics.tier2ExchangeCount).toBe(5);

      // Reset metrics through our resetMetrics method
      adapter.resetMetrics();

      // Check that metrics are reset
      expect((adapter as any)._requestCount).toBe(0);
      expect((adapter as any)._successCount).toBe(0);
      expect((adapter as any)._errorCount).toBe(0);
      expect((adapter as any).tier2ExchangeCount).toBe(0);
    });
  });

  describe("connection management", () => {
    it("should connect successfully", async () => {
      await adapter.connect();
      expect(adapter.isConnected()).toBe(true);
      expect(logger.log).toHaveBeenCalledWith("Initializing CCXT Pro multi-exchange adapter...");
    });

    it("should disconnect successfully", async () => {
      await adapter.connect();
      await adapter.disconnect();
      expect(adapter.isConnected()).toBe(false);
      expect(logger.log).toHaveBeenCalledWith("CCXT Pro multi-exchange adapter disconnected");
    });

    it("should handle connection errors", async () => {
      const errorCallbackMock = jest.fn();
      const connectionChangeCallbackMock = jest.fn();

      // Mock callback registrations
      adapter.onError(errorCallbackMock);
      adapter.onConnectionChange(connectionChangeCallbackMock);

      // Mock the logger methods and set up spies
      const errorSpy = jest.spyOn(logger, "error");
      const warnSpy = jest.spyOn(logger, "warn");

      // Create an error instance
      const error = new Error("Connection failed");

      // Mock doConnect to call logger.error directly as the concrete adapter would
      jest.spyOn(adapter as any, "doConnect").mockImplementation(async () => {
        // Cast error as a record to satisfy EnhancedLogContext type requirement
        logger.error("Failed to initialize CCXT multi-exchange adapter:", error as unknown as Record<string, unknown>);
        throw error;
      });

      // Mock the retry delay and max retries for fast test
      (adapter as any).retryDelay = 0;
      (adapter as any).maxRetries = 2; // This means 3 attempts total

      // Should fail after 3 attempts (initial + 2 retries)
      await expect(adapter.connect()).rejects.toThrow("Failed to connect to ccxt-multi-exchange after 3 attempts");
      expect(adapter.isConnected()).toBe(false);

      // Each retry except the last should produce a warning
      expect(warnSpy).toHaveBeenCalledTimes(2);
      expect(warnSpy.mock.calls[0][0]).toContain("Connection attempt 1 failed");
      expect(warnSpy.mock.calls[1][0]).toContain("Connection attempt 2 failed");

      // The error is logged on each attempt in doConnect
      expect(errorSpy).toHaveBeenCalledTimes(3);
      expect(errorSpy).toHaveBeenNthCalledWith(1, "Failed to initialize CCXT multi-exchange adapter:", error);
      expect(errorSpy).toHaveBeenNthCalledWith(2, "Failed to initialize CCXT multi-exchange adapter:", error);
      expect(errorSpy).toHaveBeenNthCalledWith(3, "Failed to initialize CCXT multi-exchange adapter:", error);

      // Verify callbacks were called
      expect(connectionChangeCallbackMock).toHaveBeenCalledWith(false);
      expect(errorCallbackMock).toHaveBeenCalledWith(expect.any(Error));
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
    it("should check if can provide tier 2 data", async () => {
      const feedId = { category: FeedCategory.Crypto, name: "BTC/USD" };
      expect(await adapter.canProvideTier2Data(feedId)).toBe(false);

      const invalidFeedId = { category: FeedCategory.Forex, name: "EUR/USD" };
      expect(await adapter.canProvideTier2Data(invalidFeedId)).toBe(false);
    });

    it("should return available tier 2 exchanges", async () => {
      const feedId = { category: FeedCategory.Crypto, name: "BTC/USD" };
      const exchanges = await adapter.getAvailableTier2Exchanges(feedId);
      expect(Array.isArray(exchanges)).toBe(true);
    });
  });

  describe("extraction metrics", () => {
    it("should track extraction metrics correctly", () => {
      const metrics = adapter.getMetrics();
      expect(metrics.priceExtractionCount).toBe(0);
      expect(metrics.successfulExtractions).toBe(0);
      expect(metrics.failedExtractions).toBe(0);

      // Reset should be handled by DataProviderMixin now
      (adapter as any).resetRateLimitCounters();
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
