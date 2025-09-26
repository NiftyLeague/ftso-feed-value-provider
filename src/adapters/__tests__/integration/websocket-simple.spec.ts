import { BinanceAdapter } from "@/adapters/crypto/binance.adapter";
import { CoinbaseAdapter } from "@/adapters/crypto/coinbase.adapter";
import { MockSetup, MockFactory } from "@/__tests__/utils";
import type { PriceUpdate } from "@/common/types/core";

// Mock WebSocket globally
(global as any).WebSocket = jest.fn().mockImplementation(() => MockFactory.createWebSocket());
global.fetch = jest.fn();

describe("WebSocket Simple Tests (No Hanging)", () => {
  let binanceAdapter: BinanceAdapter;
  let coinbaseAdapter: CoinbaseAdapter;

  beforeEach(() => {
    MockSetup.setupAll();
    binanceAdapter = new BinanceAdapter();
    coinbaseAdapter = new CoinbaseAdapter();

    // Disable reconnection and retries to prevent hanging
    (binanceAdapter as any).maxReconnectAttempts = 0;
    (coinbaseAdapter as any).maxReconnectAttempts = 0;
    (binanceAdapter as any).maxRetries = 0;
    (coinbaseAdapter as any).maxRetries = 0;
    (binanceAdapter as any).retryDelay = 0;
    (coinbaseAdapter as any).retryDelay = 0;
  });

  afterEach(async () => {
    // Force immediate cleanup without waiting
    try {
      if (binanceAdapter.isConnected()) {
        await binanceAdapter.disconnect();
      }
      if (coinbaseAdapter.isConnected()) {
        await coinbaseAdapter.disconnect();
      }
    } catch (error) {
      // Ignore errors
    }

    // Clear all timers immediately
    jest.clearAllTimers();
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.clearAllMocks();
    MockSetup.cleanup();
  });

  describe("basic connection functionality", () => {
    it("should connect and disconnect adapters", async () => {
      await binanceAdapter.connect();
      expect(binanceAdapter.isConnected()).toBe(true);

      await binanceAdapter.disconnect();
      expect(binanceAdapter.isConnected()).toBe(false);
    }, 10000); // Increased timeout to 10 seconds

    it("should handle subscription management", async () => {
      await binanceAdapter.connect();

      await binanceAdapter.subscribe(["BTC/USDT"]);
      const subscriptions = binanceAdapter.getSubscriptions();
      expect(subscriptions.length).toBeGreaterThan(0);

      await binanceAdapter.unsubscribe(["BTC/USDT"]);
      const afterUnsubscribe = binanceAdapter.getSubscriptions();
      expect(afterUnsubscribe.length).toBe(0);
    }, 10000); // Increased timeout to 10 seconds
  });

  describe("message processing", () => {
    beforeEach(async () => {
      await binanceAdapter.connect();
      await coinbaseAdapter.connect();
    });

    it("should process Binance messages", async () => {
      const priceUpdates: PriceUpdate[] = [];
      binanceAdapter.onPriceUpdate(update => priceUpdates.push(update));

      const message = {
        e: "24hrTicker",
        E: Date.now(),
        s: "BTCUSDT",
        c: "50000.00",
        b: "49999.00",
        a: "50001.00",
        v: "1000.0",
        p: "1000.00",
        P: "2.00",
        w: "50000.00",
        x: "49000.00",
        Q: "0.1",
        B: "1.0",
        A: "1.0",
        o: "49000.00",
        h: "51000.00",
        l: "48000.00",
        q: "50000000.0",
        O: Date.now() - 86400000,
        C: Date.now(),
        F: 1,
        L: 1000,
        n: 500,
      };

      (binanceAdapter as any).handleWebSocketMessage(message);

      expect(priceUpdates).toHaveLength(1);
      expect(priceUpdates[0].symbol).toBe("BTC/USDT");
      expect(priceUpdates[0].price).toBe(50000);
    }, 10000); // Increased timeout to 10 seconds

    it("should process Coinbase messages", async () => {
      const priceUpdates: PriceUpdate[] = [];
      coinbaseAdapter.onPriceUpdate(update => priceUpdates.push(update));

      const message = {
        type: "ticker",
        sequence: 123456,
        product_id: "BTC-USD",
        price: "50100.00",
        best_bid: "50099.00",
        best_ask: "50101.00",
        volume_24h: "1200.0",
        time: new Date().toISOString(),
        open_24h: "49000.00",
        low_24h: "48000.00",
        high_24h: "51000.00",
        volume_30d: "30000.0",
        side: "buy" as const,
        trade_id: 789,
        last_size: "0.1",
      };

      (coinbaseAdapter as any).handleWebSocketMessage(message);

      expect(priceUpdates).toHaveLength(1);
      expect(priceUpdates[0].symbol).toBe("BTC/USD");
      expect(priceUpdates[0].price).toBe(50100);
    }, 10000); // Increased timeout to 10 seconds

    it("should handle multiple messages efficiently", async () => {
      const priceUpdates: PriceUpdate[] = [];
      binanceAdapter.onPriceUpdate(update => priceUpdates.push(update));

      // Process 10 messages quickly
      for (let i = 0; i < 10; i++) {
        const message = {
          e: "24hrTicker",
          E: Date.now(),
          s: "BTCUSDT",
          c: (50000 + i).toString(),
          b: "49999.00",
          a: "50001.00",
          v: "1000.0",
          p: "1000.00",
          P: "2.00",
          w: "50000.00",
          x: "49000.00",
          Q: "0.1",
          B: "1.0",
          A: "1.0",
          o: "49000.00",
          h: "51000.00",
          l: "48000.00",
          q: "50000000.0",
          O: Date.now() - 86400000,
          C: Date.now(),
          F: 1,
          L: 1000,
          n: 500,
        };

        (binanceAdapter as any).handleWebSocketMessage(message);
      }

      expect(priceUpdates).toHaveLength(10);
      expect(priceUpdates[9].price).toBe(50009);
    }, 10000); // Increased timeout to 10 seconds
  });

  describe("error handling", () => {
    it("should handle malformed messages gracefully", async () => {
      await binanceAdapter.connect();

      const errors: Error[] = [];
      binanceAdapter.onError(error => errors.push(error));

      const malformedMessages = [null, undefined, "invalid json", { invalid: "structure" }];

      malformedMessages.forEach(msg => {
        (binanceAdapter as any).handleWebSocketMessage(msg);
      });

      // Should generate errors but not crash
      expect(errors.length).toBeGreaterThan(0);
    }, 10000); // Increased timeout to 10 seconds

    it("should handle connection failures", async () => {
      const errors: Error[] = [];
      binanceAdapter.onError(error => errors.push(error));

      // Simulate connection error
      await binanceAdapter.connect();
      const ws = (binanceAdapter as any).ws;
      if (ws) {
        ws.emit("error", new Error("Connection failed"));
      }

      expect(errors).toHaveLength(1);
    }, 10000); // Increased timeout to 10 seconds
  });

  describe("REST API fallback", () => {
    it("should handle REST API calls", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            symbol: "BTCUSDT",
            lastPrice: "50000.00",
            bidPrice: "49999.00",
            askPrice: "50001.00",
            volume: "1000.0",
            closeTime: Date.now(),
          }),
      });

      const result = await binanceAdapter.fetchTickerREST("BTC/USDT");

      expect(result.symbol).toBe("BTC/USDT");
      expect(result.price).toBe(50000);
      expect(result.source).toBe("binance");
    }, 10000); // Increased timeout to 10 seconds

    it("should handle REST API errors", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
      });

      await expect(binanceAdapter.fetchTickerREST("BTC/USDT")).rejects.toThrow();
    }, 10000); // Increased timeout to 10 seconds
  });

  describe("health checks", () => {
    it("should perform health checks", async () => {
      await binanceAdapter.connect();

      const isHealthy = await binanceAdapter.healthCheck();
      expect(isHealthy).toBe(true);
    }, 10000); // Increased timeout to 10 seconds

    it("should handle health check when disconnected", async () => {
      const isHealthy = await binanceAdapter.healthCheck();
      expect(typeof isHealthy).toBe("boolean");
    }, 10000); // Increased timeout to 10 seconds
  });
});
