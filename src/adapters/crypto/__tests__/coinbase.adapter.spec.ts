import { CoinbaseAdapter, CoinbaseTickerData } from "../coinbase.adapter";
import { FeedCategory } from "@/common/types/core";

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen?: () => void;
  onclose?: () => void;
  onerror?: (error: Error | Event) => void;
  onmessage?: (event: { data: string }) => void;

  constructor(public url: string) {
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.();
    }, 1);
  }

  send(_data: string) {
    // Mock send implementation
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

// Mock fetch
global.fetch = jest.fn();
global.WebSocket = MockWebSocket as any;

describe("CoinbaseAdapter", () => {
  let adapter: CoinbaseAdapter;

  beforeEach(() => {
    adapter = new CoinbaseAdapter();

    // Disable reconnection attempts during tests to prevent hanging
    (adapter as any).maxReconnectAttempts = 0;

    jest.clearAllMocks();
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  describe("initialization", () => {
    it("should initialize with correct properties", () => {
      expect(adapter.exchangeName).toBe("coinbase");
      expect(adapter.category).toBe(FeedCategory.Crypto);
      expect(adapter.capabilities.supportsWebSocket).toBe(true);
      expect(adapter.capabilities.supportsREST).toBe(true);
      expect(adapter.capabilities.supportsVolume).toBe(true);
    });
  });

  describe("symbol mapping", () => {
    it("should map symbols correctly", () => {
      expect(adapter.getSymbolMapping("BTC/USD")).toBe("BTC-USD");
      expect(adapter.getSymbolMapping("ETH/USD")).toBe("ETH-USD");
      expect(adapter.getSymbolMapping("LTC/BTC")).toBe("LTC-BTC");
    });

    it("should validate symbols correctly", () => {
      expect(adapter.validateSymbol("BTC/USD")).toBe(true);
      expect(adapter.validateSymbol("ETH/USD")).toBe(true);
      expect(adapter.validateSymbol("INVALID")).toBe(false);
    });
  });

  describe("data normalization", () => {
    const mockTickerData: CoinbaseTickerData = {
      type: "ticker",
      sequence: 123456,
      product_id: "BTC-USD",
      price: "50000.00",
      open_24h: "49000.00",
      volume_24h: "1000.0",
      low_24h: "48000.00",
      high_24h: "51000.00",
      volume_30d: "30000.0",
      best_bid: "49999.00",
      best_ask: "50001.00",
      side: "buy",
      time: new Date().toISOString(),
      trade_id: 789,
      last_size: "0.1",
    };

    it("should normalize price data correctly", () => {
      const result = adapter.normalizePriceData(mockTickerData);

      expect(result.symbol).toBe("BTC/USD");
      expect(result.price).toBe(50000);
      expect(result.source).toBe("coinbase");
      expect(result.volume).toBe(1000);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(typeof result.timestamp).toBe("number");
    });

    it("should normalize volume data correctly", () => {
      const result = adapter.normalizeVolumeData(mockTickerData);

      expect(result.symbol).toBe("BTC/USD");
      expect(result.volume).toBe(1000);
      expect(result.source).toBe("coinbase");
      expect(typeof result.timestamp).toBe("number");
    });

    it("should calculate confidence based on spread", () => {
      const lowSpreadData = { ...mockTickerData, best_bid: "49999.50", best_ask: "50000.50" };
      const highSpreadData = { ...mockTickerData, best_bid: "49000.00", best_ask: "51000.00" };

      const lowSpreadResult = adapter.normalizePriceData(lowSpreadData);
      const highSpreadResult = adapter.normalizePriceData(highSpreadData);

      expect(lowSpreadResult.confidence).toBeGreaterThan(highSpreadResult.confidence);
    });
  });

  describe("response validation", () => {
    it("should validate correct ticker data", () => {
      const validData: CoinbaseTickerData = {
        type: "ticker",
        sequence: 123456,
        product_id: "BTC-USD",
        price: "50000.00",
        open_24h: "49000.00",
        volume_24h: "1000.0",
        low_24h: "48000.00",
        high_24h: "51000.00",
        volume_30d: "30000.0",
        best_bid: "49999.00",
        best_ask: "50001.00",
        side: "buy",
        time: new Date().toISOString(),
        trade_id: 789,
        last_size: "0.1",
      };

      expect(adapter.validateResponse(validData)).toBe(true);
    });

    it("should reject invalid data", () => {
      expect(adapter.validateResponse(null)).toBe(false);
      expect(adapter.validateResponse({})).toBe(false);
      expect(adapter.validateResponse({ product_id: "BTC-USD" })).toBe(false);
      expect(adapter.validateResponse({ product_id: "BTC-USD", price: "invalid" })).toBe(false);
    });
  });

  describe("WebSocket connection", () => {
    it("should handle all connection scenarios", async () => {
      // Mock WebSocket constants
      const WebSocketMock = {
        CONNECTING: 0,
        OPEN: 1,
        CLOSING: 2,
        CLOSED: 3,
      };

      // Mock WebSocket constructor and instance
      const mockWebSocket = {
        readyState: WebSocketMock.OPEN,
        url: "wss://ws-feed.exchange.coinbase.com",
        protocol: "",
        on: jest.fn((event, callback) => {
          if (event === "open") {
            // Simulate successful connection immediately
            setTimeout(() => callback(), 0);
          }
        }),
        close: jest.fn((_code?: number, _reason?: string) => {
          mockWebSocket.readyState = WebSocketMock.CLOSED;
        }),
        send: jest.fn(),
        ping: jest.fn(),
      };

      // Store reference to the mock so we can track calls
      const originalWebSocket = global.WebSocket;
      global.WebSocket = jest.fn().mockImplementation(() => {
        (adapter as any).ws = mockWebSocket;
        return mockWebSocket;
      }) as any;

      // Add WebSocket constants to global
      (global.WebSocket as any).OPEN = WebSocketMock.OPEN;
      (global.WebSocket as any).CLOSED = WebSocketMock.CLOSED;

      // Test successful connection
      await expect(adapter.connect()).resolves.toBeUndefined();
      expect(adapter.isConnected()).toBe(true);

      // Test disconnect
      await adapter.disconnect(1000, "Normal closure");
      // After disconnect, adapter should not be connected
      expect(adapter.isConnected()).toBe(false);

      // Restore original WebSocket
      global.WebSocket = originalWebSocket;

      // Test disconnection when not connected
      await adapter.disconnect();
      // After disconnect, adapter should not be connected
      expect(adapter.isConnected()).toBe(false);

      // Test that connection can be attempted multiple times
      expect(adapter.isConnected()).toBe(false);
    });

    it("should handle disconnection errors gracefully", async () => {
      // Mock WebSocket that throws error on close
      const mockWebSocket = {
        readyState: 1, // WebSocket.OPEN
        url: "wss://ws-feed.exchange.coinbase.com",
        protocol: "",
        on: jest.fn((event, callback) => {
          if (event === "open") {
            // Simulate successful connection immediately
            setTimeout(() => callback(), 0);
          }
        }),
        close: jest.fn().mockImplementation(() => {
          throw new Error("Failed to close");
        }),
        send: jest.fn(),
        ping: jest.fn(),
      };

      // Mock WebSocket constructor
      const originalWebSocket = global.WebSocket;
      global.WebSocket = jest.fn().mockImplementation(() => mockWebSocket) as any;

      await adapter.connect();
      // Should handle close error gracefully and not throw
      await expect(adapter.disconnect()).resolves.toBeUndefined();
      expect(adapter.isConnected()).toBe(false);

      // Restore original WebSocket
      global.WebSocket = originalWebSocket;
    });

    it("should handle error callbacks properly", async () => {
      const errorSpy = jest.fn();
      adapter.onError(errorSpy);

      // Mock WebSocket that throws error on construction
      const originalWebSocket = global.WebSocket;
      global.WebSocket = jest.fn().mockImplementation(() => {
        throw new Error("WebSocket connection failed");
      }) as any;

      try {
        await adapter.connect();
      } catch (error) {
        expect(error).toBeDefined();
        expect(adapter.isConnected()).toBe(false);
      }

      // Restore original WebSocket
      global.WebSocket = originalWebSocket;
    });
  });

  describe("REST API", () => {
    it("should fetch ticker data via REST", async () => {
      const mockResponse = {
        ask: "50001.00",
        bid: "49999.00",
        volume: "1000.0",
        trade_id: 789,
        price: "50000.00",
        size: "0.1",
        time: new Date().toISOString(),
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await adapter.fetchTickerREST("BTC/USD");

      expect(result.symbol).toBe("BTC/USD");
      expect(result.price).toBe(50000);
      expect(result.source).toBe("coinbase");
      expect(result.volume).toBe(1000);
    });

    it("should handle REST API errors", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      await expect(adapter.fetchTickerREST("INVALID/PAIR")).rejects.toThrow("Failed to fetch Coinbase ticker");
    });

    it("should handle network errors in REST API", async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("Network error"));

      await expect(adapter.fetchTickerREST("BTC/USD")).rejects.toThrow("Failed to fetch Coinbase ticker");
    });

    it("should handle malformed JSON in REST API", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.reject(new Error("Invalid JSON")),
      });

      await expect(adapter.fetchTickerREST("BTC/USD")).rejects.toThrow("Invalid JSON");
    });
  });

  describe("health check", () => {
    it("should return true when connected", async () => {
      // Mock WebSocket for connection
      const mockWebSocket = {
        readyState: 1, // OPEN
        on: jest.fn((event, callback) => {
          if (event === "open") setTimeout(() => callback(), 0);
        }),
        close: jest.fn(),
        send: jest.fn(),
        ping: jest.fn(),
      };

      const originalWebSocket = global.WebSocket;
      global.WebSocket = jest.fn().mockImplementation(() => mockWebSocket) as any;

      await adapter.connect();
      const isHealthy = await adapter.healthCheck();
      expect(isHealthy).toBe(true);

      global.WebSocket = originalWebSocket;
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
      // Mock WebSocket for connection
      const mockWebSocket = {
        readyState: 1, // OPEN
        on: jest.fn((event, callback) => {
          if (event === "open") setTimeout(() => callback(), 0);
        }),
        close: jest.fn(),
        send: jest.fn(),
        ping: jest.fn(),
      };

      const originalWebSocket = global.WebSocket;
      global.WebSocket = jest.fn().mockImplementation(() => mockWebSocket) as any;

      await adapter.connect();
      await adapter.subscribe(["BTC/USD", "ETH/USD"]);

      const subscriptions = adapter.getSubscriptions();
      expect(subscriptions).toContain("BTC-USD");
      expect(subscriptions).toContain("ETH-USD");

      global.WebSocket = originalWebSocket;
    });

    it("should handle unsubscribe", async () => {
      // Mock WebSocket for connection
      const mockWebSocket = {
        readyState: 1, // OPEN
        on: jest.fn((event, callback) => {
          if (event === "open") setTimeout(() => callback(), 0);
        }),
        close: jest.fn(),
        send: jest.fn(),
        ping: jest.fn(),
      };

      const originalWebSocket = global.WebSocket;
      global.WebSocket = jest.fn().mockImplementation(() => mockWebSocket) as any;

      await adapter.connect();
      await adapter.subscribe(["BTC/USD", "ETH/USD"]);
      await adapter.unsubscribe(["BTC/USD"]);

      const subscriptions = adapter.getSubscriptions();
      expect(subscriptions).not.toContain("BTC-USD");
      expect(subscriptions).toContain("ETH-USD");

      global.WebSocket = originalWebSocket;
    });
  });

  describe("edge cases and error handling", () => {
    it("should handle missing volume data", () => {
      const dataWithoutVolume: CoinbaseTickerData = {
        type: "ticker",
        sequence: 123456,
        product_id: "BTC-USD",
        price: "50000.00",
        open_24h: "49000.00",
        volume_24h: "", // Empty volume
        low_24h: "48000.00",
        high_24h: "51000.00",
        volume_30d: "30000.0",
        best_bid: "49999.00",
        best_ask: "50001.00",
        side: "buy",
        time: new Date().toISOString(),
        trade_id: 789,
        last_size: "0.1",
      };

      const result = adapter.normalizePriceData(dataWithoutVolume);
      expect(result.volume).toBeUndefined();
    });

    it("should handle missing bid/ask data", () => {
      const dataWithoutBidAsk: CoinbaseTickerData = {
        type: "ticker",
        sequence: 123456,
        product_id: "BTC-USD",
        price: "50000.00",
        open_24h: "49000.00",
        volume_24h: "1000.0",
        low_24h: "48000.00",
        high_24h: "51000.00",
        volume_30d: "30000.0",
        best_bid: "", // Empty bid
        best_ask: "", // Empty ask
        side: "buy",
        time: new Date().toISOString(),
        trade_id: 789,
        last_size: "0.1",
      };

      const result = adapter.normalizePriceData(dataWithoutBidAsk);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it("should handle WebSocket error messages", () => {
      const errorSpy = jest.fn();
      adapter.onError(errorSpy);

      const errorMessage = {
        type: "error",
        message: "Invalid subscription",
        reason: "product not found",
      };

      (adapter as any).handleWebSocketMessage(errorMessage);

      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("WebSocket error"),
        })
      );
    });

    it("should handle non-ticker WebSocket messages", () => {
      const priceUpdateSpy = jest.fn();
      adapter.onPriceUpdate(priceUpdateSpy);

      const subscriptionMessage = {
        type: "subscriptions",
        channels: [{ name: "ticker", product_ids: ["BTC-USD"] }],
      };

      (adapter as any).handleWebSocketMessage(subscriptionMessage);

      // Should not trigger price update for non-ticker messages
      expect(priceUpdateSpy).not.toHaveBeenCalled();
    });

    it("should handle invalid timestamp formats", () => {
      const invalidTimeData: CoinbaseTickerData = {
        type: "ticker",
        sequence: 123456,
        product_id: "BTC-USD",
        price: "50000.00",
        open_24h: "49000.00",
        volume_24h: "1000.0",
        low_24h: "48000.00",
        high_24h: "51000.00",
        volume_30d: "30000.0",
        best_bid: "49999.00",
        best_ask: "50001.00",
        side: "buy",
        time: "invalid-timestamp",
        trade_id: 789,
        last_size: "0.1",
      };

      // Should not throw, should use current time as fallback
      const result = adapter.normalizePriceData(invalidTimeData);
      expect(typeof result.timestamp).toBe("number");
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it("should handle subscription to already subscribed symbols", async () => {
      await adapter.connect();

      // Subscribe twice to the same symbol
      await adapter.subscribe(["BTC/USD"]);
      await adapter.subscribe(["BTC/USD"]);

      const subscriptions = adapter.getSubscriptions();
      expect(subscriptions.filter(s => s === "BTC-USD")).toHaveLength(1);
    });

    it("should handle unsubscription from non-subscribed symbols", async () => {
      await adapter.connect();

      // Should not throw when unsubscribing from non-subscribed symbol
      await expect(adapter.unsubscribe(["ETH/USD"])).resolves.toBeUndefined();
    });

    it("should handle WebSocket close during active subscriptions", async () => {
      const mockWebSocket = {
        readyState: 1, // OPEN
        on: jest.fn((event, callback) => {
          if (event === "open") setTimeout(() => callback(), 0);
        }),
        close: jest.fn(),
        send: jest.fn(),
        ping: jest.fn(),
      };

      const originalWebSocket = global.WebSocket;
      global.WebSocket = jest.fn().mockImplementation(() => mockWebSocket) as any;

      await adapter.connect();
      await adapter.subscribe(["BTC/USD"]);

      // Simulate WebSocket close
      mockWebSocket.readyState = 3; // CLOSED
      (adapter as any).handleWebSocketClose();

      expect(adapter.isConnected()).toBe(false);

      global.WebSocket = originalWebSocket;
    });

    it("should handle very large price values", () => {
      const largeValueData: CoinbaseTickerData = {
        type: "ticker",
        sequence: 123456,
        product_id: "BTC-USD",
        price: "999999999.99",
        open_24h: "999999998.99",
        volume_24h: "1000000000.0",
        low_24h: "999999997.99",
        high_24h: "1000000000.99",
        volume_30d: "30000000000.0",
        best_bid: "999999999.98",
        best_ask: "999999999.99",
        side: "buy",
        time: new Date().toISOString(),
        trade_id: 789,
        last_size: "0.1",
      };

      const result = adapter.normalizePriceData(largeValueData);
      expect(result.price).toBe(999999999.99);
      expect(result.volume).toBe(1000000000);
    });

    it("should handle zero and negative values gracefully", () => {
      const zeroValueData: CoinbaseTickerData = {
        type: "ticker",
        sequence: 123456,
        product_id: "BTC-USD",
        price: "0.00",
        open_24h: "0.00",
        volume_24h: "0.0",
        low_24h: "0.00",
        high_24h: "0.00",
        volume_30d: "0.0",
        best_bid: "0.00",
        best_ask: "0.00",
        side: "buy",
        time: new Date().toISOString(),
        trade_id: 789,
        last_size: "0.0",
      };

      const result = adapter.normalizePriceData(zeroValueData);
      expect(result.price).toBe(0);
      expect(result.volume).toBe(0);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
    });

    it("should handle cleanup with active WebSocket", async () => {
      await adapter.connect();
      await adapter.subscribe(["BTC/USD"]);

      // Should cleanup without throwing
      await expect(adapter.cleanup()).resolves.toBeUndefined();
      expect(adapter.isConnected()).toBe(false);
      expect(adapter.getSubscriptions()).toHaveLength(0);
    });

    it("should handle multiple rapid connect/disconnect cycles", async () => {
      for (let i = 0; i < 5; i++) {
        await adapter.connect();
        await adapter.disconnect();
      }

      // Should end in disconnected state
      expect(adapter.isConnected()).toBe(false);
    });

    it("should validate response with edge case data", () => {
      // Valid minimal data
      expect(
        adapter.validateResponse({
          type: "ticker",
          product_id: "BTC-USD",
          price: "50000.00",
          time: new Date().toISOString(),
        })
      ).toBe(true);

      // Missing required fields
      expect(
        adapter.validateResponse({
          type: "ticker",
          product_id: "BTC-USD",
          // Missing price
          time: new Date().toISOString(),
        })
      ).toBe(false);

      // Wrong type
      expect(
        adapter.validateResponse({
          type: "heartbeat",
          product_id: "BTC-USD",
          price: "50000.00",
          time: new Date().toISOString(),
        })
      ).toBe(false);
    });
  });
});
