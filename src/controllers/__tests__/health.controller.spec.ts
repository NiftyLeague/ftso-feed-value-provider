import { Test, TestingModule } from "@nestjs/testing";
import { HttpStatus } from "@nestjs/common";
import { HealthController } from "../health.controller";
import { FtsoProviderService } from "../../app.service";
import { ProductionIntegrationService } from "../../integration/production-integration.service";
import { RealTimeCacheService } from "../../cache/real-time-cache.service";
import { RealTimeAggregationService } from "../../aggregators/real-time-aggregation.service";
import { ApiErrorHandlerService } from "../../error-handling/api-error-handler.service";

describe("HealthController - Health Check Endpoints", () => {
  let controller: HealthController;
  let providerService: jest.Mocked<FtsoProviderService>;
  let integrationService: jest.Mocked<ProductionIntegrationService>;
  let cacheService: jest.Mocked<RealTimeCacheService>;
  let aggregationService: jest.Mocked<RealTimeAggregationService>;

  beforeEach(async () => {
    const mockProviderService = {
      healthCheck: jest.fn(),
      getPerformanceMetrics: jest.fn(),
    };

    const mockIntegrationService = {
      getSystemHealth: jest.fn(),
    };

    const mockCacheService = {
      getStats: jest.fn(),
    };

    const mockAggregationService = {
      getCacheStats: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: "FTSO_PROVIDER_SERVICE",
          useValue: mockProviderService,
        },
        {
          provide: ProductionIntegrationService,
          useValue: mockIntegrationService,
        },
        {
          provide: RealTimeCacheService,
          useValue: mockCacheService,
        },
        {
          provide: RealTimeAggregationService,
          useValue: mockAggregationService,
        },
        {
          provide: ApiErrorHandlerService,
          useClass: ApiErrorHandlerService,
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    providerService = module.get("FTSO_PROVIDER_SERVICE");
    integrationService = module.get(ProductionIntegrationService);
    cacheService = module.get(RealTimeCacheService);
    aggregationService = module.get(RealTimeAggregationService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("healthCheck (POST)", () => {
    it("should return healthy status when all components are healthy", async () => {
      providerService.healthCheck.mockResolvedValue({ status: "healthy", details: {} });
      providerService.getPerformanceMetrics.mockResolvedValue({
        cacheStats: {},
        aggregationStats: {},
        activeFeedCount: 10,
      });
      cacheService.getStats.mockReturnValue({
        hitRate: 0.8,
        missRate: 0.2,
        totalRequests: 1000,
        totalEntries: 100,
        memoryUsage: 1024,
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
      providerService.healthCheck.mockResolvedValue({ status: "healthy", details: {} });
      providerService.getPerformanceMetrics.mockResolvedValue({
        cacheStats: {},
        aggregationStats: {},
        activeFeedCount: 10,
      });
      cacheService.getStats.mockReturnValue({
        hitRate: 0.2,
        missRate: 0.8,
        totalRequests: 1000,
        totalEntries: 100,
        memoryUsage: 1024,
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
        hitRate: 0.8,
        missRate: 0.2,
        totalRequests: 1000,
        totalEntries: 100,
        memoryUsage: 1024,
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
        expect(error.getStatus()).toBe(503);
        expect(error.getResponse().status).toBe("unhealthy");
        expect(error.getResponse().components.provider.status).toBe("unhealthy");
      }
    });
  });

  describe("getHealth (GET)", () => {
    it("should return system health status", async () => {
      integrationService.getSystemHealth.mockResolvedValue({
        status: "healthy",
        connections: { active: 5, total: 5 },
        adapters: { healthy: 3, total: 3 },
        cache: { status: "healthy" },
      });

      const result = await controller.getHealth();

      expect(result.status).toBe("healthy");
      expect((result as any).services.integration.status).toBe("healthy");
      expect(result.startup.initialized).toBe(true);
    });
  });

  describe("getReadiness", () => {
    it("should return ready status when system is ready", async () => {
      integrationService.getSystemHealth.mockResolvedValue({
        status: "healthy",
        connections: { active: 5, total: 5 },
        adapters: { healthy: 3, total: 3 },
        cache: { status: "healthy" },
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
        connections: { active: 5, total: 5 },
        adapters: { healthy: 3, total: 3 },
        cache: { status: "healthy" },
      });

      const result = await controller.getLiveness();

      expect((result as any).alive).toBe(true);
      expect((result as any).checks.integration).toBe(true);
    });
  });
});
