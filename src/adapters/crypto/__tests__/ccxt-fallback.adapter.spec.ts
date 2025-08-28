import { CcxtFallbackAdapter, CcxtFallbackConfig } from "../ccxt-fallback.adapter";
import { FeedCategory } from "@/types/feed-category.enum";
import { EnhancedFeedId } from "@/types/enhanced-feed-id.types";
import { CcxtFeed } from "@/data-feeds/ccxt-provider-service";

// Mock the CcxtFeed
jest.mock("@/data-feeds/ccxt-provider-service");

describe("CcxtFallbackAdapter", () => {
  let adapter: CcxtFallbackAdapter;
  let mockCcxtFeed: jest.Mocked<CcxtFeed>;

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

    adapter = new CcxtFallbackAdapter();
  });

  describe("initialization", () => {
    it("should initialize with correct properties", () => {
      expect(adapter.exchangeName).toBe("ccxt-fallback");
      expect(adapter.category).toBe(FeedCategory.Crypto);
      expect(adapter.capabilities.supportsWebSocket).toBe(false);
      expect(adapter.capabilities.supportsREST).toBe(true);
      expect(adapter.capabilities.supportsVolume).toBe(true);
    });

    it("should initialize with default configuration", () => {
      const config = adapter.getFallbackConfig();
      expect(config.fallbackDelay).toBe(50);
      expect(config.tradesLimit).toBe(1000);
      expect(config.lambda).toBe(0.00005);
      expect(config.retryBackoffMs).toBe(10000);
      expect(config.enableUsdtConversion).toBe(true);
    });

    it("should initialize with custom configuration", () => {
      const customConfig: CcxtFallbackConfig = {
        fallbackDelay: 100,
        tradesLimit: 2000,
        lambda: 0.0001,
        retryBackoffMs: 20000,
        enableUsdtConversion: false,
      };

      const customAdapter = new CcxtFallbackAdapter(customConfig);
      const config = customAdapter.getFallbackConfig();

      expect(config.fallbackDelay).toBe(100);
      expect(config.tradesLimit).toBe(2000);
      expect(config.lambda).toBe(0.0001);
      expect(config.retryBackoffMs).toBe(20000);
      expect(config.enableUsdtConversion).toBe(false);
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
      expect(result.source).toBe("ccxt-fallback");
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
      expect(result.source).toBe("ccxt-fallback");
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

  describe("CCXT fallback functionality", () => {
    beforeEach(async () => {
      mockCcxtFeed.start.mockResolvedValue(undefined);
      await adapter.connect();
    });

    it("should fallback to CCXT successfully", async () => {
      const mockFeedValue = {
        feed: testFeedId,
        value: 50000,
      };

      mockCcxtFeed.getValue.mockResolvedValue(mockFeedValue);

      const result = await adapter.fallbackToCcxt(testFeedId);

      expect(result.symbol).toBe("BTC/USD");
      expect(result.price).toBe(50000);
      expect(result.source).toBe("ccxt-fallback");
      expect(mockCcxtFeed.getValue).toHaveBeenCalledWith({
        category: testFeedId.category,
        name: testFeedId.name,
      });
    });

    it("should handle CCXT fallback errors", async () => {
      mockCcxtFeed.getValue.mockRejectedValue(new Error("CCXT error"));

      await expect(adapter.fallbackToCcxt(testFeedId)).rejects.toThrow("CCXT fallback failed");
    });

    it("should handle missing price data", async () => {
      mockCcxtFeed.getValue.mockResolvedValue({ feed: testFeedId, value: undefined });

      await expect(adapter.fallbackToCcxt(testFeedId)).rejects.toThrow("No price data available");
    });

    it("should update metrics on successful fallback", async () => {
      const mockFeedValue = {
        feed: testFeedId,
        value: 50000,
      };

      mockCcxtFeed.getValue.mockResolvedValue(mockFeedValue);

      await adapter.fallbackToCcxt(testFeedId);

      const metrics = adapter.getMetrics();
      expect(metrics.fallbackCount).toBe(1);
      expect(metrics.successfulFallbacks).toBe(1);
      expect(metrics.failedFallbacks).toBe(0);
      expect(metrics.averageFallbackTime).toBeGreaterThan(0);
    });

    it("should update metrics on failed fallback", async () => {
      mockCcxtFeed.getValue.mockRejectedValue(new Error("CCXT error"));

      try {
        await adapter.fallbackToCcxt(testFeedId);
      } catch {
        // Expected to fail
      }

      const metrics = adapter.getMetrics();
      expect(metrics.fallbackCount).toBe(1);
      expect(metrics.successfulFallbacks).toBe(0);
      expect(metrics.failedFallbacks).toBe(1);
    });
  });

  describe("volume fallback functionality", () => {
    beforeEach(async () => {
      mockCcxtFeed.start.mockResolvedValue(undefined);
      await adapter.connect();
    });

    it("should fallback to volume data successfully", async () => {
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

      const result = await adapter.fallbackToVolumeData(testFeedId, 3600);

      expect(result.symbol).toBe("BTC/USD");
      expect(result.volume).toBe(800); // 500 + 300
      expect(result.source).toBe("ccxt-fallback");
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

    it("should handle volume fallback errors", async () => {
      mockCcxtFeed.getVolumes.mockRejectedValue(new Error("Volume error"));

      await expect(adapter.fallbackToVolumeData(testFeedId, 3600)).rejects.toThrow("CCXT volume fallback failed");
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
      const configWithoutConversion: CcxtFallbackConfig = {
        enableUsdtConversion: false,
      };

      const adapterWithoutConversion = new CcxtFallbackAdapter(configWithoutConversion);

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

  describe("seamless fallback functionality", () => {
    beforeEach(async () => {
      mockCcxtFeed.start.mockResolvedValue(undefined);
      await adapter.connect();
    });

    it("should perform seamless fallback successfully", async () => {
      const mockFeedValue = {
        feed: testFeedId,
        value: 50000,
      };

      mockCcxtFeed.getValue.mockResolvedValue(mockFeedValue);

      const primaryError = new Error("WebSocket connection failed");
      const result = await adapter.seamlessFallback(testFeedId, "binance", primaryError);

      expect(result.symbol).toBe("BTC/USD");
      expect(result.price).toBe(50000);
      expect(result.source).toBe("ccxt-fallback");
    });

    it("should handle complete failure", async () => {
      mockCcxtFeed.getValue.mockRejectedValue(new Error("CCXT also failed"));

      const primaryError = new Error("WebSocket connection failed");

      await expect(adapter.seamlessFallback(testFeedId, "binance", primaryError)).rejects.toThrow("Complete failure");
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
      // Simulate some activity
      adapter.getMetrics().fallbackCount = 5;
      adapter.getMetrics().successfulFallbacks = 3;
      adapter.getMetrics().failedFallbacks = 2;

      adapter.resetMetrics();

      const metrics = adapter.getMetrics();
      expect(metrics.fallbackCount).toBe(0);
      expect(metrics.successfulFallbacks).toBe(0);
      expect(metrics.failedFallbacks).toBe(0);
      expect(metrics.averageFallbackTime).toBe(0);
    });
  });

  describe("configuration management", () => {
    it("should update configuration", () => {
      const newConfig: Partial<CcxtFallbackConfig> = {
        fallbackDelay: 200,
        tradesLimit: 3000,
      };

      adapter.updateFallbackConfig(newConfig);

      const config = adapter.getFallbackConfig();
      expect(config.fallbackDelay).toBe(200);
      expect(config.tradesLimit).toBe(3000);
      // Other values should remain unchanged
      expect(config.lambda).toBe(0.00005);
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
