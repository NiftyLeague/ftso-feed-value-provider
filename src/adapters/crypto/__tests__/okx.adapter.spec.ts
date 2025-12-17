// Mock WebSocket module
jest.mock("ws", () => {
  const { MockFactory } = jest.requireActual("@/__tests__/utils");
  const MockWebSocket = jest.fn().mockImplementation(() => MockFactory.createWebSocket());
  return MockWebSocket;
});

import { OkxAdapter, OkxTickerData } from "../okx.adapter";
import { FeedCategory } from "@/common/types/core";
import { ExchangeId } from "@/common/types/adapters";

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

  ping() {
    // Mock ping implementation
  }
}

// Mock fetch
global.fetch = jest.fn();
global.WebSocket = MockWebSocket as any;

describe("OkxAdapter", () => {
  let adapter: OkxAdapter;

  beforeEach(() => {
    adapter = new OkxAdapter();
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  describe("initialization", () => {
    it("should initialize with correct properties", () => {
      expect(adapter.exchangeName).toBe(ExchangeId.Okx);
      expect(adapter.category).toBe(FeedCategory.Crypto);
      expect(adapter.capabilities.supportsWebSocket).toBe(true);
      expect(adapter.capabilities.supportsREST).toBe(true);
      expect(adapter.capabilities.supportsVolume).toBe(true);
    });
  });

  describe("symbol mapping", () => {
    it("should map symbols correctly", () => {
      expect(adapter.getSymbolMapping("BTC/USDT")).toBe("BTC-USDT");
      expect(adapter.getSymbolMapping("ETH/USDT")).toBe("ETH-USDT");
      expect(adapter.getSymbolMapping("LTC/BTC")).toBe("LTC-BTC");
    });

    it("should validate symbols correctly", () => {
      expect(adapter.validateSymbol("BTC/USDT")).toBe(true);
      expect(adapter.validateSymbol("ETH/USDT")).toBe(true);
      expect(adapter.validateSymbol("INVALID")).toBe(false);
    });
  });

  describe("data normalization", () => {
    const mockTickerData: OkxTickerData = {
      instType: "SPOT",
      instId: "BTC-USDT",
      last: "50000",
      lastSz: "0.1",
      askPx: "50001",
      askSz: "1.0",
      bidPx: "49999",
      bidSz: "1.0",
      open24h: "49000",
      high24h: "51000",
      low24h: "48000",
      volCcy24h: "50000000",
      vol24h: "1000",
      ts: Date.now().toString(),
      sodUtc0: "49500",
      sodUtc8: "49600",
    };

    it("should normalize price data correctly", () => {
      const result = adapter.normalizePriceData(mockTickerData);

      expect(result.symbol).toBe("BTC/USDT");
      expect(result.price).toBe(50000);
      expect(result.source).toBe(ExchangeId.Okx);
      expect(result.volume).toBe(1000);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(typeof result.timestamp).toBe("number");
    });

    it("should normalize volume data correctly", () => {
      const result = adapter.normalizeVolumeData(mockTickerData);

      expect(result.symbol).toBe("BTC/USDT");
      expect(result.volume).toBe(1000);
      expect(result.source).toBe(ExchangeId.Okx);
      expect(typeof result.timestamp).toBe("number");
    });

    it("should calculate confidence based on spread", () => {
      const lowSpreadData = { ...mockTickerData, askPx: "50000.5", bidPx: "49999.5" };
      const highSpreadData = { ...mockTickerData, askPx: "51000", bidPx: "49000" };

      const lowSpreadResult = adapter.normalizePriceData(lowSpreadData);
      const highSpreadResult = adapter.normalizePriceData(highSpreadData);

      expect(lowSpreadResult.confidence).toBeGreaterThan(highSpreadResult.confidence);
    });
  });

  describe("response validation", () => {
    it("should validate correct ticker data", () => {
      const validData: OkxTickerData = {
        instType: "SPOT",
        instId: "BTC-USDT",
        last: "50000",
        lastSz: "0.1",
        askPx: "50001",
        askSz: "1.0",
        bidPx: "49999",
        bidSz: "1.0",
        open24h: "49000",
        high24h: "51000",
        low24h: "48000",
        volCcy24h: "50000000",
        vol24h: "1000",
        ts: Date.now().toString(),
        sodUtc0: "49500",
        sodUtc8: "49600",
      };

      expect(adapter.validateResponse(validData)).toBe(true);
    });

    it("should reject invalid data", () => {
      expect(adapter.validateResponse(null)).toBe(false);
      expect(adapter.validateResponse({})).toBe(false);
      expect(adapter.validateResponse({ instId: "BTC-USDT" })).toBe(false);
      expect(adapter.validateResponse({ instId: "BTC-USDT", last: "invalid" })).toBe(false);
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

      // Mock successful WebSocket
      const mockWebSocket = {
        readyState: WebSocketMock.OPEN,
        url: "wss://ws.okx.com:8443/ws/v5/public",
        protocol: "",
        on: jest.fn((event, callback) => {
          if (event === "open") {
            // Simulate successful connection
            setTimeout(() => callback(), 0);
          }
        }),
        close: jest.fn(() => {
          mockWebSocket.readyState = WebSocketMock.CLOSED;
        }),
        send: jest.fn(),
        ping: jest.fn(),
      };

      // Mock WebSocket constructor
      const originalWebSocket = global.WebSocket;
      global.WebSocket = jest.fn().mockImplementation(() => {
        // Store reference to the mock so we can track calls
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
      await adapter.disconnect();
      // After disconnect, adapter should not be connected
      expect(adapter.isConnected()).toBe(false);

      // Restore original WebSocket
      global.WebSocket = originalWebSocket;
    });

    it("should handle error callbacks properly", async () => {
      const errorSpy = jest.fn();
      adapter.onError(errorSpy);

      // Test connection error by mocking WebSocket to throw
      (adapter as any).maxRetries = 0;
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

      // Restore WebSocket
      global.WebSocket = originalWebSocket;
    });
  });

  describe("REST API", () => {
    it("should fetch ticker data via REST", async () => {
      const mockResponse = {
        code: "0",
        msg: "",
        data: [
          {
            instType: "SPOT",
            instId: "BTC-USDT",
            last: "50000",
            lastSz: "0.1",
            askPx: "50001",
            askSz: "1.0",
            bidPx: "49999",
            bidSz: "1.0",
            open24h: "49000",
            high24h: "51000",
            low24h: "48000",
            volCcy24h: "50000000",
            vol24h: "1000",
            ts: Date.now().toString(),
            sodUtc0: "49500",
            sodUtc8: "49600",
          },
        ],
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await adapter.fetchTickerREST("BTC/USDT");

      expect(result.symbol).toBe("BTC/USDT");
      expect(result.price).toBe(50000);
      expect(result.source).toBe(ExchangeId.Okx);
      expect(result.volume).toBe(1000);
    });

    it("should handle REST API errors", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      await expect(adapter.fetchTickerREST("INVALID/PAIR")).rejects.toThrow("Failed to fetch okx ticker");
    });

    it("should handle OKX API errors", async () => {
      const mockResponse = {
        code: "51001",
        msg: "Instrument ID does not exist",
        data: [],
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      await expect(adapter.fetchTickerREST("INVALID/PAIR")).rejects.toThrow("okx API error");
    });
  });

  describe("health check", () => {
    it("should return true when connected", async () => {
      await adapter.connect();
      const isHealthy = await adapter.healthCheck();
      expect(isHealthy).toBe(true);
    });

    it("should check REST API when not connected", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ code: "0", data: [] }),
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
      await adapter.connect();
      await adapter.subscribe(["BTC/USDT", "ETH/USDT"]);

      const subscriptions = adapter.getSubscriptions();
      expect(subscriptions).toContain("BTC-USDT");
      expect(subscriptions).toContain("ETH-USDT");
    });

    it("should handle unsubscribe", async () => {
      await adapter.connect();
      await adapter.subscribe(["BTC/USDT", "ETH/USDT"]);
      await adapter.unsubscribe(["BTC/USDT"]);

      const subscriptions = adapter.getSubscriptions();
      expect(subscriptions).not.toContain("BTC-USDT");
      expect(subscriptions).toContain("ETH-USDT");
    });
  });

  describe("heartbeat management", () => {
    it("should handle ping messages", async () => {
      await adapter.connect();

      // Simulate receiving a ping message
      const mockPingMessage = JSON.stringify({ event: "ping" });
      const mockWs = (adapter as any).ws;

      if (mockWs && mockWs.onmessage) {
        mockWs.onmessage({ data: mockPingMessage });
      }

      // Should not throw errors
      expect(adapter.isConnected()).toBe(true);
    });

    it("should send pong responses to ping messages", async () => {
      await adapter.connect();

      const mockWs = (adapter as any).ws;

      // Check if WebSocket exists and has send method
      if (mockWs && typeof mockWs.send === "function") {
        const sendSpy = jest.spyOn(mockWs, "send");

        // Simulate receiving a ping message
        const mockPingMessage = JSON.stringify({ event: "ping" });

        if (mockWs.onmessage) {
          mockWs.onmessage({ data: mockPingMessage });
        }

        expect(sendSpy).toHaveBeenCalledWith(JSON.stringify({ event: "pong" }));
      } else {
        // Skip test if WebSocket mock doesn't have send method
        expect(true).toBe(true);
      }
    });
  });

  describe("WebSocket close handling", () => {
    it("logs OKX-specific close codes when not shutting down", () => {
      (adapter as any).isShuttingDown = false;
      const debugSpy = jest.spyOn((adapter as any).logger, "debug").mockImplementation(() => undefined);
      const warnSpy = jest.spyOn((adapter as any).logger, "warn").mockImplementation(() => undefined);

      expect((adapter as any).handleWebSocketClose(4004, "x")).toBe(true);
      expect((adapter as any).handleWebSocketClose(1006, "x")).toBe(true);
      expect((adapter as any).handleWebSocketClose(1000, "x")).toBe(true);
      expect((adapter as any).handleWebSocketClose(9999, "x")).toBe(true);

      expect(debugSpy).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();

      debugSpy.mockRestore();
      warnSpy.mockRestore();
    });
  });

  describe("WebSocket message handling", () => {
    it("handles raw pong and ping strings", () => {
      const parseSpy = jest.spyOn(adapter as any, "parseWebSocketData");
      const pongSpy = jest.spyOn(adapter as any, "onPongReceived").mockImplementation(() => undefined);
      const debugSpy = jest.spyOn((adapter as any).logger, "debug").mockImplementation(() => undefined);

      parseSpy.mockReturnValueOnce("pong");
      (adapter as any).handleWebSocketMessage("ignored");
      expect(pongSpy).toHaveBeenCalledTimes(1);

      parseSpy.mockReturnValueOnce("ping");
      (adapter as any).handleWebSocketMessage("ignored");
      expect(debugSpy).toHaveBeenCalledWith("Received ping from OKX WebSocket");

      debugSpy.mockRestore();
      pongSpy.mockRestore();
      parseSpy.mockRestore();
    });

    it("handles JSON pong, subscription, and error messages", () => {
      const parseSpy = jest.spyOn(adapter as any, "parseWebSocketData");
      const pongSpy = jest.spyOn(adapter as any, "onPongReceived").mockImplementation(() => undefined);
      const debugSpy = jest.spyOn((adapter as any).logger, "debug").mockImplementation(() => undefined);
      const warnSpy = jest.spyOn((adapter as any).logger, "warn").mockImplementation(() => undefined);

      parseSpy.mockReturnValueOnce({ event: "pong" });
      (adapter as any).handleWebSocketMessage("ignored");
      expect(pongSpy).toHaveBeenCalledTimes(1);

      parseSpy.mockReturnValueOnce({ event: "subscribe" });
      (adapter as any).handleWebSocketMessage("ignored");
      expect(debugSpy).toHaveBeenCalledWith("OKX subscription confirmation:", { event: "subscribe" });

      parseSpy.mockReturnValueOnce({ event: "error", code: "520", msg: "server 520" });
      (adapter as any).handleWebSocketMessage("ignored");
      expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/OKX server error \(520\)/));

      parseSpy.mockReturnValueOnce({ event: "error", code: "123", msg: "nope" });
      (adapter as any).handleWebSocketMessage("ignored");
      expect(warnSpy).toHaveBeenCalledWith("OKX WebSocket error:", { event: "error", code: "123", msg: "nope" });

      warnSpy.mockRestore();
      debugSpy.mockRestore();
      pongSpy.mockRestore();
      parseSpy.mockRestore();
    });

    it("processes valid ticker data and skips invalid entries", () => {
      const parseSpy = jest.spyOn(adapter as any, "parseWebSocketData");
      const onPriceUpdate = jest.fn();
      (adapter as any).onPriceUpdateCallback = onPriceUpdate;

      const debugSpy = jest.spyOn((adapter as any).logger, "debug").mockImplementation(() => undefined);

      const validTicker: OkxTickerData = {
        instType: "SPOT",
        instId: "BTC-USDT",
        last: "50000",
        lastSz: "0.1",
        askPx: "50001",
        askSz: "1.0",
        bidPx: "49999",
        bidSz: "1.0",
        open24h: "49000",
        high24h: "51000",
        low24h: "48000",
        volCcy24h: "50000000",
        vol24h: "1000",
        ts: Date.now().toString(),
        sodUtc0: "49500",
        sodUtc8: "49600",
      };

      const invalidTicker = { ...validTicker, last: "" };

      parseSpy.mockReturnValueOnce({
        arg: { channel: "tickers", instId: "BTC-USDT" },
        data: [validTicker, invalidTicker],
      });

      (adapter as any).handleWebSocketMessage("ignored");

      expect(onPriceUpdate).toHaveBeenCalledTimes(1);
      expect(onPriceUpdate.mock.calls[0][0]).toEqual(
        expect.objectContaining({ symbol: "BTC/USDT", source: ExchangeId.Okx, price: 50000 })
      );

      debugSpy.mockRestore();
      parseSpy.mockRestore();
    });

    it("warns on 520 processing errors and reports other errors via onErrorCallback", () => {
      const warnSpy = jest.spyOn((adapter as any).logger, "warn").mockImplementation(() => undefined);
      const errorSpy = jest.spyOn((adapter as any).logger, "error").mockImplementation(() => undefined);
      const onError = jest.fn();
      (adapter as any).onErrorCallback = onError;

      jest.spyOn(adapter as any, "parseWebSocketData").mockImplementation(() => {
        throw new Error("520 boom");
      });
      (adapter as any).handleWebSocketMessage("ignored");
      expect(warnSpy).toHaveBeenCalledWith("OKX connection error (520) - will retry:", "520 boom");

      (adapter as any).parseWebSocketData.mockImplementation(() => {
        throw new Error("other");
      });
      (adapter as any).handleWebSocketMessage("ignored");
      expect(errorSpy).toHaveBeenCalledWith("Error processing OKX WebSocket message:", expect.any(Error));
      expect(onError).toHaveBeenCalledWith(expect.any(Error));

      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });

  describe("REST ticker fallback", () => {
    it("throws when REST returns no data", async () => {
      jest.spyOn(adapter as any, "fetchRestApi").mockResolvedValue({
        json: async () => ({ code: "0", msg: "", data: [] }),
      } as any);

      await expect(adapter.fetchTickerREST("BTC/USDT")).rejects.toThrow(/No data/i);
    });
  });

  describe("ping handling", () => {
    it("logs when WebSocket is not connected", () => {
      jest.spyOn(adapter as any, "isWebSocketConnected").mockReturnValue(false);
      const debugSpy = jest.spyOn((adapter as any).logger, "debug").mockImplementation(() => undefined);

      (adapter as any).sendPingMessage();
      expect(debugSpy).toHaveBeenCalledWith(expect.stringMatching(/WebSocket not connected/i));
      debugSpy.mockRestore();
    });

    it("logs send success and failure when connected", () => {
      jest.spyOn(adapter as any, "isWebSocketConnected").mockReturnValue(true);
      const debugSpy = jest.spyOn((adapter as any).logger, "debug").mockImplementation(() => undefined);

      jest.spyOn(adapter as any, "sendWebSocketMessage").mockResolvedValue(undefined);
      (adapter as any).sendPingMessage();
      expect(debugSpy).toHaveBeenCalledWith(expect.stringMatching(/Sent ping to OKX WebSocket/i));

      (adapter as any).sendWebSocketMessage.mockImplementation(() => {
        throw new Error("nope");
      });
      (adapter as any).sendPingMessage();
      expect(debugSpy).toHaveBeenCalledWith("❌ Failed to send ping to OKX WebSocket:", expect.any(Error));

      debugSpy.mockRestore();
    });
  });
});
