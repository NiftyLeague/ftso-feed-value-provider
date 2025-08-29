import { Test, TestingModule } from "@nestjs/testing";
import { ProductionDataManagerService } from "../production-data-manager";
import { ExchangeAdapterRegistry } from "@/adapters/base/exchange-adapter.registry";
import { DataValidator } from "../validation/data-validator";
import { FeedCategory } from "@/types/feed-category.enum";
import { EnhancedFeedId } from "@/types/enhanced-feed-id.types";
import { ExchangeAdapter } from "@/interfaces/exchange-adapter.interface";
import { PriceUpdate } from "@/interfaces/data-source.interface";

// Mock adapter for testing that implements DataSource interface
class MockExchangeAdapter extends ExchangeAdapter {
  readonly exchangeName = "mock-exchange";
  readonly category = FeedCategory.Crypto;
  readonly capabilities = {
    supportsWebSocket: true,
    supportsREST: true,
    supportsVolume: true,
    supportsOrderBook: false,
    supportedCategories: [FeedCategory.Crypto],
  };

  // DataSource interface properties
  readonly id = "mock-exchange-1";
  readonly type: "websocket" | "rest" = "websocket";
  readonly priority = 1;

  private connected = false;
  private priceCallback?: (update: PriceUpdate) => void;
  private connectionCallback?: (connected: boolean) => void;

  async connect(): Promise<void> {
    this.connected = true;
    this.connectionCallback?.(true);
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.connectionCallback?.(false);
  }

  isConnected(): boolean {
    return this.connected;
  }

  getLatency(): number {
    return 50; // Mock latency in ms
  }

  normalizePriceData(rawData: any): PriceUpdate {
    return {
      symbol: "BTC/USD",
      price: rawData.price || 50000,
      timestamp: Date.now(),
      source: this.exchangeName,
      confidence: 0.9,
    };
  }

  normalizeVolumeData(rawData: any): any {
    return {
      symbol: "BTC/USD",
      volume: rawData.volume || 1000,
      timestamp: Date.now(),
      source: this.exchangeName,
    };
  }

  validateResponse(rawData: any): boolean {
    return rawData && typeof rawData.price === "number";
  }

  async subscribe(_symbols: string[]): Promise<void> {
    // Mock subscription
  }

  async unsubscribe(_symbols: string[]): Promise<void> {
    // Mock unsubscription
  }

  onPriceUpdate(callback: (update: PriceUpdate) => void): void {
    this.priceCallback = callback;
  }

  onConnectionChange(callback: (connected: boolean) => void): void {
    this.connectionCallback = callback;
  }

  validateSymbol(feedSymbol: string): boolean {
    return feedSymbol.includes("/");
  }

  // Helper method to simulate price updates
  simulatePriceUpdate(price: number) {
    if (this.priceCallback) {
      this.priceCallback({
        symbol: "BTC/USD",
        price,
        timestamp: Date.now(),
        source: this.exchangeName,
        confidence: 0.9,
      });
    }
  }
}

