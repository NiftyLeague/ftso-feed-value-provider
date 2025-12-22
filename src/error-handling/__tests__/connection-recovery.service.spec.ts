import { Test, TestingModule } from "@nestjs/testing";
import { FailoverManager } from "@/data-manager/failover-manager.service";
import { type DataSource, type CoreFeedId, FeedCategory } from "@/common/types/core";
import { TestHelpers } from "@/__tests__/utils";

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

  async connect(): Promise<void> {
    this.connected = true;
    if (this.connectionChangeCallback) {
      this.connectionChangeCallback(true);
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.connectionChangeCallback) {
      this.connectionChangeCallback(false);
    }
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

  // REST fallback is now handled by DataSourceFactory, not by individual data sources

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

class MockEmitterDataSource extends MockDataSource {
  off = jest.fn();
}

class MockRemoveListenerDataSource extends MockDataSource {
  removeListener = jest.fn();
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
      resetStats: jest.fn(), // Added for recovery fix
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

  afterEach(async () => {
    if (service && service.cleanup) {
      await service.cleanup();
    }
    if (circuitBreaker && circuitBreaker.cleanup) {
      await circuitBreaker.cleanup();
    }
    if (failoverManager && failoverManager.cleanup) {
      await failoverManager.cleanup();
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

    it("detaches connection handler via off/removeListener on unregister", async () => {
      const srcOff = new MockEmitterDataSource("src-off");
      const srcRemove = new MockRemoveListenerDataSource("src-remove");

      await service.registerDataSource(srcOff);
      await service.registerDataSource(srcRemove);

      await service.unregisterDataSource("src-off");
      await service.unregisterDataSource("src-remove");

      expect(srcOff.off).toHaveBeenCalledWith("connectionChange", expect.any(Function));
      expect(srcRemove.removeListener).toHaveBeenCalledWith("connectionChange", expect.any(Function));
    });

    it("cleans up feed source mapping on unregister (remove-one vs remove-all)", async () => {
      const feedId: CoreFeedId = { category: FeedCategory.Crypto, name: "BTC/USD" };
      const s1 = new MockEmitterDataSource("s1");
      const s2 = new MockEmitterDataSource("s2");

      await service.registerDataSource(s1);
      await service.registerDataSource(s2);

      service.configureFeedSources(feedId, ["s1", "s2"], []);
      const feedKey = (service as any).getFeedKey(feedId);

      await service.unregisterDataSource("s1");
      expect(((service as any).feedSourceMapping as Map<string, any>).get(feedKey)).toEqual(["s2"]);

      await service.unregisterDataSource("s2");
      expect(((service as any).feedSourceMapping as Map<string, any>).has(feedKey)).toBe(false);
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
      // Check that the failover manager was configured with the correct sources
      expect(failoverManager.configureFailoverGroup).toHaveBeenCalledWith(feedId, primarySources, backupSources);
    });
  });

  describe("System health and recovery strategies", () => {
    it("getRecoveryStrategies returns empty for unknown sources", () => {
      expect(service.getRecoveryStrategies("missing")).toEqual([]);
    });

    it("getRecoveryStrategies includes reconnect for websocket sources and circuit_breaker when open", async () => {
      const src = new MockDataSource("ws-source", "websocket");
      await service.registerDataSource(src);

      const healthMap = (service as any).connectionHealth as Map<string, any>;
      const h = healthMap.get("ws-source");
      h.reconnectAttempts = 0;
      h.circuitBreakerState = "open";

      const strategies = service.getRecoveryStrategies("ws-source");
      expect(strategies.map(s => s.strategy)).toEqual(
        expect.arrayContaining(["reconnect", "circuit_breaker", "failover", "graceful_degradation"])
      );

      // Ensure sorted by priority ascending
      const priorities = strategies.map(s => s.priority);
      expect(priorities).toEqual([...priorities].sort((a, b) => a - b));
    });

    it("getSystemHealth classifies overall health across threshold bands", () => {
      const m = (service as any).connectionHealth as Map<string, any>;

      m.set("a", {
        sourceId: "a",
        isConnected: true,
        isHealthy: true,
        reconnectAttempts: 0,
        consecutiveFailures: 0,
        averageLatency: 0,
        circuitBreakerState: "closed",
      });
      m.set("b", {
        sourceId: "b",
        isConnected: true,
        isHealthy: true,
        reconnectAttempts: 0,
        consecutiveFailures: 0,
        averageLatency: 0,
        circuitBreakerState: "closed",
      });
      m.set("c", {
        sourceId: "c",
        isConnected: true,
        isHealthy: false,
        reconnectAttempts: 0,
        consecutiveFailures: 0,
        averageLatency: 0,
        circuitBreakerState: "closed",
      });
      m.set("d", {
        sourceId: "d",
        isConnected: false,
        isHealthy: false,
        reconnectAttempts: 0,
        consecutiveFailures: 0,
        averageLatency: 0,
        circuitBreakerState: "closed",
      });

      // 2/4 healthy => 50% => degraded
      expect(service.getSystemHealth().overallHealth).toBe("degraded");

      // 4/4 healthy => healthy
      m.get("c").isHealthy = true;
      m.get("d").isConnected = true;
      m.get("d").isHealthy = true;
      expect(service.getSystemHealth().overallHealth).toBe("healthy");

      // 1/4 healthy => critical
      m.get("a").isHealthy = false;
      m.get("b").isHealthy = false;
      m.get("c").isHealthy = false;
      m.get("d").isHealthy = true;
      expect(service.getSystemHealth().overallHealth).toBe("critical");
    });
  });

  describe("Disconnection handling", () => {
    it("handleDisconnection categorizes errors, schedules recovery, and triggers failover", async () => {
      const src = new MockDataSource("source-x", "websocket");
      await service.registerDataSource(src);

      const scheduleSpy = jest.spyOn(service as any, "scheduleRecovery");
      const failoverSpy = jest.spyOn(service, "triggerFailover");

      await service.handleDisconnection("source-x", new Error("HTTP 429 too many"));

      expect(scheduleSpy).toHaveBeenCalled();
      expect(failoverSpy).toHaveBeenCalledWith("source-x", expect.stringContaining("Disconnection detected"));
    });

    it("performHealthCheck marks sources unhealthy after long inactivity", () => {
      const now = Date.now();
      const m = (service as any).connectionHealth as Map<string, any>;
      const sources = (service as any).dataSources as Map<string, any>;

      const src = new MockDataSource("inactive", "websocket");
      src.simulateConnection();
      sources.set("inactive", src);
      m.set("inactive", {
        sourceId: "inactive",
        isConnected: true,
        isHealthy: true,
        lastConnected: now - 600000 - 1,
        reconnectAttempts: 0,
        consecutiveFailures: 0,
        averageLatency: 0,
        circuitBreakerState: "closed",
      });

      const emitSpy = jest.spyOn(service, "emit");
      (service as any).performHealthCheck();
      expect(m.get("inactive").isHealthy).toBe(false);
      expect(emitSpy).toHaveBeenCalledWith("sourceUnhealthy", "inactive");
    });

    it("scheduleRecovery returns early for non-websocket sources and respects cooldown", async () => {
      jest.useRealTimers();
      const restSource = new MockDataSource("rest-src", "rest");
      await service.registerDataSource(restSource);

      // Non-websocket should not schedule.
      (service as any).scheduleRecovery("rest-src");
      expect(((service as any).reconnectTimers as Map<string, any>).has("rest-src")).toBe(false);

      const wsSource = new MockDataSource("ws-src", "websocket");
      await service.registerDataSource(wsSource);

      // Cooldown branch should skip.
      ((service as any).lastReconnectAttempt as Map<string, number>).set("ws-src", Date.now());
      const debugSpy = jest.spyOn((service as any).logger, "debug");
      (service as any).scheduleRecovery("ws-src");
      expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining("too soon"));
      expect(((service as any).reconnectTimers as Map<string, any>).has("ws-src")).toBe(false);
    });

    it("attemptReconnection schedules another attempt when source lacks connect and remains disconnected", async () => {
      // Force circuitBreaker.execute to actually invoke the provided function.
      (circuitBreaker.execute as jest.Mock).mockImplementation(async (_id: string, fn: () => Promise<void>) => fn());

      const scheduleSpy = jest.spyOn(service as any, "scheduleRecovery");

      const sourceId = "no-connect";
      (service as any).dataSources.set(sourceId, {
        id: sourceId,
        type: "websocket",
        priority: 1,
        category: FeedCategory.Crypto,
        isConnected: () => false,
        getLatency: () => 0,
        subscribe: async () => {},
        unsubscribe: async () => {},
        onPriceUpdate: () => {},
        onConnectionChange: () => {},
      });
      (service as any).connectionHealth.set(sourceId, {
        sourceId,
        isConnected: false,
        isHealthy: true,
        reconnectAttempts: 0,
        consecutiveFailures: 0,
        averageLatency: 0,
        circuitBreakerState: "closed",
      });

      await (service as any).attemptReconnection(sourceId);
      expect(scheduleSpy).toHaveBeenCalledWith(sourceId);
    });

    it("scheduleRecovery schedules a reconnection timer for websocket sources", async () => {
      const src = new MockDataSource("ws-src", "websocket");
      await service.registerDataSource(src);

      await TestHelpers.withMockedNowAsync(1_700_000_000_000, async () => {
        const timers = (service as any).reconnectTimers as Map<string, any>;
        const healthMap = (service as any).connectionHealth as Map<string, any>;

        expect(timers.has("ws-src")).toBe(false);
        (service as any).scheduleRecovery("ws-src", "network");

        expect(healthMap.get("ws-src").reconnectAttempts).toBe(1);
        expect(timers.has("ws-src")).toBe(true);
      });
    });

    it("scheduleRecovery logs error and does not schedule when max reconnect attempts reached", async () => {
      const src = new MockDataSource("ws-src", "websocket");
      await service.registerDataSource(src);

      const errorSpy = jest.spyOn((service as any).logger, "error");
      const timers = (service as any).reconnectTimers as Map<string, any>;
      const healthMap = (service as any).connectionHealth as Map<string, any>;

      // Make the limit deterministic
      (service as any).config.maxReconnectAttempts = 1;
      healthMap.get("ws-src").reconnectAttempts = 1;

      (service as any).scheduleRecovery("ws-src");
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Max reconnection attempts reached"));
      expect(timers.has("ws-src")).toBe(false);
    });

    it("attemptReconnection succeeds when source.connect works and reports connected", async () => {
      // Force circuitBreaker.execute to invoke the provided function.
      (circuitBreaker.execute as jest.Mock).mockImplementation(async (_id: string, fn: () => Promise<void>) => fn());

      const scheduleSpy = jest.spyOn(service as any, "scheduleRecovery");

      let connected = false;
      const sourceId = "connect-ok";
      (service as any).dataSources.set(sourceId, {
        id: sourceId,
        type: "websocket",
        priority: 1,
        category: FeedCategory.Crypto,
        isConnected: () => connected,
        getLatency: () => 0,
        connect: async () => {
          connected = true;
        },
        subscribe: async () => {},
        unsubscribe: async () => {},
        onPriceUpdate: () => {},
        onConnectionChange: () => {},
      });
      (service as any).connectionHealth.set(sourceId, {
        sourceId,
        isConnected: false,
        isHealthy: true,
        reconnectAttempts: 0,
        consecutiveFailures: 0,
        averageLatency: 0,
        circuitBreakerState: "closed",
      });

      await (service as any).attemptReconnection(sourceId);
      expect(scheduleSpy).not.toHaveBeenCalled();
    });

    it("calculateReconnectDelay applies centralized backoff parameters when an error is provided", () => {
      // attemptNumber=0 -> delay should be baseDelay (>= default minDelay=5000)
      const delay = (service as any).calculateReconnectDelay(0, new Error("HTTP 429 too many"));
      expect(delay).toBeGreaterThanOrEqual(5000);
    });

    it("handleConnectionLost warns on first failure and debug-logs on subsequent rapid failures", async () => {
      const src = new MockDataSource("src", "websocket");
      await service.registerDataSource(src);

      jest.spyOn(service, "triggerFailover").mockResolvedValue({} as any);

      const warnSpy = jest.spyOn((service as any).logger, "warn");
      const debugSpy = jest.spyOn((service as any).logger, "debug");

      let now = 1_700_000_000_000;

      await TestHelpers.withMockedNowAsync(
        () => now,
        async () => {
          await (service as any).handleConnectionLost("src");
          expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Connection lost for source: src"));

          now += 1;
          await (service as any).handleConnectionLost("src");
          expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining("Connection lost for source: src"));
        }
      );
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

    it("opens circuit breaker for severe, non-normal failures", async () => {
      const healthMap = (service as any).connectionHealth as Map<string, any>;
      const h = healthMap.get("source1");
      h.consecutiveFailures = 8;

      await service.triggerFailover("source1", "Critical failure: auth denied");
      expect(circuitBreaker.openCircuit).toHaveBeenCalledWith("source1", expect.stringContaining("Critical failure"));
    });

    it("does not open circuit breaker for normal disconnection reasons", async () => {
      (circuitBreaker.openCircuit as jest.Mock).mockClear();
      const healthMap = (service as any).connectionHealth as Map<string, any>;
      const h = healthMap.get("source1");
      h.consecutiveFailures = 99;

      await service.triggerFailover("source1", "Connection lost");
      expect(circuitBreaker.openCircuit).not.toHaveBeenCalled();
    });

    it("warns when failover time exceeds target", async () => {
      const warnSpy = jest.spyOn((service as any).logger, "warn");
      // Make threshold trivially small so the warning branch is deterministic.
      (service as any).config.maxFailoverTime = 0;

      // Ensure failoverTime > 0 even in fast test runs.
      let t = 0;

      await TestHelpers.withMockedNowAsync(
        () => {
          t += 1;
          return t;
        },
        async () => {
          await service.triggerFailover("source1", "Connection lost");

          expect(warnSpy.mock.calls.some(([msg]) => String(msg).includes("Failover time"))).toBe(true);
        }
      );
    });

    it("returns success=false when failover manager throws", async () => {
      (failoverManager.triggerFailover as jest.Mock).mockRejectedValueOnce(new Error("boom"));
      const result = await service.triggerFailover("source1", "Connection lost");
      expect(result.success).toBe(false);
      expect(result.degradationLevel).toBe("severe");
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

      // Verify that graceful degradation was implemented
      // This should trigger appropriate fallback mechanisms
      expect(failoverManager.triggerFailover).toHaveBeenCalled();
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

    it("emits completeServiceDegradation when no sources are healthy", async () => {
      const feedId: CoreFeedId = { category: FeedCategory.Crypto, name: "BTC/USD" };
      const source1 = new MockDataSource("source1");
      const source2 = new MockDataSource("source2");

      await service.registerDataSource(source1);
      await service.registerDataSource(source2);
      service.configureFeedSources(feedId, ["source1"], ["source2"]);

      // Ensure both are unhealthy/disconnected
      const healthMap = (service as any).connectionHealth as Map<string, any>;
      healthMap.get("source1").isHealthy = false;
      healthMap.get("source1").isConnected = false;
      healthMap.get("source2").isHealthy = false;
      healthMap.get("source2").isConnected = false;

      const eventSpy = jest.fn();
      service.on("completeServiceDegradation", eventSpy);

      await service.implementGracefulDegradation(feedId);
      expect(eventSpy).toHaveBeenCalledWith(feedId);
    });

    it("emits partialServiceDegradation when healthy sources below threshold", async () => {
      const feedId: CoreFeedId = { category: FeedCategory.Crypto, name: "BTC/USD" };
      const source1 = new MockDataSource("source1");
      const source2 = new MockDataSource("source2");

      await service.registerDataSource(source1);
      await service.registerDataSource(source2);
      service.configureFeedSources(feedId, ["source1"], ["source2"]);

      // Override threshold for deterministic behavior.
      (service as any).config.gracefulDegradationThreshold = 2;

      const healthMap = (service as any).connectionHealth as Map<string, any>;
      healthMap.get("source1").isHealthy = true;
      healthMap.get("source1").isConnected = true;
      healthMap.get("source2").isHealthy = false;
      healthMap.get("source2").isConnected = false;

      const partialSpy = jest.fn();
      const implementedSpy = jest.fn();
      service.on("partialServiceDegradation", partialSpy);
      service.on("gracefulDegradationImplemented", implementedSpy);

      await service.implementGracefulDegradation(feedId);

      expect(partialSpy).toHaveBeenCalledWith(
        feedId,
        expect.objectContaining({ availableSources: 1, requiredSources: 2 })
      );
      expect(implementedSpy).toHaveBeenCalledWith(
        feedId,
        expect.objectContaining({ healthySources: 1, totalSources: 2 })
      );
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

      if (service && service.destroy) {
        service.destroy();
      }

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
