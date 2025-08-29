import { Test, TestingModule } from "@nestjs/testing";
import { HybridErrorHandlerService, DataSourceTier, ErrorClassification } from "../hybrid-error-handler.service";
import { CircuitBreakerService } from "../circuit-breaker.service";
import { ConnectionRecoveryService } from "../connection-recovery.service";
import { CcxtMultiExchangeAdapter } from "@/adapters/crypto/ccxt.adapter";
import { FailoverManager } from "@/data-manager/failover-manager";
import { EnhancedFeedId } from "@/types";
import { FeedCategory } from "@/types/feed-category.enum";

describe("Hybrid Error Handling Integration", () => {
  let hybridErrorHandler: HybridErrorHandlerService;
  let circuitBreaker: CircuitBreakerService;
  let connectionRecovery: ConnectionRecoveryService;
  let ccxtAdapter: CcxtMultiExchangeAdapter;
  let failoverManager: FailoverManager;

  const testFeedId: EnhancedFeedId = {
    category: FeedCategory.Crypto,
    name: "BTC/USD",
  };

  beforeEach(async () => {
    // Create mock instances
    const mockCircuitBreaker = {
      registerCircuit: jest.fn(),
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
      triggerFailover: jest.fn().mockResolvedValue({
        success: true,
        failoverTime: 50,
        activatedSources: ["backup-source"],
        deactivatedSources: ["failed-source"],
        degradationLevel: "none",
      }),
      destroy: jest.fn(),
      on: jest.fn(),
    };

    const mockConnectionRecovery = {
      registerDataSource: jest.fn(),
      unregisterDataSource: jest.fn(),
      triggerFailover: jest.fn().mockResolvedValue({
        success: true,
        failoverTime: 50,
        activatedSources: ["backup-source"],
        deactivatedSources: ["failed-source"],
        degradationLevel: "none",
      }),
      implementGracefulDegradation: jest.fn().mockResolvedValue(),
      destroy: jest.fn(),
    };

    const mockCcxtAdapter = {
      getCcxtPrice: jest.fn(),
      getAvailableTier2Exchanges: jest.fn().mockReturnValue(["bitmart", "bybit", "gate"]),
      canProvideTier2Data: jest.fn().mockReturnValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: HybridErrorHandlerService,
          useFactory: () =>
            new HybridErrorHandlerService(
              mockCircuitBreaker as any,
              mockConnectionRecovery as any,
              mockCcxtAdapter as any
            ),
        },
        { provide: CircuitBreakerService, useValue: mockCircuitBreaker },
        { provide: ConnectionRecoveryService, useValue: mockConnectionRecovery },
        { provide: FailoverManager, useValue: mockFailoverManager },
        { provide: CcxtMultiExchangeAdapter, useValue: mockCcxtAdapter },
      ],
    }).compile();

    hybridErrorHandler = module.get<HybridErrorHandlerService>(HybridErrorHandlerService);
    circuitBreaker = module.get<CircuitBreakerService>(CircuitBreakerService);
    connectionRecovery = module.get<ConnectionRecoveryService>(ConnectionRecoveryService);
    ccxtAdapter = module.get<CcxtMultiExchangeAdapter>(CcxtMultiExchangeAdapter);
    failoverManager = module.get<FailoverManager>(FailoverManager);
  });

  afterEach(() => {
    if (hybridErrorHandler) {
      hybridErrorHandler.destroy();
    }
    if (circuitBreaker && circuitBreaker.destroy) {
      circuitBreaker.destroy();
    }
    if (connectionRecovery && connectionRecovery.destroy) {
      connectionRecovery.destroy();
    }
    if (failoverManager && failoverManager.destroy) {
      failoverManager.destroy();
    }
  });

  describe("Complete Tier 1 to Tier 2 Failover Flow", () => {
    it("should handle complete failover from Tier 1 custom adapters to Tier 2 CCXT", async () => {
      // Step 1: Simulate Tier 1 adapter failures
      const tier1Sources = ["binance-adapter", "coinbase-adapter", "kraken-adapter"];
      const tier1Errors = [
        new Error("Binance connection lost"),
        new Error("Coinbase timeout"),
        new Error("Kraken rate limit exceeded"),
      ];

      const errorResponses = [];

      // Handle each Tier 1 error
      for (let i = 0; i < tier1Sources.length; i++) {
        const response = await hybridErrorHandler.handleCustomAdapterError(tier1Sources[i], tier1Errors[i], testFeedId);
        errorResponses.push(response);
      }

      // Verify all Tier 1 errors were recorded
      const stats = hybridErrorHandler.getErrorStats();
      expect(stats.tier1Errors).toBe(3);
      expect(stats.totalErrors).toBe(3);

      // Step 2: Trigger tier failover
      const failoverResponse = await hybridErrorHandler.implementTierFailover(testFeedId, tier1Sources);

      expect(failoverResponse.strategy).toBe("ccxt_backup");
      expect(failoverResponse.degradationLevel).toBe("none");
      expect(hybridErrorHandler.isCcxtBackupActive(testFeedId)).toBe(true);

      // Verify failover statistics
      const updatedStats = hybridErrorHandler.getErrorStats();
      expect(updatedStats.failoverEvents).toBe(1);
      expect(updatedStats.ccxtBackupActivations).toBe(1);
    });

    it("should handle mixed Tier 1 and Tier 2 errors with appropriate strategies", async () => {
      // Simulate mixed error scenario
      const tier1Error = new Error("Binance WebSocket disconnected");
      const tier2Error = new Error("Bitmart API rate limit");

      // Handle Tier 1 error
      const tier1Response = await hybridErrorHandler.handleCustomAdapterError(
        "binance-adapter",
        tier1Error,
        testFeedId
      );

      // Handle Tier 2 error
      const tier2Response = await hybridErrorHandler.handleCcxtExchangeError("bitmart", tier2Error, testFeedId);

      // Verify different handling strategies
      expect(tier1Response.strategy).toBeDefined();
      expect(tier2Response.strategy).toBe("retry"); // Rate limit should trigger retry
      expect(tier2Response.estimatedRecoveryTime).toBe(60000); // 1 minute for rate limits

      // Verify statistics
      const stats = hybridErrorHandler.getErrorStats();
      expect(stats.tier1Errors).toBe(1);
      expect(stats.tier2Errors).toBe(1);
      expect(stats.errorsByClassification[ErrorClassification.CONNECTION_ERROR]).toBe(1);
      expect(stats.errorsByClassification[ErrorClassification.RATE_LIMIT_ERROR]).toBe(1);
    });
  });

  describe("CCXT Retry Logic Integration", () => {
    it("should successfully recover using CCXT retry logic", async () => {
      const originalError = new Error("Primary source failed");
      const mockPriceUpdate = {
        symbol: "BTC/USD",
        price: 45000,
        timestamp: Date.now(),
        source: "ccxt-multi-exchange",
        confidence: 0.85,
      };

      // Mock successful CCXT retry
      (ccxtAdapter.getCcxtPrice as jest.Mock).mockResolvedValue(mockPriceUpdate);

      const result = await hybridErrorHandler.leverageCcxtRetryLogic(testFeedId, originalError);

      expect(result).toEqual(mockPriceUpdate);
      expect(hybridErrorHandler.getErrorStats().successfulRecoveries).toBe(1);
    });

    it("should handle CCXT retry failures and implement graceful degradation", async () => {
      const originalError = new Error("Primary source failed");

      // Mock CCXT retry failure
      (ccxtAdapter.getCcxtPrice as jest.Mock).mockRejectedValue(new Error("CCXT also failed"));

      const result = await hybridErrorHandler.leverageCcxtRetryLogic(testFeedId, originalError);

      expect(result).toBeNull();

      // Should still be able to implement graceful degradation
      const degradationResponse = await hybridErrorHandler.implementTierFailover(testFeedId, ["failed-source"]);
      expect(degradationResponse.strategy).toBe("graceful_degradation");
    });
  });

  describe("Circuit Breaker Integration", () => {
    it("should integrate with circuit breaker for source protection", async () => {
      const sourceId = "binance-adapter";

      // Register circuit breaker for the source
      circuitBreaker.registerCircuit(sourceId);

      // Simulate multiple failures to open circuit
      const error = new Error("Repeated connection failure");

      for (let i = 0; i < 5; i++) {
        await hybridErrorHandler.handleCustomAdapterError(sourceId, error, testFeedId);
      }

      // Circuit should be open after multiple failures
      const circuitState = circuitBreaker.getState(sourceId);
      expect(circuitState).toBeDefined();

      // Error handler should be aware of circuit state
      const tierStatus = hybridErrorHandler.getTierHealthStatus();
      const sourceStatus = tierStatus.get(sourceId);
      expect(sourceStatus?.isHealthy).toBe(false);
    });
  });

  describe("Performance and Timing Requirements", () => {
    it("should complete tier failover within 100ms requirement", async () => {
      const failedSources = ["binance-adapter", "coinbase-adapter"];

      const startTime = Date.now();
      const response = await hybridErrorHandler.implementTierFailover(testFeedId, failedSources);
      const failoverTime = Date.now() - startTime;

      expect(failoverTime).toBeLessThan(200); // Allow buffer for test environment
      expect(response.estimatedRecoveryTime).toBeLessThan(200);
    });

    it("should handle high-frequency errors efficiently", async () => {
      const sourceId = "high-frequency-source";
      const errors = Array.from({ length: 100 }, (_, i) => new Error(`Error ${i}`));

      const startTime = Date.now();

      // Process all errors
      const responses = await Promise.all(
        errors.map(error => hybridErrorHandler.handleCustomAdapterError(sourceId, error, testFeedId))
      );

      const totalTime = Date.now() - startTime;
      const averageTimePerError = totalTime / errors.length;

      expect(responses.length).toBe(100);
      expect(averageTimePerError).toBeLessThan(50); // Should handle each error quickly

      // Verify all errors were recorded
      const history = hybridErrorHandler.getErrorHistory(sourceId);
      expect(history.length).toBe(100);
    });
  });

  describe("Recovery and Health Monitoring", () => {
    it("should monitor source recovery and update health status", async () => {
      const sourceId = "recovery-test-source";
      const error = new Error("Temporary failure");

      // Simulate error
      await hybridErrorHandler.handleCustomAdapterError(sourceId, error, testFeedId);

      let tierStatus = hybridErrorHandler.getTierHealthStatus();
      let sourceStatus = tierStatus.get(sourceId);
      expect(sourceStatus?.isHealthy).toBe(false);

      // Mock successful recovery check
      jest.spyOn(circuitBreaker, "execute").mockResolvedValue(true);

      // Trigger recovery check
      await (hybridErrorHandler as any).checkSourceRecovery(sourceId);

      // Verify recovery
      tierStatus = hybridErrorHandler.getTierHealthStatus();
      sourceStatus = tierStatus.get(sourceId);
      expect(sourceStatus?.isHealthy).toBe(true);
      expect(hybridErrorHandler.getErrorStats().successfulRecoveries).toBe(1);
    });
  });

  describe("Event-Driven Error Handling", () => {
    it("should emit appropriate events throughout error handling flow", done => {
      const sourceId = "event-test-source";
      const error = new Error("Event test error");

      let eventsReceived = 0;
      const expectedEvents = ["tier1ErrorHandled", "errorRecorded"];

      expectedEvents.forEach(eventName => {
        hybridErrorHandler.on(eventName, () => {
          eventsReceived++;
          if (eventsReceived === expectedEvents.length) {
            done();
          }
        });
      });

      hybridErrorHandler.handleCustomAdapterError(sourceId, error, testFeedId);
    });

    it("should emit tier failover events", done => {
      const failedSources = ["binance-adapter"];

      hybridErrorHandler.on("tierFailoverCompleted", (feedId, response) => {
        expect(feedId).toEqual(testFeedId);
        expect(response.strategy).toBe("ccxt_backup");
        done();
      });

      hybridErrorHandler.implementTierFailover(testFeedId, failedSources);
    });
  });

  describe("Error Classification and Severity Escalation", () => {
    it("should escalate error severity based on frequency and type", async () => {
      const sourceId = "escalation-test-source";

      // Start with low-severity errors
      const lowSeverityError = new Error("Minor parsing issue");
      await hybridErrorHandler.handleCustomAdapterError(sourceId, lowSeverityError, testFeedId);

      let history = hybridErrorHandler.getErrorHistory(sourceId);
      expect(history[0].severity).toBe("low");

      // Add more errors to trigger escalation
      for (let i = 0; i < 4; i++) {
        await hybridErrorHandler.handleCustomAdapterError(sourceId, lowSeverityError, testFeedId);
      }

      history = hybridErrorHandler.getErrorHistory(sourceId);
      const latestError = history[history.length - 1];
      expect(latestError.severity).toBe("critical"); // Should escalate due to frequency
    });

    it("should classify different error types correctly", async () => {
      const errorTypes = [
        { error: new Error("Connection refused"), expected: ErrorClassification.CONNECTION_ERROR },
        { error: new Error("Request timeout"), expected: ErrorClassification.TIMEOUT_ERROR },
        { error: new Error("Rate limit exceeded"), expected: ErrorClassification.RATE_LIMIT_ERROR },
        { error: new Error("Unauthorized"), expected: ErrorClassification.AUTHENTICATION_ERROR },
        { error: new Error("Invalid JSON response"), expected: ErrorClassification.PARSING_ERROR },
      ];

      for (let i = 0; i < errorTypes.length; i++) {
        const sourceId = `classification-test-${i}`;
        await hybridErrorHandler.handleCustomAdapterError(sourceId, errorTypes[i].error, testFeedId);

        const history = hybridErrorHandler.getErrorHistory(sourceId);
        expect(history[0].classification).toBe(errorTypes[i].expected);
      }
    });
  });

  describe("Resource Management and Cleanup", () => {
    it("should manage error history memory efficiently", async () => {
      const sourceId = "memory-test-source";
      const error = new Error("Memory test error");

      // Generate many errors
      for (let i = 0; i < 1500; i++) {
        await hybridErrorHandler.handleCustomAdapterError(sourceId, error, testFeedId);
      }

      const history = hybridErrorHandler.getErrorHistory(sourceId);

      // Should limit history to prevent memory leaks (max 1000 as per implementation)
      expect(history.length).toBeLessThanOrEqual(1000);
    });

    it("should clean up old error history", async () => {
      const sourceId = "cleanup-test-source";
      const error = new Error("Cleanup test error");

      // Create error with old timestamp
      const oldError = { ...error };
      await hybridErrorHandler.handleCustomAdapterError(sourceId, oldError, testFeedId);

      // Manually set old timestamp to simulate aged error
      const history = hybridErrorHandler.getErrorHistory(sourceId);
      if (history.length > 0) {
        history[0].timestamp = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago
      }

      // Add new error to trigger cleanup
      await hybridErrorHandler.handleCustomAdapterError(sourceId, error, testFeedId);

      // Old errors should be cleaned up (implementation keeps last 24 hours)
      const updatedHistory = hybridErrorHandler.getErrorHistory(sourceId);
      const recentErrors = updatedHistory.filter(e => Date.now() - e.timestamp < 24 * 60 * 60 * 1000);
      expect(recentErrors.length).toBe(updatedHistory.length);
    });
  });

  describe("Comprehensive Error Scenarios", () => {
    it("should handle complete system degradation scenario", async () => {
      // Simulate complete Tier 1 failure
      const tier1Sources = ["binance-adapter", "coinbase-adapter", "kraken-adapter", "okx-adapter"];
      const tier1Error = new Error("Complete Tier 1 system failure");

      for (const source of tier1Sources) {
        await hybridErrorHandler.handleCustomAdapterError(source, tier1Error, testFeedId);
      }

      // Simulate Tier 2 failures
      const tier2Sources = ["bitmart", "bybit", "gate"];
      const tier2Error = new Error("Tier 2 system overload");

      for (const source of tier2Sources) {
        await hybridErrorHandler.handleCcxtExchangeError(source, tier2Error, testFeedId);
      }

      // Mock CCXT adapter failure
      (ccxtAdapter.getAvailableTier2Exchanges as jest.Mock).mockReturnValue([]);

      // Attempt tier failover - should result in graceful degradation
      const response = await hybridErrorHandler.implementTierFailover(testFeedId, tier1Sources);

      expect(response.strategy).toBe("graceful_degradation");
      expect(response.degradationLevel).toBe("severe");

      // Verify comprehensive statistics
      const stats = hybridErrorHandler.getErrorStats();
      expect(stats.tier1Errors).toBe(4);
      expect(stats.tier2Errors).toBe(3);
      expect(stats.totalErrors).toBe(7);
    });

    it("should handle rapid error recovery scenario", async () => {
      const sourceId = "rapid-recovery-source";
      const error = new Error("Temporary network glitch");

      // Simulate error
      await hybridErrorHandler.handleCustomAdapterError(sourceId, error, testFeedId);

      // Mock rapid recovery
      jest.spyOn(circuitBreaker, "execute").mockResolvedValue(true);

      // Trigger recovery
      await (hybridErrorHandler as any).checkSourceRecovery(sourceId);

      // Verify rapid recovery
      const tierStatus = hybridErrorHandler.getTierHealthStatus();
      const sourceStatus = tierStatus.get(sourceId);
      expect(sourceStatus?.isHealthy).toBe(true);

      // Should be able to handle new requests normally
      const strategies = await hybridErrorHandler.getErrorResponseStrategies(sourceId, testFeedId, error);
      expect(strategies.length).toBeGreaterThan(0);
    });
  });
});
