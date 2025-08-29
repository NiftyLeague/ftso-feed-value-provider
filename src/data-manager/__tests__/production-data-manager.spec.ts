import { Test, TestingModule } from "@nestjs/testing";
import { ProductionDataManager } from "../production-data-manager";
import { ExchangeAdapterRegistry } from "@/adapters/base/exchange-adapter.registry";
import { DataValidator } from "../validation/data-validator";
import { EnhancedFeedId } from "@/types/enhanced-feed-id.types";
import { FeedCategory } from "@/types/feed-category.enum";
import { PriceUpdate } from "@/interfaces/data-source.interface";
import { ExchangeAdapter } from "@/interfaces/exchange-adapter.interface";

// Mock adapter for testing
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

  private connected = false;
  private priceCallback?: (update: PriceUpdate) => void;

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
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

  async subscribe(symbols: string[]): Promise<void> {
    // Mock subscription
  }

  async unsubscribe(symbols: string[]): Promise<void> {
    // Mock unsubscription
  }

  onPriceUpdate(callback: (update: PriceUpdate) => void): void {
    this.priceCallback = callback;
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

describe("ProductionDataManager", () => {
  let dataManager: ProductionDataManager;
  let adapterRegistry: jest.Mocked<ExchangeAdapterRegistry>;
  let dataValidator: jest.Mocked<DataValidator>;
  let mockAdapter: MockExchangeAdapter;
  let module: TestingModule;

  const mockFeedId: EnhancedFeedId = {
    category: FeedCategory.Crypto,
    name: "BTC/USD",
  };

  beforeEach(async () => {
    mockAdapter = new MockExchangeAdapter();

    const mockAdapterRegistry = {
      findBestAdapter: jest.fn(),
      getByCategory: jest.fn(),
      get: jest.fn(),
      register: jest.fn(),
      setActive: jest.fn(),
      updateHealthStatus: jest.fn(),
      getStats: jest.fn(),
    };

    const mockDataValidator = {
      validateUpdate: jest.fn(),
      validateBatch: jest.fn(),
      getValidationStats: jest.fn(),
    };

    module = await Test.createTestingModule({
      providers: [
        ProductionDataManager,
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

    dataManager = module.get<ProductionDataManager>(ProductionDataManager);
    adapterRegistry = module.get(ExchangeAdapterRegistry);
    dataValidator = module.get(DataValidator);

    // Setup default mock behaviors
    adapterRegistry.findBestAdapter.mockReturnValue(mockAdapter);
    adapterRegistry.getByCategory.mockReturnValue([mockAdapter]);
    dataValidator.validateUpdate.mockResolvedValue({
      isValid: true,
      errors: [],
      confidence: 0.9,
      adjustedUpdate: undefined,
    });
  });

  afterEach(async () => {
    await module.close();
  });

  describe("initialization", () => {
    it("should initialize successfully", async () => {
      await dataManager.onModuleInit();
      expect(dataManager.isInitialized()).toBe(true);
    });

    it("should cleanup on destroy", async () => {
      await dataManager.onModuleInit();
      await dataManager.onModuleDestroy();
      expect(dataManager.isInitialized()).toBe(false);
    });
  });

  describe("connection management", () => {
    beforeEach(async () => {
      await dataManager.onModuleInit();
    });

    it("should connect to data sources for feed", async () => {
      await dataManager.connectToFeed(mockFeedId);

      expect(adapterRegistry.findBestAdapter).toHaveBeenCalledWith("BTC/USD", FeedCategory.Crypto);
      expect(mockAdapter.isConnected()).toBe(true);
    });

    it("should handle connection failures gracefully", async () => {
      const failingAdapter = new MockExchangeAdapter();
      jest.spyOn(failingAdapter, "connect").mockRejectedValue(new Error("Connection failed"));
      adapterRegistry.findBestAdapter.mockReturnValue(failingAdapter);

      await expect(dataManager.connectToFeed(mockFeedId)).rejects.toThrow("Connection failed");
    });

    it("should disconnect from feed sources", async () => {
      await dataManager.connectToFeed(mockFeedId);
      expect(mockAdapter.isConnected()).toBe(true);

      await dataManager.disconnectFromFeed(mockFeedId);
      expect(mockAdapter.isConnected()).toBe(false);
    });

    it("should track connection status", async () => {
      expect(dataManager.isConnectedToFeed(mockFeedId)).toBe(false);

      await dataManager.connectToFeed(mockFeedId);
      expect(dataManager.isConnectedToFeed(mockFeedId)).toBe(true);

      await dataManager.disconnectFromFeed(mockFeedId);
      expect(dataManager.isConnectedToFeed(mockFeedId)).toBe(false);
    });
  });

  describe("data subscription", () => {
    beforeEach(async () => {
      await dataManager.onModuleInit();
      await dataManager.connectToFeed(mockFeedId);
    });

    it("should subscribe to price updates", async () => {
      const callback = jest.fn();
      const unsubscribe = dataManager.subscribeToPriceUpdates(mockFeedId, callback);

      expect(typeof unsubscribe).toBe("function");

      // Simulate price update
      mockAdapter.simulatePriceUpdate(51000);

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          symbol: "BTC/USD",
          price: 51000,
          source: "mock-exchange",
        })
      );

      // Cleanup
      unsubscribe();
    });

    it("should validate price updates before forwarding", async () => {
      const callback = jest.fn();
      dataManager.subscribeToPriceUpdates(mockFeedId, callback);

      // Mock validation failure
      dataValidator.validateUpdate.mockResolvedValueOnce({
        isValid: false,
        errors: [{ type: "RANGE_ERROR" as any, message: "Invalid price", severity: "critical" as const }],
        confidence: 0,
        adjustedUpdate: undefined,
      });

      mockAdapter.simulatePriceUpdate(-100); // Invalid negative price

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(dataValidator.validateUpdate).toHaveBeenCalled();
      expect(callback).not.toHaveBeenCalled(); // Should not forward invalid data
    });

    it("should handle multiple subscribers", async () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      dataManager.subscribeToPriceUpdates(mockFeedId, callback1);
      dataManager.subscribeToPriceUpdates(mockFeedId, callback2);

      mockAdapter.simulatePriceUpdate(52000);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(callback1).toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();
    });

    it("should unsubscribe properly", async () => {
      const callback = jest.fn();
      const unsubscribe = dataManager.subscribeToPriceUpdates(mockFeedId, callback);

      mockAdapter.simulatePriceUpdate(53000);
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();

      mockAdapter.simulatePriceUpdate(54000);
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(callback).toHaveBeenCalledTimes(1); // Should not be called again
    });
  });

  describe("health monitoring", () => {
    beforeEach(async () => {
      await dataManager.onModuleInit();
      await dataManager.connectToFeed(mockFeedId);
    });

    it("should monitor connection health", async () => {
      const healthStatus = await dataManager.getConnectionHealth(mockFeedId);

      expect(healthStatus).toBeDefined();
      expect(healthStatus.isHealthy).toBe(true);
      expect(healthStatus.connectedSources).toBeGreaterThan(0);
      expect(healthStatus.totalSources).toBeGreaterThan(0);
    });

    it("should detect unhealthy connections", async () => {
      // Simulate connection failure
      await mockAdapter.disconnect();

      const healthStatus = await dataManager.getConnectionHealth(mockFeedId);

      expect(healthStatus.isHealthy).toBe(false);
      expect(healthStatus.connectedSources).toBe(0);
    });

    it("should track latency metrics", async () => {
      const callback = jest.fn();
      dataManager.subscribeToPriceUpdates(mockFeedId, callback);

      mockAdapter.simulatePriceUpdate(55000);
      await new Promise(resolve => setTimeout(resolve, 10));

      const metrics = dataManager.getLatencyMetrics(mockFeedId);

      expect(metrics).toBeDefined();
      expect(metrics.averageLatency).toBeGreaterThanOrEqual(0);
      expect(metrics.maxLatency).toBeGreaterThanOrEqual(0);
      expect(metrics.minLatency).toBeGreaterThanOrEqual(0);
      expect(metrics.sampleCount).toBeGreaterThan(0);
    });
  });

  describe("failover management", () => {
    let primaryAdapter: MockExchangeAdapter;
    let backupAdapter: MockExchangeAdapter;

    beforeEach(async () => {
      primaryAdapter = new MockExchangeAdapter();
      backupAdapter = new MockExchangeAdapter();
      (backupAdapter as any).exchangeName = "backup-exchange";

      adapterRegistry.getByCategory.mockReturnValue([primaryAdapter, backupAdapter]);
      adapterRegistry.findBestAdapter.mockReturnValue(primaryAdapter);

      await dataManager.onModuleInit();
      await dataManager.connectToFeed(mockFeedId);
    });

    it("should failover to backup source when primary fails", async () => {
      const callback = jest.fn();
      dataManager.subscribeToPriceUpdates(mockFeedId, callback);

      // Primary adapter working
      primaryAdapter.simulatePriceUpdate(56000);
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(callback).toHaveBeenCalledWith(expect.objectContaining({ source: "mock-exchange" }));

      // Simulate primary adapter failure
      await primaryAdapter.disconnect();
      adapterRegistry.updateHealthStatus.mockImplementation((name, status) => {
        if (name === "mock-exchange") {
          adapterRegistry.findBestAdapter.mockReturnValue(backupAdapter);
        }
      });

      // Trigger failover check
      await dataManager.checkAndHandleFailover(mockFeedId);

      // Backup adapter should now be active
      backupAdapter.simulatePriceUpdate(57000);
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(callback).toHaveBeenCalledWith(expect.objectContaining({ source: "backup-exchange" }));
    });

    it("should measure failover time", async () => {
      const startTime = Date.now();

      // Simulate primary failure
      await primaryAdapter.disconnect();

      // Trigger failover
      await dataManager.checkAndHandleFailover(mockFeedId);

      const failoverTime = Date.now() - startTime;

      // Should failover quickly (within 100ms requirement)
      expect(failoverTime).toBeLessThan(100);
    });
  });

  describe("data quality monitoring", () => {
    beforeEach(async () => {
      await dataManager.onModuleInit();
      await dataManager.connectToFeed(mockFeedId);
    });

    it("should track data quality metrics", async () => {
      const callback = jest.fn();
      dataManager.subscribeToPriceUpdates(mockFeedId, callback);

      // Simulate some price updates
      mockAdapter.simulatePriceUpdate(58000);
      mockAdapter.simulatePriceUpdate(58100);
      mockAdapter.simulatePriceUpdate(58200);

      await new Promise(resolve => setTimeout(resolve, 20));

      const qualityMetrics = dataManager.getDataQualityMetrics(mockFeedId);

      expect(qualityMetrics).toBeDefined();
      expect(qualityMetrics.validationRate).toBeGreaterThan(0);
      expect(qualityMetrics.averageConfidence).toBeGreaterThan(0);
      expect(qualityMetrics.totalUpdates).toBeGreaterThan(0);
    });

    it("should detect data staleness", async () => {
      const callback = jest.fn();
      dataManager.subscribeToPriceUpdates(mockFeedId, callback);

      // Simulate old price update
      const staleUpdate: PriceUpdate = {
        symbol: "BTC/USD",
        price: 59000,
        timestamp: Date.now() - 5000, // 5 seconds old
        source: "mock-exchange",
        confidence: 0.9,
      };

      // Mock validation to detect staleness
      dataValidator.validateUpdate.mockResolvedValueOnce({
        isValid: false,
        errors: [{ type: "STALENESS_ERROR" as any, message: "Data too old", severity: "critical" as const }],
        confidence: 0,
        adjustedUpdate: undefined,
      });

      if (mockAdapter.priceCallback) {
        mockAdapter.priceCallback(staleUpdate);
      }

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(callback).not.toHaveBeenCalled(); // Stale data should be rejected
    });
  });

  describe("configuration management", () => {
    it("should update configuration", () => {
      const newConfig = {
        maxStalenessMs: 3000,
        failoverTimeoutMs: 200,
        healthCheckIntervalMs: 5000,
      };

      dataManager.updateConfig(newConfig);
      const currentConfig = dataManager.getConfig();

      expect(currentConfig.maxStalenessMs).toBe(3000);
      expect(currentConfig.failoverTimeoutMs).toBe(200);
      expect(currentConfig.healthCheckIntervalMs).toBe(5000);
    });

    it("should use default configuration values", () => {
      const config = dataManager.getConfig();

      expect(config.maxStalenessMs).toBe(2000);
      expect(config.failoverTimeoutMs).toBe(100);
      expect(config.healthCheckIntervalMs).toBe(10000);
      expect(config.maxRetries).toBe(3);
      expect(config.retryDelayMs).toBe(1000);
    });
  });

  describe("error handling", () => {
    beforeEach(async () => {
      await dataManager.onModuleInit();
    });

    it("should handle adapter not found gracefully", async () => {
      adapterRegistry.findBestAdapter.mockReturnValue(undefined);

      await expect(dataManager.connectToFeed(mockFeedId)).rejects.toThrow("No suitable adapter found for feed BTC/USD");
    });

    it("should handle validation errors gracefully", async () => {
      await dataManager.connectToFeed(mockFeedId);
      const callback = jest.fn();
      dataManager.subscribeToPriceUpdates(mockFeedId, callback);

      // Mock validation error
      dataValidator.validateUpdate.mockRejectedValue(new Error("Validation service error"));

      mockAdapter.simulatePriceUpdate(60000);
      await new Promise(resolve => setTimeout(resolve, 10));

      // Should not crash, but also not forward the update
      expect(callback).not.toHaveBeenCalled();
    });

    it("should retry failed operations", async () => {
      const failingAdapter = new MockExchangeAdapter();
      let attempts = 0;
      jest.spyOn(failingAdapter, "connect").mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          return Promise.reject(new Error("Connection failed"));
        }
        return Promise.resolve();
      });

      adapterRegistry.findBestAdapter.mockReturnValue(failingAdapter);

      await dataManager.connectToFeed(mockFeedId);
      expect(attempts).toBe(3); // Should have retried
      expect(failingAdapter.isConnected()).toBe(true);
    });
  });

  describe("performance metrics", () => {
    beforeEach(async () => {
      await dataManager.onModuleInit();
      await dataManager.connectToFeed(mockFeedId);
    });

    it("should track throughput metrics", async () => {
      const callback = jest.fn();
      dataManager.subscribeToPriceUpdates(mockFeedId, callback);

      // Simulate multiple price updates
      for (let i = 0; i < 10; i++) {
        mockAdapter.simulatePriceUpdate(50000 + i * 100);
        await new Promise(resolve => setTimeout(resolve, 1));
      }

      await new Promise(resolve => setTimeout(resolve, 20));

      const throughputMetrics = dataManager.getThroughputMetrics(mockFeedId);

      expect(throughputMetrics).toBeDefined();
      expect(throughputMetrics.updatesPerSecond).toBeGreaterThan(0);
      expect(throughputMetrics.totalUpdates).toBe(10);
    });

    it("should measure processing latency", async () => {
      const callback = jest.fn();
      dataManager.subscribeToPriceUpdates(mockFeedId, callback);

      mockAdapter.simulatePriceUpdate(61000);
      await new Promise(resolve => setTimeout(resolve, 10));

      const latencyMetrics = dataManager.getLatencyMetrics(mockFeedId);

      expect(latencyMetrics.averageLatency).toBeLessThan(100); // Should be fast
    });
  });
});
