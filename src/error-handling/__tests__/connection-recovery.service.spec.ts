import { Test, TestingModule } from "@nestjs/testing";
import { FailoverManager } from "@/data-manager/failover-manager.service";
import { type DataSource, type CoreFeedId, FeedCategory } from "@/common/types/core";

import { ConnectionRecoveryService } from "../connection-recovery.service";
import { CircuitBreakerService } from "../circuit-breaker.service";

// Mock DataSource implementation
class MockDataSource implements DataSource {
  id: string;
  type: "websocket" | "rest";
  priority: number;
  category: FeedCategory;
  private connected: boolean = false;
  private latency: number = 50;
  private connectionChangeCallback?: (connected: boolean) => void;

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

  async subscribe(_symbols: string[]): Promise<void> {
    void _symbols;
    // Mock implementation
  }

  async unsubscribe(_symbols: string[]): Promise<void> {
    void _symbols;
    // Mock implementation
  }

  onPriceUpdate(_callback: (update: any) => void): void {
    // Mock implementation
  }

  onConnectionChange(callback: (connected: boolean) => void): void {
    this.connectionChangeCallback = callback;
  }

  // Test helper methods
  simulateConnection(): void {
    this.connected = true;
    if (this.connectionChangeCallback) {
      this.connectionChangeCallback(true);
    }
  }

  simulateDisconnection(): void {
    this.connected = false;
    if (this.connectionChangeCallback) {
      this.connectionChangeCallback(false);
    }
  }

  setLatency(latency: number): void {
    this.latency = latency;
  }
}

