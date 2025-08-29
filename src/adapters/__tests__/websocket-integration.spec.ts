import { Test, TestingModule } from "@nestjs/testing";
import { BinanceAdapter } from "@/adapters/crypto/binance.adapter";
import { CoinbaseAdapter } from "@/adapters/crypto/coinbase.adapter";
import { KrakenAdapter } from "@/adapters/crypto/kraken.adapter";
import { ExchangeAdapterRegistry } from "@/adapters/base/exchange-adapter.registry";
import { PriceUpdate } from "@/interfaces/data-source.interface";
import { FeedCategory } from "@/types/feed-category.enum";

// Mock WebSocket for integration testing
class MockWebSocketServer {
  private connections: MockWebSocket[] = [];
  private messageHandlers: Map<string, (data: any) => void> = new Map();

  createConnection(url: string): MockWebSocket {
    const ws = new MockWebSocket(url, this);
    this.connections.push(ws);
    return ws;
  }

  broadcast(channel: string, data: any) {
    this.connections.forEach(ws => {
      if (ws.subscribedChannels.has(channel)) {
        ws.simulateMessage(data);
      }
    });
  }

  simulateConnectionFailure(url: string) {
    const connection = this.connections.find(ws => ws.url === url);
    if (connection) {
      connection.simulateError(new Error("Connection failed"));
    }
  }

  simulateReconnection(url: string) {
    const connection = this.connections.find(ws => ws.url === url);
    if (connection) {
      connection.simulateReconnection();
    }
  }

  getConnectionCount(): number {
    return this.connections.filter(ws => ws.readyState === MockWebSocket.OPEN).length;
  }
}

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  subscribedChannels = new Set<string>();
  onopen?: () => void;
  onclose?: () => void;
  onerror?: (error: any) => void;
  onmessage?: (event: { data: string }) => void;

  constructor(
    public url: string,
    private server: MockWebSocketServer
  ) {
    // Simulate connection opening
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.();
    }, 10);
  }

  send(data: string) {
    try {
      const message = JSON.parse(data);

      // Handle subscription messages
      if (message.method === "SUBSCRIBE" || message.params) {
        const channels = message.params || [message.channel];
        channels.forEach((channel: string) => {
          this.subscribedChannels.add(channel);
        });
      }
    } catch (e) {
      // Ignore parsing errors for test simplicity
    }
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  simulateMessage(data: any) {
    if (this.onmessage && this.readyState === MockWebSocket.OPEN) {
      this.onmessage({ data: JSON.stringify(data) });
    }
  }

  simulateError(error: Error) {
    this.readyState = MockWebSocket.CLOSED;
    this.onerror?.(error);
  }

  simulateReconnection() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }
}