describe("ProductionDataManagerService", () => {
  let dataManager: ProductionDataManagerService;
  let module: TestingModule;
  let adapterRegistry: jest.Mocked<ExchangeAdapterRegistry>;
  let dataValidator: jest.Mocked<DataValidator>;

  const mockFeedId: EnhancedFeedId = {
    category: FeedCategory.Crypto,
    name: "BTC/USD",
  };

  beforeEach(async () => {
    const mockAdapterRegistry = {
      findBestAdapter: jest.fn(),
      registerAdapter: jest.fn(),
      unregisterAdapter: jest.fn(),
      getAdapter: jest.fn(),
      getAllAdapters: jest.fn(),
      updateHealthStatus: jest.fn().mockReturnValue(true),
      getHealthyAdapters: jest.fn(),
      getAdaptersByCategory: jest.fn(),
    };

    const mockDataValidator = {
      validatePriceUpdate: jest.fn().mockReturnValue(true),
      validateVolumeData: jest.fn().mockReturnValue(true),
      isDataFresh: jest.fn().mockReturnValue(true),
      calculateConfidence: jest.fn().mockReturnValue(0.9),
    };

    module = await Test.createTestingModule({
      providers: [
        ProductionDataManagerService,
        {
          provide: ExchangeAdapterRegistry,
          useValue: mockAdapterRegistry,
        },
        {
          provide: DataValidator,
          useValue: mockDataValidator,
        },
      ],
    }).compile();

    dataManager = module.get<ProductionDataManagerService>(ProductionDataManagerService);
    adapterRegistry = module.get(ExchangeAdapterRegistry);
    dataValidator = module.get(DataValidator);
  });

  afterEach(async () => {
    dataManager.cleanup();
    await module.close();
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
    it("should add a data source successfully", async () => {
      const mockAdapter = new MockExchangeAdapter();
      await mockAdapter.connect();

      await dataManager.addDataSource(mockAdapter);
      const connectedSources = dataManager.getConnectedSources();
      expect(connectedSources).toHaveLength(1);
      expect(connectedSources[0]).toBe(mockAdapter);
    });

    it("should remove a data source successfully", async () => {
      const mockAdapter = new MockExchangeAdapter();
      await mockAdapter.connect();

      await dataManager.addDataSource(mockAdapter);
      expect(dataManager.getConnectedSources()).toHaveLength(1);

      await dataManager.removeDataSource(mockAdapter.id);
      expect(dataManager.getConnectedSources()).toHaveLength(0);
    });
  });

  describe("Feed Subscription", () => {
    it("should subscribe to a feed successfully", async () => {
      const mockAdapter = new MockExchangeAdapter();
      await mockAdapter.connect();
      await dataManager.addDataSource(mockAdapter);

      await expect(dataManager.subscribeToFeed(mockFeedId)).resolves.not.toThrow();
    });

    it("should unsubscribe from a feed successfully", async () => {
      const mockAdapter = new MockExchangeAdapter();
      await mockAdapter.connect();
      await dataManager.addDataSource(mockAdapter);

      await dataManager.subscribeToFeed(mockFeedId);
      await expect(dataManager.unsubscribeFromFeed(mockFeedId)).resolves.not.toThrow();
    });
  });

  describe("Health Monitoring", () => {
    it("should return connection health status", async () => {
      const health = await dataManager.getConnectionHealth();
      expect(health).toBeDefined();
      expect(typeof health.connectedSources).toBe("number");
      expect(typeof health.totalSources).toBe("number");
      expect(typeof health.healthScore).toBe("number");
    });

    it("should return data freshness for a feed", async () => {
      const freshness = await dataManager.getDataFreshness(mockFeedId);
      expect(typeof freshness).toBe("number");
      expect(freshness).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Real-time Data Management", () => {
    it("should prioritize real-time data", () => {
      const prioritize = dataManager.prioritizeRealTimeData();
      expect(typeof prioritize).toBe("boolean");
    });

    it("should process updates immediately when configured", () => {
      const mockUpdate: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        source: "mock-exchange",
        confidence: 0.9,
      };

      expect(() => dataManager.processUpdateImmediately(mockUpdate)).not.toThrow();
    });

    it("should maintain voting round history", () => {
      expect(() => dataManager.maintainVotingRoundHistory(10)).not.toThrow();
    });
  });

  describe("Error Handling", () => {
    it("should handle getCurrentPrice with no data available", async () => {
      await expect(dataManager.getCurrentPrice(mockFeedId)).rejects.toThrow("No data available for feed BTC/USD");
    });

    it("should handle getCurrentPrices with no data available", async () => {
      const result = await dataManager.getCurrentPrices([mockFeedId]);
      expect(result).toEqual([]); // Should return empty array when no data is available
    });
  });
});
