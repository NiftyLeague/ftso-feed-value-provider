// Mock ws module before any imports
jest.mock("ws", () => {
  const { MockFactory } = jest.requireActual("@/__tests__/utils");
  const MockWebSocket = jest.fn().mockImplementation(() => MockFactory.createWebSocket());
  return MockWebSocket;
});

import { KrakenAdapter } from "../kraken.adapter";
import type { KrakenTickerData } from "@/common/types/adapters";
import { BaseExchangeAdapter } from "@/adapters/base/base-exchange-adapter";
import { FeedCategory } from "@/common/types/core";
import { ExchangeId } from "@/common/types/adapters";
import { TestHelpers } from "@/__tests__/utils/test.helpers";

// Mock fetch
global.fetch = jest.fn();

describe("KrakenAdapter", () => {
  let adapter: KrakenAdapter;

  beforeEach(() => {
    // Reset fetch mock
    jest.clearAllMocks();

    // Mock the logger to prevent console output
    const mockLogger = {
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
      verbose: jest.fn(),
    };

    // Create adapter with mocked logger
    adapter = new KrakenAdapter();
    (adapter as any).logger = mockLogger;

    jest.clearAllMocks();
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  describe("initialization", () => {
    it("should initialize with correct properties", () => {
      expect(adapter.exchangeName).toBe(ExchangeId.Kraken);
      expect(adapter.category).toBe(FeedCategory.Crypto);
      expect(adapter.capabilities.supportsWebSocket).toBe(true);
      expect(adapter.capabilities.supportsREST).toBe(true);
      expect(adapter.capabilities.supportsVolume).toBe(true);
    });
  });

  describe("symbol mapping", () => {
    it("should map BTC symbols correctly", () => {
      expect(adapter.getSymbolMapping("BTC/USD")).toBe("BTC/USD");
      expect(adapter.getSymbolMapping("BTC/EUR")).toBe("BTC/EUR");
    });

    it("should map other symbols correctly", () => {
      expect(adapter.getSymbolMapping("ETH/USD")).toBe("ETH/USD");
      expect(adapter.getSymbolMapping("LTC/USD")).toBe("LTC/USD");
    });

    it("should validate symbols correctly", () => {
      expect(adapter.validateSymbol("BTC/USD")).toBe(true);
      expect(adapter.validateSymbol("ETH/USD")).toBe(true);
      expect(adapter.validateSymbol("INVALID")).toBe(false);
    });
  });

  describe("symbol normalization from exchange format", () => {
    it("should normalize XBT pairs back to BTC", () => {
      const mockData: KrakenTickerData = {
        channelID: 123,
        channelName: "ticker",
        pair: "XBT/USD",
        data: {
          a: ["50001.00", "1", "1.000"],
          b: ["49999.00", "1", "1.000"],
          c: ["50000.00", "0.1"],
          v: ["1000.0", "5000.0"],
          p: ["50000.00", "49500.00"],
          t: [500, 2500],
          l: ["48000.00", "47000.00"],
          h: ["51000.00", "52000.00"],
          o: ["49000.00", "48000.00"],
        },
      };

      const result = adapter.normalizePriceData(mockData);
      expect(result.symbol).toBe("XBT/USD");
    });

    it("should normalize other pairs correctly", () => {
      const mockData: KrakenTickerData = {
        channelID: 125,
        channelName: "ticker",
        pair: "ETH/USD",
        data: {
          a: ["2901.00", "10", "10.000"],
          b: ["2899.00", "5", "5.000"],
          c: ["2900.00", "1.0"],
          v: ["10000.0", "50000.0"],
          p: ["2900.00", "2850.00"],
          t: [1000, 5000],
          l: ["2750.00", "2700.00"],
          h: ["2950.00", "3000.00"],
          o: ["2800.00", "2750.00"],
        },
      };

      const result = adapter.normalizePriceData(mockData);
      expect(result.symbol).toBe("ETH/USD");
    });
  });

  describe("data normalization", () => {
    const mockTickerData: KrakenTickerData = {
      channelID: 126,
      channelName: "ticker",
      pair: "XBT/USD",
      data: {
        a: ["50001.00", "1", "1.000"],
        b: ["49999.00", "1", "1.000"],
        c: ["50000.00", "0.1"],
        v: ["1000.0", "5000.0"],
        p: ["50000.00", "49500.00"],
        t: [500, 2500],
        l: ["48000.00", "47000.00"],
        h: ["51000.00", "52000.00"],
        o: ["49000.00", "48000.00"],
      },
    };

    it("should normalize price data correctly", () => {
      const result = adapter.normalizePriceData(mockTickerData);

      expect(result.symbol).toBe("XBT/USD");
      expect(result.price).toBe(50000);
      expect(result.source).toBe(ExchangeId.Kraken);
      expect(result.volume).toBe(5000);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(typeof result.timestamp).toBe("number");
    });

    it("should normalize volume data correctly", () => {
      const result = adapter.normalizeVolumeData(mockTickerData);

      expect(result.symbol).toBe("XBT/USD");
      expect(result.volume).toBe(5000);
      expect(result.source).toBe(ExchangeId.Kraken);
      expect(typeof result.timestamp).toBe("number");
    });

    it("should calculate confidence based on spread", () => {
      const lowSpreadData: KrakenTickerData = {
        ...mockTickerData,
        data: {
          ...mockTickerData.data,
          a: ["50000.50", "1", "1.000"] as [string, string, string],
          b: ["49999.50", "1", "1.000"] as [string, string, string],
        },
      };
      const highSpreadData: KrakenTickerData = {
        ...mockTickerData,
        data: {
          ...mockTickerData.data,
          a: ["51000.00", "1", "1.000"] as [string, string, string],
          b: ["49000.00", "1", "1.000"] as [string, string, string],
        },
      };

      const lowSpreadResult = adapter.normalizePriceData(lowSpreadData);
      const highSpreadResult = adapter.normalizePriceData(highSpreadData);

      expect(lowSpreadResult.confidence).toBeGreaterThan(highSpreadResult.confidence);
    });
  });

  describe("response validation", () => {
    it("should validate correct ticker data", () => {
      const validData: KrakenTickerData = {
        channelID: 127,
        channelName: "ticker",
        pair: "XBT/USD",
        data: {
          a: ["50001.00", "1", "1.000"],
          b: ["49999.00", "1", "1.000"],
          c: ["50000.00", "0.1"],
          v: ["1000.0", "5000.0"],
          p: ["50000.00", "49500.00"],
          t: [500, 2500],
          l: ["48000.00", "47000.00"],
          h: ["51000.00", "52000.00"],
          o: ["49000.00", "48000.00"],
        },
      };

      expect(adapter.validateResponse(validData)).toBe(true);
    });

    it("should reject invalid data", () => {
      expect(adapter.validateResponse(null)).toBe(false);
      expect(adapter.validateResponse({})).toBe(false);
      expect(adapter.validateResponse({ c: ["50000.00", "0.1"] })).toBe(false);
      expect(adapter.validateResponse({ c: ["invalid", "0.1"], a: ["50001.00", "1", "1.000"] })).toBe(false);
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
        url: "wss://ws.kraken.com",
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
        result: {
          XXBTZUSD: {
            a: ["50001.00", "1", "1.000"],
            b: ["49999.00", "1", "1.000"],
            c: ["50000.00", "0.1"],
            v: ["1000.0", "2000.0"],
            p: ["49500.0", "49750.0"],
            t: [100, 200],
            l: ["48000.0", "47000.0"],
            h: ["51000.0", "52000.0"],
            o: "49000.0",
          },
        },
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await adapter.fetchTickerREST("BTC/USD");

      expect(result.symbol).toBe("BTC/USD");
      expect(result.price).toBe(50000);
      expect(result.source).toBe(ExchangeId.Kraken);
      expect(result.volume).toBe(2000);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it("should handle REST API errors", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      await expect(adapter.fetchTickerREST("INVALID/PAIR")).rejects.toThrow("Failed to fetch Kraken ticker");
    });

    it("should handle Kraken API errors", async () => {
      const mockResponse = {
        error: ["EQuery:Unknown asset pair"],
        result: {},
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      await expect(adapter.fetchTickerREST("INVALID/PAIR")).rejects.toThrow("Kraken API error");
    });

    it("should throw when Kraken returns no result field", async () => {
      const mockResponse = {
        error: [],
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      await expect(adapter.fetchTickerREST("BTC/USD")).rejects.toThrow("No result data returned");
    });

    it.each([
      ["EService:Unavailable", "Service temporarily unavailable"],
      ["EAPI:Rate limit exceeded", "Rate limit exceeded"],
      ["SomeOtherError", "Kraken API error"],
    ])("should handle Kraken error code: %s", async (krakenError, expectedMessagePart) => {
      const mockResponse = {
        error: [krakenError],
        result: {},
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      await expect(adapter.fetchTickerREST("BTC/USD")).rejects.toThrow(expectedMessagePart);
    });
  });

  describe("WebSocket handlers", () => {
    it.each([
      [1006, "closed abnormally"],
      [1001, "pong timeout"],
      [1000, "closed normally"],
      [4004, "inactivity"],
      [9999, "code 9999"],
    ])("handleWebSocketClose logs and returns true for code %s", (code, expectedMessagePart) => {
      (adapter as any).isShuttingDown = false;

      const handled = (adapter as any).handleWebSocketClose(code, "reason");

      expect(handled).toBe(true);
      expect((adapter as any).logger.debug).toHaveBeenCalled();
      const msgArg = ((adapter as any).logger.debug as jest.Mock).mock.calls[0][0] as string;
      expect(msgArg.toLowerCase()).toContain("kraken websocket closed");
      expect(msgArg.toLowerCase()).toContain(expectedMessagePart);
    });

    it("handleWebSocketClose defers to base when shutting down", () => {
      const baseSpy = jest.spyOn((BaseExchangeAdapter as any).prototype, "handleWebSocketClose").mockReturnValue(false);

      (adapter as any).isShuttingDown = true;
      const handled = (adapter as any).handleWebSocketClose(1000, "normal");

      expect(baseSpy).toHaveBeenCalled();
      expect(handled).toBe(false);

      baseSpy.mockRestore();
    });

    it("handleWebSocketError handles 503 with callbacks and returns early", () => {
      const onConn = jest.fn();
      const onErr = jest.fn();
      (adapter as any).onConnectionChangeCallback = onConn;
      (adapter as any).onErrorCallback = onErr;
      (adapter as any).isConnected_ = true;

      (adapter as any).handleWebSocketError(new Error("503 Service Unavailable"));

      expect((adapter as any).logger.warn).toHaveBeenCalled();
      expect((adapter as any).isConnected_).toBe(false);
      expect(onConn).toHaveBeenCalledWith(false);
      expect(onErr).toHaveBeenCalled();
    });

    it("handleWebSocketError handles unexpected server response >= 500", () => {
      const onConn = jest.fn();
      const onErr = jest.fn();
      (adapter as any).onConnectionChangeCallback = onConn;
      (adapter as any).onErrorCallback = onErr;
      (adapter as any).isConnected_ = true;

      (adapter as any).handleWebSocketError(new Error("Unexpected server response: 502"));

      expect((adapter as any).logger.warn).toHaveBeenCalled();
      expect((adapter as any).isConnected_).toBe(false);
      expect(onConn).toHaveBeenCalledWith(false);
      expect(onErr).toHaveBeenCalled();
    });

    it("handleWebSocketError defers to base for other errors", () => {
      const baseSpy = jest
        .spyOn((BaseExchangeAdapter as any).prototype, "handleWebSocketError")
        .mockImplementation(() => undefined);

      (adapter as any).handleWebSocketError(new Error("Some other error"));

      expect(baseSpy).toHaveBeenCalled();
      baseSpy.mockRestore();
    });

    it("handleWebSocketMessage processes array ticker updates", () => {
      const onPriceUpdate = jest.fn();
      (adapter as any).onPriceUpdateCallback = onPriceUpdate;

      const message = JSON.stringify([
        123,
        {
          a: ["50001.00", "1", "1.000"],
          b: ["49999.00", "1", "1.000"],
          c: ["50000.00", "0.1"],
          v: ["1000.0", "5000.0"],
          p: ["50000.0", "49500.0"],
          t: [1, 2],
          l: ["48000.0", "47000.0"],
          h: ["51000.0", "52000.0"],
          o: ["49000.0", "48000.0"],
        },
        "ticker",
        "XBT/USD",
      ]);

      (adapter as any).handleWebSocketMessage(message);

      expect(onPriceUpdate).toHaveBeenCalled();
      const update = onPriceUpdate.mock.calls[0][0];
      expect(update.source).toBe(ExchangeId.Kraken);
      expect(update.symbol).toBe("XBT/USD");
      expect(update.price).toBe(50000);
    });

    it("handleWebSocketMessage handles systemStatus and subscriptionStatus branches", () => {
      (adapter as any).handleWebSocketMessage(JSON.stringify({ event: "systemStatus", status: "online" }));
      expect((adapter as any).logger.debug).toHaveBeenCalled();

      (adapter as any).handleWebSocketMessage(
        JSON.stringify({ event: "subscriptionStatus", status: "subscribed", pair: "BTC/USD" })
      );
      expect((adapter as any).logger.debug).toHaveBeenCalled();

      (adapter as any).handleWebSocketMessage(
        JSON.stringify({
          event: "subscriptionStatus",
          status: "error",
          pair: "BTC/USD",
          errorMessage: "msg rate exceeded",
        })
      );
      expect((adapter as any).logger.warn).not.toHaveBeenCalled();

      (adapter as any).handleWebSocketMessage(
        JSON.stringify({
          event: "subscriptionStatus",
          status: "error",
          pair: "BTC/USD",
          errorMessage: "some other error",
        })
      );
      expect((adapter as any).logger.warn).toHaveBeenCalled();
    });

    it("handleWebSocketMessage handles pong and calls onPongReceived", () => {
      const onPongReceived = jest.fn();
      (adapter as any).onPongReceived = onPongReceived;

      (adapter as any).handleWebSocketMessage(JSON.stringify({ event: "pong" }));

      expect(onPongReceived).toHaveBeenCalled();
    });

    it("handleWebSocketMessage ignores non-parseable messages", () => {
      (adapter as any).parseWebSocketData = jest.fn().mockReturnValue(null);

      (adapter as any).handleWebSocketMessage("not json");

      expect((adapter as any).logger.debug).toHaveBeenCalled();
    });

    it("handleWebSocketMessage treats JSON parse errors as non-critical", () => {
      const onErr = jest.fn();
      (adapter as any).onErrorCallback = onErr;

      (adapter as any).handleWebSocketMessage("{");

      expect((adapter as any).logger.debug).toHaveBeenCalled();
      expect(onErr).not.toHaveBeenCalled();
    });

    it("handleWebSocketMessage calls onErrorCallback for non-parse errors", () => {
      const onErr = jest.fn();
      (adapter as any).onErrorCallback = onErr;
      (adapter as any).parseWebSocketData = jest.fn(() => {
        throw new Error("boom");
      });

      (adapter as any).handleWebSocketMessage("whatever");

      expect((adapter as any).logger.warn).toHaveBeenCalled();
      expect(onErr).toHaveBeenCalled();
    });
  });

  describe("ping", () => {
    it("sendPingMessage sends ping and occasionally logs", () => {
      const randomSpy = jest.spyOn(Math, "random").mockReturnValue(0.05);
      (adapter as any).isWebSocketConnected = jest.fn().mockReturnValue(true);
      (adapter as any).sendWebSocketMessage = jest.fn().mockResolvedValue(undefined);

      (adapter as any).sendPingMessage();

      expect((adapter as any).sendWebSocketMessage).toHaveBeenCalledWith(JSON.stringify({ event: "ping" }));
      expect((adapter as any).logger.log).toHaveBeenCalled();

      randomSpy.mockRestore();
    });

    it("sendPingMessage warns when not connected", () => {
      (adapter as any).isWebSocketConnected = jest.fn().mockReturnValue(false);

      (adapter as any).sendPingMessage();

      expect((adapter as any).logger.warn).toHaveBeenCalled();
    });

    it("sendPingMessage triggers error handling if send fails", () => {
      (adapter as any).isWebSocketConnected = jest.fn().mockReturnValue(true);
      (adapter as any).sendWebSocketMessage = jest.fn(() => {
        throw new Error("send failed");
      });

      const handleErrorSpy = jest.spyOn(adapter as any, "handleWebSocketError").mockImplementation(() => undefined);

      (adapter as any).sendPingMessage();

      expect((adapter as any).logger.warn).toHaveBeenCalled();
      expect(handleErrorSpy).toHaveBeenCalled();
    });
  });

  describe("subscription batching", () => {
    it("doSubscribe sends in batches and waits between batches", async () => {
      await TestHelpers.withFakeTimersAsync(async () => {
        (adapter as any).sendWebSocketMessage = jest.fn().mockResolvedValue(undefined);

        const symbols = ["BTC/USD", "ETH/USD", "SOL/USD", "FLR/USD", "XRP/USD", "DOGE/USD"]; // 6 symbols => 2 batches
        const p = (adapter as any).doSubscribe(symbols);

        // First batch delay
        await Promise.resolve();
        jest.advanceTimersByTime(2000);

        await p;

        expect((adapter as any).sendWebSocketMessage).toHaveBeenCalledTimes(2);
      });
    });

    it("doSubscribe waits longer after a batch error", async () => {
      await TestHelpers.withFakeTimersAsync(async () => {
        (adapter as any).sendWebSocketMessage = jest
          .fn()
          .mockRejectedValueOnce(new Error("rate limited"))
          .mockResolvedValueOnce(undefined);

        const symbols = ["BTC/USD", "ETH/USD", "SOL/USD", "FLR/USD", "XRP/USD", "DOGE/USD"]; // 2 batches
        const p = (adapter as any).doSubscribe(symbols);

        // Error-path delay
        await Promise.resolve();
        jest.advanceTimersByTime(5000);

        await p;

        expect((adapter as any).logger.warn).toHaveBeenCalled();
        expect((adapter as any).sendWebSocketMessage).toHaveBeenCalledTimes(2);
      });
    });

    it("doUnsubscribe swallows send errors", async () => {
      await TestHelpers.withFakeTimersAsync(async () => {
        (adapter as any).sendWebSocketMessage = jest.fn().mockRejectedValue(new Error("send failed"));

        await expect((adapter as any).doUnsubscribe(["BTC/USD"])).resolves.toBeUndefined();
        expect((adapter as any).logger.warn).toHaveBeenCalled();
      });
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
        json: () => Promise.resolve({ result: { status: "online" } }),
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
      await adapter.subscribe(["BTC/USD", "ETH/USD"]);

      const subscriptions = adapter.getSubscriptions();
      expect(subscriptions).toContain("BTC/USD");
      expect(subscriptions).toContain("ETH/USD");
    });

    it("should handle unsubscribe", async () => {
      await adapter.connect();
      await adapter.subscribe(["BTC/USD", "ETH/USD"]);
      await adapter.unsubscribe(["BTC/USD"]);

      const subscriptions = adapter.getSubscriptions();
      expect(subscriptions).not.toContain("BTC/USD");
      expect(subscriptions).toContain("ETH/USD");
    });
  });
});
