// Mock the ws module to return a constructor function
jest.mock("ws", () => {
  const { MockFactory } = jest.requireActual("@/__tests__/utils");
  const MockWebSocketConstructor = jest.fn().mockImplementation(() => MockFactory.createWebSocket());
  // Add WebSocket constants using Object.assign to avoid TypeScript errors
  Object.assign(MockWebSocketConstructor, {
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3,
  });
  return MockWebSocketConstructor;
});

import { BinanceAdapter, BinanceTickerData } from "../binance.adapter";
import { FeedCategory } from "@/common/types/core";
// @ts-ignore - MockFactory is used in jest.mock below
import { MockFactory, MockSetup } from "@/__tests__/utils";

// Mock fetch globally
global.fetch = jest.fn();

describe("BinanceAdapter", () => {
  let adapter: BinanceAdapter;

  beforeEach(() => {
    MockSetup.setupAll();
    adapter = new BinanceAdapter();

    // Disable reconnection and retries to prevent hanging
    (adapter as any).maxReconnectAttempts = 0;
    (adapter as any).maxRetries = 0;
    (adapter as any).retryDelay = 0;

    // Mock the connectWebSocket method to avoid WebSocket issues
    jest.spyOn(adapter as any, "connectWebSocket").mockResolvedValue(undefined);
    jest.spyOn(adapter as any, "disconnectWebSocket").mockResolvedValue(undefined);

    // Mock connection state
    jest.spyOn(adapter, "isConnected").mockReturnValue(false);

    jest.clearAllMocks();
  });

  afterEach(async () => {
    try {
      // Force cleanup with timeout
      await Promise.race([adapter.cleanup(), new Promise(resolve => setTimeout(resolve, 100))]);
    } catch (error) {
      // Ignore cleanup errors
    }

    MockSetup.cleanup();
    jest.clearAllTimers();
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  describe("initialization", () => {
    it("should initialize with correct properties", () => {
      expect(adapter.exchangeName).toBe("binance");
      expect(adapter.category).toBe(FeedCategory.Crypto);
      expect(adapter.capabilities.supportsWebSocket).toBe(true);
      expect(adapter.capabilities.supportsREST).toBe(true);
      expect(adapter.capabilities.supportsVolume).toBe(true);
    });
  });

  describe("symbol mapping", () => {
    it("should map symbols correctly", () => {
      expect(adapter.getSymbolMapping("BTC/USDT")).toBe("BTCUSDT");
      expect(adapter.getSymbolMapping("ETH/USDT")).toBe("ETHUSDT");
      expect(adapter.getSymbolMapping("LTC/BTC")).toBe("LTCBTC");
    });

    it("should validate symbols correctly", () => {
      expect(adapter.validateSymbol("BTC/USDT")).toBe(true);
      expect(adapter.validateSymbol("ETH/USDT")).toBe(true);
      expect(adapter.validateSymbol("INVALID")).toBe(false);
    });
  });

  describe("symbol normalization from exchange format", () => {
    it("should normalize USDT pairs correctly", () => {
      const mockData: BinanceTickerData = {
        e: "24hrTicker",
        E: Date.now(),
        s: "BTCUSDT",
        p: "1000.00",
        P: "2.00",
        w: "50000.00",
        x: "49000.00",
        c: "50000.00",
        Q: "0.1",
        b: "49999.00",
        B: "1.0",
        a: "50001.00",
        A: "1.0",
        o: "49000.00",
        h: "51000.00",
        l: "48000.00",
        v: "1000.0",
        q: "50000000.0",
        O: Date.now() - 86400000,
        C: Date.now(),
        F: 1,
        L: 1000,
        n: 500,
      };

      const result = adapter.normalizePriceData(mockData);
      expect(result.symbol).toBe("BTC/USDT");
    });

    it("should normalize USD pairs correctly", () => {
      const mockData: BinanceTickerData = {
        e: "24hrTicker",
        E: Date.now(),
        s: "BTCUSD",
        p: "1000.00",
        P: "2.00",
        w: "50000.00",
        x: "49000.00",
        c: "50000.00",
        Q: "0.1",
        b: "49999.00",
        B: "1.0",
        a: "50001.00",
        A: "1.0",
        o: "49000.00",
        h: "51000.00",
        l: "48000.00",
        v: "1000.0",
        q: "50000000.0",
        O: Date.now() - 86400000,
        C: Date.now(),
        F: 1,
        L: 1000,
        n: 500,
      };

      const result = adapter.normalizePriceData(mockData);
      expect(result.symbol).toBe("BTC/USD");
    });

    it("should normalize USDT pairs correctly", () => {
      const mockData: BinanceTickerData = {
        e: "24hrTicker",
        E: Date.now(),
        s: "ETHUSDT",
        p: "100.0",
        P: "3.50",
        w: "2850.0",
        x: "2800.0",
        c: "2900.0",
        Q: "1.0",
        b: "2899.0",
        B: "10.0",
        a: "2901.0",
        A: "5.0",
        o: "2800.0",
        h: "2950.0",
        l: "2750.0",
        v: "10000.0",
        q: "28500000.0",
        O: Date.now() - 86400000,
        C: Date.now(),
        F: 1,
        L: 1000,
        n: 500,
      };

      const result = adapter.normalizePriceData(mockData);
      expect(result.symbol).toBe("ETH/USDT");
    });
  });

  describe("data normalization", () => {
    const mockTickerData: BinanceTickerData = {
      e: "24hrTicker",
      E: Date.now(),
      s: "BTCUSDT",
      p: "1000.00",
      P: "2.00",
      w: "50000.00",
      x: "49000.00",
      c: "50000.00",
      Q: "0.1",
      b: "49999.00",
      B: "1.0",
      a: "50001.00",
      A: "1.0",
      o: "49000.00",
      h: "51000.00",
      l: "48000.00",
      v: "1000.0",
      q: "50000000.0",
      O: Date.now() - 86400000,
      C: Date.now(),
      F: 1,
      L: 1000,
      n: 500,
    };

    it("should normalize price data correctly", () => {
      const result = adapter.normalizePriceData(mockTickerData);

      expect(result.symbol).toBe("BTC/USDT");
      expect(result.price).toBe(50000);
      expect(result.source).toBe("binance");
      expect(result.volume).toBe(1000);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(typeof result.timestamp).toBe("number");
    });

    it("should normalize volume data correctly", () => {
      const result = adapter.normalizeVolumeData(mockTickerData);

      expect(result.symbol).toBe("BTC/USDT");
      expect(result.volume).toBe(1000);
      expect(result.source).toBe("binance");
      expect(typeof result.timestamp).toBe("number");
    });

    it("should calculate confidence based on spread", () => {
      const lowSpreadData = { ...mockTickerData, b: "49999.50", a: "50000.50" };
      const highSpreadData = { ...mockTickerData, b: "49000.00", a: "51000.00" };

      const lowSpreadResult = adapter.normalizePriceData(lowSpreadData);
      const highSpreadResult = adapter.normalizePriceData(highSpreadData);

      expect(lowSpreadResult.confidence).toBeGreaterThan(highSpreadResult.confidence);
    });
  });

  describe("response validation", () => {
    it("should validate correct ticker data", () => {
      const validData: BinanceTickerData = {
        e: "24hrTicker",
        E: Date.now(),
        s: "BTCUSDT",
        p: "1000.00",
        P: "2.00",
        w: "50000.00",
        x: "49000.00",
        c: "50000.00",
        Q: "0.1",
        b: "49999.00",
        B: "1.0",
        a: "50001.00",
        A: "1.0",
        o: "49000.00",
        h: "51000.00",
        l: "48000.00",
        v: "1000.0",
        q: "50000000.0",
        O: Date.now() - 86400000,
        C: Date.now(),
        F: 1,
        L: 1000,
        n: 500,
      };

      expect(adapter.validateResponse(validData)).toBe(true);
    });

    it("should reject invalid data", () => {
      expect(adapter.validateResponse(null)).toBe(false);
      expect(adapter.validateResponse({})).toBe(false);
      expect(adapter.validateResponse({ s: "BTCUSDT" })).toBe(false);
      expect(adapter.validateResponse({ s: "BTCUSDT", c: "invalid", E: Date.now() })).toBe(false);
    });
  });

  describe("WebSocket connection", () => {
    it("should handle successful connection", async () => {
      // Mock successful connection
      jest.spyOn(adapter, "isConnected").mockReturnValue(true);

      // Test successful connection using the existing mock
      await expect(adapter.connect()).resolves.toBeUndefined();
      expect(adapter.isConnected()).toBe(true);

      // Mock disconnection
      jest.spyOn(adapter, "isConnected").mockReturnValue(false);

      // Test disconnect
      await adapter.disconnect();
      expect(adapter.isConnected()).toBe(false);
    });

    it("should handle connection errors", async () => {
      const errorSpy = jest.fn();
      adapter.onError(errorSpy);

      // Mock the doConnect method to throw an error
      jest.spyOn(adapter as any, "doConnect").mockRejectedValue(new Error("WebSocket connection failed"));

      // Ensure isConnected returns false for error case
      jest.spyOn(adapter, "isConnected").mockReturnValue(false);

      try {
        await adapter.connect();
      } catch (error) {
        expect(error).toBeDefined();
        expect(adapter.isConnected()).toBe(false);
      }
    });
  });

  describe("REST API", () => {
    it("should fetch ticker data via REST", async () => {
      const mockResponse = {
        symbol: "BTCUSDT",
        priceChange: "1000.00",
        priceChangePercent: "2.00",
        weightedAvgPrice: "50000.00",
        prevClosePrice: "49000.00",
        lastPrice: "50000.00",
        lastQty: "0.1",
        bidPrice: "49999.00",
        bidQty: "1.0",
        askPrice: "50001.00",
        askQty: "1.0",
        openPrice: "49000.00",
        highPrice: "51000.00",
        lowPrice: "48000.00",
        volume: "1000.0",
        quoteVolume: "50000000.0",
        openTime: Date.now() - 86400000,
        closeTime: Date.now(),
        firstId: 1,
        lastId: 1000,
        count: 500,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await adapter.fetchTickerREST("BTC/USDT");

      expect(result.symbol).toBe("BTC/USDT");
      expect(result.price).toBe(50000);
      expect(result.source).toBe("binance");
      expect(result.volume).toBe(1000);
    });

    it("should handle REST API errors", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      await expect(adapter.fetchTickerREST("INVALID/PAIR")).rejects.toThrow("Failed to fetch Binance ticker");
    });

    it("should handle network errors", async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("Network error"));

      await expect(adapter.fetchTickerREST("BTC/USDT")).rejects.toThrow("Failed to fetch Binance ticker");
    });

    it("should handle malformed JSON response", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.reject(new Error("Invalid JSON")),
      });

      await expect(adapter.fetchTickerREST("BTC/USDT")).rejects.toThrow("Invalid JSON");
    });
  });

  describe("health check", () => {
    it("should return true when connected", async () => {
      // Mock successful connection
      jest.spyOn(adapter, "isConnected").mockReturnValue(true);

      await adapter.connect();
      const isHealthy = await adapter.healthCheck();
      expect(isHealthy).toBe(true);
    });

    it("should check REST API when not connected", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
      });

      const isHealthy = await adapter.healthCheck();
      expect(isHealthy).toBe(true);
    });

    it("should return false when both WebSocket and REST fail", async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("Network error"));

      const isHealthy = await adapter.healthCheck();
      expect(isHealthy).toBe(false);
    });
  });

  describe("subscriptions", () => {
    it("should track subscriptions", async () => {
      // Mock successful connection
      jest.spyOn(adapter, "isConnected").mockReturnValue(true);

      await adapter.connect();
      await adapter.subscribe(["BTC/USDT", "ETH/USDT"]);

      const subscriptions = adapter.getSubscriptions();
      expect(subscriptions).toContain("btcusdt");
      expect(subscriptions).toContain("ethusdt");
    });

    it("should handle unsubscribe", async () => {
      // Mock successful connection
      jest.spyOn(adapter, "isConnected").mockReturnValue(true);

      await adapter.connect();
      await adapter.subscribe(["BTC/USDT", "ETH/USDT"]);
      await adapter.unsubscribe(["BTC/USDT"]);

      const subscriptions = adapter.getSubscriptions();
      expect(subscriptions).not.toContain("btcusdt");
      expect(subscriptions).toContain("ethusdt");
    });
  });

  describe("edge cases and error handling", () => {
    it("should handle invalid numeric values gracefully", () => {
      const invalidData: BinanceTickerData = {
        e: "24hrTicker",
        E: Date.now(),
        s: "BTCUSDT",
        p: "1000.00",
        P: "2.00",
        w: "50000.00",
        x: "49000.00",
        c: "invalid_price", // Invalid price
        Q: "0.1",
        b: "49999.00",
        B: "1.0",
        a: "50001.00",
        A: "1.0",
        o: "49000.00",
        h: "51000.00",
        l: "48000.00",
        v: "1000.0",
        q: "50000000.0",
        O: Date.now() - 86400000,
        C: Date.now(),
        F: 1,
        L: 1000,
        n: 500,
      };

      expect(() => adapter.normalizePriceData(invalidData)).toThrow("Invalid numeric value");
    });

    it("should handle WebSocket message parsing errors gracefully", () => {
      const errorSpy = jest.fn();
      adapter.onError(errorSpy);

      // Test with invalid JSON - should not crash and should not emit error
      (adapter as any).handleWebSocketMessage("invalid json");

      // Current implementation logs the error but doesn't emit it
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it("should handle empty WebSocket messages", () => {
      const errorSpy = jest.fn();
      adapter.onError(errorSpy);

      // Test with null/undefined data
      (adapter as any).handleWebSocketMessage(null);
      (adapter as any).handleWebSocketMessage(undefined);

      // Should not throw or call error callback for null/undefined
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it("should handle array of invalid ticker data", () => {
      const priceUpdateSpy = jest.fn();
      adapter.onPriceUpdate(priceUpdateSpy);

      const invalidArray = [{ invalid: "data" }, { s: "BTCUSDT", c: "invalid_price" }, null];

      (adapter as any).handleWebSocketMessage(invalidArray);

      // Should not call price update for invalid data
      expect(priceUpdateSpy).not.toHaveBeenCalled();
    });

    it("should handle connection retry logic", async () => {
      let connectionAttempts = 0;

      // Temporarily enable retries for this test
      (adapter as any).maxRetries = 2;
      (adapter as any).retryDelay = 1; // Very short delay for testing

      // Mock the sleep method to avoid delays in tests
      const originalSleep = (adapter as any).sleep;
      (adapter as any).sleep = jest.fn().mockResolvedValue(undefined);

      // Override the doConnect method to simulate failures
      const originalDoConnect = (adapter as any).doConnect;
      (adapter as any).doConnect = jest.fn().mockImplementation(async () => {
        connectionAttempts++;
        if (connectionAttempts < 3) {
          throw new Error("Connection failed");
        }
        // Mock successful connection on 3rd attempt
        return Promise.resolve();
      });

      // Mock the isConnected method to return true after successful connection
      const originalIsConnected = adapter.isConnected;
      jest.spyOn(adapter, "isConnected").mockImplementation(() => {
        return connectionAttempts >= 3;
      });

      // Should eventually succeed after retries (maxRetries=2 means 3 total attempts: 0,1,2)
      await expect(adapter.connect()).resolves.toBeUndefined();
      expect(connectionAttempts).toBe(3);
      expect(adapter.isConnected()).toBe(true);

      // Restore original methods and settings
      (adapter as any).doConnect = originalDoConnect;
      (adapter as any).sleep = originalSleep;
      adapter.isConnected = originalIsConnected;
      (adapter as any).maxRetries = 0;
      (adapter as any).retryDelay = 0;
    });

    it("should handle subscription to empty symbol list", async () => {
      // Mock successful connection
      jest.spyOn(adapter, "isConnected").mockReturnValue(true);

      await adapter.connect();

      // Should throw for empty array (base adapter behavior)
      await expect(adapter.subscribe([])).rejects.toThrow("No valid symbols provided for subscription");
      // Unsubscribe should not throw for empty array
      await expect(adapter.unsubscribe([])).resolves.toBeUndefined();
    });

    it("should handle subscription when not connected", async () => {
      // Should throw when not connected
      await expect(adapter.subscribe(["BTC/USDT"])).rejects.toThrow("not connected");
    });

    it("should handle malformed symbol normalization", () => {
      // Test edge cases in symbol normalization
      expect((adapter as any).normalizeSymbolFromExchange("")).toBe("");
      expect((adapter as any).normalizeSymbolFromExchange("INVALID")).toBe("INVALID");
      expect((adapter as any).normalizeSymbolFromExchange("BTC")).toBe("BTC");
    });

    it("should handle confidence calculation edge cases", () => {
      const mockData: BinanceTickerData = {
        e: "24hrTicker",
        E: Date.now(),
        s: "BTCUSDT",
        p: "1000.00",
        P: "2.00",
        w: "50000.00",
        x: "49000.00",
        c: "50000.00",
        Q: "0.1",
        b: "0", // Zero bid
        B: "1.0",
        a: "0", // Zero ask
        A: "1.0",
        o: "49000.00",
        h: "51000.00",
        l: "48000.00",
        v: "0", // Zero volume
        q: "50000000.0",
        O: Date.now() - 86400000,
        C: Date.now(),
        F: 1,
        L: 1000,
        n: 500,
      };

      const result = adapter.normalizePriceData(mockData);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it("should handle cleanup properly", async () => {
      // Mock successful connection initially
      jest.spyOn(adapter, "isConnected").mockReturnValue(true);

      await adapter.connect();
      await adapter.subscribe(["BTC/USDT"]);

      // Mock disconnection after cleanup
      jest.spyOn(adapter, "isConnected").mockReturnValue(false);

      // Should not throw during cleanup
      await expect(adapter.cleanup()).resolves.toBeUndefined();
      expect(adapter.isConnected()).toBe(false);
      expect(adapter.getSubscriptions()).toHaveLength(0);
    });

    it("should handle ping message when not connected", () => {
      // Should not throw when WebSocket is not connected
      expect(() => (adapter as any).sendPingMessage()).not.toThrow();
    });

    it("should handle very old timestamps", () => {
      const oldData: BinanceTickerData = {
        e: "24hrTicker",
        E: 1000000000, // Very old timestamp (2001)
        s: "BTCUSDT",
        p: "1000.00",
        P: "2.00",
        w: "50000.00",
        x: "49000.00",
        c: "50000.00",
        Q: "0.1",
        b: "49999.00",
        B: "1.0",
        a: "50001.00",
        A: "1.0",
        o: "49000.00",
        h: "51000.00",
        l: "48000.00",
        v: "1000.0",
        q: "50000000.0",
        O: Date.now() - 86400000,
        C: Date.now(),
        F: 1,
        L: 1000,
        n: 500,
      };

      const result = adapter.normalizePriceData(oldData);
      expect(result.confidence).toBeLessThan(1); // Should have reduced confidence due to high latency
    });
  });
});
