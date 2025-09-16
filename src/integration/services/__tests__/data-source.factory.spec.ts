import { Test, TestingModule } from "@nestjs/testing";
import { DataSourceFactory } from "../data-source.factory";
import { EventEmitter } from "events";
import type { IExchangeAdapter } from "@/common/types/adapters";
import { FeedCategory } from "@/common/types/core";

// Mock exchange adapter
const createMockAdapter = (exchangeName: string): IExchangeAdapter => ({
  exchangeName,
  category: FeedCategory.Crypto,
  capabilities: {
    supportsWebSocket: true,
    supportsREST: true,
    supportsVolume: true,
    supportsOrderBook: false,
    supportedCategories: [FeedCategory.Crypto],
  },
  normalizePriceData: jest.fn().mockReturnValue({}),
  normalizeVolumeData: jest.fn().mockReturnValue({}),
  validateResponse: jest.fn().mockReturnValue(true),
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  isConnected: jest.fn().mockReturnValue(false),
  subscribe: jest.fn().mockResolvedValue(undefined),
  unsubscribe: jest.fn().mockResolvedValue(undefined),
  onPriceUpdate: jest.fn(),
  onConnectionChange: jest.fn(),
  onError: jest.fn(),
  getSymbolMapping: jest.fn().mockReturnValue("BTC/USD"),
  validateSymbol: jest.fn().mockReturnValue(true),
  getConfig: jest.fn().mockReturnValue({}),
  updateConfig: jest.fn(),
});

describe("DataSourceFactory", () => {
  let factory: DataSourceFactory;
  let mockAdapter: IExchangeAdapter;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DataSourceFactory],
    }).compile();

    factory = module.get<DataSourceFactory>(DataSourceFactory);
    mockAdapter = createMockAdapter("TestExchange");
  });

  describe("createFromAdapter", () => {
    it("should create DataSource from adapter", () => {
      const dataSource = factory.createFromAdapter(mockAdapter, 1);

      expect(dataSource).toBeDefined();
      expect(dataSource.priority).toBe(1);
      expect(dataSource.id).toBe("TestExchange");
    });

    it("should use default priority when not provided", () => {
      const dataSource = factory.createFromAdapter(mockAdapter);

      expect(dataSource.priority).toBe(1);
    });

    it("should create DataSource with custom priority", () => {
      const dataSource = factory.createFromAdapter(mockAdapter, 5);

      expect(dataSource.priority).toBe(5);
    });
  });

  describe("createFromAdapters", () => {
    it("should create multiple DataSources from adapters", () => {
      const adapters = [
        { adapter: createMockAdapter("Exchange1"), priority: 1 },
        { adapter: createMockAdapter("Exchange2"), priority: 2 },
        { adapter: createMockAdapter("Exchange3"), priority: 3 },
      ];

      const dataSources = factory.createFromAdapters(adapters);

      expect(dataSources).toHaveLength(3);
      expect(dataSources[0].id).toBe("Exchange1");
      expect(dataSources[0].priority).toBe(1);
      expect(dataSources[1].id).toBe("Exchange2");
      expect(dataSources[1].priority).toBe(2);
      expect(dataSources[2].id).toBe("Exchange3");
      expect(dataSources[2].priority).toBe(3);
    });

    it("should handle empty adapters array", () => {
      const dataSources = factory.createFromAdapters([]);

      expect(dataSources).toHaveLength(0);
    });
  });
});

