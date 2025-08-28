import { OkxAdapter, OkxTickerData, OkxRestResponse } from "../okx.adapter";
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

describe("OkxAdapter", () => {
  let adapter: OkxAdapter;
  let mockWebSocket: MockWebSocket;

  const mockTickerData: OkxTickerData = {
    instType: "SPOT",
    instId: "BTC-USDT",
    last: "50000.5",
    lastSz: "0.001",
    askPx: "50001.0",
    askSz: "1.5",
    bidPx: "49999.0",
    bidSz: "2.0",
    open24h: "49500.0",
    high24h: "50500.0",
    low24h: "49000.0",
    volCcy24h: "1000000.0",
    vol24h: "20.0",
    ts: "1640995200000",
    sodUtc0: "49800.0",
    sodUtc8: "49900.0",
  };

  beforeEach(() => {
    adapter = new OkxAdapter();
    jest.clearAllMocks();
  });

  afterEach(async () => {
    if (adapter.isConnected()) {
      await adapter.disconnect();
    }
  });

  describe("initialization", () => {
    it("should initialize with correct properties", () => {
      expect(adapter.exchangeName).toBe("okx");
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
      expect(result.source).toBe("okx");
      expect(result.volume).toBe(20.0);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it("should normalize volume data correctly", () => {
      const result = adapter.normalizeVolumeData(mockTickerData);

      expect(result.symbol).toBe("BTC/USDT");
      expect(result.volume).toBe(20.0);
      expect(result.timestamp).toBe(1640995200000);
      expect(result.source).toBe("okx");
    });

    it("should handle symbol mapping correctly", () => {
      expect(adapter.getSymbolMapping("BTC/USDT")).toBe("BTC-USDT");
      expect(adapter.getSymbolMapping("ETH/USD")).toBe("ETH-USD");
      expect(adapter.getSymbolMapping("ADA/BTC")).toBe("ADA-BTC");
    });
  });

  describe("response validation", () => {
    it("should validate correct ticker data", () => {
      expect(adapter.validateResponse(mockTickerData)).toBe(true);
    });

    it("should reject invalid data", () => {
      expect(adapter.validateResponse(null)).toBe(false);
      expect(adapter.validateResponse({})).toBe(false);
      expect(adapter.validateResponse({ instId: "BTC-USDT" })).toBe(false);
      expect(adapter.validateResponse({ last: "50000" })).toBe(false);
      expect(adapter.validateResponse({ instId: "BTC-USDT", last: "invalid" })).toBe(false);
    });

    it("should handle missing required fields", () => {
      const invalidData = { ...mockTickerData };
      delete (invalidData as any).instId;
      expect(adapter.validateResponse(invalidData)).toBe(false);

      const invalidData2 = { ...mockTickerData };
      delete (invalidData2 as any).last;
      expect(adapter.validateResponse(invalidData2)).toBe(false);

      const invalidData3 = { ...mockTickerData };
      delete (invalidData3 as any).ts;
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
        arg: {
          channel: "tickers",
          instId: "BTC-USDT",
        },
        data: [mockTickerData],
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
        arg: {
          channel: "tickers",
          instId: "BTC-USDT",
        },
        data: [mockTickerData, { ...mockTickerData, instId: "ETH-USDT", last: "3000.0" }],
      };

      mockWebSocket.simulateMessage(message);

      expect(priceUpdateCallback).toHaveBeenCalledTimes(2);
    });

    it("should ignore pong messages", () => {
      const priceUpdateCallback = jest.fn();
      adapter.onPriceUpdate(priceUpdateCallback);

      mockWebSocket.simulateMessage({ event: "pong" });

      expect(priceUpdateCallback).not.toHaveBeenCalled();
    });

    it("should ignore subscription confirmations", () => {
      const priceUpdateCallback = jest.fn();
      adapter.onPriceUpdate(priceUpdateCallback);

      mockWebSocket.simulateMessage({ event: "subscribe" });

      expect(priceUpdateCallback).not.toHaveBeenCalled();
    });

    it("should handle malformed messages gracefully", () => {
      const priceUpdateCallback = jest.fn();
      adapter.onPriceUpdate(priceUpdateCallback);

      // Suppress console.error for this expected error
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      // Simulate malformed JSON
      mockWebSocket.onmessage?.({ data: "invalid json" });

      expect(priceUpdateCallback).not.toHaveBeenCalled();

      // Restore console.error
      consoleSpy.mockRestore();
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
      expect(adapter.getSubscriptions()).toContain("BTC-USDT");
      expect(adapter.getSubscriptions()).toContain("ETH-USDT");
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
      expect(adapter.getSubscriptions()).not.toContain("BTC-USDT");
    });

    it("should handle subscription when not connected", async () => {
      await adapter.disconnect();

      await expect(adapter.subscribe(["BTC/USDT"])).rejects.toThrow("OKX WebSocket not connected");
    });

    it("should handle unsubscription when not connected", async () => {
      await adapter.disconnect();

      // Should not throw
      await expect(adapter.unsubscribe(["BTC/USDT"])).resolves.toBeUndefined();
    });
  });

  describe("REST API functionality", () => {
    it("should fetch ticker data via REST", async () => {
      const mockResponse: OkxRestResponse = {
        code: "0",
        msg: "",
        data: [mockTickerData],
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await adapter.fetchTickerREST("BTC/USDT");

      expect(result.symbol).toBe("BTC/USDT");
      expect(result.price).toBe(50000.5);
      expect(result.source).toBe("okx");
      expect(global.fetch).toHaveBeenCalledWith("https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT");
    });

    it("should handle REST API errors", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      await expect(adapter.fetchTickerREST("BTC/USDT")).rejects.toThrow("HTTP 500: Internal Server Error");
    });

    it("should handle OKX API error responses", async () => {
      const mockErrorResponse: OkxRestResponse = {
        code: "50001",
        msg: "Invalid symbol",
        data: [],
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockErrorResponse,
      });

      await expect(adapter.fetchTickerREST("INVALID/SYMBOL")).rejects.toThrow("OKX API error: Invalid symbol");
    });

    it("should handle empty data response", async () => {
      const mockEmptyResponse: OkxRestResponse = {
        code: "0",
        msg: "",
        data: [],
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockEmptyResponse,
      });

      await expect(adapter.fetchTickerREST("BTC/USDT")).rejects.toThrow("OKX API error: No data");
    });

    it("should handle network errors", async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("Network error"));

      await expect(adapter.fetchTickerREST("BTC/USDT")).rejects.toThrow("Failed to fetch OKX ticker for BTC/USDT");
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
      const mockResponse: OkxRestResponse = {
        code: "0",
        msg: "",
        data: [],
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const isHealthy = await adapter.healthCheck();
      expect(isHealthy).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith("https://www.okx.com/api/v5/system/status");
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
      const mockErrorResponse: OkxRestResponse = {
        code: "50001",
        msg: "System error",
        data: [],
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

  describe("ping functionality", () => {
    it("should have ping interval after connection", async () => {
      await adapter.connect();

      // Check that ping interval is set
      const pingInterval = (adapter as any).pingInterval;
      expect(pingInterval).toBeDefined();
    });

    it("should clear ping interval on disconnection", async () => {
      await adapter.connect();
      await adapter.disconnect();

      // Check that ping interval is cleared
      const pingInterval = (adapter as any).pingInterval;
      expect(pingInterval).toBeUndefined();
    });
  });

  describe("confidence calculation", () => {
    it("should calculate confidence based on spread", () => {
      const tickerWithNarrowSpread = {
        ...mockTickerData,
        bidPx: "49999.5",
        askPx: "50000.5",
      };

      const result = adapter.normalizePriceData(tickerWithNarrowSpread);
      expect(result.confidence).toBeGreaterThan(0.5); // Adjusted expectation
    });

    it("should reduce confidence for wide spreads", () => {
      const tickerWithWideSpread = {
        ...mockTickerData,
        bidPx: "49000.0",
        askPx: "51000.0",
      };

      const result = adapter.normalizePriceData(tickerWithWideSpread);
      expect(result.confidence).toBeLessThan(0.8);
    });

    it("should consider volume in confidence calculation", () => {
      const tickerWithHighVolume = {
        ...mockTickerData,
        vol24h: "1000.0",
      };

      const tickerWithLowVolume = {
        ...mockTickerData,
        vol24h: "0.1",
      };

      const highVolumeResult = adapter.normalizePriceData(tickerWithHighVolume);
      const lowVolumeResult = adapter.normalizePriceData(tickerWithLowVolume);

      expect(highVolumeResult.confidence).toBeGreaterThan(lowVolumeResult.confidence);
    });
  });
});
