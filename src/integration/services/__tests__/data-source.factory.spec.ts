import { Test, TestingModule } from "@nestjs/testing";
import { DataSourceFactory } from "../data-source.factory";
import { EventEmitter } from "events";
import type { IExchangeAdapter } from "@/common/types/adapters";
import { FeedCategory } from "@/common/types/core";
import { Logger } from "@nestjs/common";
import { TestHelpers } from "@/__tests__/utils";

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

    it("should throw and emit error when no valid symbols", async () => {
      (mockAdapter.validateSymbol as jest.Mock).mockReturnValue(false);

      const errorSpy = jest.fn();
      dataSource.on("error", errorSpy);

      await expect(dataSource.subscribe(["BAD1", "BAD2"])).rejects.toThrow("No valid symbols");
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it("should warn when invalid symbols are present", async () => {
      const warnSpy = jest.spyOn(Logger.prototype, "warn");
      (mockAdapter.validateSymbol as jest.Mock).mockImplementation((symbol: string) => symbol === "BTC/USD");

      await dataSource.subscribe(["BTC/USD", "BAD"]);

      expect(warnSpy).toHaveBeenCalled();
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

  describe("health monitoring", () => {
    it("uses adapter healthCheck when available", async () => {
      const adapterWithHealth = {
        ...mockAdapter,
        healthCheck: jest.fn().mockResolvedValue(true),
      } as unknown as IExchangeAdapter;

      dataSource = factory.createFromAdapter(adapterWithHealth, 1);

      await expect(dataSource.performHealthCheck()).resolves.toBe(true);
      expect((adapterWithHealth as any).healthCheck).toHaveBeenCalledTimes(1);
    });

    it("returns false when not connected and no adapter healthCheck", async () => {
      await expect(dataSource.performHealthCheck()).resolves.toBe(false);
    });

    it("returns true when connected and latency indicates recent activity", async () => {
      (dataSource as any).connected = true;
      (dataSource as any).lastLatency = 1000;
      await expect(dataSource.performHealthCheck()).resolves.toBe(true);
    });

    it("returns false when connected but last activity is stale", async () => {
      (dataSource as any).connected = true;
      (dataSource as any).lastLatency = 60001;
      await expect(dataSource.performHealthCheck()).resolves.toBe(false);
    });
  });

  describe("REST fallback", () => {
    it("returns null if reconnect fails before REST fetch", async () => {
      const adapter = {
        ...mockAdapter,
        connect: jest.fn().mockRejectedValue(new Error("no")),
      } as unknown as IExchangeAdapter;

      dataSource = factory.createFromAdapter(adapter, 1);

      await expect(dataSource.fetchPriceViaREST("BTC/USD")).resolves.toBeNull();
    });

    it("uses adapter fetchTickerREST when available", async () => {
      const ticker = { symbol: "BTC/USD", price: 1, timestamp: Date.now(), source: "x", confidence: 1 };
      const adapter = {
        ...mockAdapter,
        fetchTickerREST: jest.fn().mockResolvedValue(ticker),
      } as unknown as IExchangeAdapter;

      dataSource = factory.createFromAdapter(adapter, 1);
      (dataSource as any).connected = true;

      await expect(dataSource.fetchPriceViaREST("BTC/USD")).resolves.toEqual(ticker);
      expect((adapter as any).fetchTickerREST).toHaveBeenCalledWith("BTC/USD");
    });

    it("returns null when adapter has no REST fallback", async () => {
      const adapter = { ...mockAdapter } as any;
      delete adapter.fetchTickerREST;

      dataSource = factory.createFromAdapter(adapter as IExchangeAdapter, 1);
      (dataSource as any).connected = true;

      await expect(dataSource.fetchPriceViaREST("BTC/USD")).resolves.toBeNull();
    });

    it("returns null when REST fallback throws", async () => {
      const adapter = {
        ...mockAdapter,
        fetchTickerREST: jest.fn().mockRejectedValue(new Error("boom")),
      } as unknown as IExchangeAdapter;

      dataSource = factory.createFromAdapter(adapter, 1);
      (dataSource as any).connected = true;

      await expect(dataSource.fetchPriceViaREST("BTC/USD")).resolves.toBeNull();
    });

    it("fetchTickerREST throws when not available", async () => {
      const adapter = { ...mockAdapter } as any;
      delete adapter.fetchTickerREST;
      dataSource = factory.createFromAdapter(adapter as IExchangeAdapter, 1);

      await expect(dataSource.fetchTickerREST("BTC/USD")).rejects.toThrow("fetchTickerREST not available");
    });
  });

  describe("reconnection", () => {
    it("reconnects and clears subscriptions if resubscribe fails", async () => {
      await TestHelpers.withFakeTimersAsync(async () => {
        (mockAdapter.subscribe as jest.Mock).mockRejectedValueOnce(new Error("subfail"));

        // Keep subscriptions present (disconnect would clear them).
        (dataSource as any).connected = false;
        (dataSource as any).subscriptions.add("BTC/USD");

        const promise = dataSource.attemptReconnection();
        await jest.advanceTimersByTimeAsync(1000);
        await expect(promise).resolves.toBe(true);

        expect((dataSource as any).subscriptions.size).toBe(0);
      });
    });

    it("reconnects and keeps subscriptions when resubscribe succeeds", async () => {
      await TestHelpers.withFakeTimersAsync(async () => {
        (dataSource as any).connected = false;
        (dataSource as any).subscriptions.add("BTC/USD");

        const promise = dataSource.attemptReconnection();
        await jest.advanceTimersByTimeAsync(1000);
        await expect(promise).resolves.toBe(true);

        expect(mockAdapter.subscribe).toHaveBeenCalledWith(["BTC/USD"]);
        expect((dataSource as any).subscriptions.has("BTC/USD")).toBe(true);
      });
    });

    it("disconnects first when already connected", async () => {
      await TestHelpers.withFakeTimersAsync(async () => {
        (dataSource as any).connected = true;
        const disconnectSpy = jest.spyOn(dataSource, "disconnect");

        const promise = dataSource.attemptReconnection();
        await jest.advanceTimersByTimeAsync(1000);
        await expect(promise).resolves.toBe(true);

        expect(disconnectSpy).toHaveBeenCalledTimes(1);
      });
    });

    it("returns false when reconnection fails", async () => {
      await TestHelpers.withFakeTimersAsync(async () => {
        (mockAdapter.connect as jest.Mock).mockRejectedValueOnce(new Error("no"));

        (dataSource as any).connected = false;

        const promise = dataSource.attemptReconnection();
        await jest.advanceTimersByTimeAsync(1000);
        await expect(promise).resolves.toBe(false);
      });
    });
  });

  describe("adapter event handlers", () => {
    it("emits priceUpdate for valid updates and normalizes seconds timestamps", () => {
      const nowMs = 1_700_000_000_000;
      const nowSec = Math.floor(nowMs / 1000);

      const priceCb = (mockAdapter.onPriceUpdate as jest.Mock).mock.calls[0]?.[0];
      expect(typeof priceCb).toBe("function");

      const priceUpdateSpy = jest.fn();
      dataSource.on("priceUpdate", priceUpdateSpy);

      TestHelpers.withMockedNow(nowMs, () => {
        priceCb({
          symbol: "BTC/USD",
          price: 1,
          timestamp: nowSec,
          source: "TestExchange",
          confidence: 1,
        });

        expect(priceUpdateSpy).toHaveBeenCalledTimes(1);
        const emitted = priceUpdateSpy.mock.calls[0][0];
        expect(emitted.timestamp).toBe(nowSec * 1000);
      });
    });

    it("normalizes microseconds timestamps", () => {
      const nowMs = 1_700_000_000_000;
      const nowMicros = nowMs * 1000;

      const priceCb = (mockAdapter.onPriceUpdate as jest.Mock).mock.calls[0]?.[0];
      const priceUpdateSpy = jest.fn();
      dataSource.on("priceUpdate", priceUpdateSpy);

      TestHelpers.withMockedNow(nowMs, () => {
        priceCb({
          symbol: "BTC/USD",
          price: 1,
          timestamp: nowMicros,
          source: "TestExchange",
          confidence: 1,
        });

        expect(priceUpdateSpy).toHaveBeenCalledTimes(1);
        const emitted = priceUpdateSpy.mock.calls[0][0];
        expect(emitted.timestamp).toBe(Math.floor(nowMicros / 1000));
      });
    });

    it("emits classified error for invalid price updates", () => {
      const errorSpy = jest.fn();
      dataSource.on("error", errorSpy);

      const priceCb = (mockAdapter.onPriceUpdate as jest.Mock).mock.calls[0]?.[0];
      priceCb({
        symbol: "",
        price: -1,
        timestamp: Date.now(),
        source: "TestExchange",
        confidence: 1,
      });

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const err = errorSpy.mock.calls[0][0] as any;
      expect(err.errorType).toBe("VALIDATION_ERROR");
      expect(err.severity).toBe("WARNING");
    });

    it("emits classified error when confidence is out of range", () => {
      const errorSpy = jest.fn();
      dataSource.on("error", errorSpy);

      const nowMs = 1_700_000_000_000;

      TestHelpers.withMockedNow(nowMs, () => {
        const priceCb = (mockAdapter.onPriceUpdate as jest.Mock).mock.calls[0]?.[0];
        priceCb({
          symbol: "BTC/USD",
          price: 1,
          timestamp: nowMs - 1000,
          source: "TestExchange",
          confidence: 2,
        });

        expect(errorSpy).toHaveBeenCalledTimes(1);
        const err = errorSpy.mock.calls[0][0] as any;
        expect(err.errorType).toBe("VALIDATION_ERROR");
        expect(err.severity).toBe("WARNING");
      });
    });

    it("emits classified error when source is missing", () => {
      const errorSpy = jest.fn();
      dataSource.on("error", errorSpy);

      const nowMs = 1_700_000_000_000;

      TestHelpers.withMockedNow(nowMs, () => {
        const priceCb = (mockAdapter.onPriceUpdate as jest.Mock).mock.calls[0]?.[0];
        priceCb({
          symbol: "BTC/USD",
          price: 1,
          timestamp: nowMs - 1000,
          source: "",
          confidence: 1,
        });

        expect(errorSpy).toHaveBeenCalledTimes(1);
        const err = errorSpy.mock.calls[0][0] as any;
        expect(err.errorType).toBe("VALIDATION_ERROR");
        expect(err.severity).toBe("WARNING");
      });
    });

    it("emits classified error when timestamp is too old", () => {
      const errorSpy = jest.fn();
      dataSource.on("error", errorSpy);

      const nowMs = 1_700_000_000_000;

      TestHelpers.withMockedNow(nowMs, () => {
        const priceCb = (mockAdapter.onPriceUpdate as jest.Mock).mock.calls[0]?.[0];
        priceCb({
          symbol: "BTC/USD",
          price: 1,
          timestamp: nowMs - 1_800_001,
          source: "TestExchange",
          confidence: 1,
        });

        expect(errorSpy).toHaveBeenCalledTimes(1);
        const err = errorSpy.mock.calls[0][0] as any;
        expect(err.errorType).toBe("VALIDATION_ERROR");
        expect(err.severity).toBe("WARNING");
      });
    });

    it("emits classified error when timestamp is too far in the future", () => {
      const errorSpy = jest.fn();
      dataSource.on("error", errorSpy);

      const nowMs = 1_700_000_000_000;

      TestHelpers.withMockedNow(nowMs, () => {
        const priceCb = (mockAdapter.onPriceUpdate as jest.Mock).mock.calls[0]?.[0];
        priceCb({
          symbol: "BTC/USD",
          price: 1,
          timestamp: nowMs + 120_001,
          source: "TestExchange",
          confidence: 1,
        });

        expect(errorSpy).toHaveBeenCalledTimes(1);
        const err = errorSpy.mock.calls[0][0] as any;
        expect(err.errorType).toBe("VALIDATION_ERROR");
        expect(err.severity).toBe("WARNING");
      });
    });

    it("emits raw error when price handler throws before validation", () => {
      const errorSpy = jest.fn();
      dataSource.on("error", errorSpy);

      const priceCb = (mockAdapter.onPriceUpdate as jest.Mock).mock.calls[0]?.[0];
      priceCb(undefined as any);

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0][0]).toBeInstanceOf(Error);
    });

    it("emits connectionChange only when state changes and resets latency", () => {
      const connCb = (mockAdapter.onConnectionChange as jest.Mock).mock.calls[0]?.[0];
      expect(typeof connCb).toBe("function");

      (dataSource as any).connected = true;
      (dataSource as any).lastLatency = 123;

      const connSpy = jest.fn();
      dataSource.on("connectionChange", connSpy);

      connCb(true);
      expect(connSpy).not.toHaveBeenCalled();

      connCb(false);
      expect(connSpy).toHaveBeenCalledWith(false);
      expect((dataSource as any).lastLatency).toBe(0);
    });

    it("classifies adapter errors and marks disconnected on connection errors", () => {
      const errorCb = (mockAdapter.onError as jest.Mock).mock.calls[0]?.[0];
      expect(typeof errorCb).toBe("function");

      const emittedErrorSpy = jest.fn();
      const connSpy = jest.fn();
      dataSource.on("error", emittedErrorSpy);
      dataSource.on("connectionChange", connSpy);

      (dataSource as any).connected = true;

      errorCb(new Error("WebSocket connection closed"));

      expect(emittedErrorSpy).toHaveBeenCalledTimes(1);
      const classified = emittedErrorSpy.mock.calls[0][0] as any;
      expect(classified.exchangeName).toBe("TestExchange");
      expect(classified.errorType).toBe("CONNECTION_ERROR");
      expect((dataSource as any).connected).toBe(false);
      expect(connSpy).toHaveBeenCalledWith(false);
    });
  });

  describe("validation and classification helpers", () => {
    it("validatePriceUpdate returns false for non-object updates", () => {
      const result = (dataSource as any).validatePriceUpdate(undefined);
      expect(result).toBe(false);
    });

    it("validatePriceUpdate returns false for non-string symbols", () => {
      const nowMs = 1_700_000_000_000;

      TestHelpers.withMockedNow(nowMs, () => {
        const result = (dataSource as any).validatePriceUpdate({
          symbol: 123,
          price: 1,
          timestamp: nowMs - 1000,
          source: "TestExchange",
          confidence: 1,
        });
        expect(result).toBe(false);
      });
    });

    it("validatePriceUpdate catches exceptions and returns false", () => {
      const errorSpy = jest.spyOn(Logger.prototype, "error");
      const nowMs = 1_700_000_000_000;

      TestHelpers.withMockedNow(nowMs, () => {
        const update: any = {
          price: 1,
          timestamp: nowMs - 1000,
          source: "TestExchange",
          confidence: 1,
        };
        Object.defineProperty(update, "symbol", {
          enumerable: true,
          get() {
            throw new Error("boom");
          },
        });

        const result = (dataSource as any).validatePriceUpdate(update);
        expect(result).toBe(false);
        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringContaining("Error validating price update:"),
          expect.anything()
        );
      });
    });

    it("classifyAdapterError selects timeout/rate-limit/parsing/default types", () => {
      const classify = (dataSource as any).classifyAdapterError.bind(dataSource);

      expect((classify(new Error("Request timed out")) as any).errorType).toBe("TIMEOUT_ERROR");
      expect((classify(new Error("Too many requests")) as any).errorType).toBe("RATE_LIMIT_ERROR");
      expect((classify(new Error("Invalid JSON")) as any).errorType).toBe("PARSING_ERROR");
      expect((classify(new Error("Something else")) as any).errorType).toBe("EXCHANGE_ERROR");
    });

    it("isConnectionError returns false for unrelated messages", () => {
      const result = (dataSource as any).isConnectionError(new Error("not related"));
      expect(result).toBe(false);
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
