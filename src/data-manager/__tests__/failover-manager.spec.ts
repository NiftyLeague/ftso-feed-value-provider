import { Test, TestingModule } from "@nestjs/testing";
import { FailoverManager } from "../failover-manager";
import type { FailoverConfig } from "@/common/types/data-manager";
import type { DataSource, PriceUpdate, CoreFeedId } from "@/common/types/core";
import { FeedCategory } from "@/common/types/core";
import { MockSetup } from "@/__tests__/utils";

// Mock DataSource for testing
class MockDataSource implements DataSource {
  id: string;
  type: "websocket" | "rest";
  priority: number;
  category: FeedCategory;

  private connected = false;
  private latency = 50;
  private connectionChangeCallback?: (connected: boolean) => void;

  constructor(id: string, category: FeedCategory = FeedCategory.Crypto) {
    this.id = id;
    this.type = "websocket";
    this.priority = 1;
    this.category = category;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getLatency(): number {
    return this.latency;
  }

  async subscribe(_symbols: string[]): Promise<void> {
    // Mock implementation
  }

  async unsubscribe(_symbols: string[]): Promise<void> {
    // Mock implementation
  }

  onPriceUpdate(_callback: (update: PriceUpdate) => void): void {
    // Mock implementation
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

  setLatency(latency: number): void {
    this.latency = latency;
  }
}

describe("FailoverManager", () => {
  let manager: FailoverManager;
  let module: TestingModule;

  const testConfig: Partial<FailoverConfig> = {
    maxFailoverTime: 100,
    healthCheckInterval: 1000,
    failureThreshold: 2,
    recoveryThreshold: 3,
  };

  beforeEach(async () => {
    // Use centralized console mocking
    MockSetup.setupConsole();

    module = await Test.createTestingModule({
      providers: [
        {
          provide: FailoverManager,
          useFactory: () => new FailoverManager(),
        },
      ],
    }).compile();

    manager = module.get<FailoverManager>(FailoverManager);

    // Apply test configuration
    (manager as any).config = { ...(manager as any).config, ...testConfig };
  });

  afterEach(async () => {
    // Clean up the manager and close the module
    if (manager) {
      manager.destroy();
    }
    if (module) {
      await module.close();
    }
    // Restore console methods after each test
    jest.restoreAllMocks();
  });

  afterEach(async () => {
    manager.destroy();
    await module.close();
  });

  describe("Data Source Registration", () => {
    it("should register a data source successfully", () => {
      const mockSource = new MockDataSource("test-source-1");

      manager.registerDataSource(mockSource);

      const healthStatus = manager.getSourceHealthStatus();
      expect(healthStatus.has("test-source-1")).toBe(true);
      expect(healthStatus.get("test-source-1")?.isHealthy).toBe(true);
    });

    it("should unregister a data source successfully", () => {
      const mockSource = new MockDataSource("test-source-1");

      manager.registerDataSource(mockSource);
      manager.unregisterDataSource("test-source-1");

      const healthStatus = manager.getSourceHealthStatus();
      expect(healthStatus.has("test-source-1")).toBe(false);
    });
  });

  describe("Failover Group Configuration", () => {
    it("should configure failover group correctly", () => {
      const feedId: CoreFeedId = {
        category: FeedCategory.Crypto,
        name: "BTC/USD",
      };

      const primarySources = ["binance", "coinbase"];
      const backupSources = ["kraken", "okx"];

      manager.configureFailoverGroup(feedId, primarySources, backupSources);

      const failoverStatus = manager.getFailoverStatus();
      const groupKey = `${feedId.category}-${feedId.name}`;
      const group = failoverStatus.get(groupKey);

      expect(group).toBeDefined();
      expect(group?.primarySources).toEqual(primarySources);
      expect(group?.backupSources).toEqual(backupSources);
      expect(group?.activeSources).toEqual(primarySources);
    });

    it("should emit failoverGroupConfigured event", done => {
      const feedId: CoreFeedId = {
        category: FeedCategory.Crypto,
        name: "BTC/USD",
      };

      manager.on("failoverGroupConfigured", (configuredFeedId, group) => {
        expect(configuredFeedId).toEqual(feedId);
        expect((group as any).primarySources).toEqual(["binance", "coinbase"]);
        done();
      });

      manager.configureFailoverGroup(feedId, ["binance", "coinbase"], ["kraken"]);
    });
  });

  describe("Active Source Management", () => {
    let mockSources: MockDataSource[];
    let feedId: CoreFeedId;

    beforeEach(() => {
      feedId = {
        category: FeedCategory.Crypto,
        name: "BTC/USD",
      };

      mockSources = [
        new MockDataSource("binance"),
        new MockDataSource("coinbase"),
        new MockDataSource("kraken"),
        new MockDataSource("okx"),
      ];

      mockSources.forEach(source => {
        manager.registerDataSource(source);
        source.simulateConnection(true);
      });

      manager.configureFailoverGroup(feedId, ["binance", "coinbase"], ["kraken", "okx"]);
    });

    it("should return active sources correctly", () => {
      const activeSources = manager.getActiveSources(feedId);

      expect(activeSources).toHaveLength(2);
      expect(activeSources.map(s => s.id)).toContain("binance");
      expect(activeSources.map(s => s.id)).toContain("coinbase");
    });

    it("should return healthy sources correctly", () => {
      // Disconnect one source
      mockSources[1].simulateConnection(false);

      const healthySources = manager.getHealthySources(feedId);

      expect(healthySources).toHaveLength(1);
      expect(healthySources[0].id).toBe("binance");
    });

    it("should return empty array for non-existent feed", () => {
      const nonExistentFeed: CoreFeedId = {
        category: FeedCategory.Forex,
        name: "EUR/USD",
      };

      const activeSources = manager.getActiveSources(nonExistentFeed);
      expect(activeSources).toHaveLength(0);
    });
  });

  describe("Failover Triggering", () => {
    let mockSources: MockDataSource[];
    let feedId: CoreFeedId;

    beforeEach(() => {
      feedId = {
        category: FeedCategory.Crypto,
        name: "BTC/USD",
      };

      mockSources = [
        new MockDataSource("binance"),
        new MockDataSource("coinbase"),
        new MockDataSource("kraken"),
        new MockDataSource("okx"),
      ];

      mockSources.forEach(source => {
        manager.registerDataSource(source);
        source.simulateConnection(true);
      });

      manager.configureFailoverGroup(feedId, ["binance", "coinbase"], ["kraken", "okx"]);
    });

    it("should trigger failover when source fails", async () => {
      const failoverPromise = new Promise<void>(resolve => {
        manager.on("failoverCompleted", (_completedFeedId, details) => {
          expect(_completedFeedId).toEqual(feedId);
          expect((details as any).failedSource).toBe("binance");
          resolve();
        });
      });

      await manager.triggerFailover("binance", "Connection lost");

      await failoverPromise;

      const activeSources = manager.getActiveSources(feedId);
      expect(activeSources.map(s => s.id)).not.toContain("binance");
      expect(activeSources.map(s => s.id)).toContain("coinbase");
    });

    it("should activate backup sources when all primary sources fail", async () => {
      const failoverPromise = new Promise<void>(resolve => {
        let failoverCount = 0;
        manager.on("failoverCompleted", (_completedFeedId, details) => {
          failoverCount++;
          if (failoverCount === 2) {
            // After both primary sources fail
            expect((details as any).backupSourcesActivated).toBeDefined();
            expect((details as any).backupSourcesActivated?.length).toBeGreaterThan(0);
            resolve();
          }
        });
      });

      // Fail both primary sources
      await manager.triggerFailover("binance", "Connection lost");
      await manager.triggerFailover("coinbase", "Connection lost");

      await failoverPromise;

      const activeSources = manager.getActiveSources(feedId);
      expect(activeSources.some(s => ["kraken", "okx"].includes(s.id))).toBe(true);
    });

    it("should emit failoverFailed when no backup sources available", async () => {
      // Disconnect all backup sources
      mockSources[2].simulateConnection(false); // kraken
      mockSources[3].simulateConnection(false); // okx

      const failoverFailedPromise = new Promise<void>(resolve => {
        manager.on("failoverFailed", (failedFeedId, details) => {
          expect(failedFeedId).toEqual(feedId);
          expect((details as any).reason).toContain("No healthy backup sources available");
          resolve();
        });
      });

      // Fail all primary sources
      await manager.triggerFailover("binance", "Connection lost");
      await manager.triggerFailover("coinbase", "Connection lost");

      await failoverFailedPromise;
    });

    it("should complete failover within time limit", async () => {
      const startTime = Date.now();

      await manager.triggerFailover("binance", "Connection lost");

      const failoverTime = Date.now() - startTime;
      expect(failoverTime).toBeLessThan(testConfig.maxFailoverTime! * 2); // Allow some margin
    });
  });

  describe("Source Recovery", () => {
    let mockSources: MockDataSource[];
    let feedId: CoreFeedId;

    beforeEach(() => {
      feedId = {
        category: FeedCategory.Crypto,
        name: "BTC/USD",
      };

      mockSources = [new MockDataSource("binance"), new MockDataSource("coinbase"), new MockDataSource("kraken")];

      mockSources.forEach(source => {
        manager.registerDataSource(source);
        source.simulateConnection(true);
      });

      manager.configureFailoverGroup(feedId, ["binance", "coinbase"], ["kraken"]);
    });

    it("should handle source recovery correctly", async () => {
      // First trigger failover
      await manager.triggerFailover("binance", "Connection lost");

      // Activate backup source
      await manager.triggerFailover("coinbase", "Connection lost");

      // Verify backup is active
      let activeSources = manager.getActiveSources(feedId);
      expect(activeSources.some(s => s.id === "kraken")).toBe(true);

      const recoveryPromise = new Promise<void>(resolve => {
        manager.on("sourceRecovered", (recoveredFeedId, details) => {
          expect(recoveredFeedId).toEqual(feedId);
          expect((details as any).recoveredSource).toBe("binance");
          expect((details as any).deactivatedBackups).toContain("kraken");
          resolve();
        });
      });

      // Simulate recovery by reconnecting multiple times to exceed recovery threshold
      for (let i = 0; i < testConfig.recoveryThreshold! + 1; i++) {
        mockSources[0].simulateConnection(true);
        // Add small delay to ensure proper processing
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      await recoveryPromise;

      // Verify primary source is back and backup is deactivated
      activeSources = manager.getActiveSources(feedId);
      expect(activeSources.some(s => s.id === "binance")).toBe(true);
      expect(activeSources.some(s => s.id === "kraken")).toBe(false);
    }, 10000);
  });

  describe("Health Monitoring", () => {
    let mockSources: MockDataSource[];

    beforeEach(() => {
      mockSources = [new MockDataSource("binance"), new MockDataSource("coinbase")];

      mockSources.forEach(source => {
        manager.registerDataSource(source);
        source.simulateConnection(true);
      });
    });

    it("should track source health correctly", () => {
      const healthStatus = manager.getSourceHealthStatus();

      expect(healthStatus.size).toBe(2);
      expect(healthStatus.get("binance")?.isHealthy).toBe(true);
      expect(healthStatus.get("coinbase")?.isHealthy).toBe(true);
    });

    it("should update health on connection changes", () => {
      // Simulate connection failure
      mockSources[0].simulateConnection(false);

      const healthStatus = manager.getSourceHealthStatus();
      const binanceHealth = healthStatus.get("binance");

      expect(binanceHealth?.consecutiveFailures).toBeGreaterThan(0);
    });

    it("should mark source as unhealthy after threshold failures", () => {
      // Simulate multiple connection failures
      for (let i = 0; i < testConfig.failureThreshold! + 1; i++) {
        mockSources[0].simulateConnection(false);
      }

      const healthStatus = manager.getSourceHealthStatus();
      expect(healthStatus.get("binance")?.isHealthy).toBe(false);
    });

    it("should mark source as healthy after recovery threshold", () => {
      // First make it unhealthy
      for (let i = 0; i < testConfig.failureThreshold! + 1; i++) {
        mockSources[0].simulateConnection(false);
      }

      // Then recover
      for (let i = 0; i < testConfig.recoveryThreshold! + 1; i++) {
        mockSources[0].simulateConnection(true);
      }

      const healthStatus = manager.getSourceHealthStatus();
      expect(healthStatus.get("binance")?.isHealthy).toBe(true);
    });
  });

  describe("Error Handling", () => {
    it("should handle errors in source subscription gracefully", async () => {
      const mockSource = new MockDataSource("test-source");

      // Mock subscribe to throw error
      jest.spyOn(mockSource, "subscribe").mockRejectedValue(new Error("Subscribe failed"));

      manager.registerDataSource(mockSource);
      mockSource.simulateConnection(true);

      const feedId: CoreFeedId = {
        category: FeedCategory.Crypto,
        name: "BTC/USD",
      };

      manager.configureFailoverGroup(feedId, ["test-source"], []);

      // Should not throw error
      await expect(manager.triggerFailover("test-source", "Test")).resolves.not.toThrow();
    });

    it("should handle errors in source unsubscription gracefully", async () => {
      const mockSource = new MockDataSource("primary");
      const mockBackup = new MockDataSource("backup");

      // Mock unsubscribe to throw error
      jest.spyOn(mockBackup, "unsubscribe").mockRejectedValue(new Error("Unsubscribe failed"));

      manager.registerDataSource(mockSource);
      manager.registerDataSource(mockBackup);
      mockSource.simulateConnection(true);
      mockBackup.simulateConnection(true);

      const feedId: CoreFeedId = {
        category: FeedCategory.Crypto,
        name: "BTC/USD",
      };

      manager.configureFailoverGroup(feedId, ["primary"], ["backup"]);

      // Trigger failover to activate backup
      await manager.triggerFailover("primary", "Test");

      // Then recover primary (should try to unsubscribe backup)
      for (let i = 0; i < testConfig.recoveryThreshold! + 1; i++) {
        mockSource.simulateConnection(true);
      }

      // Should handle the unsubscribe error gracefully
      // No assertion needed - just ensuring no unhandled errors
    });
  });

  describe("Configuration", () => {
    it("should use default configuration when none provided", () => {
      const defaultManager = new FailoverManager();

      // Access private config for testing
      const config = (defaultManager as any).config;

      expect(config.maxFailoverTime).toBe(100);
      expect(config.healthCheckInterval).toBe(5000);
      expect(config.failureThreshold).toBe(3);
      expect(config.recoveryThreshold).toBe(5);

      defaultManager.destroy();
    });

    it("should merge provided configuration with defaults", () => {
      // Since FailoverManager doesn't accept config in constructor,
      // we need to modify the config after creation
      const customManager = new FailoverManager();
      (customManager as any).config = {
        ...(customManager as any).config,
        maxFailoverTime: 50,
      };

      const config = (customManager as any).config;

      expect(config.maxFailoverTime).toBe(50);
      expect(config.healthCheckInterval).toBe(5000); // Should use default

      customManager.destroy();
    });
  });
});
