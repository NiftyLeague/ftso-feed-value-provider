import { CoinbaseAdapter, CoinbaseTickerData } from "../coinbase.adapter";
import { FeedCategory } from "@/common/types/core";

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen?: () => void;
  onclose?: () => void;
  onerror?: (error: Error | Event) => void;
  onmessage?: (event: { data: string }) => void;

  constructor(public url: string) {
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.();
    }, 10);
  }

  send(_data: string) {
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

describe("CoinbaseAdapter", () => {
  let adapter: CoinbaseAdapter;

  beforeEach(() => {
    adapter = new CoinbaseAdapter();
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  describe("initialization", () => {
    it("should initialize with correct properties", () => {
      expect(adapter.exchangeName).toBe("coinbase");
      expect(adapter.category).toBe(FeedCategory.Crypto);
      expect(adapter.capabilities.supportsWebSocket).toBe(true);
      expect(adapter.capabilities.supportsREST).toBe(true);
      expect(adapter.capabilities.supportsVolume).toBe(true);
    });
  });

  describe("symbol mapping", () => {
    it("should map symbols correctly", () => {
      expect(adapter.getSymbolMapping("BTC/USD")).toBe("BTC-USD");
      expect(adapter.getSymbolMapping("ETH/USD")).toBe("ETH-USD");
      expect(adapter.getSymbolMapping("LTC/BTC")).toBe("LTC-BTC");
    });

    it("should validate symbols correctly", () => {
      expect(adapter.validateSymbol("BTC/USD")).toBe(true);
      expect(adapter.validateSymbol("ETH/USD")).toBe(true);
      expect(adapter.validateSymbol("INVALID")).toBe(false);
    });
  });

  describe("data normalization", () => {
    const mockTickerData: CoinbaseTickerData = {
      type: "ticker",
      sequence: 123456,
      product_id: "BTC-USD",
      price: "50000.00",
      open_24h: "49000.00",
      volume_24h: "1000.0",
      low_24h: "48000.00",
      high_24h: "51000.00",
      volume_30d: "30000.0",
      best_bid: "49999.00",
      best_ask: "50001.00",
      side: "buy",
      time: new Date().toISOString(),
      trade_id: 789,
      last_size: "0.1",
    };

    it("should normalize price data correctly", () => {
      const result = adapter.normalizePriceData(mockTickerData);

      expect(result.symbol).toBe("BTC/USD");
      expect(result.price).toBe(50000);
      expect(result.source).toBe("coinbase");
      expect(result.volume).toBe(1000);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(typeof result.timestamp).toBe("number");
    });

    it("should normalize volume data correctly", () => {
      const result = adapter.normalizeVolumeData(mockTickerData);

      expect(result.symbol).toBe("BTC/USD");
      expect(result.volume).toBe(1000);
      expect(result.source).toBe("coinbase");
      expect(typeof result.timestamp).toBe("number");
    });

    it("should calculate confidence based on spread", () => {
      const lowSpreadData = { ...mockTickerData, best_bid: "49999.50", best_ask: "50000.50" };
      const highSpreadData = { ...mockTickerData, best_bid: "49000.00", best_ask: "51000.00" };

      const lowSpreadResult = adapter.normalizePriceData(lowSpreadData);
      const highSpreadResult = adapter.normalizePriceData(highSpreadData);

      expect(lowSpreadResult.confidence).toBeGreaterThan(highSpreadResult.confidence);
    });
  });

  describe("response validation", () => {
    it("should validate correct ticker data", () => {
      const validData: CoinbaseTickerData = {
        type: "ticker",
        sequence: 123456,
        product_id: "BTC-USD",
        price: "50000.00",
        open_24h: "49000.00",
        volume_24h: "1000.0",
        low_24h: "48000.00",
        high_24h: "51000.00",
        volume_30d: "30000.0",
        best_bid: "49999.00",
        best_ask: "50001.00",
        side: "buy",
        time: new Date().toISOString(),
        trade_id: 789,
        last_size: "0.1",
      };

      expect(adapter.validateResponse(validData)).toBe(true);
    });

    it("should reject invalid data", () => {
      expect(adapter.validateResponse(null)).toBe(false);
      expect(adapter.validateResponse({})).toBe(false);
      expect(adapter.validateResponse({ product_id: "BTC-USD" })).toBe(false);
      expect(adapter.validateResponse({ product_id: "BTC-USD", price: "invalid" })).toBe(false);
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
        ask: "50001.00",
        bid: "49999.00",
        volume: "1000.0",
        trade_id: 789,
        price: "50000.00",
        size: "0.1",
        time: new Date().toISOString(),
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await adapter.fetchTickerREST("BTC/USD");

      expect(result.symbol).toBe("BTC/USD");
      expect(result.price).toBe(50000);
      expect(result.source).toBe("coinbase");
      expect(result.volume).toBe(1000);
    });

    it("should handle REST API errors", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      await expect(adapter.fetchTickerREST("INVALID/PAIR")).rejects.toThrow("Failed to fetch Coinbase ticker");
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
      await adapter.subscribe(["BTC/USD", "ETH/USD"]);

      const subscriptions = adapter.getSubscriptions();
      expect(subscriptions).toContain("BTC-USD");
      expect(subscriptions).toContain("ETH-USD");
    });

    it("should handle unsubscribe", async () => {
      await adapter.connect();
      await adapter.subscribe(["BTC/USD", "ETH/USD"]);
      await adapter.unsubscribe(["BTC/USD"]);

      const subscriptions = adapter.getSubscriptions();
      expect(subscriptions).not.toContain("BTC-USD");
      expect(subscriptions).toContain("ETH-USD");
    });
  });
});
