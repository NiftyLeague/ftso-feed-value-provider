import { Test, TestingModule } from "@nestjs/testing";
import { AccuracyMonitorService } from "@/monitoring/accuracy-monitor.service";
import { AlertingService } from "@/monitoring/alerting.service";
import { HybridErrorHandlerService } from "@/error-handling/hybrid-error-handler.service";
import { PerformanceMonitorService } from "@/monitoring/performance-monitor.service";
import { ProductionDataManagerService } from "@/data-manager/production-data-manager";
import { RealTimeAggregationService } from "@/aggregators/real-time-aggregation.service";
import { RealTimeCacheService } from "@/cache/real-time-cache.service";
import { type EnhancedFeedId, FeedCategory, type PriceUpdate } from "@/common/types/core";

import { IntegrationModule } from "../integration.module";
import { IntegrationService } from "../integration.service";

describe("Service Wiring Integration", () => {
  let integrationService: IntegrationService;
  let dataManager: ProductionDataManagerService;
  let aggregationService: RealTimeAggregationService;
  let cacheService: RealTimeCacheService;
  let accuracyMonitor: AccuracyMonitorService;
  let performanceMonitor: PerformanceMonitorService;
  let alertingService: AlertingService;
  let errorHandler: HybridErrorHandlerService;
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [IntegrationModule],
    }).compile();

    integrationService = module.get<IntegrationService>(IntegrationService);
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
    if (dataManager) {
      dataManager.cleanupForTests();
    }
    if (errorHandler) {
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
    it("should wire data manager price update events to aggregation service", async () => {
      const testUpdate: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        source: "test-source",
        confidence: 0.95,
      };

      // Spy on aggregation service processPriceUpdate method
      const processPriceUpdateSpy = jest.spyOn(aggregationService, "processPriceUpdate");

      // Emit price update from data manager
      dataManager.emit("priceUpdate", testUpdate);

      // Wait a bit for async processing
      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify that the aggregation service received the update
      expect(processPriceUpdateSpy).toHaveBeenCalledWith(testUpdate);
    });

    it("should wire aggregation service events to cache service", async () => {
      const testFeedId: EnhancedFeedId = {
        category: FeedCategory.Crypto,
        name: "BTC/USD",
      };

      const testAggregatedPrice = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        sources: ["test-source"],
        confidence: 0.95,
        consensusScore: 0.9,
      };

      // Spy on cache service setPrice method
      const setPriceSpy = jest.spyOn(cacheService, "setPrice");

      // Emit aggregated price from aggregation service
      aggregationService.emit("aggregatedPrice", testAggregatedPrice);

      // Wait a bit for async processing
      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify that the cache service received the price
      expect(setPriceSpy).toHaveBeenCalledWith(testFeedId, {
        value: testAggregatedPrice.price,
        timestamp: testAggregatedPrice.timestamp,
        sources: testAggregatedPrice.sources,
        confidence: testAggregatedPrice.confidence,
      });
    });

    it("should wire aggregation service events to accuracy monitor", async () => {
      const testAggregatedPrice = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        sources: ["test-source"],
        confidence: 0.95,
        consensusScore: 0.9,
      };

      // Spy on accuracy monitor recordPrice method
      const recordPriceSpy = jest.spyOn(accuracyMonitor, "recordPrice");

      // Emit aggregated price from aggregation service
      aggregationService.emit("aggregatedPrice", testAggregatedPrice);

      // Wait a bit for async processing
      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify that the accuracy monitor received the price
      expect(recordPriceSpy).toHaveBeenCalledWith(testAggregatedPrice);
    });

    it("should wire price updates to performance monitor", async () => {
      const testUpdate: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        source: "test-source",
        confidence: 0.95,
      };

      // Spy on performance monitor recordPriceUpdate method
      const recordPriceUpdateSpy = jest.spyOn(performanceMonitor, "recordPriceUpdate");

      // Emit price update from data manager
      dataManager.emit("priceUpdate", testUpdate);

      // Wait a bit for async processing
      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify that the performance monitor received the update
      expect(recordPriceUpdateSpy).toHaveBeenCalledWith(testUpdate);
    });
  });

  describe("Error Handling Wiring", () => {
    it("should wire data source errors to error handler", async () => {
      const testError = new Error("Test connection error");
      const sourceId = "test-source";

      // Spy on error handler handleError method
      const handleErrorSpy = jest.spyOn(errorHandler, "handleError");

      // Emit source error from data manager
      dataManager.emit("sourceError", sourceId, testError);

      // Wait a bit for async processing
      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify that the error handler received the error with enhanced context
      expect(handleErrorSpy).toHaveBeenCalledWith(
        testError,
        expect.objectContaining({
          sourceId,
          component: "dataSource",
          errorType: expect.any(String),
          exchangeName: expect.any(String),
          adapterType: expect.any(String),
          timestamp: expect.any(Number),
        })
      );
    });

    it("should wire source disconnection to connection recovery", async () => {
      const sourceId = "test-source";

      // Spy on error handler recordFailure method
      const recordFailureSpy = jest.spyOn(errorHandler, "recordFailure");

      // Emit source disconnection from data manager
      dataManager.emit("sourceDisconnected", sourceId);

      // Wait a bit for async processing
      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify that the error handler recorded the failure
      expect(recordFailureSpy).toHaveBeenCalledWith(sourceId);
    });
  });

  describe("Monitoring Integration", () => {
    it("should wire monitoring alerts to alerting service", async () => {
      const testAlert = {
        type: "accuracy_alert",
        feedId: "BTC/USD",
        deviation: 0.6,
        threshold: 0.5,
        timestamp: Date.now(),
        severity: "warning",
        message: "High consensus deviation for BTC/USD: 0.6%",
      };

      // Spy on alerting service sendAlert method (which is what actually gets called)
      const sendAlertSpy = jest.spyOn(alertingService, "sendAlert");

      // Emit accuracy alert from accuracy monitor
      accuracyMonitor.emit("accuracyAlert", testAlert);

      // Wait a bit for async processing
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify that the alerting service received the alert
      expect(sendAlertSpy).toHaveBeenCalled();
    });
  });

  describe("Data Flow Integration", () => {
    it("should complete full data flow from price update to cached result", async () => {
      const testFeedId: EnhancedFeedId = {
        category: FeedCategory.Crypto,
        name: "BTC/USD",
      };

      const testUpdate: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        source: "test-source",
        confidence: 0.95,
      };

      // Add the price update to aggregation service first
      aggregationService.addPriceUpdate(testFeedId, testUpdate);

      // Emit price update to trigger the full flow
      dataManager.emit("priceUpdate", testUpdate);

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify that the price was cached
      const cachedPrice = cacheService.getPrice(testFeedId);
      expect(cachedPrice).toBeDefined();
      expect(cachedPrice?.value).toBe(testUpdate.price);
    });
  });
});
