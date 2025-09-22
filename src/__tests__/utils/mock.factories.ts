// Jest globals are available without import in standard Jest setup

interface MockWebSocketEventHandler {
  (...args: unknown[]): void;
}

interface MockWebSocket extends Partial<WebSocket> {
  on: (event: string, handler: MockWebSocketEventHandler) => MockWebSocket;
  off: (event: string, handler?: MockWebSocketEventHandler) => MockWebSocket;
  emit: (event: string, ...args: unknown[]) => boolean;
  ping: () => void;
  pong: () => void;
  terminate: () => void;
}

/**
 * Factory for creating commonly used mocks
 */
export class MockFactory {
  /**
   * Create a mock WebSocket
   */
  static createWebSocket(): MockWebSocket {
    const eventHandlers = new Map<string, MockWebSocketEventHandler[]>();

    const mockWs: MockWebSocket = {
      CONNECTING: 0,
      OPEN: 1,
      CLOSING: 2,
      CLOSED: 3,
      readyState: 1,
      onopen: null,
      onclose: null,
      onerror: null,
      onmessage: null,
      send: jest.fn(),
      close: jest.fn(),
      url: "ws://test.example.com",
      protocol: "",
      extensions: "",
      bufferedAmount: 0,
      binaryType: "blob" as BinaryType,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
      on: jest.fn((event: string, handler: MockWebSocketEventHandler): MockWebSocket => {
        // Store handlers for the event
        if (!eventHandlers.has(event)) {
          eventHandlers.set(event, []);
        }
        eventHandlers.get(event)!.push(handler);

        // Also set the direct properties for compatibility
        if (event === "open") {
          mockWs.onopen = handler;
        } else if (event === "close") {
          mockWs.onclose = handler;
        } else if (event === "error") {
          mockWs.onerror = handler;
        } else if (event === "message") {
          mockWs.onmessage = handler;
        }
        return mockWs;
      }),
      ping: jest.fn(),
      pong: jest.fn(),
      terminate: jest.fn(),
      off: jest.fn((event: string, handler?: MockWebSocketEventHandler): MockWebSocket => {
        if (handler && eventHandlers.has(event)) {
          const handlers = eventHandlers.get(event)!;
          const index = handlers.indexOf(handler);
          if (index > -1) {
            handlers.splice(index, 1);
          }
        }
        return mockWs;
      }),
      emit: jest.fn((event: string, ...args: unknown[]): boolean => {
        const handlers = eventHandlers.get(event) || [];
        handlers.forEach(handler => {
          try {
            handler(...args);
          } catch {
            // Ignore handler errors in tests
          }
        });
        return handlers.length > 0;
      }),
    };

    // Make close function properly update state
    const originalClose = mockWs.close;
    mockWs.close = jest.fn((code?: number, reason?: string) => {
      (mockWs as MockWebSocket & { readyState: number }).readyState = 3; // CLOSED
      if (mockWs.onclose) {
        try {
          const event = new CloseEvent("close", { code: code || 1000, reason: reason || "" });
          (mockWs.onclose as EventListener).call(mockWs as unknown as WebSocket, event);
        } catch {
          // Ignore errors in test callbacks
        }
      }
      if (originalClose) originalClose.call(mockWs, code, reason);
    });

    // Don't trigger open event automatically to prevent hanging
    // Tests should manually trigger events when needed

    return mockWs;
  }

  /**
   * Create a mock HTTP client (axios-like)
   */
  static createHttpClient() {
    return {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
      patch: jest.fn(),
      head: jest.fn(),
      options: jest.fn(),
      request: jest.fn(),
      defaults: {
        timeout: 5000,
        headers: {},
      },
      interceptors: {
        request: {
          use: jest.fn(),
          eject: jest.fn(),
        },
        response: {
          use: jest.fn(),
          eject: jest.fn(),
        },
      },
    };
  }

  /**
   * Create a mock EventEmitter
   */
  static createEventEmitter() {
    return {
      on: jest.fn(),
      off: jest.fn(),
      emit: jest.fn(),
      once: jest.fn(),
      removeListener: jest.fn(),
      removeAllListeners: jest.fn(),
      listeners: jest.fn().mockReturnValue([]),
      listenerCount: jest.fn().mockReturnValue(0),
      addListener: jest.fn(),
      prependListener: jest.fn(),
      prependOnceListener: jest.fn(),
      eventNames: jest.fn().mockReturnValue([]),
      getMaxListeners: jest.fn().mockReturnValue(10),
      setMaxListeners: jest.fn(),
    };
  }