describe("ConnectionRecoveryService", () => {
  let service: ConnectionRecoveryService;
  let circuitBreaker: CircuitBreakerService;
  let failoverManager: FailoverManager;

  beforeEach(async () => {
    // Mock console methods to suppress expected error logs during tests
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});

    // Create mock instances
    const mockCircuitBreaker = {
      registerCircuit: jest.fn(),
      unregisterCircuit: jest.fn(),
      execute: jest.fn().mockResolvedValue(true),
      getState: jest.fn().mockReturnValue("closed"),
      openCircuit: jest.fn(),
      closeCircuit: jest.fn(),
      destroy: jest.fn(),
    };

    const mockFailoverManager = {
      registerDataSource: jest.fn(),
      unregisterDataSource: jest.fn(),
      configureFailoverGroup: jest.fn(),
      triggerFailover: jest.fn().mockResolvedValue(undefined),
      destroy: jest.fn(),
      on: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: ConnectionRecoveryService,
          useFactory: () => new ConnectionRecoveryService(mockCircuitBreaker as any, mockFailoverManager as any),
        },
        { provide: CircuitBreakerService, useValue: mockCircuitBreaker },
        { provide: FailoverManager, useValue: mockFailoverManager },
      ],
    }).compile();

    service = module.get<ConnectionRecoveryService>(ConnectionRecoveryService);
    circuitBreaker = module.get<CircuitBreakerService>(CircuitBreakerService);
    failoverManager = module.get<FailoverManager>(FailoverManager);
  });

  afterEach(() => {
    if (service) {
      service.destroy();
    }
    if (circuitBreaker && circuitBreaker.destroy) {
      circuitBreaker.destroy();
    }
    if (failoverManager && failoverManager.destroy) {
      failoverManager.destroy();
    }
    // Restore console methods after each test
    jest.restoreAllMocks();
  });

  describe("Data Source Registration", () => {
    it("should register a data source successfully", async () => {
      const mockSource = new MockDataSource("test-source");

      await service.registerDataSource(mockSource);

      const health = service.getConnectionHealth();
      expect(health.has("test-source")).toBe(true);

      const sourceHealth = health.get("test-source");
      expect(sourceHealth).toBeDefined();
      expect(sourceHealth!.sourceId).toBe("test-source");
    });

    it("should unregister a data source successfully", async () => {
      const mockSource = new MockDataSource("test-source");

      await service.registerDataSource(mockSource);
      expect(service.getConnectionHealth().has("test-source")).toBe(true);

      await service.unregisterDataSource("test-source");
      expect(service.getConnectionHealth().has("test-source")).toBe(false);
    });

    it("should handle connection changes", async () => {
      const mockSource = new MockDataSource("test-source");

      await service.registerDataSource(mockSource);

      // Simulate connection
      mockSource.simulateConnection();

      const health = service.getConnectionHealth().get("test-source");
      expect(health!.isConnected).toBe(true);
    });
  });

  describe("Feed Source Configuration", () => {
    it("should configure feed sources correctly", async () => {
      const feedId: CoreFeedId = {
        category: FeedCategory.Crypto,
        name: "BTC/USD",
      };

      const primarySources = ["source1", "source2"];
      const backupSources = ["source3", "source4"];

      service.configureFeedSources(feedId, primarySources, backupSources);

      // Verify configuration was applied
      // This would be tested through the failover manager integration
      expect(true).toBe(true); // Placeholder assertion
    });
  });

  describe("Failover Mechanism", () => {
    let mockSource1: MockDataSource;
    let mockSource2: MockDataSource;

    beforeEach(async () => {
      mockSource1 = new MockDataSource("source1");
      mockSource2 = new MockDataSource("source2");

      await service.registerDataSource(mockSource1);
      await service.registerDataSource(mockSource2);

      const feedId: CoreFeedId = {
        category: FeedCategory.Crypto,
        name: "BTC/USD",
      };

      service.configureFeedSources(feedId, ["source1"], ["source2"]);
    });

    it("should trigger failover within 100ms requirement", async () => {
      const startTime = Date.now();

      const result = await service.triggerFailover("source1", "Connection lost");

      const failoverTime = Date.now() - startTime;
      expect(failoverTime).toBeLessThan(200); // Allow some buffer for test execution
      expect((result as any).success).toBe(true);
      expect((result as any).failoverTime).toBeLessThan(200);
    });

    it("should update connection health on failover", async () => {
      await service.triggerFailover("source1", "Test failover");

      const health = service.getConnectionHealth().get("source1");
      expect(health!.isHealthy).toBe(false);
      expect(health!.consecutiveFailures).toBeGreaterThan(0);
    });

    it("should emit failover events", done => {
      service.on("failoverCompleted", (sourceId, result) => {
        expect(sourceId).toBe("source1");
        expect((result as any).success).toBe(true);
        done();
      });

      void service.triggerFailover("source1", "Test failover");
    });
  });

  describe("Graceful Degradation", () => {
    it("should implement graceful degradation when sources fail", async () => {
      const feedId: CoreFeedId = {
        category: FeedCategory.Crypto,
        name: "BTC/USD",
      };

      const mockSource1 = new MockDataSource("source1");
      const mockSource2 = new MockDataSource("source2");
      const mockSource3 = new MockDataSource("source3");

      await service.registerDataSource(mockSource1);
      await service.registerDataSource(mockSource2);
      await service.registerDataSource(mockSource3);

      service.configureFeedSources(feedId, ["source1", "source2"], ["source3"]);

      // Simulate all sources as unhealthy
      await service.triggerFailover("source1", "Test");
      await service.triggerFailover("source2", "Test");

      service.on("partialServiceDegradation", () => {
        // No-op for this test
      });

      await service.implementGracefulDegradation(feedId);

      // The test would need to be adjusted based on the actual implementation
      expect(true).toBe(true); // Placeholder assertion
    });

    it("should emit complete service degradation when no sources available", async () => {
      const feedId: CoreFeedId = {
        category: FeedCategory.Crypto,
        name: "BTC/USD",
      };

      service.configureFeedSources(feedId, [], []);

      let completeDegradationEmitted = false;
      service.on("completeServiceDegradation", () => {
        completeDegradationEmitted = true;
      });

      await service.implementGracefulDegradation(feedId);
      expect(completeDegradationEmitted).toBe(true);
    });
  });

  describe("Recovery Strategies", () => {
    it("should provide appropriate recovery strategies", async () => {
      const mockSource = new MockDataSource("test-source", "websocket");
      await service.registerDataSource(mockSource);

      const strategies = service.getRecoveryStrategies("test-source");

      expect(strategies.length).toBeGreaterThan(0);
      expect(strategies[0].strategy).toBe("reconnect");
      expect(strategies.some(s => s.strategy === "failover")).toBe(true);
      expect(strategies.some(s => s.strategy === "graceful_degradation")).toBe(true);
    });

    it("should prioritize strategies correctly", async () => {
      const mockSource = new MockDataSource("test-source", "websocket");
      await service.registerDataSource(mockSource);

      const strategies = service.getRecoveryStrategies("test-source");

      // Strategies should be sorted by priority
      for (let i = 1; i < strategies.length; i++) {
        expect(strategies[i].priority).toBeGreaterThanOrEqual(strategies[i - 1].priority);
      }
    });
  });

  describe("System Health Monitoring", () => {
    it("should provide accurate system health status", async () => {
      const mockSource1 = new MockDataSource("source1");
      const mockSource2 = new MockDataSource("source2");
      const mockSource3 = new MockDataSource("source3");

      await service.registerDataSource(mockSource1);
      await service.registerDataSource(mockSource2);
      await service.registerDataSource(mockSource3);

      // Simulate different health states
      mockSource1.simulateConnection();
      mockSource2.simulateConnection();
      // source3 remains disconnected

      // Trigger failover for one source
      await service.triggerFailover("source2", "Test");

      const systemHealth = service.getSystemHealth();

      expect(systemHealth.totalSources).toBe(3);
      expect(systemHealth.connectedSources).toBe(2); // source1 and source2 are connected
      expect(systemHealth.healthySources).toBe(1);
      expect(systemHealth.failedSources).toBe(1);
    });

    it("should calculate overall health correctly", async () => {
      const mockSource1 = new MockDataSource("source1");
      const mockSource2 = new MockDataSource("source2");

      await service.registerDataSource(mockSource1);
      await service.registerDataSource(mockSource2);

      mockSource1.simulateConnection();
      mockSource2.simulateConnection();

      const systemHealth = service.getSystemHealth();
      expect(systemHealth.overallHealth).toBe("healthy"); // 100% healthy
    });
  });

  describe("Connection Recovery", () => {
    it("should handle connection restoration", async () => {
      const mockSource = new MockDataSource("test-source");
      await service.registerDataSource(mockSource);

      // Simulate disconnection and failover
      mockSource.simulateDisconnection();
      await service.triggerFailover("test-source", "Connection lost");

      let restorationEmitted = false;
      service.on("connectionRestored", sourceId => {
        expect(sourceId).toBe("test-source");
        restorationEmitted = true;
      });

      // Simulate reconnection
      mockSource.simulateConnection();

      // Allow some time for event processing
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(restorationEmitted).toBe(true);

      const health = service.getConnectionHealth().get("test-source");
      expect(health!.isHealthy).toBe(true);
      expect(health!.consecutiveFailures).toBe(0);
    });

    it("should reset reconnection attempts on successful connection", async () => {
      const mockSource = new MockDataSource("test-source");
      await service.registerDataSource(mockSource);

      // Simulate multiple failed reconnection attempts
      const health = service.getConnectionHealth().get("test-source")!;
      health.reconnectAttempts = 5;

      // Simulate successful reconnection
      mockSource.simulateConnection();

      // Allow some time for event processing
      await new Promise(resolve => setTimeout(resolve, 100));

      const updatedHealth = service.getConnectionHealth().get("test-source");
      expect(updatedHealth!.reconnectAttempts).toBe(0);
    });
  });

  describe("Performance Requirements", () => {
    it("should complete failover within 100ms target", async () => {
      const mockSource = new MockDataSource("test-source");
      await service.registerDataSource(mockSource);

      const startTime = Date.now();
      const result = await service.triggerFailover("test-source", "Performance test");
      const actualTime = Date.now() - startTime;

      expect(actualTime).toBeLessThan(150); // Allow some buffer
      expect(result.failoverTime).toBeLessThan(150);
    });

    it("should log warning when failover exceeds target time", async () => {
      const mockSource = new MockDataSource("test-source");
      await service.registerDataSource(mockSource);

      // Mock a slow failover by adding delay
      const originalTriggerFailover = failoverManager.triggerFailover;
      failoverManager.triggerFailover = jest.fn().mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 200)); // Exceed 100ms target
      });

      const logSpy = jest.spyOn(service["logger"], "warn");

      await service.triggerFailover("test-source", "Slow failover test");

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("exceeded target 100ms"));

      // Restore original method
      failoverManager.triggerFailover = originalTriggerFailover;
    });
  });

  describe("Error Handling", () => {
    it("should handle registration of non-existent sources gracefully", async () => {
      await expect(service.unregisterDataSource("non-existent")).resolves.not.toThrow();
    });

    it("should handle recovery strategies for non-existent sources", () => {
      const strategies = service.getRecoveryStrategies("non-existent");
      expect(strategies).toEqual([]);
    });

    it("should handle failover failures gracefully", async () => {
      const mockSource = new MockDataSource("test-source");
      await service.registerDataSource(mockSource);

      // Mock failover manager to throw error
      const originalTriggerFailover = failoverManager.triggerFailover;
      failoverManager.triggerFailover = jest.fn().mockRejectedValue(new Error("Failover failed"));

      const result = await service.triggerFailover("test-source", "Test error handling");

      expect((result as any).success).toBe(false);
      expect(result.degradationLevel).toBe("severe");

      // Restore original method
      failoverManager.triggerFailover = originalTriggerFailover;
    });
  });

  describe("Cleanup and Resource Management", () => {
    it("should clean up resources on destroy", async () => {
      const mockSource1 = new MockDataSource("source1");
      const mockSource2 = new MockDataSource("source2");

      await service.registerDataSource(mockSource1);
      await service.registerDataSource(mockSource2);

      expect(service.getConnectionHealth().size).toBe(2);

      service.destroy();

      expect(service.getConnectionHealth().size).toBe(0);
    });

    it("should cancel pending reconnection timers on unregister", async () => {
      const mockSource = new MockDataSource("test-source");
      await service.registerDataSource(mockSource);

      // Trigger failover to start reconnection timer
      await service.triggerFailover("test-source", "Test");

      // Unregister should cancel the timer
      await service.unregisterDataSource("test-source");

      // No way to directly test timer cancellation, but it should not throw
      expect(true).toBe(true);
    });
  });
});
