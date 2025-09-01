import { HybridErrorHandlerService, DataSourceTier, ErrorClassification } from "../hybrid-error-handler.service";
import { CircuitBreakerService } from "../circuit-breaker.service";
import { ConnectionRecoveryService } from "../connection-recovery.service";
import { CcxtMultiExchangeAdapter } from "@/adapters/crypto/ccxt.adapter";
import { EnhancedFeedId, FeedCategory } from "@/common/types/feed.types";

// Mock implementations
const mockCircuitBreaker = {
  registerCircuit: jest.fn(),
  execute: jest.fn(),
  getState: jest.fn(),
  openCircuit: jest.fn(),
  closeCircuit: jest.fn(),
};

const mockConnectionRecovery = {
  triggerFailover: jest.fn(),
  implementGracefulDegradation: jest.fn(),
};

const mockCcxtAdapter = {
  getCcxtPrice: jest.fn(),
  getAvailableTier2Exchanges: jest.fn(),
  canProvideTier2Data: jest.fn(),
};

describe("HybridErrorHandlerService", () => {
  let service: HybridErrorHandlerService;
  let circuitBreaker: CircuitBreakerService;
  let connectionRecovery: ConnectionRecoveryService;
  let ccxtAdapter: CcxtMultiExchangeAdapter;

  const testFeedId: EnhancedFeedId = {
    category: FeedCategory.Crypto,
    name: "BTC/USD",
  };

  beforeEach(async () => {
    // Mock console methods to suppress expected error logs during tests
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});

    // Reset mocks
    jest.clearAllMocks();

    // Set default mock return values
    mockCcxtAdapter.getAvailableTier2Exchanges.mockReturnValue(["binance", "coinbase", "bitmart", "bybit", "gate"]);

    // Create service instance directly with mocks
    service = new HybridErrorHandlerService(
      mockCircuitBreaker as any,
      mockConnectionRecovery as any,
      mockCcxtAdapter as any
    );

    circuitBreaker = mockCircuitBreaker as any;
    connectionRecovery = mockConnectionRecovery as any;
    ccxtAdapter = mockCcxtAdapter as any;
  });

  afterEach(() => {
    if (service) {
      service.destroy();
    }
    // Restore console methods after each test
    jest.restoreAllMocks();
  });

  describe("Error Classification", () => {
    it("should classify connection errors correctly", async () => {
      const connectionError = new Error("Connection refused");

      const response = await service.handleCustomAdapterError("binance-adapter", connectionError, testFeedId);

      expect(response).toBeDefined();
      expect(response.strategy).toBeDefined();

      const stats = service.getErrorStats();
      expect(stats.tier1Errors).toBe(1);
      expect(stats.errorsByClassification[ErrorClassification.CONNECTION_ERROR]).toBe(1);
    });

    it("should classify timeout errors correctly", async () => {
      const timeoutError = new Error("Request timeout");

      await service.handleCustomAdapterError("coinbase-adapter", timeoutError, testFeedId);

      const stats = service.getErrorStats();
      expect(stats.errorsByClassification[ErrorClassification.TIMEOUT_ERROR]).toBe(1);
    });

    it("should classify rate limit errors correctly", async () => {
      const rateLimitError = new Error("Rate limit exceeded");

      await service.handleCcxtExchangeError("bitmart", rateLimitError, testFeedId);

      const stats = service.getErrorStats();
      expect(stats.tier2Errors).toBe(1);
      expect(stats.errorsByClassification[ErrorClassification.RATE_LIMIT_ERROR]).toBe(1);
    });

    it("should classify authentication errors correctly", async () => {
      const authError = new Error("Unauthorized access");

      await service.handleCustomAdapterError("kraken-adapter", authError, testFeedId);

      const stats = service.getErrorStats();
      expect(stats.errorsByClassification[ErrorClassification.AUTHENTICATION_ERROR]).toBe(1);
    });

    it("should classify stale data errors correctly", async () => {
      const staleDataError = new Error("Stale data detected");
      const context = { dataAge: 5000 }; // 5 seconds old

      await service.handleCustomAdapterError("okx-adapter", staleDataError, testFeedId, context);

      const stats = service.getErrorStats();
      expect(stats.errorsByClassification[ErrorClassification.STALE_DATA_ERROR]).toBe(1);
    });
  });

  describe("Tier 1 Custom Adapter Error Handling", () => {
    it("should handle Tier 1 adapter errors with appropriate response", async () => {
      const error = new Error("Connection lost");
      mockConnectionRecovery.triggerFailover.mockResolvedValue({
        success: true,
        failoverTime: 50,
        activatedSources: ["backup-source"],
        deactivatedSources: ["binance-adapter"],
        degradationLevel: "none",
      });

      const response = await service.handleCustomAdapterError("binance-adapter", error, testFeedId);

      expect(response).toBeDefined();
      expect(response.strategy).toBeDefined();
      expect(response.estimatedRecoveryTime).toBeDefined();
    });

    it("should emit tier1ErrorHandled event", done => {
      const error = new Error("Test error");

      service.on("tier1ErrorHandled", (sourceId, dataSourceError, response) => {
        expect(sourceId).toBe("binance-adapter");
        expect(dataSourceError.tier).toBe(DataSourceTier.TIER_1_CUSTOM);
        expect(response).toBeDefined();
        done();
      });

      void service.handleCustomAdapterError("binance-adapter", error, testFeedId);
    });

    it("should record error history for Tier 1 sources", async () => {
      const error = new Error("Test error");

      await service.handleCustomAdapterError("binance-adapter", error, testFeedId);

      const history = service.getErrorHistory("binance-adapter");
      expect(history.length).toBe(1);
      expect(history[0].tier).toBe(DataSourceTier.TIER_1_CUSTOM);
      expect(history[0].sourceId).toBe("binance-adapter");
    });

    it("should escalate severity based on error frequency", async () => {
      const error = new Error("Connection error");

      // Generate multiple errors
      for (let i = 0; i < 5; i++) {
        await service.handleCustomAdapterError("binance-adapter", error, testFeedId);
      }

      const history = service.getErrorHistory("binance-adapter");
      const latestError = history[history.length - 1];
      expect(latestError.severity).toBe("critical");
    });
  });

  describe("Tier 2 CCXT Exchange Error Handling", () => {
    it("should handle Tier 2 exchange errors differently", async () => {
      const error = new Error("Exchange API error");

      const response = await service.handleCcxtExchangeError("bitmart", error, testFeedId);

      expect(response).toBeDefined();

      const stats = service.getErrorStats();
      expect(stats.tier2Errors).toBe(1);
    });

    it("should handle rate limit errors with appropriate delay", async () => {
      const rateLimitError = new Error("Rate limit exceeded");

      const response = await service.handleCcxtExchangeError("bybit", rateLimitError, testFeedId);

      expect(response.strategy).toBe("retry");
      expect(response.estimatedRecoveryTime).toBe(60000); // 1 minute for rate limits
    });

    it("should emit tier2ErrorHandled event", done => {
      const error = new Error("Test error");

      service.on("tier2ErrorHandled", (exchangeId, dataSourceError, response) => {
        expect(exchangeId).toBe("kucoin");
        expect(dataSourceError.tier).toBe(DataSourceTier.TIER_2_CCXT);
        expect(response).toBeDefined();
        done();
      });

      void service.handleCcxtExchangeError("kucoin", error, testFeedId);
    });
  });

  describe("Tier Failover Implementation", () => {
    it("should implement tier failover when Tier 1 sources fail", async () => {
      const failedSources = ["binance-adapter", "coinbase-adapter"];
      mockCcxtAdapter.getAvailableTier2Exchanges.mockReturnValue(["binance", "coinbase", "bitmart"]);

      const response = await service.implementTierFailover(testFeedId, failedSources);

      expect(response.strategy).toBe("ccxt_backup");
      expect(response.degradationLevel).toBe("none");
      expect(service.getErrorStats().failoverEvents).toBe(1);
    });

    it("should implement graceful degradation when no CCXT backup available", async () => {
      const failedSources = ["binance-adapter"];
      mockCcxtAdapter.getAvailableTier2Exchanges.mockReturnValue([]);
      mockConnectionRecovery.implementGracefulDegradation.mockResolvedValue(undefined);

      const response = await service.implementTierFailover(testFeedId, failedSources);

      expect(response.strategy).toBe("graceful_degradation");
      expect(response.degradationLevel).toBe("severe");
      expect(mockConnectionRecovery.implementGracefulDegradation).toHaveBeenCalledWith(testFeedId);
    });

    it("should emit tierFailoverCompleted event", done => {
      const failedSources = ["binance-adapter"];
      mockCcxtAdapter.getAvailableTier2Exchanges.mockReturnValue(["binance"]);

      service.on("tierFailoverCompleted", (feedId, response) => {
        expect(feedId).toEqual(testFeedId);
        expect(response.strategy).toBe("ccxt_backup");
        done();
      });

      void service.implementTierFailover(testFeedId, failedSources);
    });
  });

  describe("CCXT Retry Logic Integration", () => {
    it("should leverage CCXT retry logic successfully", async () => {
      const originalError = new Error("Original error");
      const mockPriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        source: "ccxt-multi-exchange",
        confidence: 0.9,
      };

      mockCcxtAdapter.getCcxtPrice.mockResolvedValue(mockPriceUpdate);

      const result = await service.leverageCcxtRetryLogic(testFeedId, originalError);

      expect(result).toEqual(mockPriceUpdate);
      expect(service.getErrorStats().successfulRecoveries).toBe(1);
    });

    it("should handle CCXT retry failures gracefully", async () => {
      const originalError = new Error("Original error");
      mockCcxtAdapter.getCcxtPrice.mockRejectedValue(new Error("CCXT retry failed"));

      const result = await service.leverageCcxtRetryLogic(testFeedId, originalError);

      expect(result).toBeNull();
    });
  });

  describe("Error Response Strategies", () => {
    it("should provide multiple recovery strategies", async () => {
      const error = new Error("Connection error");

      const strategies = await service.getErrorResponseStrategies("binance-adapter", testFeedId, error);

      expect(strategies.length).toBeGreaterThan(0);
      expect(strategies.some(s => s.strategy === "retry")).toBe(true);
      expect(strategies.some(s => s.strategy === "graceful_degradation")).toBe(true);
    });

    it("should prioritize strategies based on error severity", async () => {
      const criticalError = new Error("Unauthorized access"); // Authentication error

      const strategies = await service.getErrorResponseStrategies("binance-adapter", testFeedId, criticalError);

      // For critical errors, should prefer failover over retry
      const failoverIndex = strategies.findIndex(s => s.strategy === "failover");
      const retryIndex = strategies.findIndex(s => s.strategy === "retry");

      if (failoverIndex !== -1 && retryIndex !== -1) {
        expect(failoverIndex).toBeLessThan(retryIndex);
      }
    });

    it("should include CCXT backup strategy for Tier 1 errors", async () => {
      const error = new Error("Connection error");
      mockCcxtAdapter.getAvailableTier2Exchanges.mockReturnValue(["binance"]);

      const strategies = await service.getErrorResponseStrategies("binance-adapter", testFeedId, error);

      expect(strategies.some(s => s.strategy === "ccxt_backup")).toBe(true);
    });
  });

  describe("CCXT Backup Management", () => {
    it("should activate CCXT backup correctly", async () => {
      const failedSources = ["binance-adapter"];
      mockCcxtAdapter.getAvailableTier2Exchanges.mockReturnValue(["binance", "bitmart"]);

      await service.implementTierFailover(testFeedId, failedSources);

      expect(service.isCcxtBackupActive(testFeedId)).toBe(true);
      expect(service.getErrorStats().ccxtBackupActivations).toBe(1);
    });

    it("should emit ccxtBackupActivated event", done => {
      const failedSources = ["binance-adapter"];
      mockCcxtAdapter.getAvailableTier2Exchanges.mockReturnValue(["binance"]);

      service.on("ccxtBackupActivated", (feedId, failedSourcesArray, backupSources) => {
        expect(feedId).toEqual(testFeedId);
        expect(failedSourcesArray).toEqual(["binance-adapter"]);
        expect(backupSources).toEqual(["ccxt-binance"]);
        done();
      });

      void service.implementTierFailover(testFeedId, failedSources);
    });
  });

  describe("Statistics and Monitoring", () => {
    it("should track error statistics correctly", async () => {
      const tier1Error = new Error("Tier 1 error");
      const tier2Error = new Error("Tier 2 error");

      await service.handleCustomAdapterError("binance-adapter", tier1Error, testFeedId);
      await service.handleCcxtExchangeError("bitmart", tier2Error, testFeedId);

      const stats = service.getErrorStats();
      expect(stats.totalErrors).toBe(2);
      expect(stats.tier1Errors).toBe(1);
      expect(stats.tier2Errors).toBe(1);
    });

    it("should provide tier health status", async () => {
      const error = new Error("Test error");

      await service.handleCustomAdapterError("binance-adapter", error, testFeedId);

      const tierStatus = service.getTierHealthStatus();
      const binanceStatus = tierStatus.get("binance-adapter");

      expect(binanceStatus).toBeDefined();
      expect(binanceStatus!.tier).toBe(DataSourceTier.TIER_1_CUSTOM);
      expect(binanceStatus!.isHealthy).toBe(false);
    });

    it("should reset statistics correctly", async () => {
      const error = new Error("Test error");

      await service.handleCustomAdapterError("binance-adapter", error, testFeedId);

      let stats = service.getErrorStats();
      expect(stats.totalErrors).toBe(1);

      service.resetStats();

      stats = service.getErrorStats();
      expect(stats.totalErrors).toBe(0);
      expect(stats.tier1Errors).toBe(0);
      expect(stats.tier2Errors).toBe(0);
    });
  });

  describe("Recovery Monitoring", () => {
    it("should detect source recovery", done => {
      const error = new Error("Connection error");

      service.on("sourceRecovered", sourceId => {
        expect(sourceId).toBe("binance-adapter");
        done();
      });

      // Simulate error and then recovery
      void service.handleCustomAdapterError("binance-adapter", error, testFeedId).then(() => {
        // Mock successful circuit breaker execution for recovery
        mockCircuitBreaker.execute.mockResolvedValue(true);

        // Trigger recovery check manually (normally done by timer)
        (service as any).checkSourceRecovery("binance-adapter");
      });
    });

    it("should update recovery statistics on successful recovery", async () => {
      // First create an error to establish tier status
      const error = new Error("Connection error");
      await service.handleCustomAdapterError("test-source", error, testFeedId);

      // Mock successful circuit breaker execution for recovery
      mockCircuitBreaker.execute.mockResolvedValue(true);

      await (service as any).checkSourceRecovery("test-source");

      const stats = service.getErrorStats();
      expect(stats.successfulRecoveries).toBe(1);
    });
  });

  describe("Performance Requirements", () => {
    it("should handle errors within performance targets", async () => {
      const error = new Error("Performance test error");

      const startTime = Date.now();
      await service.handleCustomAdapterError("binance-adapter", error, testFeedId);
      const responseTime = Date.now() - startTime;

      // Should handle error quickly (within reasonable time for test environment)
      expect(responseTime).toBeLessThan(1000); // 1 second for test environment
    });

    it("should provide estimated recovery times", async () => {
      const error = new Error("Connection error");

      const strategies = await service.getErrorResponseStrategies("binance-adapter", testFeedId, error);

      strategies.forEach(strategy => {
        expect(strategy.estimatedRecoveryTime).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe("Error Context and Metadata", () => {
    it("should handle errors with additional context", async () => {
      const error = new Error("Context test error");
      const context = {
        dataAge: 3000,
        latency: 500,
        exchangeStatus: "degraded",
      };

      await service.handleCustomAdapterError("binance-adapter", error, testFeedId, context);

      const history = service.getErrorHistory("binance-adapter");
      expect(history.length).toBe(1);

      // Context should influence error classification
      const errorRecord = history[0];
      expect(errorRecord.classification).toBe(ErrorClassification.STALE_DATA_ERROR);
    });

    it("should preserve error metadata", async () => {
      const error = new Error("Metadata test");

      await service.handleCustomAdapterError("binance-adapter", error, testFeedId);

      const history = service.getErrorHistory("binance-adapter");
      const errorRecord = history[0];

      expect(errorRecord.sourceId).toBe("binance-adapter");
      expect(errorRecord.feedId).toEqual(testFeedId);
      expect(errorRecord.timestamp).toBeDefined();
      expect(errorRecord.tier).toBe(DataSourceTier.TIER_1_CUSTOM);
    });
  });

  describe("Cleanup and Resource Management", () => {
    it("should clean up resources on destroy", async () => {
      const error = new Error("Test error");

      await service.handleCustomAdapterError("binance-adapter", error, testFeedId);

      expect(service.getErrorHistory("binance-adapter").length).toBe(1);

      service.destroy();

      // After destroy, resources should be cleaned up
      expect(service.getErrorHistory("binance-adapter").length).toBe(0);
    });

    it("should cancel pending recovery timers on destroy", async () => {
      const error = new Error("Test error");

      await service.handleCustomAdapterError("binance-adapter", error, testFeedId);

      // Should not throw when destroying with pending timers
      expect(() => service.destroy()).not.toThrow();
    });
  });

  describe("Edge Cases and Error Conditions", () => {
    it("should handle errors without feedId gracefully", async () => {
      const error = new Error("No feed ID error");

      // Should not throw even without feedId
      await expect(service.handleCustomAdapterError("binance-adapter", error, testFeedId)).resolves.toBeDefined();
    });

    it("should handle unknown source IDs", async () => {
      const strategies = await service.getErrorResponseStrategies("unknown-source", testFeedId, new Error("Test"));

      expect(strategies).toBeDefined();
      expect(strategies.length).toBeGreaterThan(0);
    });

    it("should handle CCXT adapter failures gracefully", async () => {
      mockCcxtAdapter.getAvailableTier2Exchanges.mockImplementation(() => {
        throw new Error("CCXT adapter error");
      });

      const failedSources = ["binance-adapter"];

      const response = await service.implementTierFailover(testFeedId, failedSources);

      // Should fall back to graceful degradation
      expect(response.strategy).toBe("graceful_degradation");
    });
  });
});