describe("WebSocket Integration Tests", () => {
  let module: TestingModule;
  let registry: ExchangeAdapterRegistry;
  let mockServer: MockWebSocketServer;
  let binanceAdapter: BinanceAdapter;
  let coinbaseAdapter: CoinbaseAdapter;
  let krakenAdapter: KrakenAdapter;

  beforeEach(async () => {
    mockServer = new MockWebSocketServer();

    // Mock global WebSocket
    (global as any).WebSocket = jest.fn().mockImplementation((url: string) => {
      return mockServer.createConnection(url);
    });

    module = await Test.createTestingModule({
      providers: [ExchangeAdapterRegistry, BinanceAdapter, CoinbaseAdapter, KrakenAdapter],
    }).compile();

    registry = module.get<ExchangeAdapterRegistry>(ExchangeAdapterRegistry);
    binanceAdapter = module.get<BinanceAdapter>(BinanceAdapter);
    coinbaseAdapter = module.get<CoinbaseAdapter>(CoinbaseAdapter);
    krakenAdapter = module.get<KrakenAdapter>(KrakenAdapter);

    // Register adapters
    registry.register("binance", binanceAdapter);
    registry.register("coinbase", coinbaseAdapter);
    registry.register("kraken", krakenAdapter);
  });

  afterEach(async () => {
    await module.close();
  });

  describe("Multi-Exchange WebSocket Connections", () => {
    it("should establish connections to multiple exchanges simultaneously", async () => {
      const connectionPromises = [binanceAdapter.connect(), coinbaseAdapter.connect(), krakenAdapter.connect()];

      await Promise.all(connectionPromises);

      expect(binanceAdapter.isConnected()).toBe(true);
      expect(coinbaseAdapter.isConnected()).toBe(true);
      expect(krakenAdapter.isConnected()).toBe(true);
      expect(mockServer.getConnectionCount()).toBe(3);
    });

    it("should handle partial connection failures gracefully", async () => {
      // Simulate Binance connection failure
      mockServer.simulateConnectionFailure("wss://stream.binance.com:9443/ws");

      const results = await Promise.allSettled([
        binanceAdapter.connect(),
        coinbaseAdapter.connect(),
        krakenAdapter.connect(),
      ]);

      expect(results[0].status).toBe("rejected"); // Binance failed
      expect(results[1].status).toBe("fulfilled"); // Coinbase succeeded
      expect(results[2].status).toBe("fulfilled"); // Kraken succeeded

      expect(binanceAdapter.isConnected()).toBe(false);
      expect(coinbaseAdapter.isConnected()).toBe(true);
      expect(krakenAdapter.isConnected()).toBe(true);
    });

    it("should maintain independent subscriptions per exchange", async () => {
      await Promise.all([binanceAdapter.connect(), coinbaseAdapter.connect(), krakenAdapter.connect()]);

      const symbols = ["BTC/USD", "ETH/USD"];

      await Promise.all([
        binanceAdapter.subscribe(symbols),
        coinbaseAdapter.subscribe(symbols),
        krakenAdapter.subscribe(symbols),
      ]);

      const binanceSubscriptions = binanceAdapter.getSubscriptions();
      const coinbaseSubscriptions = coinbaseAdapter.getSubscriptions();
      const krakenSubscriptions = krakenAdapter.getSubscriptions();

      expect(binanceSubscriptions).toContain("btcusdt");
      expect(binanceSubscriptions).toContain("ethusdt");
      expect(coinbaseSubscriptions).toContain("btc-usd");
      expect(coinbaseSubscriptions).toContain("eth-usd");
      expect(krakenSubscriptions).toContain("xbtusd");
      expect(krakenSubscriptions).toContain("ethusd");
    });
  });

  describe("Real-time Data Flow", () => {
    beforeEach(async () => {
      await Promise.all([binanceAdapter.connect(), coinbaseAdapter.connect(), krakenAdapter.connect()]);

      await Promise.all([
        binanceAdapter.subscribe(["BTC/USD"]),
        coinbaseAdapter.subscribe(["BTC/USD"]),
        krakenAdapter.subscribe(["BTC/USD"]),
      ]);
    });

    it("should receive and normalize price updates from multiple exchanges", async () => {
      const priceUpdates: PriceUpdate[] = [];

      // Set up price update listeners
      binanceAdapter.onPriceUpdate(update => priceUpdates.push(update));
      coinbaseAdapter.onPriceUpdate(update => priceUpdates.push(update));
      krakenAdapter.onPriceUpdate(update => priceUpdates.push(update));

      // Simulate price updates from each exchange
      mockServer.broadcast("btcusdt@ticker", {
        e: "24hrTicker",
        E: Date.now(),
        s: "BTCUSDT",
        c: "50000.00",
        v: "1000.0",
        b: "49999.00",
        a: "50001.00",
      });

      mockServer.broadcast("btc-usd", {
        type: "ticker",
        product_id: "BTC-USD",
        price: "50100.00",
        volume_24h: "800.0",
        best_bid: "50099.00",
        best_ask: "50101.00",
        time: new Date().toISOString(),
      });

      mockServer.broadcast("ticker", {
        channelName: "ticker",
        data: [
          {
            symbol: "XBT/USD",
            c: ["49950.00", "0.1"],
            v: ["900.0", "4500.0"],
            a: ["49951.00", "1", "1.000"],
            b: ["49949.00", "1", "1.000"],
          },
        ],
      });

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(priceUpdates).toHaveLength(3);

      // Verify Binance update
      const binanceUpdate = priceUpdates.find(u => u.source === "binance");
      expect(binanceUpdate).toBeDefined();
      expect(binanceUpdate!.symbol).toBe("BTC/USDT");
      expect(binanceUpdate!.price).toBe(50000);

      // Verify Coinbase update
      const coinbaseUpdate = priceUpdates.find(u => u.source === "coinbase");
      expect(coinbaseUpdate).toBeDefined();
      expect(coinbaseUpdate!.symbol).toBe("BTC/USD");
      expect(coinbaseUpdate!.price).toBe(50100);

      // Verify Kraken update
      const krakenUpdate = priceUpdates.find(u => u.source === "kraken");
      expect(krakenUpdate).toBeDefined();
      expect(krakenUpdate!.symbol).toBe("BTC/USD");
      expect(krakenUpdate!.price).toBe(49950);
    });

    it("should handle high-frequency price updates", async () => {
      const priceUpdates: PriceUpdate[] = [];
      binanceAdapter.onPriceUpdate(update => priceUpdates.push(update));

      const startTime = Date.now();

      // Simulate rapid price updates
      for (let i = 0; i < 100; i++) {
        mockServer.broadcast("btcusdt@ticker", {
          e: "24hrTicker",
          E: Date.now(),
          s: "BTCUSDT",
          c: (50000 + i).toString(),
          v: "1000.0",
          b: "49999.00",
          a: "50001.00",
        });
      }

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 100));

      const endTime = Date.now();
      const processingTime = endTime - startTime;

      expect(priceUpdates.length).toBeGreaterThan(90); // Allow for some processing delays
      expect(processingTime).toBeLessThan(500); // Should process quickly
    });

    it("should maintain data freshness under 2 seconds", async () => {
      const priceUpdates: PriceUpdate[] = [];
      binanceAdapter.onPriceUpdate(update => priceUpdates.push(update));

      const sendTime = Date.now();

      mockServer.broadcast("btcusdt@ticker", {
        e: "24hrTicker",
        E: sendTime,
        s: "BTCUSDT",
        c: "50000.00",
        v: "1000.0",
        b: "49999.00",
        a: "50001.00",
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(priceUpdates).toHaveLength(1);
      const update = priceUpdates[0];
      const dataAge = Date.now() - update.timestamp;

      expect(dataAge).toBeLessThan(2000); // Data should be fresh
    });
  });

  describe("Connection Recovery and Failover", () => {
    beforeEach(async () => {
      await Promise.all([binanceAdapter.connect(), coinbaseAdapter.connect()]);
    });

    it("should automatically reconnect after connection loss", async () => {
      expect(binanceAdapter.isConnected()).toBe(true);

      // Simulate connection loss
      mockServer.simulateConnectionFailure("wss://stream.binance.com:9443/ws");

      // Wait for connection loss detection
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(binanceAdapter.isConnected()).toBe(false);

      // Simulate reconnection
      mockServer.simulateReconnection("wss://stream.binance.com:9443/ws");

      // Wait for reconnection
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(binanceAdapter.isConnected()).toBe(true);
    });

    it("should restore subscriptions after reconnection", async () => {
      await binanceAdapter.subscribe(["BTC/USD", "ETH/USD"]);

      let subscriptions = binanceAdapter.getSubscriptions();
      expect(subscriptions).toContain("btcusdt");
      expect(subscriptions).toContain("ethusdt");

      // Simulate connection loss and recovery
      mockServer.simulateConnectionFailure("wss://stream.binance.com:9443/ws");
      await new Promise(resolve => setTimeout(resolve, 50));

      mockServer.simulateReconnection("wss://stream.binance.com:9443/ws");
      await new Promise(resolve => setTimeout(resolve, 100));

      // Subscriptions should be restored
      subscriptions = binanceAdapter.getSubscriptions();
      expect(subscriptions).toContain("btcusdt");
      expect(subscriptions).toContain("ethusdt");
    });

    it("should failover to backup exchanges within 100ms", async () => {
      const priceUpdates: PriceUpdate[] = [];

      // Set up listeners for both exchanges
      binanceAdapter.onPriceUpdate(update => priceUpdates.push(update));
      coinbaseAdapter.onPriceUpdate(update => priceUpdates.push(update));

      await Promise.all([binanceAdapter.subscribe(["BTC/USD"]), coinbaseAdapter.subscribe(["BTC/USD"])]);

      // Primary exchange (Binance) working
      mockServer.broadcast("btcusdt@ticker", {
        e: "24hrTicker",
        E: Date.now(),
        s: "BTCUSDT",
        c: "50000.00",
        v: "1000.0",
        b: "49999.00",
        a: "50001.00",
      });

      await new Promise(resolve => setTimeout(resolve, 10));
      expect(priceUpdates.filter(u => u.source === "binance")).toHaveLength(1);

      // Simulate Binance failure
      const failoverStartTime = Date.now();
      mockServer.simulateConnectionFailure("wss://stream.binance.com:9443/ws");

      // Backup exchange (Coinbase) should take over
      mockServer.broadcast("btc-usd", {
        type: "ticker",
        product_id: "BTC-USD",
        price: "50100.00",
        volume_24h: "800.0",
        best_bid: "50099.00",
        best_ask: "50101.00",
        time: new Date().toISOString(),
      });

      await new Promise(resolve => setTimeout(resolve, 10));
      const failoverTime = Date.now() - failoverStartTime;

      expect(priceUpdates.filter(u => u.source === "coinbase")).toHaveLength(1);
      expect(failoverTime).toBeLessThan(100); // Should failover quickly
    });
  });

  describe("Data Quality and Validation", () => {
    beforeEach(async () => {
      await binanceAdapter.connect();
      await binanceAdapter.subscribe(["BTC/USD"]);
    });

    it("should validate incoming data format", async () => {
      const priceUpdates: PriceUpdate[] = [];
      const errors: any[] = [];

      binanceAdapter.onPriceUpdate(update => priceUpdates.push(update));

      // Send valid data
      mockServer.broadcast("btcusdt@ticker", {
        e: "24hrTicker",
        E: Date.now(),
        s: "BTCUSDT",
        c: "50000.00",
        v: "1000.0",
        b: "49999.00",
        a: "50001.00",
      });

      // Send invalid data
      mockServer.broadcast("btcusdt@ticker", {
        e: "24hrTicker",
        E: Date.now(),
        s: "BTCUSDT",
        c: "invalid_price", // Invalid price
        v: "1000.0",
        b: "49999.00",
        a: "50001.00",
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // Should only process valid data
      expect(priceUpdates).toHaveLength(1);
      expect(priceUpdates[0].price).toBe(50000);
    });

    it("should calculate confidence scores based on spread", async () => {
      const priceUpdates: PriceUpdate[] = [];
      binanceAdapter.onPriceUpdate(update => priceUpdates.push(update));

      // Send data with tight spread (high confidence)
      mockServer.broadcast("btcusdt@ticker", {
        e: "24hrTicker",
        E: Date.now(),
        s: "BTCUSDT",
        c: "50000.00",
        v: "1000.0",
        b: "49999.50", // Tight spread
        a: "50000.50",
      });

      // Send data with wide spread (low confidence)
      mockServer.broadcast("btcusdt@ticker", {
        e: "24hrTicker",
        E: Date.now(),
        s: "BTCUSDT",
        c: "50000.00",
        v: "1000.0",
        b: "49000.00", // Wide spread
        a: "51000.00",
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(priceUpdates).toHaveLength(2);
      expect(priceUpdates[0].confidence).toBeGreaterThan(priceUpdates[1].confidence);
    });
  });

  describe("Performance and Scalability", () => {
    it("should handle multiple symbol subscriptions efficiently", async () => {
      await binanceAdapter.connect();

      const symbols = [];
      for (let i = 0; i < 50; i++) {
        symbols.push(`SYMBOL${i}/USDT`);
      }

      const startTime = Date.now();
      await binanceAdapter.subscribe(symbols);
      const subscriptionTime = Date.now() - startTime;

      expect(subscriptionTime).toBeLessThan(1000); // Should subscribe quickly
      expect(binanceAdapter.getSubscriptions().length).toBe(50);
    });

    it("should maintain performance under high message volume", async () => {
      await binanceAdapter.connect();
      await binanceAdapter.subscribe(["BTC/USD"]);

      const priceUpdates: PriceUpdate[] = [];
      binanceAdapter.onPriceUpdate(update => priceUpdates.push(update));

      const startTime = Date.now();

      // Send high volume of messages
      for (let i = 0; i < 1000; i++) {
        mockServer.broadcast("btcusdt@ticker", {
          e: "24hrTicker",
          E: Date.now(),
          s: "BTCUSDT",
          c: (50000 + Math.random() * 1000).toFixed(2),
          v: "1000.0",
          b: "49999.00",
          a: "50001.00",
        });
      }

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 200));

      const processingTime = Date.now() - startTime;
      const throughput = priceUpdates.length / (processingTime / 1000);

      expect(throughput).toBeGreaterThan(100); // Should handle >100 updates/second
      expect(processingTime).toBeLessThan(1000); // Should process within 1 second
    });
  });

  describe("Error Handling and Resilience", () => {
    it("should handle malformed WebSocket messages gracefully", async () => {
      await binanceAdapter.connect();
      await binanceAdapter.subscribe(["BTC/USD"]);

      const priceUpdates: PriceUpdate[] = [];
      binanceAdapter.onPriceUpdate(update => priceUpdates.push(update));

      // Send malformed JSON
      const connection = mockServer.connections.find(ws => ws.url.includes("binance"));

      if (connection) {
        connection.simulateMessage("invalid json");
        connection.simulateMessage({ invalid: "structure" });
      }

      // Send valid message after malformed ones
      mockServer.broadcast("btcusdt@ticker", {
        e: "24hrTicker",
        E: Date.now(),
        s: "BTCUSDT",
        c: "50000.00",
        v: "1000.0",
        b: "49999.00",
        a: "50001.00",
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // Should still process valid messages
      expect(priceUpdates).toHaveLength(1);
      expect(binanceAdapter.isConnected()).toBe(true);
    });

    it("should implement exponential backoff for reconnection attempts", async () => {
      await binanceAdapter.connect();
      expect(binanceAdapter.isConnected()).toBe(true);

      const reconnectionAttempts: number[] = [];
      const originalConnect = binanceAdapter.connect.bind(binanceAdapter);

      jest.spyOn(binanceAdapter, "connect").mockImplementation(async () => {
        reconnectionAttempts.push(Date.now());
        if (reconnectionAttempts.length < 3) {
          throw new Error("Connection failed");
        }
        return originalConnect();
      });

      // Simulate connection failure
      mockServer.simulateConnectionFailure("wss://stream.binance.com:9443/ws");

      // Wait for reconnection attempts
      await new Promise(resolve => setTimeout(resolve, 5000));

      expect(reconnectionAttempts.length).toBeGreaterThanOrEqual(3);

      // Verify exponential backoff (each attempt should be longer than the previous)
      if (reconnectionAttempts.length >= 3) {
        const delay1 = reconnectionAttempts[1] - reconnectionAttempts[0];
        const delay2 = reconnectionAttempts[2] - reconnectionAttempts[1];
        expect(delay2).toBeGreaterThan(delay1);
      }
    });
  });
});
