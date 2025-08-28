import { Test, TestingModule } from "@nestjs/testing";
import { ProductionDataManagerService } from "../production-data-manager";
import { DataSource, PriceUpdate } from "@/interfaces";
import { EnhancedFeedId } from "@/types";
import { FeedCategory } from "@/types/feed-category.enum";

// Mock DataSource implementation for testing
class MockDataSource implements DataSource {
  id: string;
  type: "websocket" | "rest";
  priority: number;
  category: FeedCategory;

  private connected = false;
  private latency = 50;
  private priceUpdateCallback?: (update: PriceUpdate) => void;
  private connectionChangeCallback?: (connected: boolean) => void;
  private subscribedSymbols: string[] = [];

  constructor(id: string, type: "websocket" | "rest" = "websocket", category: FeedCategory = FeedCategory.Crypto) {
    this.id = id;
    this.type = type;
    this.priority = 1;
    this.category = category;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getLatency(): number {
    return this.latency;
  }

  async subscribe(symbols: string[]): Promise<void> {
    this.subscribedSymbols.push(...symbols);
  }

  async unsubscribe(symbols: string[]): Promise<void> {
    this.subscribedSymbols = this.subscribedSymbols.filter(s => !symbols.includes(s));
  }

  onPriceUpdate(callback: (update: PriceUpdate) => void): void {
    this.priceUpdateCallback = callback;
  }

  onConnectionChange(callback: (connected: boolean) => void): void {
    this.connectionChangeCallback = callback;
  }

  // Test helper methods
  simulateConnection(connected: boolean): void {
    this.connected = connected;
    if (this.connectionChangeCallback) {
      this.connectionChangeCallback(connected);
    }
  }

  simulatePriceUpdate(update: PriceUpdate): void {
    if (this.priceUpdateCallback && this.connected) {
      this.priceUpdateCallback(update);
    }
  }

  setLatency(latency: number): void {
    this.latency = latency;
  }

  getSubscribedSymbols(): string[] {
    return [...this.subscribedSymbols];
  }
}

describe("ProductionDataManagerService", () => {
  let service: ProductionDataManagerService;
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [ProductionDataManagerService],
    }).compile();