  /**
   * Create a mock Timer
   */
  static createTimer() {
    return {
      setTimeout: jest.fn(),
      clearTimeout: jest.fn(),
      setInterval: jest.fn(),
      clearInterval: jest.fn(),
      setImmediate: jest.fn(),
      clearImmediate: jest.fn(),
    };
  }

  /**
   * Create a mock Logger
   */
  static createLogger() {
    return {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
      info: jest.fn(),
      trace: jest.fn(),
    };
  }

  /**
   * Create a mock Cache
   */
  static createCache() {
    const cache = new Map();
    return {
      get: jest.fn().mockImplementation(key => cache.get(key)),
      set: jest.fn().mockImplementation((key, value) => cache.set(key, value)),
      delete: jest.fn().mockImplementation(key => cache.delete(key)),
      clear: jest.fn().mockImplementation(() => cache.clear()),
      has: jest.fn().mockImplementation(key => cache.has(key)),
      size: jest.fn().mockImplementation(() => cache.size),
      keys: jest.fn().mockImplementation(() => Array.from(cache.keys())),
      values: jest.fn().mockImplementation(() => Array.from(cache.values())),
    };
  }

  /**
   * Create a mock Database connection
   */
  static createDatabase() {
    return {
      connect: jest.fn(),
      disconnect: jest.fn(),
      query: jest.fn(),
      transaction: jest.fn(),
      isConnected: jest.fn().mockReturnValue(true),
    };
  }

  /**
   * Create a mock Exchange Adapter
   */
  static createExchangeAdapter(exchangeName: string = "test-exchange") {
    return {
      exchangeName,
      category: 1,
      supportedSymbols: ["BTC/USD", "ETH/USD"],
      getPrice: jest.fn(),
      getPrices: jest.fn(),
      getVolume: jest.fn(),
      healthCheck: jest.fn(),
      isSymbolSupported: jest.fn().mockReturnValue(true),
      connect: jest.fn(),
      disconnect: jest.fn(),
      subscribe: jest.fn(),
      unsubscribe: jest.fn(),
    };
  }

  /**
   * Create a mock Configuration Service
   */
  static createConfigService() {
    return {
      get: jest.fn(),
      getConfig: jest.fn(),
      getFeedConfigurations: jest.fn().mockReturnValue([]),
      getEnvironmentConfig: jest.fn().mockReturnValue({}),
      validateConfiguration: jest.fn().mockReturnValue({ isValid: true }),
    };
  }

  /**
   * Create a comprehensive mock for FTSO Provider Service
   */
  static createFtsoProviderService() {
    return {
      healthCheck: jest.fn(async () => ({
        status: "healthy",
        timestamp: Date.now(),
      })),
      getPerformanceMetrics: jest.fn(async () => ({
        uptime: 3600,
        responseTime: { average: 100, p95: 150, max: 200 },
        requestsPerSecond: 20,
        errorRate: 0.01,
      })),
      getValue: jest.fn(),
      getValues: jest.fn(),
      getVolumes: jest.fn(),
    };
  }

  /**
   * Create a mock Integration Service
   */
  static createIntegrationService() {
    return {
      getSystemHealth: jest.fn(async () => ({
        status: "healthy",
        timestamp: Date.now(),
        sources: [],
        aggregation: {
          successRate: 100,
          errorCount: 0,
        },
        performance: {
          averageResponseTime: 50,
          errorRate: 0.01,
        },
        accuracy: {
          averageConfidence: 0.99,
          outlierRate: 0.01,
        },
      })),
      isHealthy: jest.fn().mockReturnValue(true),
      getStatus: jest.fn().mockReturnValue("healthy"),
      getMetrics: jest.fn().mockReturnValue({}),
      initialize: jest.fn(),
      subscribeToFeed: jest.fn(),
    };
  }

  /**
   * Create a mock API Monitor Service
   */
  static createApiMonitorService() {
    return {
      recordRequest: jest.fn(),
      getMetrics: jest.fn().mockReturnValue({
        totalRequests: 100,
        averageResponseTime: 50,
        errorRate: 0.01,
      }),
    };
  }

