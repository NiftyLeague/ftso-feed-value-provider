import { ExchangeId } from "@/common/types/adapters";
import type { CoreFeedId, DataSource, PriceUpdate } from "@/common/types/core";
import { FeedCategory } from "@/common/types/core";
import { getFeedConfiguration, hasCustomAdapter } from "@/common/utils";
import { TestHelpers } from "@/__tests__/utils";

import { ProductionDataManagerService } from "../production-data-manager.service";

jest.mock("@/common/utils", () => {
  const actual = jest.requireActual<typeof import("@/common/utils")>("@/common/utils");
  return {
    ...actual,
    getFeedConfiguration: jest.fn(),
    hasCustomAdapter: jest.fn(),
  };
});

type FeedConfig = {
  feed: { category: number; name: string };
  sources: Array<{ exchange: string; symbol?: string }>;
};

function createMockDataSource(params: {
  id: string;
  type?: "websocket" | "rest";
  connected?: boolean;
  latencyMs?: number;
  fetchTickerREST?: ((symbol: string) => Promise<PriceUpdate | null>) | undefined;
  fetchPriceViaREST?: ((symbol: string) => Promise<PriceUpdate | null>) | undefined;
  performHealthCheck?: (() => Promise<boolean>) | undefined;
  getAdapter?:
    | (() => { getPriceFromExchange?: (exchange: string, feedId: CoreFeedId) => Promise<PriceUpdate | null> })
    | undefined;
  onError?: boolean;
}): DataSource & {
  triggerPriceUpdate(update: PriceUpdate): void;
  triggerConnectionChange(connected: boolean): void;
  triggerError(err: Error): void;
  getAdapter?: () => { getPriceFromExchange?: (exchange: string, feedId: CoreFeedId) => Promise<PriceUpdate | null> };
  fetchTickerREST?: (symbol: string) => Promise<PriceUpdate | null>;
  performHealthCheck?: () => Promise<boolean>;
} {
  let connected = params.connected ?? false;
  let priceCb: ((update: PriceUpdate) => void) | undefined;
  let connectionCb: ((connected: boolean) => void) | undefined;
  let errorCb: ((error: Error) => void) | undefined;

  const ds: DataSource & {
    triggerPriceUpdate(update: PriceUpdate): void;
    triggerConnectionChange(connected: boolean): void;
    triggerError(err: Error): void;
    getAdapter?: () => { getPriceFromExchange?: (exchange: string, feedId: CoreFeedId) => Promise<PriceUpdate | null> };
    fetchTickerREST?: (symbol: string) => Promise<PriceUpdate | null>;
    performHealthCheck?: () => Promise<boolean>;
  } = {
    id: params.id,
    type: params.type ?? "websocket",
    priority: 1,
    category: FeedCategory.Crypto,
    isConnected: () => connected,
    getLatency: () => params.latencyMs ?? 10,
    connect: async () => {
      connected = true;
      connectionCb?.(true);
    },
    disconnect: async () => {
      connected = false;
      connectionCb?.(false);
    },
    subscribe: async () => {
      // not used by ProductionDataManagerService (owned by orchestrator)
    },
    unsubscribe: async () => {
      // not used by ProductionDataManagerService (owned by orchestrator)
    },
    onPriceUpdate: cb => {
      priceCb = cb;
    },
    onConnectionChange: cb => {
      connectionCb = cb;
    },
    triggerPriceUpdate: update => {
      priceCb?.(update);
    },
    triggerConnectionChange: next => {
      connected = next;
      connectionCb?.(next);
    },
    triggerError: err => {
      errorCb?.(err);
    },
  };

  if (params.onError) {
    ds.onError = cb => {
      errorCb = cb;
    };
  }

  // These are not part of DataSource but are used by type guards in the service.
  if ("fetchTickerREST" in params) {
    (ds as any).fetchTickerREST = params.fetchTickerREST;
  }
  if (params.fetchPriceViaREST) {
    ds.fetchPriceViaREST = params.fetchPriceViaREST;
  }
  if ("performHealthCheck" in params) {
    (ds as any).performHealthCheck = params.performHealthCheck;
  }
  if (params.getAdapter) {
    (ds as any).getAdapter = params.getAdapter;
  }

  return ds;
}

