import { Test, TestingModule } from "@nestjs/testing";
import { AccuracyMonitorService } from "@/monitoring/accuracy-monitor.service";
import { AlertingService } from "@/monitoring/alerting.service";
import { HybridErrorHandlerService } from "@/error-handling/hybrid-error-handler.service";
import { PerformanceMonitorService } from "@/monitoring/performance-monitor.service";
import { ProductionDataManagerService } from "@/data-manager/production-data-manager";
import { RealTimeAggregationService } from "@/aggregators/real-time-aggregation.service";
import { RealTimeCacheService } from "@/cache/real-time-cache.service";
import { ConfigService } from "@/config/config.service";
import { EnhancedLoggerService } from "@/common/logging/enhanced-logger.service";
import { type EnhancedFeedId, FeedCategory, type PriceUpdate } from "@/common/types/core";

import { IntegrationService } from "../integration.service";
import { DataSourceIntegrationService } from "../services/data-source-integration.service";
import { PriceAggregationCoordinatorService } from "../services/price-aggregation-coordinator.service";
import { SystemHealthService } from "../services/system-health.service";

describe("Service Wiring Integration", () => {
  let integrationService: IntegrationService;
  let dataSourceIntegration: DataSourceIntegrationService;
  let priceAggregationCoordinator: PriceAggregationCoordinatorService;
  let systemHealth: SystemHealthService;
  let dataManager: ProductionDataManagerService;
  let aggregationService: RealTimeAggregationService;
  let cacheService: RealTimeCacheService;
  let accuracyMonitor: AccuracyMonitorService;
  let performanceMonitor: PerformanceMonitorService;
  let alertingService: AlertingService;
  let errorHandler: HybridErrorHandlerService;
  let module: TestingModule;

  beforeEach(async () => {
    // Create comprehensive mocks for all services
    const mockConfigService = {
      get: jest.fn(),
      getConfig: jest.fn(),
      getFeedConfigurations: jest.fn().mockReturnValue([]),
      getEnvironmentConfig: jest.fn().mockReturnValue({}),
    };

    const mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    };

    const mockDataManager = {
      emit: jest.fn(),
      on: jest.fn(),
      subscribeToFeed: jest.fn(),
      cleanupForTests: jest.fn(),
    };

    const mockAggregationService = {
      emit: jest.fn(),
      on: jest.fn(),
      processPriceUpdate: jest.fn(),
      addPriceUpdate: jest.fn(),
      getAggregatedPrice: jest.fn().mockResolvedValue({
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        sources: ["test-source"],
        confidence: 0.95,
        consensusScore: 0.9,
      }),
    };

    const mockCacheService = {
      setPrice: jest.fn(),
      getPrice: jest.fn().mockReturnValue({
        value: 50000,
        timestamp: Date.now(),
        sources: ["test-source"],
        confidence: 0.95,
      }),
    };

    const mockAccuracyMonitor = {
      emit: jest.fn(),
      on: jest.fn(),
      recordPrice: jest.fn(),
    };

    const mockPerformanceMonitor = {
      recordPriceUpdate: jest.fn(),
      checkPerformanceThresholds: jest.fn(),
      checkAndEmitAlerts: jest.fn(),
    };

    const mockAlertingService = {
      sendAlert: jest.fn(),
    };

    const mockErrorHandler = {
      handleError: jest.fn(),
      recordFailure: jest.fn(),
      destroy: jest.fn(),
    };

    const mockDataSourceIntegration = {
      initialize: jest.fn().mockResolvedValue(undefined),
      shutdown: jest.fn().mockResolvedValue(undefined),
      subscribeToFeed: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
      emit: jest.fn(),
    };

    const mockPriceAggregationCoordinator = {
      initialize: jest.fn().mockResolvedValue(undefined),
      shutdown: jest.fn().mockResolvedValue(undefined),
      configureFeed: jest.fn().mockResolvedValue(undefined),
      getCurrentPrice: jest.fn().mockResolvedValue({
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        sources: ["test-source"],
        confidence: 0.95,
        consensusScore: 0.9,
      }),
      getCurrentPrices: jest.fn().mockResolvedValue([]),
      handlePriceUpdate: jest.fn(),
      on: jest.fn(),
      emit: jest.fn(),
    };

    const mockSystemHealth = {
      initialize: jest.fn().mockResolvedValue(undefined),
      shutdown: jest.fn().mockResolvedValue(undefined),
      getOverallHealth: jest.fn().mockReturnValue({
        status: "healthy",
        timestamp: Date.now(),
        sources: [],
        aggregation: { errorCount: 0, successRate: 1.0 },
        performance: { averageResponseTime: 50, errorRate: 0.0 },
        accuracy: { averageConfidence: 0.95, outlierRate: 0.0 },
      }),
      recordPriceAggregation: jest.fn(),
      recordSourceHealth: jest.fn(),
      recordAggregationError: jest.fn(),
      on: jest.fn(),
      emit: jest.fn(),
    };

    module = await Test.createTestingModule({
      providers: [
        IntegrationService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: EnhancedLoggerService, useValue: mockLogger },
        { provide: DataSourceIntegrationService, useValue: mockDataSourceIntegration },
        { provide: PriceAggregationCoordinatorService, useValue: mockPriceAggregationCoordinator },
        { provide: SystemHealthService, useValue: mockSystemHealth },
        { provide: ProductionDataManagerService, useValue: mockDataManager },
        { provide: RealTimeAggregationService, useValue: mockAggregationService },
        { provide: RealTimeCacheService, useValue: mockCacheService },
        { provide: AccuracyMonitorService, useValue: mockAccuracyMonitor },
        { provide: PerformanceMonitorService, useValue: mockPerformanceMonitor },
        { provide: AlertingService, useValue: mockAlertingService },
        { provide: HybridErrorHandlerService, useValue: mockErrorHandler },
      ],
    }).compile();

    integrationService = module.get<IntegrationService>(IntegrationService);
    dataSourceIntegration = module.get<DataSourceIntegrationService>(DataSourceIntegrationService);
    priceAggregationCoordinator = module.get<PriceAggregationCoordinatorService>(PriceAggregationCoordinatorService);
    systemHealth = module.get<SystemHealthService>(SystemHealthService);
    dataManager = module.get<ProductionDataManagerService>(ProductionDataManagerService);
    aggregationService = module.get<RealTimeAggregationService>(RealTimeAggregationService);
    cacheService = module.get<RealTimeCacheService>(RealTimeCacheService);
    accuracyMonitor = module.get<AccuracyMonitorService>(AccuracyMonitorService);
    performanceMonitor = module.get<PerformanceMonitorService>(PerformanceMonitorService);
    alertingService = module.get<AlertingService>(AlertingService);
    errorHandler = module.get<HybridErrorHandlerService>(HybridErrorHandlerService);

    // Initialize the integration service to wire up event handlers
    await integrationService.onModuleInit();
  });

  afterEach(async () => {
    // Clean up services
    if (dataManager && dataManager.cleanupForTests) {
      dataManager.cleanupForTests();
    }
    if (errorHandler && errorHandler.destroy) {
      errorHandler.destroy();
    }
    await module.close();
  });

  describe("Service Dependencies", () => {
    it("should have all services properly injected", () => {
      expect(integrationService).toBeDefined();
      expect(dataManager).toBeDefined();
      expect(aggregationService).toBeDefined();
      expect(cacheService).toBeDefined();
      expect(accuracyMonitor).toBeDefined();
      expect(performanceMonitor).toBeDefined();
      expect(alertingService).toBeDefined();
      expect(errorHandler).toBeDefined();
    });

    it("should initialize integration service without errors", async () => {
      // The service should initialize without throwing errors
      expect(() => integrationService).not.toThrow();

      // Initialize the integration service to wire up event handlers
      await integrationService.onModuleInit();
    });
  });

  describe("Event Wiring", () => {
    it("should wire data source integration price update events to price aggregation coordinator", async () => {
      const testUpdate: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        source: "test-source",
        confidence: 0.95,
      };

      // Spy on price aggregation coordinator handlePriceUpdate method
      const handlePriceUpdateSpy = jest.spyOn(priceAggregationCoordinator, "handlePriceUpdate");

      // Simulate the event wiring by calling the handler directly
      // (since we're testing the integration service's wiring logic)
      const priceUpdateHandler = (dataSourceIntegration.on as jest.Mock).mock.calls.find(
        call => call[0] === "priceUpdate"
      )?.[1];

      if (priceUpdateHandler) {
        priceUpdateHandler(testUpdate);
      }

      // Verify that the price aggregation coordinator received the update
      expect(handlePriceUpdateSpy).toHaveBeenCalledWith(testUpdate);
    });

    it("should wire price aggregation coordinator events to system health", async () => {
      const testAggregatedPrice = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        sources: ["test-source"],
        confidence: 0.95,
        consensusScore: 0.9,
      };

      // Spy on system health recordPriceAggregation method
      const recordPriceAggregationSpy = jest.spyOn(systemHealth, "recordPriceAggregation");

      // Simulate the event wiring by calling the handler directly
      const aggregatedPriceHandler = (priceAggregationCoordinator.on as jest.Mock).mock.calls.find(
        call => call[0] === "aggregatedPrice"
      )?.[1];

      if (aggregatedPriceHandler) {
        aggregatedPriceHandler(testAggregatedPrice);
      }

      // Verify that the system health service received the aggregated price
      expect(recordPriceAggregationSpy).toHaveBeenCalledWith(testAggregatedPrice);
    });

    it("should wire data source health events to system health", async () => {
      const sourceId = "test-source";

      // Spy on system health recordSourceHealth method
      const recordSourceHealthSpy = jest.spyOn(systemHealth, "recordSourceHealth");

      // Simulate the event wiring for source healthy event
      const sourceHealthyHandler = (dataSourceIntegration.on as jest.Mock).mock.calls.find(
        call => call[0] === "sourceHealthy"
      )?.[1];

      if (sourceHealthyHandler) {
        sourceHealthyHandler(sourceId);
      }

      // Verify that the system health service recorded the source health
      expect(recordSourceHealthSpy).toHaveBeenCalledWith(sourceId, "healthy");
    });

    it("should wire system health alerts to integration service events", async () => {
      const testAlert = {
        type: "health_alert",
        message: "System health degraded",
        timestamp: Date.now(),
        severity: "warning",
      };

      // Spy on integration service emit method
      const integrationEmitSpy = jest.spyOn(integrationService, "emit");

      // Simulate the event wiring for health alert
      const healthAlertHandler = (systemHealth.on as jest.Mock).mock.calls.find(call => call[0] === "healthAlert")?.[1];

      if (healthAlertHandler) {
        healthAlertHandler(testAlert);
      }

      // Verify that the integration service emitted the health alert
      expect(integrationEmitSpy).toHaveBeenCalledWith("healthAlert", testAlert);
    });
  });

  describe("Error Handling Wiring", () => {
    it("should wire price aggregation errors to system health", async () => {
      const testError = new Error("Test aggregation error");

      // Spy on system health recordAggregationError method
      const recordAggregationErrorSpy = jest.spyOn(systemHealth, "recordAggregationError");

      // Simulate the event wiring for aggregation error
      const aggregationErrorHandler = (priceAggregationCoordinator.on as jest.Mock).mock.calls.find(
        call => call[0] === "aggregationError"
      )?.[1];

      if (aggregationErrorHandler) {
        aggregationErrorHandler(testError);
      }

      // Verify that the system health service recorded the aggregation error
      expect(recordAggregationErrorSpy).toHaveBeenCalledWith(testError);
    });

    it("should wire data source unhealthy events to system health", async () => {
      const sourceId = "test-source";

      // Spy on system health recordSourceHealth method
      const recordSourceHealthSpy = jest.spyOn(systemHealth, "recordSourceHealth");

      // Simulate the event wiring for source unhealthy event
      const sourceUnhealthyHandler = (dataSourceIntegration.on as jest.Mock).mock.calls.find(
        call => call[0] === "sourceUnhealthy"
      )?.[1];

      if (sourceUnhealthyHandler) {
        sourceUnhealthyHandler(sourceId);
      }

      // Verify that the system health service recorded the source as unhealthy
      expect(recordSourceHealthSpy).toHaveBeenCalledWith(sourceId, "unhealthy");
    });

    it("should wire data source recovery events to system health", async () => {
      const sourceId = "test-source";

      // Spy on system health recordSourceHealth method
      const recordSourceHealthSpy = jest.spyOn(systemHealth, "recordSourceHealth");

      // Simulate the event wiring for source recovered event
      const sourceRecoveredHandler = (dataSourceIntegration.on as jest.Mock).mock.calls.find(
        call => call[0] === "sourceRecovered"
      )?.[1];

      if (sourceRecoveredHandler) {
        sourceRecoveredHandler(sourceId);
      }

      // Verify that the system health service recorded the source as recovered
      expect(recordSourceHealthSpy).toHaveBeenCalledWith(sourceId, "recovered");
    });
  });

  describe("Service Integration", () => {
    it("should provide access to current price through integration service", async () => {
      const testFeedId: EnhancedFeedId = {
        category: FeedCategory.Crypto,
        name: "BTC/USD",
      };

      // Call the integration service method
      const result = await integrationService.getCurrentPrice(testFeedId);

      // Verify that the price aggregation coordinator was called
      expect(priceAggregationCoordinator.getCurrentPrice).toHaveBeenCalledWith(testFeedId);
      expect(result).toEqual(
        expect.objectContaining({
          symbol: "BTC/USD",
          price: 50000,
          confidence: 0.95,
        })
      );
    });

    it("should provide access to system health through integration service", async () => {
      // Call the integration service method
      const result = await integrationService.getSystemHealth();

      // Verify that the system health service was called
      expect(systemHealth.getOverallHealth).toHaveBeenCalled();
      expect(result).toEqual(
        expect.objectContaining({
          status: "healthy",
          timestamp: expect.any(Number),
        })
      );
    });

    it("should report healthy status when system health is healthy or degraded", () => {
      // Test healthy status
      (systemHealth.getOverallHealth as jest.Mock).mockReturnValue({
        status: "healthy",
        timestamp: Date.now(),
      });
      expect(integrationService.isHealthy()).toBe(true);

      // Test degraded status (should still be considered operational)
      (systemHealth.getOverallHealth as jest.Mock).mockReturnValue({
        status: "degraded",
        timestamp: Date.now(),
      });
      expect(integrationService.isHealthy()).toBe(true);

      // Test unhealthy status
      (systemHealth.getOverallHealth as jest.Mock).mockReturnValue({
        status: "unhealthy",
        timestamp: Date.now(),
      });
      expect(integrationService.isHealthy()).toBe(false);
    });
  });

  describe("Service Initialization", () => {
    it("should initialize all sub-services during integration service initialization", async () => {
      // Verify that all sub-services were initialized
      expect(dataSourceIntegration.initialize).toHaveBeenCalled();
      expect(priceAggregationCoordinator.initialize).toHaveBeenCalled();
      expect(systemHealth.initialize).toHaveBeenCalled();
    });

    it("should wire service interactions during initialization", async () => {
      // Verify that event handlers were set up
      expect(dataSourceIntegration.on).toHaveBeenCalledWith("priceUpdate", expect.any(Function));
      expect(priceAggregationCoordinator.on).toHaveBeenCalledWith("aggregatedPrice", expect.any(Function));
      expect(dataSourceIntegration.on).toHaveBeenCalledWith("sourceHealthy", expect.any(Function));
      expect(dataSourceIntegration.on).toHaveBeenCalledWith("sourceUnhealthy", expect.any(Function));
      expect(dataSourceIntegration.on).toHaveBeenCalledWith("sourceRecovered", expect.any(Function));
      expect(systemHealth.on).toHaveBeenCalledWith("healthAlert", expect.any(Function));
      expect(priceAggregationCoordinator.on).toHaveBeenCalledWith("aggregationError", expect.any(Function));
    });

    it("should subscribe to configured feeds during initialization", async () => {
      // Since we mocked getFeedConfigurations to return empty array,
      // verify that subscribeToFeed was not called
      expect(dataSourceIntegration.subscribeToFeed).not.toHaveBeenCalled();
      expect(priceAggregationCoordinator.configureFeed).not.toHaveBeenCalled();
    });
  });
});