  /**
   * Create a mock data source for testing
   */
  static createDataSource(id: string = "test-source", type: "websocket" | "rest" = "websocket") {
    return {
      id,
      type,
      isConnected: jest.fn().mockReturnValue(true),
      connect: jest.fn(),
      disconnect: jest.fn(),
      subscribe: jest.fn(),
      unsubscribe: jest.fn(),
      getHealth: jest.fn().mockReturnValue({ status: "healthy" }),
    };
  }

  /**
   * Create a mock circuit breaker
   */
  static createCircuitBreaker() {
    return {
      registerCircuit: jest.fn(),
      unregisterCircuit: jest.fn(),
      execute: jest.fn(async () => true),
      getState: jest.fn().mockReturnValue("closed"),
      openCircuit: jest.fn(),
      closeCircuit: jest.fn(),
      destroy: jest.fn(),
    };
  }

  /**
   * Create a mock failover manager
   */
  static createFailoverManager() {
    return {
      registerDataSource: jest.fn(),
      unregisterDataSource: jest.fn(),
      configureFailoverGroup: jest.fn(),
      triggerFailover: jest.fn(async () => ({
        success: true,
        failoverTime: 50,
        newPrimarySource: "backup-source",
        degradationLevel: "none",
      })),
      destroy: jest.fn(),
      on: jest.fn(),
    };
  }
}

/**
 * Global mock setup utilities
 */
export class MockSetup {
  /**
   * Setup global fetch mock
   */
  static setupFetch() {
    global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;
  }

  /**
   * Setup global WebSocket mock
   */
  static setupWebSocket() {
    const mockWebSockets: MockWebSocket[] = [];

    // Create a WebSocket constructor that returns our mock
    const WebSocketConstructor = jest.fn().mockImplementation(() => {
      const ws = MockFactory.createWebSocket();
      mockWebSockets.push(ws);
      return ws;
    });

    // Add WebSocket constants
    Object.assign(WebSocketConstructor, {
      CONNECTING: 0,
      OPEN: 1,
      CLOSING: 2,
      CLOSED: 3,
    });

    // Set up global WebSocket
    (global as unknown as { WebSocket: unknown }).WebSocket = WebSocketConstructor;

    // Store reference for cleanup
    (global as typeof global & { __mockWebSockets: MockWebSocket[] }).__mockWebSockets = mockWebSockets;
  }

  /**
   * Setup global console mocks (to reduce test noise)
   */
  static setupConsole() {
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "debug").mockImplementation(() => {});
  }

  /**
   * Setup all common global mocks
   */
  static setupAll() {
    this.setupFetch();
    this.setupWebSocket();
    this.setupConsole();
  }

  /**
   * Cleanup all mocks
   */
  static cleanup() {
    // Cleanup mock WebSockets aggressively
    const mockWebSockets = (global as typeof global & { __mockWebSockets?: MockWebSocket[] }).__mockWebSockets;
    if (mockWebSockets && Array.isArray(mockWebSockets)) {
      mockWebSockets.forEach((ws: MockWebSocket) => {
        try {
          if (ws) {
            // Force immediate closure
            (ws as MockWebSocket & { readyState: number }).readyState = 3; // CLOSED

            // Clear all event handlers to prevent callbacks
            ws.onopen = null;
            ws.onclose = null;
            ws.onerror = null;
            ws.onmessage = null;

            if (typeof ws.terminate === "function") {
              ws.terminate();
            }
            if (typeof ws.close === "function") {
              ws.close(1000, "Test cleanup");
            }
          }
        } catch {
          // Ignore cleanup errors
        }
      });
      mockWebSockets.length = 0;
    }

    // Clear any pending timers more aggressively
    try {
      // Clear all timeouts up to a reasonable range
      for (let i = 1; i <= 1000; i++) {
        try {
          clearTimeout(i as unknown as NodeJS.Timeout);
          clearInterval(i as unknown as NodeJS.Timeout);
        } catch {
          // Ignore errors for invalid timer IDs
        }
      }
    } catch {
      // Ignore cleanup errors
    }

    // Force garbage collection if available
    if (typeof global.gc === "function") {
      try {
        global.gc();
      } catch {
        // Ignore if gc is not available
      }
    }

    jest.clearAllMocks();
    jest.restoreAllMocks();
  }
}