    service = module.get<ProductionDataManagerService>(ProductionDataManagerService);
  });

  afterEach(async () => {
    await module.close();
  });

  describe("Data Source Management", () => {
    it("should add a data source successfully", async () => {
      const mockSource = new MockDataSource("test-source-1");

      await service.addDataSource(mockSource);

      const connectedSources = service.getConnectedSources();
      expect(connectedSources).toHaveLength(0); // Not connected yet
    });

    it("should remove a data source successfully", async () => {
      const mockSource = new MockDataSource("test-source-1");

      await service.addDataSource(mockSource);
      await service.removeDataSource("test-source-1");

      const connectedSources = service.getConnectedSources();
      expect(connectedSources).toHaveLength(0);
    });

    it("should track connected sources correctly", async () => {
      const mockSource1 = new MockDataSource("test-source-1");
      const mockSource2 = new MockDataSource("test-source-2");

      await service.addDataSource(mockSource1);
      await service.addDataSource(mockSource2);

      // Simulate connections
      mockSource1.simulateConnection(true);
      mockSource2.simulateConnection(true);

      const connectedSources = service.getConnectedSources();
      expect(connectedSources).toHaveLength(2);
      expect(connectedSources.map(s => s.id)).toContain("test-source-1");
      expect(connectedSources.map(s => s.id)).toContain("test-source-2");
    });
  });

  describe("Feed Subscription Management", () => {
    it("should subscribe to a feed successfully", async () => {
      const mockSource = new MockDataSource("test-source-1", "websocket", FeedCategory.Crypto);
      await service.addDataSource(mockSource);
      mockSource.simulateConnection(true);

      const feedId: EnhancedFeedId = {
        category: FeedCategory.Crypto,
        name: "BTC/USD",
      };

      await service.subscribeToFeed(feedId);

      expect(mockSource.getSubscribedSymbols()).toContain("BTC/USD");
    });

    it("should unsubscribe from a feed successfully", async () => {
      const mockSource = new MockDataSource("test-source-1", "websocket", FeedCategory.Crypto);
      await service.addDataSource(mockSource);
      mockSource.simulateConnection(true);

      const feedId: EnhancedFeedId = {
        category: FeedCategory.Crypto,
        name: "BTC/USD",
      };

      await service.subscribeToFeed(feedId);
      await service.unsubscribeFromFeed(feedId);

      expect(mockSource.getSubscribedSymbols()).not.toContain("BTC/USD");
    });

    it("should throw error when no connected sources available", async () => {
      const feedId: EnhancedFeedId = {
        category: FeedCategory.Crypto,
        name: "BTC/USD",
      };

      await expect(service.subscribeToFeed(feedId)).rejects.toThrow("No connected data sources available");
    });
  });

  describe("Real-time Data Processing", () => {
    it("should process price updates immediately", done => {
      const mockSource = new MockDataSource("test-source-1");
      const priceUpdate: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        source: "test-source-1",
        confidence: 0.95,
      };

      service.on("priceUpdate", (update: PriceUpdate) => {
        expect(update).toEqual(priceUpdate);
        done();
      });

      service.processUpdateImmediately(priceUpdate);
    });

    it("should reject stale data", () => {
      const staleUpdate: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now() - 5000, // 5 seconds old
        source: "test-source-1",
        confidence: 0.95,
      };

      const eventSpy = jest.fn();
      service.on("priceUpdate", eventSpy);

      service.processUpdateImmediately(staleUpdate);

      expect(eventSpy).not.toHaveBeenCalled();
    });

    it("should prioritize real-time data", () => {
      expect(service.prioritizeRealTimeData()).toBe(true);
    });
  });

  describe("Connection Health Monitoring", () => {
    it("should return correct connection health", async () => {
      const mockSource1 = new MockDataSource("test-source-1");
      const mockSource2 = new MockDataSource("test-source-2");

      await service.addDataSource(mockSource1);
      await service.addDataSource(mockSource2);

      mockSource1.simulateConnection(true);
      mockSource2.simulateConnection(false);

      const health = await service.getConnectionHealth();

      expect(health.totalSources).toBe(2);
      expect(health.connectedSources).toBe(1);
      expect(health.failedSources).toHaveLength(1);
    });

    it("should track data freshness correctly", async () => {
      const mockSource = new MockDataSource("test-source-1", "websocket", FeedCategory.Crypto);
      await service.addDataSource(mockSource);
      mockSource.simulateConnection(true);

      const feedId: EnhancedFeedId = {
        category: FeedCategory.Crypto,
        name: "BTC/USD",
      };

      await service.subscribeToFeed(feedId);

      // Simulate price update
      const priceUpdate: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        source: "test-source-1",
        confidence: 0.95,
      };

      mockSource.simulatePriceUpdate(priceUpdate);

      // Wait a bit and check freshness
      await new Promise(resolve => setTimeout(resolve, 100));

      const freshness = await service.getDataFreshness(feedId);
      expect(freshness).toBeGreaterThan(0);
      expect(freshness).toBeLessThan(1000); // Should be less than 1 second
    });
  });

  describe("Event Handling", () => {
    it("should emit sourceAdded event when source is added", done => {
      const mockSource = new MockDataSource("test-source-1");

      service.on("sourceAdded", (sourceId: string) => {
        expect(sourceId).toBe("test-source-1");
        done();
      });

      service.addDataSource(mockSource);
    });

    it("should emit sourceRemoved event when source is removed", async () => {
      const mockSource = new MockDataSource("test-source-1");
      await service.addDataSource(mockSource);

      const eventPromise = new Promise<string>(resolve => {
        service.on("sourceRemoved", (sourceId: string) => {
          resolve(sourceId);
        });
      });

      await service.removeDataSource("test-source-1");

      const sourceId = await eventPromise;
      expect(sourceId).toBe("test-source-1");
    });

    it("should emit sourceConnected event when source connects", done => {
      const mockSource = new MockDataSource("test-source-1");

      service.on("sourceConnected", (sourceId: string) => {
        expect(sourceId).toBe("test-source-1");
        done();
      });

      service.addDataSource(mockSource).then(() => {
        mockSource.simulateConnection(true);
      });
    });

    it("should emit sourceDisconnected event when source disconnects", async () => {
      const mockSource = new MockDataSource("test-source-1");
      await service.addDataSource(mockSource);
      mockSource.simulateConnection(true);

      const eventPromise = new Promise<string>(resolve => {
        service.on("sourceDisconnected", (sourceId: string) => {
          resolve(sourceId);
        });
      });

      mockSource.simulateConnection(false);

      const sourceId = await eventPromise;
      expect(sourceId).toBe("test-source-1");
    });
  });

  describe("Error Handling", () => {
    it("should handle source addition errors gracefully", async () => {
      const mockSource = new MockDataSource("test-source-1");

      // Mock an error in the source setup
      jest.spyOn(mockSource, "onPriceUpdate").mockImplementation(() => {
        throw new Error("Setup failed");
      });

      await expect(service.addDataSource(mockSource)).rejects.toThrow("Setup failed");
    });

    it("should handle source removal errors gracefully", async () => {
      const mockSource = new MockDataSource("test-source-1");
      await service.addDataSource(mockSource);

      // Mock an error in unsubscribe
      jest.spyOn(mockSource, "unsubscribe").mockRejectedValue(new Error("Unsubscribe failed"));

      // Should not throw, but log the error
      await expect(service.removeDataSource("test-source-1")).resolves.not.toThrow();
    });
  });

  describe("Configuration Compliance", () => {
    it("should enforce maximum data age of 2000ms", () => {
      expect(service.maxDataAge).toBe(2000);
    });

    it("should enforce maximum cache TTL of 1000ms", () => {
      expect(service.maxCacheTTL).toBe(1000);
    });

    it("should have correct data freshness policy", () => {
      // Access private property for testing
      const policy = (service as any).dataFreshnessPolicy;

      expect(policy.rejectStaleData).toBe(true);
      expect(policy.staleThresholdMs).toBe(2000);
      expect(policy.realTimePriority).toBe(true);
      expect(policy.cacheBypassOnFreshData).toBe(true);
      expect(policy.immediateProcessing).toBe(true);
      expect(policy.streamingConnectionPreferred).toBe(true);
      expect(policy.preciseTimestamps).toBe(true);
      expect(policy.votingRoundTracking).toBe(true);
    });
  });
});
