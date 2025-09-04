import { CryptocomAdapter, CryptocomTickerData, CryptocomRestResponse } from "../cryptocom.adapter";
import { FeedCategory } from "@/common/types/core";

// Define the mock WebSocket type
type MockWebSocket = {
  readyState: number;
  onopen: jest.Mock | null;
  onclose: jest.Mock | null;
  onerror: jest.Mock | null;
  onmessage: jest.Mock | null;
  send: jest.Mock;
  close: jest.Mock;
  addEventListener: jest.Mock;
  removeEventListener: jest.Mock;
  simulateMessage: (data: unknown) => MockWebSocket;
  simulateError: (error: Error) => MockWebSocket;
  simulateOpen: () => MockWebSocket;
  simulateClose: () => MockWebSocket;
  clearMocks: () => void;
  _setReadyState: (state: number) => void;
  getWebSocket: () => MockWebSocket;
};

// Create a mock WebSocket instance
const createMockWebSocket = (): MockWebSocket => {
  let _readyState = 0; // Start with CONNECTING state
  const eventListeners: Record<string, Function[]> = {
    message: [],
    error: [],
    open: [],
    close: [],
  };

  const mockWs: MockWebSocket = {
    get readyState() {
      return _readyState;
    },
    set readyState(value) {
      _readyState = value;
      if (value === 1) {
        // OPEN
        if (mockWs.onopen) mockWs.onopen({});
        eventListeners.open.forEach(cb => cb({}));
      } else if (value === 3) {
        // CLOSED
        if (mockWs.onclose) mockWs.onclose({});
        eventListeners.close.forEach(cb => cb({}));
      }
    },
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
    send: jest.fn().mockImplementation(data => {
      const message = JSON.parse(data);
      // Handle subscription messages
      if (message.method === "subscribe" && message.params?.channels?.[0]?.name === "ticker") {
        // Simulate subscription success
        mockWs.simulateMessage({
          method: "subscribe",
          result: {
            channel: "ticker",
            subscription: message.params.channels[0].subscriptions,
            id: message.id,
          },
        });
      }
    }),
    close: jest.fn().mockImplementation(() => {
      _readyState = 3; // CLOSED
      if (mockWs.onclose) mockWs.onclose({});
      eventListeners.close.forEach(cb => cb({}));
    }),
    addEventListener: jest.fn((event, listener) => {
      if (eventListeners[event]) {
        eventListeners[event].push(listener);
      }
    }),
    removeEventListener: jest.fn((event, listener) => {
      if (eventListeners[event]) {
        const index = eventListeners[event].indexOf(listener);
        if (index > -1) {
          eventListeners[event].splice(index, 1);
        }
      }
    }),
    simulateMessage: (data: unknown) => {
      const event = { data: JSON.stringify(data) };
      if (mockWs.onmessage) mockWs.onmessage(event);
      eventListeners.message.forEach(cb => cb(event));
      return mockWs;
    },
    simulateError: function (error: Error) {
      _readyState = 3; // CLOSED on error
      const errorEvent = {
        error,
        message: error.message,
        type: "error",
      };
      if (this.onerror) {
        this.onerror(errorEvent as ErrorEvent);
      }
      eventListeners.error.forEach(cb => cb(errorEvent));
      return this;
    },
    simulateOpen: function () {
      this.readyState = 1; // OPEN
      if (this.onopen) {
        this.onopen({} as Event);
      }
      eventListeners.open.forEach(cb => cb({}));
      return this;
    },
    simulateClose: function () {
      this.readyState = 3; // CLOSED
      if (this.onclose) {
        this.onclose({} as CloseEvent);
      }
      eventListeners.close.forEach(cb => cb({}));
      return this;
    },
    clearMocks: function () {
      (this.send as jest.Mock).mockClear();
      (this.close as jest.Mock).mockClear();
      this.onopen = null;
      this.onclose = null;
      this.onerror = null;
      this.onmessage = null;
      return this;
    },
    _setReadyState: function (state: number) {
      this.readyState = state;
      return this;
    },
    getWebSocket: function () {
      return this;
    },
  };

  return mockWs as MockWebSocket;
};

