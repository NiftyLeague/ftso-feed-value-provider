import { CryptocomAdapter, CryptocomTickerData, CryptocomRestResponse } from "../cryptocom.adapter";
import { FeedCategory } from "@/types/feed-category.enum";

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen?: () => void;
  onclose?: () => void;
  onerror?: (error: any) => void;
  onmessage?: (event: { data: string }) => void;

  constructor(public url: string) {
    // Simulate connection opening
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.();
    }, 10);
  }

  send(data: string) {
    // Mock send method
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  // Simulate receiving a message
  simulateMessage(data: any) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  // Simulate connection error
  simulateError(error: any) {
    this.readyState = MockWebSocket.CLOSED;
    this.onerror?.(error);
  }
}

// Mock fetch
global.fetch = jest.fn();
(global as any).WebSocket = MockWebSocket;

describe("CryptocomAdapter", () => {
  let adapter: CryptocomAdapter;
  let mockWebSocket: MockWebSocket;

  const mockTickerData: CryptocomTickerData = {
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

  beforeEach(() => {
    adapter = new CryptocomAdapter();
    jest.clearAllMocks();
  });

  afterEach(async () => {
    if (adapter.isConnected()) {
      await adapter.disconnect();
    }
  });

  describe("initialization", () => {
    it("should initialize with correct properties", () => {
      expect(adapter.exchangeName).toBe("cryptocom");
      expect(adapter.category).toBe(FeedCategory.Crypto);
      expect(adapter.capabilities.supportsWebSocket).toBe(true);
      expect(adapter.capabilities.supportsREST).toBe(true);
      expect(adapter.capabilities.supportsVolume).toBe(true);
      expect(adapter.capabilities.supportsOrderBook).toBe(true);
    });

    it("should not be connected initially", () => {
      expect(adapter.isConnected()).toBe(false);
    });
  });

  describe("connection management", () => {
    it("should connect successfully", async () => {
      await adapter.connect();
      expect(adapter.isConnected()).toBe(true);
    });

    it("should handle connection errors", async () => {
      // Mock WebSocket constructor to throw error
      const originalWebSocket = global.WebSocket;
      (global as any).WebSocket = jest.fn().mockImplementation(() => {
        throw new Error("Connection failed");
      });

      await expect(adapter.connect()).rejects.toThrow("Connection failed");
      expect(adapter.isConnected()).toBe(false);

      // Restore original WebSocket
      global.WebSocket = originalWebSocket;
    });

    it("should not reconnect if already connected", async () => {
      await adapter.connect();
      const firstConnection = (adapter as any).wsConnection;

      await adapter.connect();
      const secondConnection = (adapter as any).wsConnection;

      expect(firstConnection).toBe(secondConnection);
    });

    it("should disconnect properly", async () => {
      await adapter.connect();
      expect(adapter.isConnected()).toBe(true);

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

  describe("WebSocket functionality", () => {
    beforeEach(async () => {
      await adapter.connect();
      mockWebSocket = (adapter as any).wsConnection;
    });

    it("should handle ticker messages", () => {
      const priceUpdateCallback = jest.fn();
      adapter.onPriceUpdate(priceUpdateCallback);

      const message = {
        method: "subscription",
        result: {
          channel: "ticker",
          subscription: "ticker.BTC_USDT",
          data: [mockTickerData],
        },
      };

      mockWebSocket.simulateMessage(message);

      expect(priceUpdateCallback).toHaveBeenCalledTimes(1);
      const priceUpdate = priceUpdateCallback.mock.calls[0][0];
      expect(priceUpdate.symbol).toBe("BTC/USDT");
      expect(priceUpdate.price).toBe(50000.5);
    });

    it("should handle multiple tickers in one message", () => {
      const priceUpdateCallback = jest.fn();
      adapter.onPriceUpdate(priceUpdateCallback);

      const message = {
        method: "subscription",
        result: {
          channel: "ticker",
          subscription: "ticker.BTC_USDT",
          data: [mockTickerData, { ...mockTickerData, i: "ETH_USDT", a: "3000.0" }],
        },
      };

      mockWebSocket.simulateMessage(message);

      expect(priceUpdateCallback).toHaveBeenCalledTimes(2);
    });

    it("should ignore heartbeat messages", () => {
      const priceUpdateCallback = jest.fn();
      adapter.onPriceUpdate(priceUpdateCallback);

      mockWebSocket.simulateMessage({ method: "public/heartbeat" });

      expect(priceUpdateCallback).not.toHaveBeenCalled();
    });

    it("should ignore subscription confirmations", () => {
      const priceUpdateCallback = jest.fn();
      adapter.onPriceUpdate(priceUpdateCallback);

      mockWebSocket.simulateMessage({ method: "subscribe", code: 0 });

      expect(priceUpdateCallback).not.toHaveBeenCalled();
    });

    it("should handle malformed messages gracefully", () => {
      const priceUpdateCallback = jest.fn();
      adapter.onPriceUpdate(priceUpdateCallback);

      // Simulate malformed JSON
      mockWebSocket.onmessage?.({ data: "invalid json" });

      expect(priceUpdateCallback).not.toHaveBeenCalled();
    });
  });

  describe("subscription management", () => {
    beforeEach(async () => {
      await adapter.connect();
      mockWebSocket = (adapter as any).wsConnection;
    });

    it("should subscribe to symbols", async () => {
      const sendSpy = jest.spyOn(mockWebSocket, "send");

      await adapter.subscribe(["BTC/USDT", "ETH/USDT"]);

      expect(sendSpy).toHaveBeenCalledTimes(2);
      expect(adapter.getSubscriptions()).toContain("BTC_USDT");
      expect(adapter.getSubscriptions()).toContain("ETH_USDT");
    });

    it("should not subscribe to the same symbol twice", async () => {
      const sendSpy = jest.spyOn(mockWebSocket, "send");

      await adapter.subscribe(["BTC/USDT"]);
      await adapter.subscribe(["BTC/USDT"]);

      expect(sendSpy).toHaveBeenCalledTimes(1);
    });

    it("should unsubscribe from symbols", async () => {
      const sendSpy = jest.spyOn(mockWebSocket, "send");

      await adapter.subscribe(["BTC/USDT"]);
      await adapter.unsubscribe(["BTC/USDT"]);

      expect(sendSpy).toHaveBeenCalledTimes(2); // 1 subscribe + 1 unsubscribe
      expect(adapter.getSubscriptions()).not.toContain("BTC_USDT");
    });

    it("should handle subscription when not connected", async () => {
      await adapter.disconnect();

      await expect(adapter.subscribe(["BTC/USDT"])).rejects.toThrow("Crypto.com WebSocket not connected");
    });

    it("should handle unsubscription when not connected", async () => {
      await adapter.disconnect();

      // Should not throw
      await expect(adapter.unsubscribe(["BTC/USDT"])).resolves.toBeUndefined();
    });
  });

  describe("REST API functionality", () => {
    it("should fetch ticker data via REST", async () => {
      const mockResponse: CryptocomRestResponse = {
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
      const mockErrorResponse: CryptocomRestResponse = {
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
      const mockEmptyResponse: CryptocomRestResponse = {
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
        "Failed to fetch Crypto.com ticker for BTC/USDT"
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

    it("should call connection change callback on error", async () => {
      await adapter.connect();

      const connectionCallback = jest.fn();
      adapter.onConnectionChange(connectionCallback);

      mockWebSocket = (adapter as any).wsConnection;
      mockWebSocket.simulateError(new Error("Connection error"));

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
      const mockResponse: CryptocomRestResponse = {
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
      const mockErrorResponse: CryptocomRestResponse = {
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
    it("should have heartbeat interval after connection", async () => {
      await adapter.connect();

      // Check that heartbeat interval is set
      const pingInterval = (adapter as any).pingInterval;
      expect(pingInterval).toBeDefined();
    });

    it("should clear heartbeat interval on disconnection", async () => {
      await adapter.connect();
      await adapter.disconnect();

      // Check that heartbeat interval is cleared
      const pingInterval = (adapter as any).pingInterval;
      expect(pingInterval).toBeUndefined();
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
      mockWebSocket = (adapter as any).wsConnection;
    });

    it("should increment message ID for each request", async () => {
      const sendSpy = jest.spyOn(mockWebSocket, "send");

      await adapter.subscribe(["BTC/USDT"]);
      await adapter.subscribe(["ETH/USDT"]);

      expect(sendSpy).toHaveBeenCalledTimes(2);

      // Check that different message IDs were used
      const firstCall = JSON.parse(sendSpy.mock.calls[0][0]);
      const secondCall = JSON.parse(sendSpy.mock.calls[1][0]);

      expect(firstCall.id).toBeDefined();
      expect(secondCall.id).toBeDefined();
      expect(firstCall.id).not.toBe(secondCall.id);
    });
  });
});
