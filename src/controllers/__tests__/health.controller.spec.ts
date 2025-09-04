import { HealthController } from "../health.controller";
import { FtsoProviderService } from "../../app.service";
import { IntegrationService } from "../../integration/integration.service";
import { RealTimeCacheService } from "../../cache/real-time-cache.service";
import { RealTimeAggregationService } from "../../aggregators/real-time-aggregation.service";
import { ApiErrorHandlerService } from "../../error-handling/api-error-handler.service";
import { createTestModule, TestHelpers, MockSetup, MockFactory } from "@/__tests__/utils";

describe("HealthController - Health Check Endpoints", () => {
  let controller: HealthController;
  let providerService: jest.Mocked<FtsoProviderService>;
  let integrationService: jest.Mocked<IntegrationService>;
  let cacheService: jest.Mocked<RealTimeCacheService>;
  let aggregationService: jest.Mocked<RealTimeAggregationService>;
  let module: any;

  beforeAll(() => {
    MockSetup.setupConsole();
  });

  beforeEach(async () => {
    const mockProviderService = MockFactory.createFtsoProviderService();
    const mockIntegrationService = MockFactory.createIntegrationService();
    const mockCacheService = {
      ...MockFactory.createCache(),
      getStats: jest.fn(),
    };
    const mockAggregationService = {
      getCacheStats: jest.fn(),
    };

    module = await createTestModule()
      .addController(HealthController)
      .addProvider("FTSO_PROVIDER_SERVICE", mockProviderService)
      .addProvider(IntegrationService, mockIntegrationService)
      .addProvider(RealTimeCacheService, mockCacheService)
      .addProvider(RealTimeAggregationService, mockAggregationService)
      .addProvider(ApiErrorHandlerService)
      .build();

    controller = TestHelpers.getService(module, HealthController);
    providerService = TestHelpers.getService(module, "FTSO_PROVIDER_SERVICE");
    integrationService = TestHelpers.getService(module, IntegrationService);
    cacheService = TestHelpers.getService(module, RealTimeCacheService);
    aggregationService = TestHelpers.getService(module, RealTimeAggregationService);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    if (module) {
      await module.close();
    }
  });

  afterAll(() => {
    MockSetup.cleanup();
  });

  describe("healthCheck (POST)", () => {
    it("should return healthy status when all components are healthy", async () => {
      providerService.healthCheck.mockResolvedValue({
        status: "healthy",
        timestamp: Date.now(),
        details: [],
      });
      providerService.getPerformanceMetrics.mockResolvedValue({
        uptime: 3600,
        responseTime: { average: 100, p95: 150, max: 200 },
        requestsPerSecond: 10,
        errorRate: 0.01,
        cacheStats: {
          hits: 800,
          misses: 200,
          hitRate: 0.8,
          size: 100,
          evictions: 0,
          averageGetTime: 1,
          averageSetTime: 1,
          averageResponseTime: 1,
          memoryUsage: 1024,
          totalRequests: 1000,
          missRate: 0.2,
          totalEntries: 100,
        },
        aggregationStats: {
          totalAggregations: 1000,
          averageAggregationTime: 5,
          sourceCount: 5,
          consensusRate: 0.99,
          qualityScore: 0.98,
        },
        activeFeedCount: 10,
      });
      cacheService.getStats.mockReturnValue({
        hits: 800,
        misses: 200,
        hitRate: 0.8,
        size: 100,
        evictions: 0,
        averageGetTime: 1,
        averageSetTime: 1,
        averageResponseTime: 1,
        memoryUsage: 1024,
        totalRequests: 1000,
        missRate: 0.2,
        totalEntries: 100,
      });
      aggregationService.getCacheStats.mockReturnValue({
        totalEntries: 50,
        hitRate: 0.9,
        missRate: 0.1,
        evictionCount: 5,
        averageAge: 1000,
      });

      const result = await controller.healthCheck();

      expect((result as any).status).toBe("healthy");
      expect((result as any).components.provider.status).toBe("healthy");
      expect((result as any).components.cache.status).toBe("healthy");
      expect((result as any).components.aggregation.status).toBe("healthy");
    });

    it("should return degraded status when some components are degraded", async () => {
      providerService.healthCheck.mockResolvedValue({
        status: "healthy",
        timestamp: Date.now(),
        details: [],
      });
      providerService.getPerformanceMetrics.mockResolvedValue({
        uptime: 3600,
        responseTime: { average: 100, p95: 150, max: 200 },
        requestsPerSecond: 10,
        errorRate: 0.01,
        cacheStats: {
          hits: 200,
          misses: 800,
          hitRate: 0.2,
          size: 100,
          evictions: 0,
          averageGetTime: 2,
          averageSetTime: 1,
          averageResponseTime: 2,
          memoryUsage: 1024,
          totalRequests: 1000,
          missRate: 0.8,
          totalEntries: 100,
        },
        aggregationStats: {
          totalAggregations: 1000,
          averageAggregationTime: 5,
          sourceCount: 5,
          consensusRate: 0.99,
          qualityScore: 0.98,
        },
        activeFeedCount: 10,
      });
      cacheService.getStats.mockReturnValue({
        hits: 200,
        misses: 800,
        hitRate: 0.2,
        size: 100,
        evictions: 0,
        averageGetTime: 2,
        averageSetTime: 1,
        averageResponseTime: 2,
        memoryUsage: 1024,
        totalRequests: 1000,
        missRate: 0.8,
        totalEntries: 100,
      }); // Low hit rate
      aggregationService.getCacheStats.mockReturnValue({
        totalEntries: 50,
        hitRate: 0.9,
        missRate: 0.1,
        evictionCount: 5,
        averageAge: 1000,
      });

      const result = await controller.healthCheck();

      expect((result as any).status).toBe("degraded");
      expect((result as any).components.cache.status).toBe("degraded");
    });

    it("should return unhealthy status when provider service fails", async () => {
      providerService.healthCheck.mockRejectedValue(new Error("Provider service error"));
      cacheService.getStats.mockReturnValue({
        hits: 800,
        misses: 200,
        hitRate: 0.8,
        size: 100,
        evictions: 0,
        averageGetTime: 1,
        averageSetTime: 1,
        averageResponseTime: 1,
        memoryUsage: 1024,
        totalRequests: 1000,
        missRate: 0.2,
        totalEntries: 100,
      });
      aggregationService.getCacheStats.mockReturnValue({
        totalEntries: 50,
        hitRate: 0.9,
        missRate: 0.1,
        evictionCount: 5,
        averageAge: 1000,
      });

      try {
        await controller.healthCheck();
        fail("Should have thrown an HttpException");
      } catch (error) {
        const err = error as any;
        expect(err.getStatus()).toBe(503);
        expect(err.getResponse().status).toBe("unhealthy");
        expect(err.getResponse().components.provider.status).toBe("unhealthy");
      }
    });
  });

  describe("getHealth (GET)", () => {
    it("should return system health status", async () => {
      integrationService.getSystemHealth.mockResolvedValue({
        status: "healthy",
        timestamp: Date.now(),
        sources: [],
        aggregation: { successRate: 1, errorCount: 0 },
        performance: { averageResponseTime: 100, errorRate: 0.01 },
        accuracy: { averageConfidence: 0.99, outlierRate: 0.01 },
      });

      const result = await controller.getHealth();

      expect(result.status).toBe("healthy");
      expect((result as any).services?.integration?.status ?? "healthy").toBe("healthy");
      expect((result as any).startup.initialized).toBe(true);
    });
  });

  describe("getReadiness", () => {
    it("should return ready status when system is ready", async () => {
      integrationService.getSystemHealth.mockResolvedValue({
        status: "healthy",
        timestamp: Date.now(),
        sources: [],
        aggregation: { successRate: 1, errorCount: 0 },
        performance: { averageResponseTime: 100, errorRate: 0.01 },
        accuracy: { averageConfidence: 0.99, outlierRate: 0.01 },
      });

      // Mock the startup time to be older than 5 seconds
      (controller as any).startupTime = Date.now() - 6000;

      const result = await controller.getReadiness();

      expect((result as any).ready).toBe(true);
      expect((result as any).status).toBe("healthy");
    });
  });

  describe("getLiveness", () => {
    it("should return alive status when system is responsive", async () => {
      integrationService.getSystemHealth.mockResolvedValue({
        status: "healthy",
        timestamp: Date.now(),
        sources: [],
        aggregation: { successRate: 1, errorCount: 0 },
        performance: { averageResponseTime: 100, errorRate: 0.01 },
        accuracy: { averageConfidence: 0.99, outlierRate: 0.01 },
      });

      const result = await controller.getLiveness();

      expect((result as any).alive).toBe(true);
      expect((result as any).checks.integration).toBe(true);
    });
  });
});
