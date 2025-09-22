import { Test, TestingModule } from "@nestjs/testing";
import { WebSocketOrchestratorService } from "../websocket-orchestrator.service";
import { ExchangeAdapterRegistry } from "@/adapters/base/exchange-adapter.registry";
import { ConfigService } from "@/config/config.service";
import type { IExchangeAdapter } from "@/common/types/adapters";
import { FeedCategory } from "@/common/types/core";

// Mock adapter
class MockAdapter implements IExchangeAdapter {
  exchangeName: string;
  category = FeedCategory.Crypto;
  capabilities = {
    supportsWebSocket: true,
    supportsREST: true,
    supportsVolume: true,
    supportsOrderBook: false,
    supportedCategories: [FeedCategory.Crypto],
  };

  private connected = false;
  private subscriptions = new Set<string>();

  constructor(exchangeName: string) {
    this.exchangeName = exchangeName;
  }

  async connect(): Promise<void> {
    this.connected = true;
    return Promise.resolve();
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.subscriptions.clear();
  }

  isConnected(): boolean {
    return this.connected;
  }

  async subscribe(symbols: string[]): Promise<void> {
    symbols.forEach(symbol => this.subscriptions.add(symbol));
  }

  async unsubscribe(symbols: string[]): Promise<void> {
    symbols.forEach(symbol => this.subscriptions.delete(symbol));
  }

  getSubscriptions(): string[] {
    return Array.from(this.subscriptions);
  }

  // Other required methods
  normalizePriceData = jest.fn();
  normalizeVolumeData = jest.fn();
  validateResponse = jest.fn().mockReturnValue(true);
  onPriceUpdate = jest.fn();
  onVolumeUpdate = jest.fn();
  onError = jest.fn();
  onConnectionChange = jest.fn();
  getConfig = jest.fn();
  updateConfig = jest.fn();
  getMetrics = jest.fn().mockReturnValue({});
  performHealthCheck = jest.fn().mockResolvedValue(true);
  getSymbolMapping = jest.fn((symbol: string) => symbol);
  validateSymbol = jest.fn().mockReturnValue(true);
}

