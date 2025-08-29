import { KrakenAdapter, KrakenTickerData } from "../kraken.adapter";
import { FeedCategory } from "@/types";

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
    it("should map BTC symbols correctly", () => {
      expect(adapter.getSymbolMapping("BTC/USD")).toBe("BTCUSD");
      expect(adapter.getSymbolMapping("BTC/EUR")).toBe("BTCEUR");
    });

    it("should map other symbols correctly", () => {
      expect(adapter.getSymbolMapping("ETH/USD")).toBe("ETHUSD");
      expect(adapter.getSymbolMapping("LTC/USD")).toBe("LTCUSD");
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
      expect(result.source).toBe("kraken");
      expect(result.volume).toBe(5000);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(typeof result.timestamp).toBe("number");
    });

    it("should normalize volume data correctly", () => {
      const result = adapter.normalizeVolumeData(mockTickerData);

      expect(result.symbol).toBe("XBT/USD");
      expect(result.volume).toBe(5000);
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
    it("should connect successfully", async () => {
      await expect(adapter.connect()).resolves.toBeUndefined();
      expect(adapter.isConnected()).toBe(true);
    });

    it("should handle connection errors", async () => {
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
            v: ["1000.0", "5000.0"],
            p: ["50000.00", "49500.00"],
            t: [500, 2500],
            l: ["48000.00", "47000.00"],
            h: ["51000.00", "52000.00"],
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
      expect(result.volume).toBe(5000);
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
        json: () => Promise.resolve({ error: [], result: { status: "online" } }),
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
      expect(subscriptions).toContain("BTCUSD");
      expect(subscriptions).toContain("ETHUSD");
    });

    it("should handle unsubscribe", async () => {
      await adapter.connect();
      await adapter.subscribe(["BTC/USD", "ETH/USD"]);
      await adapter.unsubscribe(["BTC/USD"]);

      const subscriptions = adapter.getSubscriptions();
      expect(subscriptions).not.toContain("BTCUSD");
      expect(subscriptions).toContain("ETHUSD");
    });
  });
});