// Global mock WebSocket instance
let mockWebSocket: MockWebSocket;

// Mock the WebSocket class
class MockWebSocketImpl extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  binaryType: BinaryType = "blob";
  bufferedAmount = 0;
  extensions = "";
  onclose: ((this: WebSocket, ev: CloseEvent) => any) | null = null;
  onerror: ((this: WebSocket, ev: Event) => any) | null = null;
  onmessage: ((this: WebSocket, ev: MessageEvent) => any) | null = null;
  onopen: ((this: WebSocket, ev: Event) => any) | null = null;
  protocol = "";
  readyState = MockWebSocketImpl.CONNECTING;
  url = "";

  constructor() {
    super();
    mockWebSocket = createMockWebSocket();

    // Set up property descriptors to delegate to the mock
    Object.defineProperties(this, {
      readyState: {
        get: () => mockWebSocket.readyState,
        set: value => {
          mockWebSocket.readyState = value;
        },
      },
      onopen: {
        get: () => mockWebSocket.onopen,
        set: value => {
          mockWebSocket.onopen = value;
        },
      },
      onclose: {
        get: () => mockWebSocket.onclose,
        set: value => {
          mockWebSocket.onclose = value;
        },
      },
      onerror: {
        get: () => mockWebSocket.onerror,
        set: value => {
          mockWebSocket.onerror = value;
        },
      },
      onmessage: {
        get: () => mockWebSocket.onmessage,
        set: value => {
          mockWebSocket.onmessage = value;
        },
      },
      send: {
        value: jest.fn((data: string) => {
          mockWebSocket.send(data);
        }),
      },
      close: {
        value: (code?: number, reason?: string) => mockWebSocket.close(code, reason),
      },
      addEventListener: {
        value: jest.fn((type: string, listener: EventListenerOrEventListenerObject) => {
          mockWebSocket.addEventListener(type, listener);
        }),
      },
      removeEventListener: {
        value: jest.fn((type: string, listener: EventListenerOrEventListenerObject) => {
          mockWebSocket.removeEventListener(type, listener);
        }),
      },
    });

    return new Proxy(this, {
      get: (target, prop) => {
        if (prop in target) {
          const value = (target as any)[prop];
          return typeof value === "function" ? value.bind(target) : value;
        }
        return (mockWebSocket as any)[prop];
      },
      set: (target, prop, value) => {
        if (prop in target) {
          (target as any)[prop] = value;
        } else {
          (mockWebSocket as any)[prop] = value;
        }
        return true;
      },
    });
  }
}

// Mock fetch
(global as any).fetch = jest.fn();
(global as any).WebSocket = MockWebSocketImpl;

// Mock the BaseExchangeAdapter's WebSocket methods
jest.mock("@/adapters/base/base-exchange-adapter", () => {
  const originalModule = jest.requireActual("@/adapters/base/base-exchange-adapter");

  return {
    ...originalModule,
    BaseExchangeAdapter: class extends originalModule.BaseExchangeAdapter {
      protected connectWebSocket = jest.fn().mockImplementation(async () => {
        // Create a new mock WebSocket instance for each connection
        const ws = createMockWebSocket();

        // Store the WebSocket instance
        (this as any).ws = ws;

        // Simulate connection opening
        setTimeout(() => {
          (ws as any).readyState = MockWebSocketImpl.OPEN;
          ws.onopen?.({} as Event);
        }, 10);
      });

      protected disconnectWebSocket = jest.fn().mockImplementation(async () => {
        const ws = (this as any).ws as MockWebSocket | undefined;
        if (ws) {
          // Use the internal _setReadyState method to update the readyState
          (ws as any)._setReadyState(MockWebSocketImpl.CLOSED);
          ws.onclose?.({} as CloseEvent);
          (this as any).ws = null;
        }
      });

      protected isWebSocketConnected = jest.fn().mockImplementation(() => {
        const ws = (this as any).ws as MockWebSocket | undefined;
        return ws && ws.readyState === MockWebSocketImpl.OPEN;
      });

      protected sendWebSocketMessage = jest.fn().mockImplementation((message: any) => {
        const ws = (this as any).ws as MockWebSocket | undefined;
        if (ws && ws.readyState === MockWebSocketImpl.OPEN) {
          ws.send(JSON.stringify(message));
        }
      });
    },
  };
});