describe("AdapterDataSource", () => {
  let factory: DataSourceFactory;
  let mockAdapter: IExchangeAdapter;
  let dataSource: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DataSourceFactory],
    }).compile();

    factory = module.get<DataSourceFactory>(DataSourceFactory);
    mockAdapter = createMockAdapter("TestExchange");
    dataSource = factory.createFromAdapter(mockAdapter, 1);
  });

  describe("constructor and properties", () => {
    it("should initialize with correct properties", () => {
      expect(dataSource.id).toBe("TestExchange");
      expect(dataSource.priority).toBe(1);
      expect(dataSource.connected).toBe(false);
    });

    it("should be an EventEmitter", () => {
      expect(dataSource).toBeInstanceOf(EventEmitter);
    });
  });

  describe("connect", () => {
    it("should connect to adapter", async () => {
      await dataSource.connect();

      expect(mockAdapter.connect).toHaveBeenCalled();
      expect(dataSource.connected).toBe(true);
    });

    it("should emit connected event", async () => {
      const connectedSpy = jest.fn();
      dataSource.on("connectionChange", connectedSpy);

      await dataSource.connect();

      expect(connectedSpy).toHaveBeenCalledWith(true);
    });

    it("should handle connection errors", async () => {
      const error = new Error("Connection failed");
      (mockAdapter.connect as jest.Mock).mockRejectedValue(error);

      const errorSpy = jest.fn();
      dataSource.on("error", errorSpy);

      await expect(dataSource.connect()).rejects.toThrow("Connection failed");
      expect(errorSpy).toHaveBeenCalledWith(error);
    });
  });

  describe("disconnect", () => {
    beforeEach(async () => {
      await dataSource.connect();
    });

    it("should disconnect from adapter", async () => {
      await dataSource.disconnect();

      expect(mockAdapter.disconnect).toHaveBeenCalled();
      expect(dataSource.connected).toBe(false);
    });

    it("should emit disconnected event", async () => {
      const disconnectedSpy = jest.fn();
      dataSource.on("connectionChange", disconnectedSpy);

      await dataSource.disconnect();

      expect(disconnectedSpy).toHaveBeenCalledWith(false);
    });

    it("should handle disconnection errors", async () => {
      const error = new Error("Disconnection failed");
      (mockAdapter.disconnect as jest.Mock).mockRejectedValue(error);

      await expect(dataSource.disconnect()).rejects.toThrow("Disconnection failed");
    });
  });

  describe("subscribe", () => {
    beforeEach(async () => {
      await dataSource.connect();
    });

    it("should subscribe to symbols", async () => {
      const symbols = ["BTC/USD"];
      await dataSource.subscribe(symbols);

      expect(mockAdapter.subscribe).toHaveBeenCalledWith(symbols);
      expect(dataSource.subscriptions.has("BTC/USD")).toBe(true);
    });

    it("should track subscriptions", async () => {
      const symbols = ["BTC/USD"];
      await dataSource.subscribe(symbols);

      expect(dataSource.getSubscriptions()).toContain("BTC/USD");
    });

    it("should handle subscription errors", async () => {
      const error = new Error("Subscription failed");
      (mockAdapter.subscribe as jest.Mock).mockRejectedValue(error);

      const errorSpy = jest.fn();
      dataSource.on("error", errorSpy);

      await expect(dataSource.subscribe(["BTC/USD"])).rejects.toThrow("Subscription failed");
      expect(errorSpy).toHaveBeenCalledWith(error);
    });

    it("should validate symbols before subscribing", async () => {
      const symbols = ["BTC/USD", "INVALID"];
      (mockAdapter.validateSymbol as jest.Mock).mockImplementation((symbol: string) => symbol === "BTC/USD");

      await dataSource.subscribe(symbols);

      expect(mockAdapter.subscribe).toHaveBeenCalledWith(["BTC/USD"]);
      expect(dataSource.subscriptions.has("BTC/USD")).toBe(true);
      expect(dataSource.subscriptions.has("INVALID")).toBe(false);
    });
  });

  describe("unsubscribe", () => {
    beforeEach(async () => {
      await dataSource.connect();
      await dataSource.subscribe(["BTC/USD"]);
    });

    it("should unsubscribe from symbols", async () => {
      const symbols = ["BTC/USD"];
      await dataSource.unsubscribe(symbols);

      expect(mockAdapter.unsubscribe).toHaveBeenCalledWith(symbols);
      expect(dataSource.subscriptions.has("BTC/USD")).toBe(false);
    });

    it("should remove from subscriptions", async () => {
      const symbols = ["BTC/USD"];
      await dataSource.unsubscribe(symbols);

      expect(dataSource.getSubscriptions()).not.toContain("BTC/USD");
    });

    it("should handle unsubscription errors", async () => {
      const error = new Error("Unsubscription failed");
      (mockAdapter.unsubscribe as jest.Mock).mockRejectedValue(error);

      await expect(dataSource.unsubscribe(["BTC/USD"])).rejects.toThrow("Unsubscription failed");
    });
  });

  describe("event handling", () => {
    it("should setup price update handler", () => {
      const callback = jest.fn();
      dataSource.onPriceUpdate(callback);

      // Simulate price update
      dataSource.emit("priceUpdate", { symbol: "BTC/USD", price: 50000 });

      expect(callback).toHaveBeenCalledWith({ symbol: "BTC/USD", price: 50000 });
    });

    it("should setup connection change handler", () => {
      const callback = jest.fn();
      dataSource.onConnectionChange(callback);

      // Simulate connection change
      dataSource.emit("connectionChange", true);

      expect(callback).toHaveBeenCalledWith(true);
    });

    it("should setup error handler", () => {
      const callback = jest.fn();
      dataSource.onError(callback);

      // Simulate error
      const error = new Error("Test error");
      dataSource.emit("error", error);

      expect(callback).toHaveBeenCalledWith(error);
    });
  });

  describe("utility methods", () => {
    it("should get subscriptions", async () => {
      await dataSource.connect();
      await dataSource.subscribe(["BTC/USD", "ETH/USD"]);

      const subscriptions = dataSource.getSubscriptions();

      expect(subscriptions).toEqual(["BTC/USD", "ETH/USD"]);
    });

    it("should get adapter", () => {
      const adapter = dataSource.getAdapter();

      expect(adapter).toBe(mockAdapter);
    });

    it("should get latency", () => {
      const latency = dataSource.getLatency();

      expect(typeof latency).toBe("number");
    });

    it("should check connection status", () => {
      expect(dataSource.isConnected()).toBe(false);

      dataSource.connected = true;
      expect(dataSource.isConnected()).toBe(true);
    });
  });

  describe("connection state management", () => {
    it("should track connection state correctly", async () => {
      expect(dataSource.connected).toBe(false);

      await dataSource.connect();
      expect(dataSource.connected).toBe(true);

      await dataSource.disconnect();
      expect(dataSource.connected).toBe(false);
    });

    it("should allow operations when not connected", async () => {
      // The implementation doesn't prevent operations when not connected
      await dataSource.subscribe(["BTC/USD"]);
      expect(mockAdapter.subscribe).toHaveBeenCalledWith(["BTC/USD"]);
    });
  });

  describe("subscription management", () => {
    beforeEach(async () => {
      await dataSource.connect();
    });

    it("should track subscriptions correctly", async () => {
      expect(dataSource.subscriptions.size).toBe(0);

      await dataSource.subscribe(["BTC/USD"]);
      expect(dataSource.subscriptions.size).toBe(1);
      expect(dataSource.subscriptions.has("BTC/USD")).toBe(true);

      await dataSource.subscribe(["ETH/USD"]);
      expect(dataSource.subscriptions.size).toBe(2);

      await dataSource.unsubscribe(["BTC/USD"]);
      expect(dataSource.subscriptions.size).toBe(1);
      expect(dataSource.subscriptions.has("BTC/USD")).toBe(false);
    });

    it("should clear subscriptions on disconnect", async () => {
      await dataSource.subscribe(["BTC/USD", "ETH/USD"]);
      expect(dataSource.subscriptions.size).toBe(2);

      await dataSource.disconnect();
      expect(dataSource.subscriptions.size).toBe(0);
    });
  });
});
