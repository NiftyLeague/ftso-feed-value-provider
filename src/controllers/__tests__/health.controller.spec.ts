import { HealthController } from "../health.controller";
import { IntegrationService } from "../../integration/integration.service";
import { RealTimeCacheService } from "../../cache/real-time-cache.service";
import { RealTimeAggregationService } from "../../aggregators/real-time-aggregation.service";
import { RateLimiterService } from "@/common/rate-limiting/rate-limiter.service";
import { ApiMonitorService } from "@/monitoring/api-monitor.service";

import { StandardizedErrorHandlerService } from "../../error-handling/standardized-error-handler.service";
import { UniversalRetryService } from "../../error-handling/universal-retry.service";
import { createTestModule, TestHelpers, MockSetup, MockFactory } from "@/__tests__/utils";

describe("HealthController - Health Check Endpoints", () => {
  let controller: HealthController;
  let integrationService: jest.Mocked<IntegrationService>;
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
      getAggregatedPrice: jest.fn().mockResolvedValue({
        price: 50000,
        confidence: 1,
        timestamp: Date.now(),
        sources: ["test"],
      }),
    };
    const mockRateLimiterService = {
      getStats: jest.fn().mockReturnValue({
        totalRequests: 0,
        allowedRequests: 0,
        blockedRequests: 0,
        hitRate: 1,
        averageResponseTime: 0,
      }),
      getRateLimitConfig: jest.fn().mockReturnValue({
        windowMs: 60000,
        maxRequests: 1000,
        skipSuccessfulRequests: false,
        skipFailedRequests: false,
      }),
    } as Partial<RateLimiterService>;
    const mockApiMonitorService = {
      getApiHealthMetrics: jest.fn().mockReturnValue({
        totalRequests: 0,
        requestsPerMinute: 0,
        averageResponseTime: 0,
        errorRate: 0,
        slowRequestRate: 0,
        criticalRequestRate: 0,
        topEndpoints: [],
        recentErrors: [],
        timestamp: Date.now(),
      }),
      getErrorAnalysis: jest.fn().mockReturnValue({
        totalErrors: 0,
        errorsByStatusCode: {},
        errorsByEndpoint: {},
        recentErrorTrends: [],
      }),
    } as Partial<ApiMonitorService>;

    module = await createTestModule()
      .addController(HealthController)
      .addProvider("FTSO_PROVIDER_SERVICE", mockProviderService)
      .addProvider(IntegrationService, mockIntegrationService)
      .addProvider(RealTimeCacheService, mockCacheService)
      .addProvider(RealTimeAggregationService, mockAggregationService)
      .addProvider(RateLimiterService, mockRateLimiterService)
      .addProvider(ApiMonitorService, mockApiMonitorService)

      .addProvider(StandardizedErrorHandlerService, {
        executeWithStandardizedHandling: jest.fn().mockImplementation(operation => operation()),
        handleValidationError: jest.fn(),
        handleAuthenticationError: jest.fn(),
        handleRateLimitError: jest.fn(),
        handleExternalServiceError: jest.fn(),
        getErrorStatistics: jest.fn().mockReturnValue({}),
      })
      .addProvider(UniversalRetryService, {
        executeWithRetry: jest.fn().mockImplementation(operation => operation()),
        executeHttpWithRetry: jest.fn().mockImplementation(operation => operation()),
        executeDatabaseWithRetry: jest.fn().mockImplementation(operation => operation()),
        executeCacheWithRetry: jest.fn().mockImplementation(operation => operation()),
        executeExternalApiWithRetry: jest.fn().mockImplementation(operation => operation()),
        configureRetrySettings: jest.fn(),
        getRetryStatistics: jest.fn().mockReturnValue({}),
      })
      .build();

    controller = TestHelpers.getService(module, HealthController);
    integrationService = TestHelpers.getService(module, IntegrationService);
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

  describe("getReadiness", () => {
    it("should return ready status when system is ready", async () => {
      integrationService.getSystemHealth.mockResolvedValue({
        status: "healthy",
        timestamp: Date.now(),
        sources: [
          { sourceId: "test-source", status: "healthy", lastUpdate: Date.now(), errorCount: 0, recoveryCount: 1 },
        ],
        aggregation: { successRate: 1, errorCount: 0 },
        performance: { averageResponseTime: 100, errorRate: 0.01 },
        accuracy: { averageConfidence: 0.99, outlierRate: 0.01 },
      });

      // Mock the startup time to be older than 15 seconds (past minStartupTime)
      (controller as any).startupTime = Date.now() - 20000;

      const result = await controller.getReadiness();

      expect((result as any).ready).toBe(true);
      // Status should be healthy or degraded (both indicate readiness)
      expect(["healthy", "degraded"]).toContain((result as any).status);
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
    });
  });
});