describe("CryptocomAdapter", () => {
  let adapter: CryptocomAdapter;

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
      // Mock the WebSocket connection
      const ws = createMockWebSocket();
      jest.spyOn(adapter as any, "connectWebSocket").mockResolvedValue(ws);
      jest.spyOn(adapter as any, "isWebSocketConnected").mockReturnValue(true);

      // Connect and wait for connection
      const connectPromise = adapter.connect();

      // Simulate WebSocket open
      ws.simulateOpen();

      await connectPromise;

      expect(adapter.isConnected()).toBe(true);
      // The connectWebSocket method should have been called
      expect(adapter["connectWebSocket"]).toHaveBeenCalled();
    });

    it("should handle connection errors gracefully", async () => {
      // Mock the doConnect method to simulate connection failure
      jest.spyOn(adapter as any, "doConnect").mockRejectedValue(new Error("Connection failed"));

      // Test that connection errors are handled gracefully
      await expect(adapter.connect()).rejects.toThrow(
        "Failed to connect to cryptocom after 4 attempts: Connection failed"
      );
      expect(adapter.isConnected()).toBe(false);
    });

    it("should handle WebSocket constructor errors", async () => {
      // Mock the doConnect method to simulate constructor failure
      jest.spyOn(adapter as any, "doConnect").mockRejectedValue(new Error("WebSocket constructor failed"));

      await expect(adapter.connect()).rejects.toThrow(
        "Failed to connect to cryptocom after 4 attempts: WebSocket constructor failed"
      );
      expect(adapter.isConnected()).toBe(false);
    });

    it("should handle connection timeout errors", async () => {
      // Mock the doConnect method to simulate timeout
      jest.spyOn(adapter as any, "doConnect").mockRejectedValue(new Error("Connection timeout"));

      await expect(adapter.connect()).rejects.toThrow(
        "Failed to connect to cryptocom after 4 attempts: Connection timeout"
      );
      expect(adapter.isConnected()).toBe(false);
    });

    it("should not reconnect if already connected", async () => {
      // Mock the WebSocket connection
      const ws = createMockWebSocket();
      const connectSpy = jest.spyOn(adapter as any, "connectWebSocket").mockResolvedValue(ws);

      // First connect
      await adapter.connect();
      ws.simulateOpen();

      // Try to connect again
      await adapter.connect();

      // Should only have connected once
      expect(connectSpy).toHaveBeenCalledTimes(1);
    });

    it("should disconnect properly", async () => {
      // Mock the WebSocket connection
      const ws = createMockWebSocket();
      jest.spyOn(adapter as any, "connectWebSocket").mockResolvedValue(ws);
      jest.spyOn(adapter as any, "isWebSocketConnected").mockReturnValue(true);
      jest.spyOn(adapter as any, "disconnectWebSocket").mockResolvedValue(undefined);

      // Connect first
      await adapter.connect();
      ws.simulateOpen();

      // Mock isWebSocketConnected to return false after disconnect
      jest.spyOn(adapter as any, "isWebSocketConnected").mockReturnValue(false);

      // Now disconnect
      await adapter.disconnect();

      expect(adapter.isConnected()).toBe(false);
    });

    it("should handle WebSocket connection errors", async () => {
      const errorCallback = jest.fn();
      adapter.onError(errorCallback);

      // Simulate WebSocket error by directly calling the error handler
      const error = new Error("WebSocket error");
      (adapter as any).handleWebSocketError(error);

      // Verify error callback was called
      expect(errorCallback).toHaveBeenCalledWith(error);
    });

    it("should verify error behavior in connection tests", async () => {
      // Test that connection errors are properly caught and handled
      const errorSpy = jest.fn();
      adapter.onError(errorSpy);

      // Mock the doConnect method to simulate connection error
      const connectionError = new Error("WebSocket connection failed");
      jest.spyOn(adapter as any, "doConnect").mockRejectedValue(connectionError);

      try {
        await adapter.connect();
      } catch (error) {
        // Verify that error callback was called and error is handled properly
        expect(error).toBeDefined();
        expect(adapter.isConnected()).toBe(false);
        expect(errorSpy).toHaveBeenCalledWith(expect.any(Error));
      }
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
    let priceUpdateCallback: jest.Mock;

    beforeEach(async () => {
      // Create a new adapter instance for each test
      adapter = new CryptocomAdapter();

      // Create and assign a new mock WebSocket instance first
      mockWebSocket = createMockWebSocket();

      // Mock the connectWebSocket method to use our mock WebSocket
      jest.spyOn(adapter as any, "connectWebSocket").mockImplementation(async () => {
        (adapter as any).ws = mockWebSocket;
        // Simulate connection opening after a short delay
        setTimeout(() => {
          mockWebSocket.simulateOpen();
        }, 10);
      });

      // Mock isWebSocketConnected to return true
      jest.spyOn(adapter as any, "isWebSocketConnected").mockReturnValue(true);

      // Connect and wait for the connection to be established
      await adapter.connect();

      // Wait for the connection to be established
      await new Promise(resolve => setTimeout(resolve, 50));

      // Setup price update callback
      priceUpdateCallback = jest.fn();
      adapter.onPriceUpdate(priceUpdateCallback);
    });

    afterEach(() => {
      // Clean up after each test
      jest.clearAllMocks();
      if (adapter && typeof adapter.disconnect === "function") {
        try {
          adapter.disconnect().catch(() => {});
        } catch (error) {
          // Ignore errors during cleanup
        }
      }
    });

    it("should handle multiple tickers in one message", async () => {
      const message = {
        method: "ticker",
        result: {
          instrument_name: "tickers",
          subscription: "tickers.BTC_USDT,ETH_USDT,XRP_USDT",
          channel: "tickers",
          data: [
            mockTickerData,
            { ...mockTickerData, i: "ETH_USDT", a: "3000.0" },
            { ...mockTickerData, i: "XRP_USDT", a: "0.55" },
          ],
        },
      };

      // Directly call the message handler to simulate WebSocket message processing
      (adapter as any).handleWebSocketMessage(message);

      // Wait for the message to be processed
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify the price update callback was called for each ticker
      expect(priceUpdateCallback).toHaveBeenCalledTimes(3);

      // Get all symbols that were updated
      const symbols = priceUpdateCallback.mock.calls.map(call => call[0].symbol);
      expect(symbols).toContain("BTC/USDT");
      expect(symbols).toContain("ETH/USDT");
      expect(symbols).toContain("XRP/USDT");
    });

    it("should handle malformed WebSocket messages", () => {
      // Set up the price update callback
      const priceUpdateCallback = jest.fn();
      adapter.onPriceUpdate(priceUpdateCallback);

      // Simulate a malformed message
      mockWebSocket.simulateMessage({ invalid: "data" });

      // The callback should not be called with invalid data
      expect(priceUpdateCallback).not.toHaveBeenCalled();
    });

    it("should ignore heartbeat messages", () => {
      // Test different types of heartbeat messages
      mockWebSocket.simulateMessage({ method: "public/heartbeat" });
      mockWebSocket.simulateMessage({ method: "heartbeat" });
      mockWebSocket.simulateMessage({ method: "ping" });

      expect(priceUpdateCallback).not.toHaveBeenCalled();
    });

    it("should ignore subscription confirmations and control messages", () => {
      // Test different types of control messages
      mockWebSocket.simulateMessage({ method: "subscribe", code: 0 });
      mockWebSocket.simulateMessage({ method: "unsubscribe", code: 0 });
      mockWebSocket.simulateMessage({ method: "set_property", code: 0 });

      expect(priceUpdateCallback).not.toHaveBeenCalled();
    });

    it("should handle malformed messages gracefully", () => {
      // Set up error callback to capture errors
      const errorCallback = jest.fn();
      adapter.onError(errorCallback);

      // Test various malformed messages by directly calling the message handler
      // Only messages that actually cause parsing errors will trigger the error callback
      (adapter as any).handleWebSocketMessage("invalid json");

      expect(priceUpdateCallback).not.toHaveBeenCalled();
      expect(errorCallback).toHaveBeenCalledTimes(1);
    });

    it("should handle WebSocket errors", async () => {
      const errorCallback = jest.fn();
      adapter.onError(errorCallback);

      // Simulate WebSocket error by directly calling the error handler
      const error = new Error("WebSocket error");
      (adapter as any).handleWebSocketError(error);

      // Verify error callback was called with the error
      expect(errorCallback).toHaveBeenCalledWith(error);
    });
  });

  describe("subscription management", () => {
    let sendWebSocketMessageSpy: jest.SpyInstance;

    beforeEach(async () => {
      // Mock the WebSocket connection
      const ws = createMockWebSocket();
      jest.spyOn(adapter as any, "connectWebSocket").mockResolvedValue(ws);
      jest.spyOn(adapter as any, "isWebSocketConnected").mockReturnValue(true);

      // Mock sendWebSocketMessage to track calls
      sendWebSocketMessageSpy = jest.spyOn(adapter as any, "sendWebSocketMessage").mockImplementation(() => {});

      await adapter.connect();
      ws.simulateOpen();
    });

    it("should subscribe to symbols", async () => {
      await adapter.subscribe(["BTC/USDT", "ETH/USDT"]);

      // Verify subscription message was sent (single message with multiple channels)
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

      await expect(adapter.fetchTickerREST("BTC/USDT")).rejects.toThrow("HTTP error! status: 500");
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

      // Simulate WebSocket close which triggers connection change callback
      (adapter as any).handleWebSocketClose();

      expect(connectionCallback).toHaveBeenCalledWith(false);
    });
  });

  describe("health check", () => {
    it("should return true when connected", async () => {
      // Mock the WebSocket connection
      const ws = createMockWebSocket();
      jest.spyOn(adapter as any, "connectWebSocket").mockResolvedValue(ws);
      jest.spyOn(adapter as any, "isWebSocketConnected").mockReturnValue(true);

      await adapter.connect();
      ws.simulateOpen();

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
      // Mock the WebSocket connection
      const ws = createMockWebSocket();
      jest.spyOn(adapter as any, "connectWebSocket").mockResolvedValue(ws);
      jest.spyOn(adapter as any, "isWebSocketConnected").mockReturnValue(true);
      jest.spyOn(adapter as any, "disconnectWebSocket").mockResolvedValue(undefined);

      await adapter.connect();
      ws.simulateOpen();

      // Mock isWebSocketConnected to return false after disconnect
      jest.spyOn(adapter as any, "isWebSocketConnected").mockReturnValue(false);

      await adapter.disconnect();

      // Check that heartbeat interval is cleared
      const pingInterval = (adapter as any).pingInterval;
      expect(pingInterval).toBeNull();
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
      // Mock the WebSocket connection
      const ws = createMockWebSocket();
      mockWebSocket = ws;
      jest.spyOn(adapter as any, "connectWebSocket").mockResolvedValue(ws);
      jest.spyOn(adapter as any, "isWebSocketConnected").mockReturnValue(true);

      await adapter.connect();
      ws.simulateOpen();
    });

    it("should increment message ID for each request", async () => {
      // Mock sendWebSocketMessage to track calls
      const sendWebSocketMessageSpy = jest.spyOn(adapter as any, "sendWebSocketMessage").mockImplementation(() => {});

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
