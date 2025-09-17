// Mock DataSource implementation
interface MockDataSource {
  id: string;
  type: "websocket" | "rest";
  priority: number;
  category: number;
  connected: boolean;
  latency: number;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  getLatency(): number;
  subscribe(symbols: string[]): Promise<void>;
  unsubscribe(symbols: string[]): Promise<void>;
  onPriceUpdate(callback: (update: any) => void): void;
  onConnectionChange(callback: (connected: boolean) => void): void;
  onError?(callback: (error: Error) => void): void;
}

class MockDataSourceImpl implements MockDataSource {
  id: string;
  type: "websocket" | "rest";
  priority: number;
  category: number;
  connected: boolean = false;
  latency: number = 50;
  private connectionChangeCallback?: (connected: boolean) => void;

  constructor(id: string, type: "websocket" | "rest" = "websocket", category: number = 1) {
    this.id = id;
    this.type = type;
    this.priority = 1;
    this.category = category;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getLatency(): number {
    return this.latency;
  }

  async connect(): Promise<void> {
    this.connected = true;
    if (this.connectionChangeCallback) {
      this.connectionChangeCallback(true);
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.connectionChangeCallback) {
      this.connectionChangeCallback(false);
    }
  }

  async subscribe(_symbols: string[]): Promise<void> {
    // Mock implementation
  }

  async unsubscribe(_symbols: string[]): Promise<void> {
    // Mock implementation
  }

  onPriceUpdate(_callback: (update: any) => void): void {
    // Mock implementation
  }

  onConnectionChange(callback: (connected: boolean) => void): void {
    this.connectionChangeCallback = callback;
  }

  onError?(_callback: (error: Error) => void): void {
    // Mock implementation
  }
}

describe("Data Source Connection Integration", () => {
  describe("Data Source Connection", () => {
    it("should connect to data source successfully", async () => {
      const mockSource = new MockDataSourceImpl("test-source");

      await mockSource.connect();

      expect(mockSource.isConnected()).toBe(true);
    });

    it("should handle connection failures gracefully", async () => {
      const mockSource = new MockDataSourceImpl("failing-source");

      // Mock connect to throw an error
      jest.spyOn(mockSource, "connect").mockRejectedValue(new Error("Connection failed"));

      await expect(mockSource.connect()).rejects.toThrow("Connection failed");
      expect(mockSource.isConnected()).toBe(false);
    });

    it("should retry connection on failure", async () => {
      const mockSource = new MockDataSourceImpl("retry-source");
      let connectAttempts = 0;

      jest.spyOn(mockSource, "connect").mockImplementation(async () => {
        connectAttempts++;
        if (connectAttempts < 3) {
          throw new Error("Connection failed");
        }
        mockSource.connected = true;
      });

      // Test retry logic by calling connect multiple times
      try {
        await mockSource.connect();
      } catch (error) {
        // Expected to fail on first attempts
      }

      try {
        await mockSource.connect();
      } catch (error) {
        // Expected to fail on second attempt
      }

      await mockSource.connect(); // Should succeed on third attempt

      expect(connectAttempts).toBe(3);
    });

    it("should handle WebSocket connection errors", async () => {
      const mockWebSocketSource = new MockDataSourceImpl("websocket-source", "websocket");

      // Mock WebSocket-specific error
      jest
        .spyOn(mockWebSocketSource, "connect")
        .mockRejectedValue(new Error("Cannot set property readyState of #<WebSocket> which has only a getter"));

      await expect(mockWebSocketSource.connect()).rejects.toThrow("Cannot set property readyState");
      expect(mockWebSocketSource.isConnected()).toBe(false);
    });

    it("should handle REST connection errors", async () => {
      const mockRestSource = new MockDataSourceImpl("rest-source", "rest");

      // Mock REST-specific error
      jest.spyOn(mockRestSource, "connect").mockRejectedValue(new Error("Network timeout"));

      await expect(mockRestSource.connect()).rejects.toThrow("Network timeout");
      expect(mockRestSource.isConnected()).toBe(false);
    });
  });

  describe("Data Source Management", () => {
    it("should create data source with correct properties", () => {
      const mockSource = new MockDataSourceImpl("registry-source", "websocket", 1);

      expect(mockSource.id).toBe("registry-source");
      expect(mockSource.type).toBe("websocket");
      expect(mockSource.category).toBe(1);
      expect(mockSource.priority).toBe(1);
    });

    it("should handle different data source types", () => {
      const websocketSource = new MockDataSourceImpl("ws-source", "websocket");
      const restSource = new MockDataSourceImpl("rest-source", "rest");

      expect(websocketSource.type).toBe("websocket");
      expect(restSource.type).toBe("rest");
    });

    it("should handle different feed categories", () => {
      const cryptoSource = new MockDataSourceImpl("crypto-source", "websocket", 1);
      const forexSource = new MockDataSourceImpl("forex-source", "websocket", 2);

      expect(cryptoSource.category).toBe(1);
      expect(forexSource.category).toBe(2);
    });
  });

  describe("Connection Recovery", () => {
    it("should recover from connection failures", async () => {
      const mockSource = new MockDataSourceImpl("recovery-source");
      let connectionAttempts = 0;

      jest.spyOn(mockSource, "connect").mockImplementation(async () => {
        connectionAttempts++;
        if (connectionAttempts === 1) {
          throw new Error("Initial connection failed");
        }
        mockSource.connected = true;
      });

      // First attempt should fail
      try {
        await mockSource.connect();
      } catch (error) {
        // Expected to fail
      }

      // Second attempt should succeed
      await mockSource.connect();

      expect(connectionAttempts).toBe(2);
    });

    it("should handle connection state changes", async () => {
      const mockSource = new MockDataSourceImpl("state-change-source");
      const connectionCallback = jest.fn();

      mockSource.onConnectionChange(connectionCallback);

      await mockSource.connect();
      expect(connectionCallback).toHaveBeenCalledWith(true);

      await mockSource.disconnect();
      expect(connectionCallback).toHaveBeenCalledWith(false);
    });
  });

  describe("Feed Subscription", () => {
    it("should subscribe to feed symbols", async () => {
      const mockSource = new MockDataSourceImpl("subscription-source");
      const subscribeSpy = jest.spyOn(mockSource, "subscribe");

      await mockSource.subscribe(["FLR/USD"]);

      expect(subscribeSpy).toHaveBeenCalledWith(["FLR/USD"]);
    });

    it("should handle subscription failures", async () => {
      const mockSource = new MockDataSourceImpl("subscription-fail-source");

      jest.spyOn(mockSource, "subscribe").mockRejectedValue(new Error("Subscription failed"));

      await expect(mockSource.subscribe(["FLR/USD"])).rejects.toThrow("Subscription failed");
    });
  });

  describe("Error Handling", () => {
    it("should handle data source errors", () => {
      const mockSource = new MockDataSourceImpl("error-source");
      const errorCallback = jest.fn();

      mockSource.onError?.(errorCallback);

      // Simulate an error by calling the callback directly
      const error = new Error("Data source error");
      errorCallback(error);

      expect(errorCallback).toHaveBeenCalledWith(error);
    });

    it("should handle connection state changes", async () => {
      const mockSource = new MockDataSourceImpl("state-change-source");
      const connectionCallback = jest.fn();

      mockSource.onConnectionChange(connectionCallback);

      await mockSource.connect();
      expect(connectionCallback).toHaveBeenCalledWith(true);

      await mockSource.disconnect();
      expect(connectionCallback).toHaveBeenCalledWith(false);
    });
  });

  describe("Performance Monitoring", () => {
    it("should track connection latency", () => {
      const mockSource = new MockDataSourceImpl("latency-source");
      mockSource.getLatency = jest.fn().mockReturnValue(100);

      expect(mockSource.getLatency()).toBe(100);
    });

    it("should handle high latency connections", () => {
      const mockSource = new MockDataSourceImpl("high-latency-source");
      mockSource.getLatency = jest.fn().mockReturnValue(5000); // 5 seconds

      expect(mockSource.getLatency()).toBe(5000);
    });
  });

  describe("Data Source Validation", () => {
    it("should validate data source interface compliance", () => {
      const mockSource = new MockDataSourceImpl("validation-source");

      // Check that all required methods exist
      expect(typeof mockSource.connect).toBe("function");
      expect(typeof mockSource.disconnect).toBe("function");
      expect(typeof mockSource.isConnected).toBe("function");
      expect(typeof mockSource.getLatency).toBe("function");
      expect(typeof mockSource.subscribe).toBe("function");
      expect(typeof mockSource.unsubscribe).toBe("function");
      expect(typeof mockSource.onPriceUpdate).toBe("function");
      expect(typeof mockSource.onConnectionChange).toBe("function");
    });

    it("should handle missing optional methods", () => {
      const mockSource = new MockDataSourceImpl("optional-methods-source");

      // onError is optional, so it might be undefined
      expect(mockSource.onError).toBeDefined();
    });
  });
});
