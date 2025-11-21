import { BinanceAdapter } from "@/adapters/crypto/binance.adapter";
import { CoinbaseAdapter } from "@/adapters/crypto/coinbase.adapter";
import { MockSetup, MockFactory } from "@/__tests__/utils";
import type { PriceUpdate } from "@/common/types/core";

// Mock WebSocket globally
(global as any).WebSocket = jest.fn().mockImplementation(() => MockFactory.createWebSocket());
global.fetch = jest.fn();

describe("Adapter Integration Tests", () => {
  let binanceAdapter: BinanceAdapter;
  let coinbaseAdapter: CoinbaseAdapter;

  beforeEach(() => {
    MockSetup.setupAll();

    // Override WebSocket mock to auto-trigger open event
    (global as any).WebSocket = jest.fn().mockImplementation(() => {
      const ws = MockFactory.createWebSocket();
      // Trigger open event asynchronously to simulate real connection
      setTimeout(() => {
        if (ws.onopen) {
          (ws.onopen as any).call(ws, new Event("open"));
        }
        ws.emit("open");
      }, 10);
      return ws;
    });

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
    // Disable reconnection to prevent hanging
    (binanceAdapter as any).maxReconnectAttempts = 0;
    (coinbaseAdapter as any).maxReconnectAttempts = 0;

    try {
      // Force immediate disconnect without cleanup delays
      if (binanceAdapter.isConnected()) {
        await binanceAdapter.disconnect();
      }
      if (coinbaseAdapter.isConnected()) {
        await coinbaseAdapter.disconnect();
      }
    } catch (_error) {
      // Ignore cleanup errors
    }

    MockSetup.cleanup();
    jest.clearAllTimers();
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe("multi-adapter functionality", () => {
    it("should handle price updates from multiple adapters", async () => {
      const priceUpdates: PriceUpdate[] = [];

      // Set up price update listeners BEFORE connection
      binanceAdapter.onPriceUpdate(update => priceUpdates.push(update));
      coinbaseAdapter.onPriceUpdate(update => priceUpdates.push(update));

      // Connect adapters
      await binanceAdapter.connect();
      await coinbaseAdapter.connect();

      // Wait for connections to stabilize
      await new Promise(resolve => setTimeout(resolve, 100));

      // Subscribe to symbols
      await binanceAdapter.subscribe(["BTC/USDT"]);
      await coinbaseAdapter.subscribe(["BTC/USD"]);

      // Clear any initial updates that may have come through
      priceUpdates.length = 0;

      // Simulate WebSocket messages
      const binanceMessage = {
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

      const coinbaseMessage = {
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

      // Process messages
      (binanceAdapter as any).handleWebSocketMessage(binanceMessage);
      (coinbaseAdapter as any).handleWebSocketMessage(coinbaseMessage);

      // Verify updates - should have at least 2 updates (one from each adapter)
      expect(priceUpdates.length).toBeGreaterThanOrEqual(2);

      const binanceUpdate = priceUpdates.find(u => u.source === "binance" && u.price === 50000);
      const coinbaseUpdate = priceUpdates.find(u => u.source === "coinbase" && u.price === 50100);

      expect(binanceUpdate).toBeDefined();
      expect(binanceUpdate!.symbol).toBe("BTC/USDT");
      expect(binanceUpdate!.price).toBe(50000);

      expect(coinbaseUpdate).toBeDefined();
      expect(coinbaseUpdate!.symbol).toBe("BTC/USD");
      expect(coinbaseUpdate!.price).toBe(50100);
    }, 5000);

    it("should handle REST API fallbacks", async () => {
      // Mock successful REST responses
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
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
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              ask: "50001.00",
              bid: "49999.00",
              volume: "1000.0",
              trade_id: 789,
              price: "50000.00",
              size: "0.1",
              time: new Date().toISOString(),
            }),
        });

      const binanceResult = await binanceAdapter.fetchTickerREST("BTC/USDT");
      const coinbaseResult = await coinbaseAdapter.fetchTickerREST("BTC/USD");

      expect(binanceResult.symbol).toBe("BTC/USDT");
      expect(binanceResult.price).toBe(50000);
      expect(binanceResult.source).toBe("binance");

      expect(coinbaseResult.symbol).toBe("BTC/USD");
      expect(coinbaseResult.price).toBe(50000);
      expect(coinbaseResult.source).toBe("coinbase");
    }, 3000);

    it("should handle error scenarios gracefully", async () => {
      const errorCallbacks: Error[] = [];

      // Set up error listeners
      binanceAdapter.onError(error => errorCallbacks.push(error));
      coinbaseAdapter.onError(error => errorCallbacks.push(error));

      // Send malformed messages - these should be handled gracefully without crashing
      (binanceAdapter as any).handleWebSocketMessage("invalid json");
      (coinbaseAdapter as any).handleWebSocketMessage({ invalid: "data" });

      // The adapters should handle malformed messages gracefully without triggering errors
      // This is by design - malformed messages are logged but don't crash the adapter
      expect(errorCallbacks.length).toBe(0);
    }, 3000);

    it("should handle high-frequency updates", async () => {
      const priceUpdates: PriceUpdate[] = [];
      binanceAdapter.onPriceUpdate(update => priceUpdates.push(update));

      // Connect and subscribe to the symbol first
      await binanceAdapter.connect();
      await binanceAdapter.subscribe(["BTC/USDT"]);

      // Simulate 20 rapid price updates
      for (let i = 0; i < 20; i++) {
        const message = {
          e: "24hrTicker",
          E: Date.now(),
          s: "BTCUSDT",
          c: (50000 + i).toString(),
          b: (49999 + i).toString(),
          a: (50001 + i).toString(),
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

      expect(priceUpdates).toHaveLength(20);
      expect(priceUpdates[19].price).toBe(50019);
    }, 5000);
  });
});