describe("ProductionDataManagerService", () => {
  let dataManager: ProductionDataManagerService;
  const mockLogger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  const mockEnhancedLogger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    logPriceUpdate: jest.fn(),
  };

  const mockFeedId: CoreFeedId = {
    category: FeedCategory.Crypto,
    name: "BTC/USD",
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    (getFeedConfiguration as unknown as jest.Mock).mockReturnValue({
      feed: { category: FeedCategory.Crypto, name: "BTC/USD" },
      sources: [
        { exchange: ExchangeId.Binance, symbol: "BTC/USD" },
        { exchange: ExchangeId.Coinbase, symbol: "BTC/USD" },
      ],
    } satisfies FeedConfig);

    (hasCustomAdapter as unknown as jest.Mock).mockImplementation((exchange: string) => {
      // Treat common custom adapters as custom; everything else as CCXT.
      return [ExchangeId.Binance, ExchangeId.Coinbase].includes(exchange as any);
    });

    dataManager = new ProductionDataManagerService();
    (dataManager as any).logger = mockLogger;
    (dataManager as any).enhancedLogger = mockEnhancedLogger;
    (dataManager as any).recordMetric = jest.fn();
    (dataManager as any).setHealthStatus = jest.fn();
  });

  afterEach(async () => {
    await dataManager.cleanup();
  });

  describe("Basic Functionality", () => {
    it("should be defined", () => {
      expect(dataManager).toBeDefined();
    });

    it("should initialize with empty data sources", () => {
      const connectedSources = dataManager.getConnectedSources();
      expect(connectedSources).toEqual([]);
    });
  });

  describe("Data Source Management", () => {
    it("adds and removes a data source", async () => {
      const source = createMockDataSource({ id: ExchangeId.Binance, connected: false });
      await dataManager.addDataSource(source);

      expect(dataManager.getConnectedSources()).toHaveLength(1);

      await dataManager.removeDataSource(source.id);
      expect(dataManager.getConnectedSources()).toHaveLength(0);
    });

    it("skips adding duplicate data source ids", async () => {
      const source = createMockDataSource({ id: ExchangeId.Binance });
      await dataManager.addDataSource(source);
      await dataManager.addDataSource(source);
      expect(dataManager.getConnectedSources()).toHaveLength(1);
    });
  });

  describe("Feed Subscription", () => {
    it("tracks subscriptions per configured exchange and updates timestamps", async () => {
      const binance = createMockDataSource({ id: ExchangeId.Binance, connected: false });
      const coinbase = createMockDataSource({ id: ExchangeId.Coinbase, connected: false });

      await dataManager.addDataSource(binance);
      await dataManager.addDataSource(coinbase);

      await dataManager.subscribeToFeed(mockFeedId);
      await dataManager.subscribeToFeed(mockFeedId); // hits existing subscription branch

      const freshnessBefore = await dataManager.getDataFreshness(mockFeedId);
      expect(freshnessBefore).not.toBe(Infinity);

      const now = Date.now();
      dataManager.processUpdateImmediately({
        symbol: "BTC/USD",
        price: 50000,
        timestamp: now,
        source: ExchangeId.Binance,
        confidence: 0.9,
      });

      const freshnessAfter = await dataManager.getDataFreshness(mockFeedId);
      expect(freshnessAfter).toBeGreaterThanOrEqual(0);
      expect(freshnessAfter).toBeLessThan(1000);
    });

    it("throws when feed configuration is missing", async () => {
      // subscribeToFeed calls getFeedConfiguration twice (validation + main lookup)
      (getFeedConfiguration as unknown as jest.Mock).mockReturnValue(undefined);
      await expect(dataManager.subscribeToFeed(mockFeedId)).rejects.toThrow(
        `No configuration found for feed: ${mockFeedId.name}`
      );
    });

    it("untracks subscriptions on unsubscribe (no websocket unsubscribe)", async () => {
      const binance = createMockDataSource({ id: ExchangeId.Binance, connected: false });
      await dataManager.addDataSource(binance);

      await dataManager.subscribeToFeed(mockFeedId);
      await dataManager.unsubscribeFromFeed(mockFeedId);

      expect(await dataManager.getDataFreshness(mockFeedId)).toBe(Infinity);
    });
  });

  describe("Health Monitoring", () => {
    it("returns connection health status", async () => {
      const health = await dataManager.getConnectionHealth();
      expect(health).toBeDefined();
      expect(typeof health.connectedSources).toBe("number");
      expect(typeof health.totalSources).toBe("number");
      expect(typeof health.healthScore).toBe("number");
    });

    it("returns data freshness for a feed", async () => {
      const freshness = await dataManager.getDataFreshness(mockFeedId);
      expect(typeof freshness).toBe("number");
      expect(freshness).toBeGreaterThanOrEqual(0);
    });

    it("performHealthCheck early-returns when service is not initialized", async () => {
      (dataManager as any).isServiceInitialized = jest.fn(() => false);

      await (dataManager as any).performHealthCheck();

      expect((dataManager as any).setHealthStatus).not.toHaveBeenCalled();
    });

    it("performHealthCheck marks a source unhealthy and emits events", async () => {
      (dataManager as any).isServiceInitialized = jest.fn(() => true);
      const emitSpy = jest.spyOn(dataManager, "emit");

      // Avoid `addDataSource` waiting on readiness polling/retry loops.
      jest.spyOn(dataManager as any, "connectWithRetry").mockResolvedValue(undefined);

      const src = createMockDataSource({
        id: ExchangeId.Binance,
        connected: false,
        latencyMs: 20001,
        performHealthCheck: async () => false,
      });
      await dataManager.addDataSource(src);
      dataManager.markDataSourceInitialized(src.id);

      // Force a health state change
      const metrics = (dataManager as any).connectionMetrics.get(src.id);
      metrics.isHealthy = true;
      metrics.lastUpdate = Date.now();

      await (dataManager as any).performHealthCheck();

      expect(metrics.isHealthy).toBe(false);
      expect(emitSpy).toHaveBeenCalledWith("sourceUnhealthy", src.id);
      expect((dataManager as any).setHealthStatus).toHaveBeenCalledWith("unhealthy");
    });

    it("performHealthCheck does not flip an unhealthy source to healthy", async () => {
      (dataManager as any).isServiceInitialized = jest.fn(() => true);
      const emitSpy = jest.spyOn(dataManager, "emit");

      // Avoid `addDataSource` waiting on readiness polling/retry loops.
      jest.spyOn(dataManager as any, "connectWithRetry").mockResolvedValue(undefined);

      const src = createMockDataSource({
        id: ExchangeId.Binance,
        connected: true,
        latencyMs: 1,
        performHealthCheck: async () => true,
      });
      await dataManager.addDataSource(src);
      dataManager.markDataSourceInitialized(src.id);

      const metrics = (dataManager as any).connectionMetrics.get(src.id);
      metrics.isHealthy = false;
      metrics.lastUpdate = Date.now();

      await (dataManager as any).performHealthCheck();

      expect(metrics.isHealthy).toBe(false);
      expect(emitSpy).not.toHaveBeenCalledWith("sourceHealthy", src.id);
    });

    it("performHealthCheck sets overall health based on healthy connection ratio", async () => {
      (dataManager as any).isServiceInitialized = jest.fn(() => true);

      const mk = async (id: string, isHealthy: boolean) => {
        const ds = createMockDataSource({ id, connected: true, latencyMs: 1 });
        await dataManager.addDataSource(ds);
        dataManager.markDataSourceInitialized(id);
        const metrics = (dataManager as any).connectionMetrics.get(id);
        metrics.isHealthy = isHealthy;
        metrics.lastUpdate = Date.now();
        return ds;
      };

      await mk("s1", true);
      await mk("s2", true);
      await mk("s3", true);
      await mk("s4", true);
      await mk("s5", false);

      await (dataManager as any).performHealthCheck();
      expect((dataManager as any).setHealthStatus).toHaveBeenLastCalledWith("healthy");

      // 3/5 = 0.6 => degraded
      (dataManager as any).connectionMetrics.get("s4").isHealthy = false;
      await (dataManager as any).performHealthCheck();
      expect((dataManager as any).setHealthStatus).toHaveBeenLastCalledWith("degraded");

      // 2/5 = 0.4 => unhealthy
      (dataManager as any).connectionMetrics.get("s3").isHealthy = false;
      await (dataManager as any).performHealthCheck();
      expect((dataManager as any).setHealthStatus).toHaveBeenLastCalledWith("unhealthy");
    });
  });

  describe("Current Price Retrieval", () => {
    it("getCurrentPrice throws when no cached data and REST fetch returns no updates", async () => {
      jest.spyOn(dataManager, "getDataFreshness").mockResolvedValueOnce(Infinity);
      jest.spyOn(dataManager, "getPriceUpdatesForFeed").mockResolvedValueOnce([] as any);

      await expect(dataManager.getCurrentPrice(mockFeedId)).rejects.toThrow(/No price data available/i);
    });

    it("getCurrentPrice aggregates valid updates and uses confidence fallback + consensusScore branches", async () => {
      const emitSpy = jest.spyOn(dataManager, "emit");
      jest.spyOn(dataManager, "getDataFreshness").mockResolvedValueOnce(1);
      jest.spyOn(dataManager, "getPriceUpdatesForFeed").mockResolvedValueOnce([
        {
          symbol: mockFeedId.name,
          price: 100,
          timestamp: Date.now(),
          source: ExchangeId.Binance,
          // no confidence => fallback
        } as any,
        {
          symbol: mockFeedId.name,
          price: 200,
          timestamp: Date.now(),
          source: ExchangeId.Coinbase,
          confidence: 0.5,
        } as any,
      ]);

      const out = await dataManager.getCurrentPrice(mockFeedId);
      expect(out.symbol).toBe(mockFeedId.name);
      expect(out.price).toBeGreaterThan(0);
      expect(out.sources).toEqual(expect.arrayContaining([ExchangeId.Binance, ExchangeId.Coinbase]));
      expect(out.consensusScore).toBe(0.8);
      expect(emitSpy).toHaveBeenCalledWith("priceRequest", mockFeedId);
    });

    it("getCurrentPrice throws when fetched updates are empty (non-Infinity freshness)", async () => {
      jest.spyOn(dataManager, "getDataFreshness").mockResolvedValueOnce(1);
      jest.spyOn(dataManager, "getPriceUpdatesForFeed").mockResolvedValueOnce([] as any);

      await expect(dataManager.getCurrentPrice(mockFeedId)).rejects.toThrow(/No price updates available/i);
    });

    it("getCurrentPrice throws when no valid price updates exist", async () => {
      jest.spyOn(dataManager, "getDataFreshness").mockResolvedValueOnce(1);
      jest.spyOn(dataManager, "getPriceUpdatesForFeed").mockResolvedValueOnce([
        {
          symbol: mockFeedId.name,
          price: 0,
          timestamp: Date.now(),
          source: ExchangeId.Binance,
          confidence: 1,
        } as any,
      ]);

      await expect(dataManager.getCurrentPrice(mockFeedId)).rejects.toThrow(/No valid price updates/i);
    });

    it("getCurrentPrices filters rejected results", async () => {
      jest.spyOn(dataManager, "getCurrentPrice").mockImplementation(async (fid: any) => {
        if (fid.name === "BTC/USD")
          return { symbol: fid.name, price: 1, timestamp: Date.now(), sources: [], confidence: 1 } as any;
        throw new Error("boom");
      });

      const out = await dataManager.getCurrentPrices([
        { category: FeedCategory.Crypto, name: "BTC/USD" },
        { category: FeedCategory.Crypto, name: "ETH/USD" },
      ]);

      expect(out).toHaveLength(1);
      expect(out[0].symbol).toBe("BTC/USD");
    });
  });

  describe("Real-time Data Management", () => {
    it("prioritizes real-time data based on policy", () => {
      const prioritize = dataManager.prioritizeRealTimeData();
      expect(typeof prioritize).toBe("boolean");
    });

    it("processUpdateImmediately emits and logs", () => {
      const mockUpdate: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        source: "mock-exchange",
        confidence: 0.9,
      };

      const emitSpy = jest.spyOn(dataManager, "emit");
      expect(() => dataManager.processUpdateImmediately(mockUpdate)).not.toThrow();
      expect(emitSpy).toHaveBeenCalledWith("priceUpdate", mockUpdate);
    });

    it("maintains voting round history (noop)", () => {
      expect(() => dataManager.maintainVotingRoundHistory(10)).not.toThrow();
    });
  });

  describe("Price Retrieval", () => {
    it("getCurrentPrice throws when no data exists and exchanges return nothing", async () => {
      jest.spyOn(dataManager, "getDataFreshness").mockResolvedValueOnce(Infinity);
      jest.spyOn(dataManager, "getPriceUpdatesForFeed").mockResolvedValueOnce([]);
      await expect(dataManager.getCurrentPrice(mockFeedId)).rejects.toThrow(
        `No price data available for feed ${mockFeedId.name}`
      );
    });

    it("getCurrentPrice throws when cache exists but no price updates are available", async () => {
      jest.spyOn(dataManager, "getDataFreshness").mockResolvedValueOnce(0);
      jest.spyOn(dataManager, "getPriceUpdatesForFeed").mockResolvedValueOnce([]);
      await expect(dataManager.getCurrentPrice(mockFeedId)).rejects.toThrow(
        `No price updates available for feed ${mockFeedId.name}`
      );
    });

    it("getCurrentPrice throws when all returned updates are invalid (price <= 0)", async () => {
      jest.spyOn(dataManager, "getDataFreshness").mockResolvedValueOnce(0);
      jest.spyOn(dataManager, "getPriceUpdatesForFeed").mockResolvedValueOnce([
        {
          symbol: "BTC/USD",
          price: 0,
          timestamp: Date.now(),
          source: ExchangeId.Binance,
          confidence: 0.9,
        },
      ]);

      await expect(dataManager.getCurrentPrice(mockFeedId)).rejects.toThrow(
        `No valid price updates for feed ${mockFeedId.name}`
      );
    });

    it("getCurrentPrice aggregates when no cache exists but exchanges return data", async () => {
      jest.spyOn(dataManager, "getDataFreshness").mockResolvedValueOnce(Infinity);
      jest.spyOn(dataManager, "getPriceUpdatesForFeed").mockResolvedValueOnce([
        {
          symbol: "BTC/USD",
          price: 100,
          timestamp: Date.now() - 10,
          source: ExchangeId.Binance,
          confidence: 0.6,
        },
        {
          symbol: "BTC/USD",
          price: 200,
          timestamp: Date.now(),
          source: ExchangeId.Coinbase,
          confidence: 0.9,
        },
      ]);

      const result = await dataManager.getCurrentPrice(mockFeedId);
      expect(result.symbol).toBe("BTC/USD");
      expect(result.sources).toEqual(expect.arrayContaining([ExchangeId.Binance, ExchangeId.Coinbase]));
      expect(result.price).toBeGreaterThan(0);
    });

    it("getCurrentPrices returns only fulfilled results", async () => {
      jest
        .spyOn(dataManager, "getCurrentPrice")
        .mockResolvedValueOnce({
          symbol: "BTC/USD",
          price: 123,
          timestamp: Date.now(),
          sources: [ExchangeId.Binance],
          confidence: 0.9,
          consensusScore: 0.5,
        } as any)
        .mockRejectedValueOnce(new Error("boom"));

      const result = await dataManager.getCurrentPrices([mockFeedId, mockFeedId]);
      expect(result).toHaveLength(1);
      expect(result[0]?.price).toBe(123);
    });
  });

  describe("Exchange selection and REST/CCXT paths", () => {
    it("getPriceUpdatesForFeed returns empty and warns when feed configuration is missing", async () => {
      (getFeedConfiguration as unknown as jest.Mock).mockReturnValueOnce(undefined);
      const updates = await dataManager.getPriceUpdatesForFeed(mockFeedId);
      expect(updates).toEqual([]);
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("No configuration found for feed"));
    });

    it("getPriceUpdatesForFeed uses CCXT adapter for non-custom exchanges and REST for custom exchanges", async () => {
      (getFeedConfiguration as unknown as jest.Mock).mockReturnValueOnce({
        feed: { category: FeedCategory.Crypto, name: "BTC/USD" },
        sources: [
          { exchange: "bitfinex", symbol: "BTC/USD" }, // treated as CCXT
          { exchange: ExchangeId.Binance, symbol: "BTC/USD" }, // treated as custom
          { exchange: ExchangeId.Coinbase, symbol: "BTC/USD" }, // treated as custom but not registered => missing
        ],
      } satisfies FeedConfig);

      (hasCustomAdapter as unknown as jest.Mock).mockImplementation((exchange: string) => {
        return exchange === ExchangeId.Binance || exchange === ExchangeId.Coinbase;
      });

      const ccxtSource = createMockDataSource({
        id: ExchangeId.CcxtMultiExchange,
        connected: true,
        getAdapter: () => ({
          getPriceFromExchange: async (exchange: string) => {
            if (exchange !== "bitfinex") return null;
            return {
              symbol: "BTC/USD",
              price: 111,
              timestamp: Date.now(),
              source: exchange,
              confidence: 0.8,
            };
          },
        }),
      });

      const binance = createMockDataSource({
        id: ExchangeId.Binance,
        connected: true,
        // Present and callable so hasRestFallbackCapability() is true
        fetchTickerREST: async (symbol: string) => ({
          symbol,
          price: 222,
          timestamp: Date.now(),
          source: ExchangeId.Binance,
          confidence: 0.9,
        }),
      });

      await dataManager.addDataSource(ccxtSource);
      await dataManager.addDataSource(binance);

      const updates = await dataManager.getPriceUpdatesForFeed(mockFeedId);
      expect(updates.map(u => u.price)).toEqual(expect.arrayContaining([111, 222]));
      expect(mockLogger.debug.mock.calls.some(([msg]) => String(msg).includes("Missing data source mapping"))).toBe(
        true
      );
    });

    it("falls back to fetchPriceViaREST when fetchTickerREST property exists but is not callable", async () => {
      (getFeedConfiguration as unknown as jest.Mock).mockReturnValueOnce({
        feed: { category: FeedCategory.Crypto, name: "BTC/USD" },
        sources: [{ exchange: ExchangeId.Binance, symbol: "BTC/USD" }],
      } satisfies FeedConfig);

      (hasCustomAdapter as unknown as jest.Mock).mockReturnValue(true);

      const binance = createMockDataSource({
        id: ExchangeId.Binance,
        connected: true,
        fetchTickerREST: undefined,
        fetchPriceViaREST: async (symbol: string) => ({
          symbol,
          price: 333,
          timestamp: Date.now(),
          source: ExchangeId.Binance,
          confidence: 0.9,
        }),
      });

      await dataManager.addDataSource(binance);
      const updates = await dataManager.getPriceUpdatesForFeed(mockFeedId);
      expect(updates).toHaveLength(1);
      expect(updates[0]?.price).toBe(333);
    });

    it("warns when REST fallback is expected but no REST method exists", async () => {
      (getFeedConfiguration as unknown as jest.Mock).mockReturnValueOnce({
        feed: { category: FeedCategory.Crypto, name: "BTC/USD" },
        sources: [{ exchange: ExchangeId.Binance, symbol: "BTC/USD" }],
      } satisfies FeedConfig);

      (hasCustomAdapter as unknown as jest.Mock).mockReturnValue(true);

      const binance = createMockDataSource({
        id: ExchangeId.Binance,
        connected: true,
        fetchTickerREST: undefined,
      });

      await dataManager.addDataSource(binance);
      await dataManager.getPriceUpdatesForFeed(mockFeedId);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("does not have fetchTickerREST or fetchPriceViaREST methods")
      );
    });

    it("matches custom adapters by id pattern when exchange name doesn't exactly match", async () => {
      (getFeedConfiguration as unknown as jest.Mock).mockReturnValueOnce({
        feed: { category: FeedCategory.Crypto, name: "BTC/USD" },
        sources: [{ exchange: "Binance", symbol: "BTC/USD" }],
      } satisfies FeedConfig);

      (hasCustomAdapter as unknown as jest.Mock).mockReturnValue(true);

      const fetchTickerREST = jest.fn(async (symbol: string) => ({
        symbol,
        price: 777,
        timestamp: Date.now(),
        source: "Binance",
        confidence: 0.9,
      }));

      const binanceLike = createMockDataSource({
        id: "my-binance-adapter",
        connected: true,
        fetchTickerREST,
      });

      await dataManager.addDataSource(binanceLike);
      const updates = await dataManager.getPriceUpdatesForFeed(mockFeedId);

      expect(fetchTickerREST).toHaveBeenCalledWith("BTC/USD");
      expect(updates.map(u => u.price)).toEqual([777]);
    });

    it("does not throw if CCXT adapter exists but does not expose getPriceFromExchange", async () => {
      (getFeedConfiguration as unknown as jest.Mock).mockReturnValueOnce({
        feed: { category: FeedCategory.Crypto, name: "BTC/USD" },
        sources: [{ exchange: "bitfinex", symbol: "BTC/USD" }],
      } satisfies FeedConfig);

      (hasCustomAdapter as unknown as jest.Mock).mockReturnValue(false);

      const ccxtSource = createMockDataSource({
        id: ExchangeId.CcxtMultiExchange,
        connected: true,
        getAdapter: () => ({}),
      });

      await dataManager.addDataSource(ccxtSource);
      const updates = await dataManager.getPriceUpdatesForFeed(mockFeedId);
      expect(updates).toEqual([]);
    });
  });

  describe("Connection retry and connection-change branches", () => {
    it("connectWithRetry emits sourceError and logs different messages for startup vs previously-connected sources", async () => {
      const sourceId = "test-unstable-source";
      const source = createMockDataSource({ id: sourceId, connected: false, type: "websocket" });
      source.connect = async () => {
        throw new Error("connect failed");
      };

      // Seed metrics required by connectWithRetry
      (dataManager as any).connectionMetrics.set(sourceId, {
        sourceId,
        isHealthy: false,
        lastUpdate: Date.now(),
        errorCount: 0,
        successCount: 0,
        reconnectAttempts: 0,
        averageLatency: 0,
        latency: 0,
        uptime: 0,
      });

      const emitSpy = jest.spyOn(dataManager, "emit");

      // Make connectWithRetry deterministic: call fn once and forward to onError.
      jest
        .spyOn(dataManager as any, "executeWithErrorHandling")
        .mockImplementation(async (fn: any, _k: any, o: any) => {
          try {
            await fn();
          } catch (e) {
            o?.onError?.(e, 1);
          }
        });

      // Startup branch (never connected)
      await (dataManager as any).connectWithRetry(source);
      expect(emitSpy).toHaveBeenCalledWith("sourceError", sourceId, expect.any(Error));
      expect(mockLogger.debug.mock.calls.some(([msg]) => String(msg).includes("during startup"))).toBe(true);

      // Previously-connected branch
      (dataManager as any).sourceEverConnected.add(sourceId);
      (dataManager as any).connectionChurnLastLogged.clear();

      await (dataManager as any).connectWithRetry(source);
      expect(mockLogger.debug.mock.calls.some(([msg]) => String(msg).includes("Connection failed for"))).toBe(true);
    });

    it("handleConnectionChange schedules reconnect for websocket sources but not rest sources", () => {
      const wsSource = createMockDataSource({ id: "ws-source", connected: true, type: "websocket" });
      const restSource = createMockDataSource({ id: "rest-source", connected: true, type: "rest" });

      (dataManager as any).dataSources.set(wsSource.id, wsSource);
      (dataManager as any).dataSources.set(restSource.id, restSource);
      (dataManager as any).connectionMetrics.set(wsSource.id, {
        sourceId: wsSource.id,
        isHealthy: true,
        lastUpdate: Date.now(),
        errorCount: 0,
        successCount: 0,
        reconnectAttempts: 0,
        averageLatency: 0,
        latency: 0,
        uptime: 0,
      });
      (dataManager as any).connectionMetrics.set(restSource.id, {
        sourceId: restSource.id,
        isHealthy: true,
        lastUpdate: Date.now(),
        errorCount: 0,
        successCount: 0,
        reconnectAttempts: 0,
        averageLatency: 0,
        latency: 0,
        uptime: 0,
      });

      const connectSpy = jest
        .spyOn(dataManager as any, "connectWithRetry")
        .mockImplementation(async () => Promise.resolve());

      (dataManager as any).handleConnectionChange(wsSource.id, false);
      (dataManager as any).handleConnectionChange(restSource.id, false);

      expect(connectSpy).toHaveBeenCalledWith(wsSource);
      expect(connectSpy).not.toHaveBeenCalledWith(restSource);
    });
  });

  describe("Event handlers, quality filtering, and error classification", () => {
    it("filters low-confidence updates, rate-limits quality logs, and processes valid updates", async () => {
      const source = createMockDataSource({ id: ExchangeId.Binance, onError: true });
      await dataManager.addDataSource(source);

      const processSpy = jest.spyOn(dataManager, "processUpdateImmediately");

      // Below MIN threshold => rejected
      source.triggerPriceUpdate({
        symbol: "BTC/USD",
        price: 1,
        timestamp: Date.now(),
        source: ExchangeId.Binance,
        confidence: 0.4,
      });
      expect(processSpy).not.toHaveBeenCalled();

      // Between MIN and WARN => accepted, and validate_price_quality log is rate-limited
      source.triggerPriceUpdate({
        symbol: "BTC/USD",
        price: 2,
        timestamp: Date.now(),
        source: ExchangeId.Binance,
        confidence: 0.6,
      });
      source.triggerPriceUpdate({
        symbol: "BTC/USD",
        price: 3,
        timestamp: Date.now(),
        source: ExchangeId.Binance,
        confidence: 0.6,
      });

      const validateQualityLogs = (mockEnhancedLogger.debug as jest.Mock).mock.calls.filter(([, meta]) => {
        return (meta as any)?.operation === "validate_price_quality";
      });
      expect(validateQualityLogs).toHaveLength(1);
      expect(processSpy).toHaveBeenCalled();
    });

    it("emits sourceError when update handling throws", async () => {
      const source = createMockDataSource({ id: ExchangeId.Binance, onError: true });
      await dataManager.addDataSource(source);

      jest.spyOn(dataManager, "processUpdateImmediately").mockImplementationOnce(() => {
        throw new Error("boom");
      });

      const emitSpy = jest.spyOn(dataManager, "emit");

      source.triggerPriceUpdate({
        symbol: "BTC/USD",
        price: 10,
        timestamp: Date.now(),
        source: ExchangeId.Binance,
        confidence: 0.9,
      });

      expect(emitSpy).toHaveBeenCalledWith("sourceError", ExchangeId.Binance, expect.any(Error));
    });

    it("classifies errors from data sources and updates metrics", async () => {
      const source = createMockDataSource({ id: ExchangeId.Binance, onError: true });
      await dataManager.addDataSource(source);

      source.triggerError(new Error("HTTP 451 geo blocked"));

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Error from data source"),
        expect.objectContaining({ errorType: "GEO_BLOCKING" })
      );

      const health = await dataManager.getConnectionHealth();
      expect(health.failedSources).toEqual(expect.arrayContaining([ExchangeId.Binance]));
    });
  });

  describe("Private helper branches (targeted)", () => {
    it("updates subscription timestamps when processing updates for tracked symbols", async () => {
      const source = createMockDataSource({
        id: ExchangeId.Binance,
        connected: true,
        fetchTickerREST: async () => null,
      });
      await dataManager.addDataSource(source);

      await dataManager.subscribeToFeed(mockFeedId);

      const subsBefore = (dataManager as any).subscriptions.get(ExchangeId.Binance);
      const lastUpdateBefore = subsBefore?.[0]?.lastUpdate;

      const ts = Date.now();
      dataManager.processUpdateImmediately({
        symbol: "BTC/USD",
        price: 123,
        timestamp: ts,
        source: ExchangeId.Binance,
        confidence: 0.9,
      });

      const subsAfter = (dataManager as any).subscriptions.get(ExchangeId.Binance);
      expect(subsAfter?.[0]?.lastUpdate).toBe(ts);
      expect(subsAfter?.[0]?.lastUpdate).toBeGreaterThanOrEqual(lastUpdateBefore ?? 0);
    });

    it("shouldLogConnectionChurn returns false within cooldown", () => {
      const key = "test-churn";
      (dataManager as any).connectionChurnLastLogged.set(key, Date.now());
      expect((dataManager as any).shouldLogConnectionChurn(key)).toBe(false);
    });

    it("calculateAdaptiveDelay applies exponential backoff with jitter and clamps max", () => {
      const randSpy = jest.spyOn(Math, "random").mockReturnValue(0);

      expect((dataManager as any).calculateAdaptiveDelay(0)).toBe(1000);
      expect((dataManager as any).calculateAdaptiveDelay(1)).toBe(2000);
      expect((dataManager as any).calculateAdaptiveDelay(10)).toBe(30000);

      randSpy.mockRestore();
    });

    it("waitForSourceReadiness throws when source never becomes ready", async () => {
      const source = createMockDataSource({ id: "src", connected: false });
      jest.spyOn(dataManager as any, "waitForCondition").mockImplementation(async (predicate: any) => {
        // Exercise the predicate at least once.
        await predicate();
        return false;
      });

      await expect((dataManager as any).waitForSourceReadiness(source, 1)).rejects.toThrow("failed to become ready");
    });

    it("waitForSourceReadiness fails if latency remains high after 10s", async () => {
      const source = createMockDataSource({ id: "src", connected: true, latencyMs: 6000 });

      // Force connectionAge > 10000 inside the predicate.
      let call = 0;

      await TestHelpers.withMockedNowAsync(
        () => {
          call += 1;
          return call === 1 ? 0 : 11001;
        },
        async () => {
          jest.spyOn(dataManager as any, "waitForCondition").mockImplementation(async (predicate: any) => {
            await predicate();
            return false;
          });

          await expect((dataManager as any).waitForSourceReadiness(source, 1)).rejects.toThrow(
            "failed to become ready"
          );
        }
      );
    });

    it("waitForSourceReadiness treats newly-connected health-check errors as ready", async () => {
      const source = createMockDataSource({
        id: "src",
        connected: true,
        performHealthCheck: async () => {
          throw new Error("health boom");
        },
      });

      // Keep connectionAge < 5000 so health-check error is tolerated.

      await TestHelpers.withMockedNowAsync(1000, async () => {
        jest.spyOn(dataManager as any, "waitForCondition").mockImplementation(async (predicate: any) => {
          const ok = await predicate();
          return Boolean(ok);
        });

        await expect((dataManager as any).waitForSourceReadiness(source, 1)).resolves.toBeUndefined();
      });
    });

    it("handleConnectionChange(connected=true) clears pending reconnect and emits healthy events", () => {
      const sourceId = "src";
      (dataManager as any).connectionMetrics.set(sourceId, {
        sourceId,
        isHealthy: false,
        lastUpdate: Date.now(),
        errorCount: 0,
        successCount: 0,
        reconnectAttempts: 5,
        consecutiveFailures: 2,
        averageLatency: 0,
        latency: 0,
        uptime: 0,
        lastError: "boom",
      });

      const timer = setTimeout(() => undefined, 1000);
      (dataManager as any).reconnectTimers.set(sourceId, timer);

      const emitSpy = jest.spyOn(dataManager as any, "emit");
      const markSpy = jest.spyOn(dataManager as any, "markDataSourceInitialized");

      (dataManager as any).handleConnectionChange(sourceId, true);

      expect((dataManager as any).reconnectTimers.has(sourceId)).toBe(false);
      expect(markSpy).toHaveBeenCalledWith(sourceId);
      expect(emitSpy).toHaveBeenCalledWith("sourceConnected", sourceId);
      expect(emitSpy).toHaveBeenCalledWith("sourceHealthy", sourceId);
    });

    it("createAggregatedPriceFromUpdates throws when no valid prices are present", () => {
      expect(() =>
        (dataManager as any).createAggregatedPriceFromUpdates(mockFeedId, [
          { symbol: "BTC/USD", price: 0, timestamp: 1, source: "a", confidence: 0.9 },
          { symbol: "BTC/USD", price: -1, timestamp: 2, source: "b", confidence: 0.9 },
        ])
      ).toThrow("No valid price updates");
    });

    it("createAggregatedPriceFromUpdates sets consensusScore based on source count", () => {
      const single = (dataManager as any).createAggregatedPriceFromUpdates(mockFeedId, [
        { symbol: "BTC/USD", price: 100, timestamp: 10, source: "a" },
      ]);
      expect(single.consensusScore).toBe(0.5);
      expect(single.price).toBeGreaterThan(0);
      expect(single.confidence).toBeLessThanOrEqual(1);

      const multi = (dataManager as any).createAggregatedPriceFromUpdates(mockFeedId, [
        { symbol: "BTC/USD", price: 100, timestamp: 10, source: "a", confidence: 0.5 },
        { symbol: "BTC/USD", price: 200, timestamp: 11, source: "b" },
      ]);
      expect(multi.consensusScore).toBe(0.8);
      expect(multi.timestamp).toBe(11);
      expect(multi.sources).toEqual(["a", "b"]);
    });
  });
});