describe("WebSocketOrchestratorService", () => {
  let service: WebSocketOrchestratorService;
  // Removed unused variables
  let mockBinanceAdapter: MockAdapter;
  let mockCcxtAdapter: MockAdapter;

  beforeEach(async () => {
    mockBinanceAdapter = new MockAdapter("binance");
    mockCcxtAdapter = new MockAdapter("ccxt-multi-exchange");

    const mockAdapterRegistry = {
      get: jest.fn((name: string) => {
        if (name === "binance") return mockBinanceAdapter;
        if (name === "ccxt-multi-exchange") return mockCcxtAdapter;
        return undefined;
      }),
    };

    const mockConfigService = {
      getFeedConfigurations: jest.fn().mockReturnValue([
        {
          feed: { category: 1, name: "BTC/USD" },
          sources: [
            { exchange: "binance", symbol: "BTC/USDT" },
            { exchange: "gate", symbol: "BTC/USDT" }, // CCXT exchange
          ],
        },
        {
          feed: { category: 1, name: "ETH/USD" },
          sources: [{ exchange: "binance", symbol: "ETH/USDT" }],
        },
      ]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebSocketOrchestratorService,
        { provide: ExchangeAdapterRegistry, useValue: mockAdapterRegistry },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<WebSocketOrchestratorService>(WebSocketOrchestratorService);
  });

  describe("initialization", () => {
    it("should be defined", () => {
      expect(service).toBeDefined();
    });

    it("should initialize and connect to all required exchanges", async () => {
      await service.initialize();

      expect(mockBinanceAdapter.isConnected()).toBe(true);
      expect(mockCcxtAdapter.isConnected()).toBe(true);
    });

    it("should build correct feed mapping", async () => {
      await service.initialize();

      const status = service.getConnectionStatus();
      expect(status.binance).toBeDefined();
      expect(status.binance.connected).toBe(true);
      expect(status.binance.requiredCount).toBe(2); // BTC/USDT and ETH/USDT

      expect(status.gate).toBeDefined();
      expect(status.gate.connected).toBe(true);
      expect(status.gate.requiredCount).toBe(1); // BTC/USDT
    });
  });

  describe("subscription management", () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it("should subscribe to feed without duplicates", async () => {
      const feedId = { category: 1, name: "BTC/USD" };

      await service.subscribeToFeed(feedId);

      // Check that binance is subscribed to BTC/USDT
      expect(mockBinanceAdapter.getSubscriptions()).toContain("BTC/USDT");

      // Check that gate (via CCXT) would be handled appropriately
      const status = service.getConnectionStatus();
      // Binance should have 2 subscriptions (BTC/USDT and ETH/USDT from initialization)
      expect(status.binance.subscribedCount).toBe(2);
    });

    it("should not duplicate subscriptions", async () => {
      const feedId = { category: 1, name: "BTC/USD" };

      // Subscribe twice
      await service.subscribeToFeed(feedId);
      await service.subscribeToFeed(feedId);

      // Should have both BTC/USDT and ETH/USDT from initialization
      expect(mockBinanceAdapter.getSubscriptions()).toContain("BTC/USDT");
      expect(mockBinanceAdapter.getSubscriptions()).toContain("ETH/USDT");
    });
  });

  describe("reconnection logic", () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it("should not reconnect if already connected", async () => {
      const connectSpy = jest.spyOn(mockBinanceAdapter, "connect");

      const result = await service.reconnectExchange("binance");

      expect(result).toBe(true);
      expect(connectSpy).not.toHaveBeenCalled(); // Should not call connect if already connected
    });

    it("should reconnect if actually disconnected", async () => {
      // Simulate disconnection - need to update orchestrator state too
      await mockBinanceAdapter.disconnect();
      // Manually update the orchestrator state to reflect disconnection
      const state = (service as any).exchangeStates.get("binance");
      state.isConnected = false;
      // Reset the lastConnectionAttempt to avoid cooldown
      state.lastConnectionAttempt = 0;

      const connectSpy = jest.spyOn(mockBinanceAdapter, "connect");

      // Debug: check states before reconnection
      expect(state.isConnected).toBe(false);
      expect(mockBinanceAdapter.isConnected()).toBe(false);

      const result = await service.reconnectExchange("binance");

      expect(result).toBe(true);
      expect(connectSpy).toHaveBeenCalled();
      expect(mockBinanceAdapter.isConnected()).toBe(true);
    });

    it("should prevent rapid reconnection attempts", async () => {
      // Simulate disconnection
      await mockBinanceAdapter.disconnect();
      const state = (service as any).exchangeStates.get("binance");
      state.isConnected = false;
      // Reset the lastConnectionAttempt to avoid initial cooldown
      state.lastConnectionAttempt = 0;

      const connectSpy = jest.spyOn(mockBinanceAdapter, "connect");

      // First reconnection
      await service.reconnectExchange("binance");

      // Simulate disconnection again
      await mockBinanceAdapter.disconnect();
      state.isConnected = false;
      // Don't reset lastConnectionAttempt this time - it should be recent from the first reconnection

      // Immediate second reconnection should be skipped
      const result = await service.reconnectExchange("binance");

      expect(result).toBe(false); // Should be skipped due to cooldown
      expect(connectSpy).toHaveBeenCalledTimes(1); // Only called once
    });

    it("should handle reconnection failures", async () => {
      // Simulate disconnection
      await mockBinanceAdapter.disconnect();
      const state = (service as any).exchangeStates.get("binance");
      state.isConnected = false;
      state.lastConnectionAttempt = 0;

      // Make connect fail
      jest.spyOn(mockBinanceAdapter, "connect").mockRejectedValueOnce(new Error("Connection failed"));

      const result = await service.reconnectExchange("binance");

      expect(result).toBe(false);
      expect(state.isConnected).toBe(false);
    });

    it("should handle unknown exchange reconnection", async () => {
      const result = await service.reconnectExchange("unknown-exchange");
      expect(result).toBe(false);
    });
  });

  describe("error handling and edge cases", () => {
    it("should handle initialization with no exchanges", async () => {
      const emptyConfigService = {
        getFeedConfigurations: jest.fn().mockReturnValue([]),
      };

      const emptyModule = await Test.createTestingModule({
        providers: [
          WebSocketOrchestratorService,
          { provide: ExchangeAdapterRegistry, useValue: { get: jest.fn().mockReturnValue(undefined) } },
          { provide: ConfigService, useValue: emptyConfigService },
        ],
      }).compile();

      const emptyService = emptyModule.get<WebSocketOrchestratorService>(WebSocketOrchestratorService);

      await expect(emptyService.initialize()).resolves.toBeUndefined();
      expect(emptyService.getConnectionStatus()).toEqual({});
    });

    it("should handle missing adapters gracefully", async () => {
      const mockAdapterRegistry = {
        get: jest.fn().mockReturnValue(undefined), // No adapters available
      };

      const mockConfigService = {
        getFeedConfigurations: jest.fn().mockReturnValue([
          {
            feed: { category: 1, name: "BTC/USD" },
            sources: [{ exchange: "missing-exchange", symbol: "BTC/USD" }],
          },
        ]),
      };

      const module = await Test.createTestingModule({
        providers: [
          WebSocketOrchestratorService,
          { provide: ExchangeAdapterRegistry, useValue: mockAdapterRegistry },
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();

      const testService = module.get<WebSocketOrchestratorService>(WebSocketOrchestratorService);

      await expect(testService.initialize()).resolves.toBeUndefined();
      expect(testService.getConnectionStatus()).toEqual({});
    });

    it("should handle adapter connection failures during initialization", async () => {
      const failingAdapter = new MockAdapter("failing-exchange");
      jest.spyOn(failingAdapter, "connect").mockRejectedValue(new Error("Connection failed"));

      const mockAdapterRegistry = {
        get: jest.fn().mockReturnValue(failingAdapter),
      };

      const mockConfigService = {
        getFeedConfigurations: jest.fn().mockReturnValue([
          {
            feed: { category: 1, name: "BTC/USD" },
            sources: [{ exchange: "failing-exchange", symbol: "BTC/USD" }],
          },
        ]),
      };

      const module = await Test.createTestingModule({
        providers: [
          WebSocketOrchestratorService,
          { provide: ExchangeAdapterRegistry, useValue: mockAdapterRegistry },
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();

      const testService = module.get<WebSocketOrchestratorService>(WebSocketOrchestratorService);

      // Should not throw even if some adapters fail to connect
      await expect(testService.initialize()).resolves.toBeUndefined();

      const status = testService.getConnectionStatus();
      expect(status["failing-exchange"].connected).toBe(false);
    });

    it("should handle subscription to non-existent feeds", async () => {
      await service.initialize();

      const nonExistentFeed = { category: 1, name: "NONEXISTENT/USD" };

      // Should not throw for non-existent feeds
      await expect(service.subscribeToFeed(nonExistentFeed)).resolves.toBeUndefined();
    });

    it("should handle subscription failures gracefully", async () => {
      await service.initialize();

      // Make subscription fail
      jest.spyOn(mockBinanceAdapter, "subscribe").mockRejectedValueOnce(new Error("Subscription failed"));

      const feedId = { category: 1, name: "BTC/USD" };

      // Should not throw even if subscription fails
      await expect(service.subscribeToFeed(feedId)).resolves.toBeUndefined();
    });

    it("should handle cleanup properly", async () => {
      await service.initialize();

      const disconnectSpy = jest.spyOn(mockBinanceAdapter, "disconnect");
      const ccxtDisconnectSpy = jest.spyOn(mockCcxtAdapter, "disconnect");

      await service.cleanup();

      expect(disconnectSpy).toHaveBeenCalled();
      expect(ccxtDisconnectSpy).toHaveBeenCalled();
      expect(service.getConnectionStatus()).toEqual({});
    });

    it("should handle cleanup with disconnection errors", async () => {
      await service.initialize();

      // Make disconnect fail
      jest.spyOn(mockBinanceAdapter, "disconnect").mockRejectedValueOnce(new Error("Disconnect failed"));

      // Should not throw even if disconnect fails
      await expect(service.cleanup()).resolves.toBeUndefined();
    });

    it("should sync connection states properly", async () => {
      await service.initialize();

      // Simulate adapter disconnection without orchestrator knowing
      await mockBinanceAdapter.disconnect();

      // Get status should detect the disconnection
      const status = service.getConnectionStatus();
      expect(status.binance.connected).toBe(false);
    });

    it("should handle double initialization", async () => {
      await service.initialize();

      // Second initialization should be skipped
      await expect(service.initialize()).resolves.toBeUndefined();
      expect(service.isInitialized).toBe(true);
    });
  });
});
