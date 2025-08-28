import { KrakenAdapter, KrakenTickerData } from "../kraken.adapter";
import { FeedCategory } from "@/types/feed-category.enum";

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen?: () => void;
  onclose?: () => void;
  onerror?: (error: any) => void;
  onmessage?: (event: { data: string }) => void;

  constructor(public url: string) {
    // Simulate connection opening
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.();
    }, 10);
  }

  send(data: string) {
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

describe("KrakenAdapter", () => {
  let adapter: KrakenAdapter;

  beforeEach(() => {
    adapter = new KrakenAdapter();
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  describe("initialization", () => {
    it("should initialize with correct properties", () => {
      expect(adapter.exchangeName).toBe("kraken");
      expect(adapter.category).toBe(FeedCategory.Crypto);
      expect(adapter.capabilities.supportsWebSocket).toBe(true);
      expect(adapter.capabilities.supportsREST).toBe(true);
      expect(adapter.capabilities.supportsVolume).toBe(true);
    });
  });

  describe("symbol mapping", () => {
    it("should map symbols by removing slash", () => {
      // Test with actual symbols from feeds.json
      expect(adapter.getSymbolMapping("SGB/USD")).toBe("SGBUSD");
      expect(adapter.getSymbolMapping("USDT/USD")).toBe("USDTUSD");
      expect(adapter.getSymbolMapping("TAO/USD")).toBe("TAOUSD");
      expect(adapter.getSymbolMapping("RENDER/USD")).toBe("RENDERUSD");
      expect(adapter.getSymbolMapping("TRUMP/USD")).toBe("TRUMPUSD");
    });

    it("should handle other crypto symbols correctly", () => {
      expect(adapter.getSymbolMapping("ETH/USD")).toBe("ETHUSD");
      expect(adapter.getSymbolMapping("LTC/USD")).toBe("LTCUSD");
      expect(adapter.getSymbolMapping("DOT/USD")).toBe("DOTUSD");
    });

    it("should validate symbols correctly", () => {
      expect(adapter.validateSymbol("BTC/USD")).toBe(true);
      expect(adapter.validateSymbol("ETH/USDT")).toBe(true);
      expect(adapter.validateSymbol("INVALID")).toBe(false);
    });
  });

  describe("symbol normalization from exchange format", () => {
    it("should normalize symbols by adding slash", () => {
      const mockData: KrakenTickerData = {
        channelID: 1,
        channelName: "ticker",
        pair: "SGBUSD",
        data: {
          a: ["1.51", "1", "1.000"],
          b: ["1.49", "1", "1.000"],
          c: ["1.50", "0.1"],
          v: ["100.0", "1000.0"],
          p: ["1.45", "1.48"],
          t: [50, 500],
          l: ["1.40", "1.40"],
          h: ["1.55", "1.55"],
          o: ["1.45", "1.45"],
        },
      };

      const result = adapter.normalizePriceData(mockData);
      expect(result.symbol).toBe("SGB/USD");
    });

    it("should normalize USDT symbols correctly", () => {
      const mockData: KrakenTickerData = {
        channelID: 1,
        channelName: "ticker",
        pair: "USDTUSD",
        data: {
          a: ["1.001", "1", "1.000"],
          b: ["0.999", "1", "1.000"],
          c: ["1.000", "1.0"],
          v: ["1000.0", "10000.0"],
          p: ["0.995", "0.998"],
          t: [100, 1000],
          l: ["0.990", "0.990"],
          h: ["1.010", "1.010"],
          o: ["0.995", "0.995"],
        },
      };

      const result = adapter.normalizePriceData(mockData);
      expect(result.symbol).toBe("USDT/USD");
    });
  });

  describe("data normalization", () => {
    const mockTickerData: KrakenTickerData = {
      channelID: 1,
      channelName: "ticker",
      pair: "SGBUSD",
      data: {
        a: ["1.51", "1", "1.000"],
        b: ["1.49", "1", "1.000"],
        c: ["1.50", "0.1"],
        v: ["100.0", "1000.0"],
        p: ["1.45", "1.48"],
        t: [50, 500],
        l: ["1.40", "1.40"],
        h: ["1.55", "1.55"],
        o: ["1.45", "1.45"],
      },
    };

    it("should normalize price data correctly", () => {
      const result = adapter.normalizePriceData(mockTickerData);

      expect(result.symbol).toBe("SGB/USD");
      expect(result.price).toBe(1.5);
      expect(result.source).toBe("kraken");
      expect(result.volume).toBe(1000);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(typeof result.timestamp).toBe("number");
    });

    it("should normalize volume data correctly", () => {
      const result = adapter.normalizeVolumeData(mockTickerData);

      expect(result.symbol).toBe("SGB/USD");
      expect(result.volume).toBe(1000);
      expect(result.source).toBe("kraken");
      expect(typeof result.timestamp).toBe("number");
    });

    it("should calculate confidence based on spread", () => {
      const lowSpreadData: KrakenTickerData = {
        ...mockTickerData,
        data: {
          ...mockTickerData.data,
          a: ["50000.50", "1", "1.000"] as [string, string, string],
          b: ["49999.50", "1", "1.000"] as [string, string, string],
          c: ["50000.00", "0.1"] as [string, string],
        },
      };

      const highSpreadData: KrakenTickerData = {
        ...mockTickerData,
        data: {
          ...mockTickerData.data,
          a: ["51000.00", "1", "1.000"] as [string, string, string],
          b: ["49000.00", "1", "1.000"] as [string, string, string],
          c: ["50000.00", "0.1"] as [string, string],
        },
      };

      const lowSpreadResult = adapter.normalizePriceData(lowSpreadData);
      const highSpreadResult = adapter.normalizePriceData(highSpreadData);

      // Low spread should have higher confidence
      expect(lowSpreadResult.confidence).toBeGreaterThan(highSpreadResult.confidence);
    });
  });

  describe("response validation", () => {
    it("should validate correct ticker data", () => {
      const validData: KrakenTickerData = {
        channelID: 1,
        channelName: "ticker",
        pair: "XBTUSD",
        data: {
          a: ["50001.00", "1", "1.000"],
          b: ["49999.00", "1", "1.000"],
          c: ["50000.00", "0.1"],
          v: ["100.0", "1000.0"],
          p: ["49500.00", "49800.00"],
          t: [50, 500],
          l: ["48000.00", "48000.00"],
          h: ["51000.00", "51000.00"],
          o: ["49000.00", "49000.00"],
        },
      };

      expect(adapter.validateResponse(validData)).toBe(true);
    });

    it("should reject invalid data", () => {
      expect(adapter.validateResponse(null)).toBe(false);
      expect(adapter.validateResponse({})).toBe(false);
      expect(adapter.validateResponse({ pair: "XBTUSD" })).toBe(false);
      expect(
        adapter.validateResponse({
          pair: "XBTUSD",
          data: { c: ["invalid"] },
        })
      ).toBe(false);
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

      await expect(adapter.connect()).rejects.toThrow("Connection failed");

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
        error: [],
        result: {
          XBTUSD: {
            a: ["50001.00", "1", "1.000"],
            b: ["49999.00", "1", "1.000"],
            c: ["50000.00", "0.1"],
            v: ["100.0", "1000.0"],
            p: ["49500.00", "49800.00"],
            t: [50, 500],
            l: ["48000.00", "48000.00"],
            h: ["51000.00", "51000.00"],
            o: "49000.00",
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
      expect(result.source).toBe("kraken");
      expect(result.volume).toBe(1000);
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

    it("should handle REST API errors", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      await expect(adapter.fetchTickerREST("INVALID/PAIR")).rejects.toThrow("Failed to fetch Kraken ticker");
    });
  });

  describe("health check", () => {
    it("should return true when connected", async () => {
      await adapter.connect();
      const isHealthy = await adapter.healthCheck();
      expect(isHealthy).toBe(true);
    });

    it("should check REST API when not connected", async () => {
      const mockResponse = {
        error: [],
        result: {
          status: "online",
          timestamp: "2023-01-01T12:00:00Z",
        },
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const isHealthy = await adapter.healthCheck();
      expect(isHealthy).toBe(true);
    });

    it("should return false when system is offline", async () => {
      const mockResponse = {
        error: [],
        result: {
          status: "maintenance",
          timestamp: "2023-01-01T12:00:00Z",
        },
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const isHealthy = await adapter.healthCheck();
      expect(isHealthy).toBe(false);
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
      await adapter.subscribe(["SGB/USD", "ETH/USD"]);

      const subscriptions = adapter.getSubscriptions();
      expect(subscriptions).toContain("SGBUSD");
      expect(subscriptions).toContain("ETHUSD");
    });

    it("should handle unsubscribe", async () => {
      await adapter.connect();
      await adapter.subscribe(["BTC/USD", "ETH/USD"]);
      await adapter.unsubscribe(["BTC/USD"]);

      const subscriptions = adapter.getSubscriptions();
      expect(subscriptions).not.toContain("XBTUSD");
      expect(subscriptions).toContain("ETHUSD");
    });
  });
});
