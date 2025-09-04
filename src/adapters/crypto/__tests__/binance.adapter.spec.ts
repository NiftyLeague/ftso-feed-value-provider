import { BinanceAdapter, BinanceTickerData } from "../binance.adapter";
import { FeedCategory } from "@/common/types/core";
import { MockSetup, TestHelpers } from "@/__tests__/utils";

describe("BinanceAdapter", () => {
  let adapter: BinanceAdapter;

  beforeEach(() => {
    MockSetup.setupAll();
    adapter = new BinanceAdapter();
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await adapter.disconnect();
    MockSetup.cleanup();
  });

  describe("initialization", () => {
    it("should initialize with correct properties", () => {
      expect(adapter.exchangeName).toBe("binance");
      expect(adapter.category).toBe(FeedCategory.Crypto);
      expect(adapter.capabilities.supportsWebSocket).toBe(true);
      expect(adapter.capabilities.supportsREST).toBe(true);
      expect(adapter.capabilities.supportsVolume).toBe(true);
    });
  });

  describe("symbol mapping", () => {
    it("should map symbols correctly", () => {
      expect(adapter.getSymbolMapping("BTC/USDT")).toBe("BTCUSDT");
      expect(adapter.getSymbolMapping("ETH/USDT")).toBe("ETHUSDT");
      expect(adapter.getSymbolMapping("LTC/BTC")).toBe("LTCBTC");
    });

    it("should validate symbols correctly", () => {
      expect(adapter.validateSymbol("BTC/USDT")).toBe(true);
      expect(adapter.validateSymbol("ETH/USDT")).toBe(true);
      expect(adapter.validateSymbol("INVALID")).toBe(false);
    });
  });

  describe("symbol normalization from exchange format", () => {
    it("should normalize USDT pairs correctly", () => {
      const mockData: BinanceTickerData = {
        e: "24hrTicker",
        E: Date.now(),
        s: "BTCUSDT",
        p: "1000.00",
        P: "2.00",
        w: "50000.00",
        x: "49000.00",
        c: "50000.00",
        Q: "0.1",
        b: "49999.00",
        B: "1.0",
        a: "50001.00",
        A: "1.0",
        o: "49000.00",
        h: "51000.00",
        l: "48000.00",
        v: "1000.0",
        q: "50000000.0",
        O: Date.now() - 86400000,
        C: Date.now(),
        F: 1,
        L: 1000,
        n: 500,
      };

      const result = adapter.normalizePriceData(mockData);
      expect(result.symbol).toBe("BTC/USDT");
    });

    it("should normalize USD pairs correctly", () => {
      const mockData: BinanceTickerData = {
        e: "24hrTicker",
        E: Date.now(),
        s: "BTCUSD",
        p: "1000.00",
        P: "2.00",
        w: "50000.00",
        x: "49000.00",
        c: "50000.00",
        Q: "0.1",
        b: "49999.00",
        B: "1.0",
        a: "50001.00",
        A: "1.0",
        o: "49000.00",
        h: "51000.00",
        l: "48000.00",
        v: "1000.0",
        q: "50000000.0",
        O: Date.now() - 86400000,
        C: Date.now(),
        F: 1,
        L: 1000,
        n: 500,
      };

      const result = adapter.normalizePriceData(mockData);
      expect(result.symbol).toBe("BTC/USD");
    });

    it("should normalize USDT pairs correctly", () => {
      const mockData: BinanceTickerData = {
        e: "24hrTicker",
        E: Date.now(),
        s: "ETHUSDT",
        p: "100.0",
        P: "3.50",
        w: "2850.0",
        x: "2800.0",
        c: "2900.0",
        Q: "1.0",
        b: "2899.0",
        B: "10.0",
        a: "2901.0",
        A: "5.0",
        o: "2800.0",
        h: "2950.0",
        l: "2750.0",
        v: "10000.0",
        q: "28500000.0",
        O: Date.now() - 86400000,
        C: Date.now(),
        F: 1,
        L: 1000,
        n: 500,
      };

      const result = adapter.normalizePriceData(mockData);
      expect(result.symbol).toBe("ETH/USDT");
    });
  });

  describe("data normalization", () => {
    const mockTickerData: BinanceTickerData = {
      e: "24hrTicker",
      E: Date.now(),
      s: "BTCUSDT",
      p: "1000.00",
      P: "2.00",
      w: "50000.00",
      x: "49000.00",
      c: "50000.00",
      Q: "0.1",
      b: "49999.00",
      B: "1.0",
      a: "50001.00",
      A: "1.0",
      o: "49000.00",
      h: "51000.00",
      l: "48000.00",
      v: "1000.0",
      q: "50000000.0",
      O: Date.now() - 86400000,
      C: Date.now(),
      F: 1,
      L: 1000,
      n: 500,
    };

    it("should normalize price data correctly", () => {
      const result = adapter.normalizePriceData(mockTickerData);

      expect(result.symbol).toBe("BTC/USDT");
      expect(result.price).toBe(50000);
      expect(result.source).toBe("binance");
      expect(result.volume).toBe(1000);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(typeof result.timestamp).toBe("number");
    });

    it("should normalize volume data correctly", () => {
      const result = adapter.normalizeVolumeData(mockTickerData);

      expect(result.symbol).toBe("BTC/USDT");
      expect(result.volume).toBe(1000);
      expect(result.source).toBe("binance");
      expect(typeof result.timestamp).toBe("number");
    });

    it("should calculate confidence based on spread", () => {
      const lowSpreadData = { ...mockTickerData, b: "49999.50", a: "50000.50" };
      const highSpreadData = { ...mockTickerData, b: "49000.00", a: "51000.00" };

      const lowSpreadResult = adapter.normalizePriceData(lowSpreadData);
      const highSpreadResult = adapter.normalizePriceData(highSpreadData);

      expect(lowSpreadResult.confidence).toBeGreaterThan(highSpreadResult.confidence);
    });
  });

  describe("response validation", () => {
    it("should validate correct ticker data", () => {
      const validData: BinanceTickerData = {
        e: "24hrTicker",
        E: Date.now(),
        s: "BTCUSDT",
        p: "1000.00",
        P: "2.00",
        w: "50000.00",
        x: "49000.00",
        c: "50000.00",
        Q: "0.1",
        b: "49999.00",
        B: "1.0",
        a: "50001.00",
        A: "1.0",
        o: "49000.00",
        h: "51000.00",
        l: "48000.00",
        v: "1000.0",
        q: "50000000.0",
        O: Date.now() - 86400000,
        C: Date.now(),
        F: 1,
        L: 1000,
        n: 500,
      };

      expect(adapter.validateResponse(validData)).toBe(true);
    });

    it("should reject invalid data", () => {
      expect(adapter.validateResponse(null)).toBe(false);
      expect(adapter.validateResponse({})).toBe(false);
      expect(adapter.validateResponse({ s: "BTCUSDT" })).toBe(false);
      expect(adapter.validateResponse({ s: "BTCUSDT", c: "invalid", E: Date.now() })).toBe(false);
    });
  });

  describe("WebSocket connection", () => {
    it("should connect successfully", async () => {
      await expect(adapter.connect()).resolves.toBeUndefined();
      expect(adapter.isConnected()).toBe(true);
    });

    it("should handle connection errors", async () => {
      // Mock WebSocket constructor to throw error
      const originalWebSocket = global.WebSocket;
      (global as any).WebSocket = jest.fn().mockImplementation(() => {
        throw new Error("Connection failed");
      });

      await TestHelpers.expectToThrow(() => adapter.connect(), "Connection failed");

      global.WebSocket = originalWebSocket;
    });

    it("should disconnect properly", async () => {
      await adapter.connect();
      expect(adapter.isConnected()).toBe(true);

      await adapter.disconnect();
      expect(adapter.isConnected()).toBe(false);
    });
  });

  describe("REST API", () => {
    it("should fetch ticker data via REST", async () => {
      const mockResponse = {
        symbol: "BTCUSDT",
        priceChange: "1000.00",
        priceChangePercent: "2.00",
        weightedAvgPrice: "50000.00",
        prevClosePrice: "49000.00",
        lastPrice: "50000.00",
        lastQty: "0.1",
        bidPrice: "49999.00",
        bidQty: "1.0",
        askPrice: "50001.00",
        askQty: "1.0",
        openPrice: "49000.00",
        highPrice: "51000.00",
        lowPrice: "48000.00",
        volume: "1000.0",
        quoteVolume: "50000000.0",
        openTime: Date.now() - 86400000,
        closeTime: Date.now(),
        firstId: 1,
        lastId: 1000,
        count: 500,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await adapter.fetchTickerREST("BTC/USDT");

      expect(result.symbol).toBe("BTC/USDT");
      expect(result.price).toBe(50000);
      expect(result.source).toBe("binance");
      expect(result.volume).toBe(1000);
    });

    it("should handle REST API errors", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      await expect(adapter.fetchTickerREST("INVALID/PAIR")).rejects.toThrow("Failed to fetch Binance ticker");
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
      expect(subscriptions).toContain("btcusdt");
      expect(subscriptions).toContain("ethusdt");
    });

    it("should handle unsubscribe", async () => {
      await adapter.connect();
      await adapter.subscribe(["BTC/USDT", "ETH/USDT"]);
      await adapter.unsubscribe(["BTC/USDT"]);

      const subscriptions = adapter.getSubscriptions();
      expect(subscriptions).not.toContain("btcusdt");
      expect(subscriptions).toContain("ethusdt");
    });
  });
});
