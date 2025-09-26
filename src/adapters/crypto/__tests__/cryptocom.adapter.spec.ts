import { CryptocomAdapter, ICryptocomTickerData, ICryptocomRestResponse } from "../cryptocom.adapter";
import { FeedCategory } from "@/common/types/core";

// Mock the BaseExchangeAdapter's WebSocket methods
jest.mock("@/adapters/base/base-exchange-adapter", () => {
  const originalModule = jest.requireActual("@/adapters/base/base-exchange-adapter");

  return {
    ...originalModule,
    BaseExchangeAdapter: class extends originalModule.BaseExchangeAdapter {
      protected connectWebSocket = jest.fn().mockResolvedValue(undefined);
      protected disconnectWebSocket = jest.fn().mockResolvedValue(undefined);
      protected isWebSocketConnected = jest.fn().mockReturnValue(true);
      protected sendWebSocketMessage = jest.fn().mockResolvedValue(true);
    },
  };
});

// Mock fetch
global.fetch = jest.fn();

describe("CryptocomAdapter", () => {
  let adapter: CryptocomAdapter;
  let originalEnv: NodeJS.ProcessEnv;

  const mockTickerData: ICryptocomTickerData = {
    i: "BTC_USDT",
    b: "49999.0",
    k: "50001.0",
    a: "50000.5",
    t: 1640995200000,
    v: "20.0",
    h: "50500.0",
    l: "49000.0",
    c: "500.5",
  };

  beforeAll(() => {
    // Save the original process.env
    originalEnv = { ...process.env };
    // Set test environment
    process.env.NODE_ENV = "test";
  });

  afterAll(() => {
    // Restore original process.env
    process.env = originalEnv;
  });

  beforeEach(() => {
    // Create a new adapter instance
    adapter = new CryptocomAdapter();

    // Clear all mocks
    jest.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up any resources
    if (adapter.isConnected()) {
      await adapter.disconnect();
    }
  });

  describe("initialization", () => {
    it("should initialize with correct properties", () => {
      // Test basic properties
      expect(adapter.exchangeName).toBe("cryptocom");
      expect(adapter.category).toBe(FeedCategory.Crypto);

      // Test capabilities
      expect(adapter.capabilities.supportsWebSocket).toBe(true);
      expect(adapter.capabilities.supportsREST).toBe(true);
      expect(adapter.capabilities.supportsVolume).toBe(true);
      expect(adapter.capabilities.supportsOrderBook).toBe(true);
      expect(adapter.capabilities.supportedCategories).toContain(FeedCategory.Crypto);
    });

    it("should not be connected initially", () => {
      expect(adapter.isConnected()).toBe(false);
    });
  });

  describe("connection management", () => {
    it("should connect to WebSocket", async () => {
      const onConnect = jest.fn();
      adapter.onConnectionChange(onConnect);

      await adapter.connect();

      expect(adapter.isConnected()).toBe(true);
      expect(onConnect).toHaveBeenCalledWith(true);
    });

    it("should handle connection errors gracefully", async () => {
      // Mock the doConnect method to simulate connection failure
      jest.spyOn(adapter as any, "doConnect").mockRejectedValue(new Error("Connection failed"));

      // Mock the sleep method to avoid delays in tests
      (adapter as any).sleep = jest.fn().mockResolvedValue(undefined);

      const errorSpy = jest.fn();
      adapter.onError(errorSpy);

      // The base adapter now handles connection failures gracefully
      // It should not throw but should call the error callback
      await expect(adapter.connect()).resolves.toBeUndefined();
      expect(adapter.isConnected()).toBe(false);
      expect(errorSpy).toHaveBeenCalled();
    });

    it("should disconnect successfully", async () => {
      // First connect
      await adapter.connect();

      const onDisconnect = jest.fn();
      adapter.onConnectionChange(onDisconnect);

      // Then disconnect
      await adapter.disconnect();

      expect(adapter.isConnected()).toBe(false);
      expect(onDisconnect).toHaveBeenCalledWith(false);
    });

    it("should handle disconnection when not connected", async () => {
      await adapter.disconnect();
      expect(adapter.isConnected()).toBe(false);
    });
  });

  describe("data normalization", () => {
    it("should normalize ticker data correctly", () => {
      const result = adapter.normalizePriceData(mockTickerData);

      expect(result.symbol).toBe("BTC/USDT");
      expect(result.price).toBe(50000.5);
      expect(result.timestamp).toBe(1640995200000);
      expect(result.source).toBe("cryptocom");
      expect(result.volume).toBe(20.0);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it("should normalize volume data correctly", () => {
      const result = adapter.normalizeVolumeData(mockTickerData);

      expect(result.symbol).toBe("BTC/USDT");
      expect(result.volume).toBe(20.0);
      expect(result.timestamp).toBe(1640995200000);
      expect(result.source).toBe("cryptocom");
    });

    it("should handle symbol mapping correctly", () => {
      expect(adapter.getSymbolMapping("BTC/USDT")).toBe("BTC_USDT");
      expect(adapter.getSymbolMapping("ETH/USD")).toBe("ETH_USD");
      expect(adapter.getSymbolMapping("ADA/BTC")).toBe("ADA_BTC");
    });
  });

  describe("response validation", () => {
    it("should validate correct ticker data", () => {
      expect(adapter.validateResponse(mockTickerData)).toBe(true);
    });

    it("should reject invalid data", () => {
      expect(adapter.validateResponse(null)).toBe(false);
      expect(adapter.validateResponse({})).toBe(false);
      expect(adapter.validateResponse({ i: "BTC_USDT" })).toBe(false);
      expect(adapter.validateResponse({ a: "50000" })).toBe(false);
      expect(adapter.validateResponse({ i: "BTC_USDT", a: "invalid" })).toBe(false);
    });

    it("should handle missing required fields", () => {
      const invalidData = { ...mockTickerData };
      delete (invalidData as any).i;
      expect(adapter.validateResponse(invalidData)).toBe(false);

      const invalidData2 = { ...mockTickerData };
      delete (invalidData2 as any).a;
      expect(adapter.validateResponse(invalidData2)).toBe(false);

      const invalidData3 = { ...mockTickerData };
      delete (invalidData3 as any).t;
      expect(adapter.validateResponse(invalidData3)).toBe(false);
    });
  });

  describe("subscription management", () => {
    let sendWebSocketMessageSpy: jest.SpyInstance;

    beforeEach(async () => {
      // Mock sendWebSocketMessage to track calls
      sendWebSocketMessageSpy = jest.spyOn(adapter as any, "sendWebSocketMessage").mockResolvedValue(true);

      await adapter.connect();
    });

    it("should subscribe to symbols", async () => {
      await adapter.subscribe(["BTC/USDT", "ETH/USDT"]);

      // Verify subscription message was sent
      expect(sendWebSocketMessageSpy).toHaveBeenCalledTimes(1);

      // Get the subscription message
      const subscriptionMessage = JSON.parse(sendWebSocketMessageSpy.mock.calls[0][0] as string);

      // Verify subscription message contains both channels
      expect(subscriptionMessage).toEqual(
        expect.objectContaining({
          method: "subscribe",
          params: {
            channels: ["ticker.BTC_USDT", "ticker.ETH_USDT"],
          },
        })
      );

      // Verify subscriptions are tracked
      expect(adapter.getSubscriptions()).toContain("BTC_USDT");
      expect(adapter.getSubscriptions()).toContain("ETH_USDT");
    });

    it("should not subscribe to the same symbol twice", async () => {
      await adapter.subscribe(["BTC/USDT"]);
      await adapter.subscribe(["BTC/USDT"]);

      expect(sendWebSocketMessageSpy).toHaveBeenCalledTimes(1);
    });

    it("should unsubscribe from symbols", async () => {
      await adapter.subscribe(["BTC/USDT"]);
      await adapter.unsubscribe(["BTC/USDT"]);

      expect(sendWebSocketMessageSpy).toHaveBeenCalledTimes(2); // 1 subscribe + 1 unsubscribe
      expect(adapter.getSubscriptions()).not.toContain("BTC_USDT");
    });

    it("should handle subscription when not connected", async () => {
      await adapter.disconnect();

      await expect(adapter.subscribe(["BTC/USDT"])).rejects.toThrow("Cannot subscribe: not connected to cryptocom");
    });

    it("should handle unsubscription when not connected", async () => {
      await adapter.disconnect();

      // Should not throw
      await expect(adapter.unsubscribe(["BTC/USDT"])).resolves.toBeUndefined();
    });
  });

  describe("REST API functionality", () => {
    it("should fetch ticker data via REST", async () => {
      const mockResponse: ICryptocomRestResponse = {
        id: 1,
        method: "public/get-ticker",
        code: 0,
        result: {
          data: [mockTickerData],
        },
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await adapter.fetchTickerREST("BTC/USDT");

      expect(result.symbol).toBe("BTC/USDT");
      expect(result.price).toBe(50000.5);
      expect(result.source).toBe("cryptocom");
      expect(global.fetch).toHaveBeenCalledWith("https://api.crypto.com/v2/public/get-ticker?instrument_name=BTC_USDT");
    });

    it("should handle REST API errors", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      await expect(adapter.fetchTickerREST("BTC/USDT")).rejects.toThrow("HTTP 500: Internal Server Error");
    });

    it("should handle Crypto.com API error responses", async () => {
      const mockErrorResponse: ICryptocomRestResponse = {
        id: 1,
        method: "public/get-ticker",
        code: 10001,
        result: {
          data: [],
        },
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockErrorResponse,
      });

      await expect(adapter.fetchTickerREST("INVALID/SYMBOL")).rejects.toThrow("Crypto.com API error: 10001");
    });

    it("should handle empty data response", async () => {
      const mockEmptyResponse: ICryptocomRestResponse = {
        id: 1,
        method: "public/get-ticker",
        code: 0,
        result: {
          data: [],
        },
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockEmptyResponse,
      });

      await expect(adapter.fetchTickerREST("BTC/USDT")).rejects.toThrow("Crypto.com API error: No data");
    });

    it("should handle network errors", async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("Network error"));

      await expect(adapter.fetchTickerREST("BTC/USDT")).rejects.toThrow(
        "Failed to fetch Crypto.com ticker for BTC/USDT: Network error"
      );
    });
  });

  describe("connection change callbacks", () => {
    it("should call connection change callback on connect", async () => {
      const connectionCallback = jest.fn();

      // Set callback before connecting
      adapter.onConnectionChange(connectionCallback);
      await adapter.connect();

      // The callback should be called when connection opens
      expect(connectionCallback).toHaveBeenCalledWith(true);
    });

    it("should call connection change callback on disconnect", async () => {
      await adapter.connect();

      const connectionCallback = jest.fn();
      adapter.onConnectionChange(connectionCallback);

      await adapter.disconnect();

      expect(connectionCallback).toHaveBeenCalledWith(false);
    });
  });

  describe("health check", () => {
    it("should return true when connected", async () => {
      await adapter.connect();

      const isHealthy = await adapter.healthCheck();
      expect(isHealthy).toBe(true);
    });

    it("should check REST API when not connected", async () => {
      const mockResponse: ICryptocomRestResponse = {
        id: 1,
        method: "public/get-instruments",
        code: 0,
        result: {
          data: [],
        },
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const isHealthy = await adapter.healthCheck();
      expect(isHealthy).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith("https://api.crypto.com/v2/public/get-instruments");
    });

    it("should return false when REST API fails", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const isHealthy = await adapter.healthCheck();
      expect(isHealthy).toBe(false);
    });

    it("should return false when REST API returns error code", async () => {
      const mockErrorResponse: ICryptocomRestResponse = {
        id: 1,
        method: "public/get-instruments",
        code: 10001,
        result: {
          data: [],
        },
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockErrorResponse,
      });

      const isHealthy = await adapter.healthCheck();
      expect(isHealthy).toBe(false);
    });

    it("should return false when network request fails", async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("Network error"));

      const isHealthy = await adapter.healthCheck();
      expect(isHealthy).toBe(false);
    });
  });

  describe("heartbeat functionality", () => {
    it("should be connected after successful connection", async () => {
      await adapter.connect();

      // Check that adapter is connected (ping is handled by base class)
      expect(adapter.isConnected()).toBe(true);
    });

    it("should be disconnected after disconnection", async () => {
      await adapter.connect();
      expect(adapter.isConnected()).toBe(true);

      await adapter.disconnect();

      // Check that adapter is disconnected (ping cleanup handled by base class)
      expect(adapter.isConnected()).toBe(false);
    });
  });

  describe("confidence calculation", () => {
    it("should calculate confidence based on spread", () => {
      const tickerWithNarrowSpread = {
        ...mockTickerData,
        b: "49999.5",
        k: "50000.5",
      };

      const result = adapter.normalizePriceData(tickerWithNarrowSpread);
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it("should reduce confidence for wide spreads", () => {
      const tickerWithWideSpread = {
        ...mockTickerData,
        b: "49000.0",
        k: "51000.0",
      };

      const result = adapter.normalizePriceData(tickerWithWideSpread);
      expect(result.confidence).toBeLessThan(0.8);
    });

    it("should consider volume in confidence calculation", () => {
      const tickerWithHighVolume = {
        ...mockTickerData,
        v: "1000.0",
      };

      const tickerWithLowVolume = {
        ...mockTickerData,
        v: "0.1",
      };

      const highVolumeResult = adapter.normalizePriceData(tickerWithHighVolume);
      const lowVolumeResult = adapter.normalizePriceData(tickerWithLowVolume);

      expect(highVolumeResult.confidence).toBeGreaterThan(lowVolumeResult.confidence);
    });
  });

  describe("message ID management", () => {
    beforeEach(async () => {
      await adapter.connect();
    });

    it("should increment message ID for each request", async () => {
      // Mock sendWebSocketMessage to track calls
      const sendWebSocketMessageSpy = jest.spyOn(adapter as any, "sendWebSocketMessage").mockResolvedValue(true);

      await adapter.subscribe(["BTC/USDT"]);
      await adapter.subscribe(["ETH/USDT"]);

      expect(sendWebSocketMessageSpy).toHaveBeenCalledTimes(2);

      // Check that different message IDs were used
      const firstCall = JSON.parse(sendWebSocketMessageSpy.mock.calls[0][0] as string);
      const secondCall = JSON.parse(sendWebSocketMessageSpy.mock.calls[1][0] as string);

      expect(firstCall.id).toBeDefined();
      expect(secondCall.id).toBeDefined();
      expect(firstCall.id).not.toBe(secondCall.id);
    });
  });
});
