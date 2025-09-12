import { CryptocomAdapter, ICryptocomTickerData, ICryptocomRestResponse } from "../cryptocom.adapter";
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

  // Define proper type for event listeners
  type EventListeners = {
    message: ((ev: MessageEvent) => void)[];
    error: ((ev: Event) => void)[];
    open: ((ev: Event) => void)[];
    close: ((ev: CloseEvent) => void)[];
  };

  const eventListeners: EventListeners = {
    message: [],
    error: [],
    open: [],
    close: [],
  };

  // Create a new mock WebSocket instance
  const mockWs: MockWebSocket & {
    simulateMessage: (data: unknown) => MockWebSocket;
    simulateError: (error: Error) => MockWebSocket;
    simulateOpen: () => MockWebSocket;
    simulateClose: (code?: number, reason?: string) => MockWebSocket;
    clearMocks: () => void;
    _setReadyState: (state: number) => void;
  } = {
    get readyState() {
      return _readyState;
    },
    set readyState(value) {
      _readyState = value;
      if (value === 1) {
        // OPEN - Create a proper Event object
        const openEvent = {
          type: "open",
          target: mockWs,
          currentTarget: mockWs,
          srcElement: mockWs,
          eventPhase: 2,
          bubbles: false,
          cancelable: false,
          defaultPrevented: false,
          timeStamp: Date.now(),
          composed: false,
          isTrusted: true,
          cancelBubble: false,
          returnValue: true,
          composedPath: () => [],
          initEvent: () => {},
          preventDefault: () => {},
          stopPropagation: () => {},
          stopImmediatePropagation: () => {},
          NONE: 0,
          CAPTURING_PHASE: 1,
          AT_TARGET: 2,
          BUBBLING_PHASE: 3,
        } as unknown as Event;

        if (mockWs.onopen) mockWs.onopen(openEvent);
        eventListeners.open.forEach(cb => cb(openEvent));
      } else if (value === 3) {
        // CLOSED - Create a proper CloseEvent object
        const closeEvent = {
          type: "close",
          code: 1000,
          reason: "",
          wasClean: true,
          target: mockWs,
          currentTarget: mockWs,
          srcElement: mockWs,
          eventPhase: 2,
          bubbles: false,
          cancelable: false,
          defaultPrevented: false,
          timeStamp: Date.now(),
          composed: false,
          isTrusted: true,
          cancelBubble: false,
          returnValue: true,
          composedPath: () => [],
          initEvent: () => {},
          preventDefault: () => {},
          stopPropagation: () => {},
          stopImmediatePropagation: () => {},
          NONE: 0,
          CAPTURING_PHASE: 1,
          AT_TARGET: 2,
          BUBBLING_PHASE: 3,
        } as unknown as CloseEvent;

        if (mockWs.onclose) mockWs.onclose(closeEvent);
        eventListeners.close.forEach(cb => cb(closeEvent));
      }
    },
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
    send: jest.fn().mockImplementation((data: string) => {
      try {
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
        // Handle ping messages
        if (message.method === "public/heartbeat") {
          mockWs.simulateMessage({
            id: message.id,
            method: "public/heartbeat",
            code: 0,
            result: {},
          });
        }
      } catch (e) {
        console.error("Error in mock WebSocket send:", e);
      }
    }),
    close: jest.fn().mockImplementation((code = 1000, reason = "") => {
      _readyState = 3; // CLOSED
      const closeEvent = {
        type: "close",
        code,
        reason,
        wasClean: code === 1000,
        target: mockWs,
        currentTarget: mockWs,
        srcElement: mockWs,
        eventPhase: 2,
        bubbles: false,
        cancelable: false,
        defaultPrevented: false,
        timeStamp: Date.now(),
        composed: false,
        isTrusted: true,
        cancelBubble: false,
        returnValue: true,
        composedPath: () => [],
        initEvent: () => {},
        preventDefault: () => {},
        stopPropagation: () => {},
        stopImmediatePropagation: () => {},
        NONE: 0,
        CAPTURING_PHASE: 1,
        AT_TARGET: 2,
        BUBBLING_PHASE: 3,
      } as unknown as CloseEvent;

      if (mockWs.onclose) mockWs.onclose(closeEvent);
      eventListeners.close.forEach(cb => cb(closeEvent));
    }),
    addEventListener: jest.fn((event: string, listener: EventListenerOrEventListenerObject | null) => {
      if (event in eventListeners && listener) {
        if (typeof listener === "function") {
          eventListeners[event as keyof EventListeners].push(listener);
        } else if (typeof listener === "object" && listener !== null && "handleEvent" in listener) {
          // Handle EventListenerObject case with type assertion
          const eventListenerObj = listener as EventListenerObject;
          eventListeners[event as keyof EventListeners].push(e => eventListenerObj.handleEvent(e));
        }
      }
    }),
    removeEventListener: jest.fn((event: string, listener: EventListenerOrEventListenerObject | null) => {
      if (!(event in eventListeners) || !listener) return;

      const listeners = eventListeners[event as keyof EventListeners];
      const index = listeners.findIndex(l => {
        if (typeof listener === "function") {
          return l === listener;
        } else if (typeof listener === "object" && "handleEvent" in listener) {
          return (l as unknown as { handleEvent: EventListener }).handleEvent === listener.handleEvent;
        }
        return false;
      });

      if (index !== -1) {
        listeners.splice(index, 1);
      }
    }),
    simulateMessage: function (this: MockWebSocket, data: unknown) {
      const event = {
        data: JSON.stringify(data),
        type: "message",
        target: this,
        currentTarget: this,
        srcElement: this,
        eventPhase: 2, // AT_TARGET
        bubbles: false,
        cancelable: false,
        defaultPrevented: false,
        timeStamp: Date.now(),
        composed: false,
        isTrusted: true,
        cancelBubble: false,
        returnValue: true,
        composedPath: () => [],
        initEvent: () => {},
        // Add event phase constants
        NONE: 0,
        CAPTURING_PHASE: 1,
        AT_TARGET: 2,
        BUBBLING_PHASE: 3,
      } as unknown as MessageEvent;

      if (this.onmessage) this.onmessage(event);
      eventListeners.message.forEach(cb => cb(event));
      return this;
    },
    simulateError: function (this: MockWebSocket, error: Error) {
      // Create a simple error event
      const errorEvent = {
        type: "error",
        error: error,
        message: error.message,
        cancelable: true,
        defaultPrevented: false,
        timeStamp: Date.now(),
        // Add standard Event properties and methods
        preventDefault: () => {
          (errorEvent as any).defaultPrevented = true;
        },
        stopPropagation: () => {},
        stopImmediatePropagation: () => {},
        // Add event phase constants
        NONE: 0,
        CAPTURING_PHASE: 1,
        AT_TARGET: 2,
        BUBBLING_PHASE: 3,
        eventPhase: 2, // AT_TARGET
        bubbles: false,
        target: this,
        currentTarget: this,
        srcElement: this as any,
        composed: false,
        isTrusted: true,
        cancelBubble: false,
        returnValue: true,
        composedPath: () => [],
        initEvent: () => {},
        // ErrorEvent specific
        filename: "",
        colno: 0,
        lineno: 0,
      } as unknown as ErrorEvent;

      // Call the onerror handler if it exists
      if (this.onerror) {
        // Call with the error event first (standard behavior)
        this.onerror(errorEvent);

        // Also call with just the error object (some WebSocket implementations do this)
        try {
          (this.onerror as any)(error);
        } catch (e) {
          // Ignore any errors from the second call
        }
      }

      // Call any registered error event listeners
      if (eventListeners.error) {
        for (const listener of [...eventListeners.error]) {
          try {
            if (typeof listener === "function") {
              listener(errorEvent);
            } else if (listener && typeof listener === "object" && "handleEvent" in listener) {
              // Safe type assertion for EventListenerObject
              (listener as EventListenerObject).handleEvent(errorEvent);
            }
          } catch (e) {
            console.error("Error in error event listener:", e);
          }
        }
      }

      return this;
    },
    simulateOpen: function (this: MockWebSocket) {
      _readyState = 1; // OPEN
      const openEvent = {
        type: "open",
        target: this,
        currentTarget: this,
        srcElement: this,
        eventPhase: 2, // AT_TARGET
        bubbles: false,
        cancelable: false,
        defaultPrevented: false,
        timeStamp: Date.now(),
        composed: false,
        isTrusted: true,
        cancelBubble: false,
        returnValue: true,
        composedPath: () => [],
        initEvent: () => {},
        // Add event phase constants
        NONE: 0,
        CAPTURING_PHASE: 1,
        AT_TARGET: 2,
        BUBBLING_PHASE: 3,
      } as unknown as Event;

      if (this.onopen) this.onopen(openEvent);
      eventListeners.open.forEach(cb => cb(openEvent));
      return this;
    },
    simulateClose: function (this: MockWebSocket, code = 1000, reason = "") {
      _readyState = 3; // CLOSED
      const closeEvent: CloseEvent = {
        code,
        reason,
        wasClean: code === 1000,
        type: "close",
        target: this as any,
        currentTarget: this as any,
        srcElement: this as any,
        eventPhase: 2, // AT_TARGET
        bubbles: false,
        cancelable: false,
        defaultPrevented: false,
        timeStamp: Date.now(),
        composed: false,
        isTrusted: true,
        cancelBubble: false,
        returnValue: true,
        composedPath: () => [],
        initEvent: () => {},
        preventDefault: () => {},
        stopPropagation: () => {},
        stopImmediatePropagation: () => {},
        NONE: 0,
        CAPTURING_PHASE: 1,
        AT_TARGET: 2,
        BUBBLING_PHASE: 3,
      } as unknown as CloseEvent;

      if (this.onclose) this.onclose(closeEvent);
      eventListeners.close.forEach(cb => cb(closeEvent));
      return this;
    },
    clearMocks: function () {
      this.send.mockClear();
      this.close.mockClear();
      this.addEventListener.mockClear();
      this.removeEventListener.mockClear();
      return this;
    },
    _setReadyState: function (state: number) {
      _readyState = state;
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

// Mock the WebSocket class
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
  let mockWebSocket: MockWebSocket;
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
    // Create a fresh mock WebSocket instance before each test
    mockWebSocket = createMockWebSocket();

    // Create a new adapter instance
    adapter = new CryptocomAdapter();

    // Set the mock WebSocket on the adapter for testing
    adapter.setMockWebSocketForTesting(mockWebSocket as unknown as WebSocket);

    // Clear all mocks and timers
    jest.clearAllMocks();
    jest.clearAllTimers();

    // Mock the WebSocket manager
    jest.spyOn(adapter as any, "connectWebSocket").mockResolvedValue(mockWebSocket);
  });

  afterEach(async () => {
    // Clean up any resources
    if (adapter.isConnected()) {
      await adapter.disconnect();
    }

    // Clear any pending timers and mocks
    jest.clearAllTimers();
    jest.clearAllMocks();
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
    beforeEach(() => {
      jest.spyOn(adapter as any, "connectWebSocket").mockResolvedValue(mockWebSocket);
    });

    afterEach(() => {
      // Clean up any pending timeouts or intervals
      jest.clearAllMocks();
      jest.clearAllTimers();
    });

    it("should connect to WebSocket", async () => {
      const onConnect = jest.fn();
      adapter.onConnectionChange(onConnect);

      // Mock the WebSocket connection
      mockWebSocket.readyState = 1; // WebSocket.OPEN

      await adapter.connect();

      expect(adapter.isConnected()).toBe(true);
      expect(onConnect).toHaveBeenCalledWith(true);
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

      await expect(adapter.connect()).rejects.toThrow("WebSocket constructor failed");
      expect(adapter.isConnected()).toBe(false);
    });

    it("should handle WebSocket errors", async () => {
      // Mock the WebSocket error handler
      const error = new Error("WebSocket error");

      // Spy on the logger's error method
      const loggerErrorSpy = jest.spyOn(adapter["logger"], "error");

      // Set up error listener before connecting
      const errorPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Test timed out"));
        }, 1000);

        adapter.onError((err: Error | Event) => {
          clearTimeout(timeout);
          // Check if it's an Error object
          if (err instanceof Error) {
            expect(err).toBeInstanceOf(Error);
          }
          // Check if it's an Event object with type 'error'
          else if (err && "type" in err && err.type === "error") {
            expect(err.type).toBe("error");
          }
          // Handle any other case
          else {
            reject(new Error("Unexpected error type"));
          }
          resolve();
        });
      });

      // Connect and simulate error
      await adapter.connect();

      // Simulate WebSocket open first
      mockWebSocket.readyState = 1; // WebSocket.OPEN

      // Then simulate error
      mockWebSocket.simulateError(error);

      // Wait for error to be handled with a timeout
      await expect(errorPromise).resolves.not.toThrow();

      // Verify error was logged using the logger
      expect(loggerErrorSpy).toHaveBeenCalledWith(expect.stringContaining("WebSocket error"), expect.anything());
      loggerErrorSpy.mockRestore();
    }, 5000); // 5 second timeout

    it("should disconnect successfully", async () => {
      // First connect
      await adapter.connect();
      mockWebSocket.readyState = 1; // WebSocket.OPEN
      mockWebSocket.simulateOpen();

      // Set up close listener
      const closePromise = new Promise<void>(resolve => {
        adapter.onConnectionChange(isConnected => {
          if (!isConnected) resolve();
        });
      });

      // Then disconnect
      await adapter.disconnect();

      // Verify close was called with correct parameters
      expect(mockWebSocket.close).toHaveBeenCalledWith(1000, "Normal closure");

      // Update readyState to CLOSED after close is called
      mockWebSocket.readyState = 3; // WebSocket.CLOSED

      // Simulate close event
      mockWebSocket.simulateClose();

      // Wait for close to complete
      await closePromise;

      // Should be disconnected
      expect(adapter.isConnected()).toBe(false);
    });

    it("should handle disconnection when not connected", async () => {
      await adapter.disconnect();
      expect(mockWebSocket.close).not.toHaveBeenCalled();
    });

    it("should handle disconnection errors gracefully", async () => {
      // First connect
      await adapter.connect();
      mockWebSocket.readyState = 1; // WebSocket.OPEN
      mockWebSocket.simulateOpen();

      // Make close throw an error
      mockWebSocket.close.mockImplementationOnce(() => {
        throw new Error("Failed to close");
      });

      // Then disconnect - should not throw
      await expect(adapter.disconnect()).resolves.toBeUndefined();
      expect(mockWebSocket.close).toHaveBeenCalled();

      // Update readyState to CLOSED even if close throws
      mockWebSocket.readyState = 3; // WebSocket.CLOSED

      // Simulate close event
      mockWebSocket.simulateClose();

      // Should still be disconnected
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

      await expect(adapter.fetchTickerREST("BTC/USDT")).rejects.toThrow("HTTP error! status: 500");
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
