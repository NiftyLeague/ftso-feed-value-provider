import { HealthController } from "../health.controller";
import { IntegrationService } from "../../integration/integration.service";
import { RealTimeCacheService } from "../../cache/real-time-cache.service";
import { RealTimeAggregationService } from "../../aggregators/real-time-aggregation.service";
import { RateLimiterService } from "@/common/rate-limiting/rate-limiter.service";
import { ApiMonitorService } from "@/monitoring/api-monitor.service";
import { ENV_HELPERS } from "@/config/environment.constants";

import { StandardizedErrorHandlerService } from "../../error-handling/standardized-error-handler.service";
import { UniversalRetryService } from "../../error-handling/universal-retry.service";
import { createTestModule, TestHelpers, MockSetup, MockFactory } from "@/__tests__/utils";
import { HttpException, HttpStatus } from "@nestjs/common";

describe("HealthController - Health Check Endpoints", () => {
  let controller: HealthController;
  let integrationService: jest.Mocked<IntegrationService>;
  let providerService: any;
  let cacheService: any;
  let aggregationService: any;
  let rateLimiterService: any;
  let apiMonitorService: any;
  let retryService: any;
  let standardizedErrorHandler: any;
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
      getCacheHealthStatus: jest.fn(),
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

    const mockStandardizedErrorHandler = {
      executeWithStandardizedHandling: jest.fn().mockImplementation(operation => operation()),
      handleValidationError: jest.fn(),
      handleAuthenticationError: jest.fn(),
      handleRateLimitError: jest.fn(),
      handleExternalServiceError: jest.fn(),
      getErrorStatistics: jest.fn().mockReturnValue({}),
    };

    const mockRetryService = {
      executeWithRetry: jest.fn().mockImplementation(operation => operation()),
      executeHttpWithRetry: jest.fn().mockImplementation(operation => operation()),
      executeDatabaseWithRetry: jest.fn().mockImplementation(operation => operation()),
      executeCacheWithRetry: jest.fn().mockImplementation(operation => operation()),
      executeExternalApiWithRetry: jest.fn().mockImplementation(operation => operation()),
      configureRetrySettings: jest.fn(),
      getRetryStatistics: jest.fn().mockReturnValue({}),
    };

    module = await createTestModule()
      .addController(HealthController)
      .addProvider("FTSO_PROVIDER_SERVICE", mockProviderService)
      .addProvider(IntegrationService, mockIntegrationService)
      .addProvider(RealTimeCacheService, mockCacheService)
      .addProvider(RealTimeAggregationService, mockAggregationService)
      .addProvider(RateLimiterService, mockRateLimiterService)
      .addProvider(ApiMonitorService, mockApiMonitorService)

      .addProvider(StandardizedErrorHandlerService, mockStandardizedErrorHandler)
      .addProvider(UniversalRetryService, mockRetryService)
      .build();

    controller = TestHelpers.getService(module, HealthController);
    integrationService = TestHelpers.getService(module, IntegrationService);

    providerService = TestHelpers.getService(module, "FTSO_PROVIDER_SERVICE");
    cacheService = TestHelpers.getService(module, RealTimeCacheService);
    aggregationService = TestHelpers.getService(module, RealTimeAggregationService);
    rateLimiterService = TestHelpers.getService(module, RateLimiterService);
    apiMonitorService = TestHelpers.getService(module, ApiMonitorService);
    retryService = TestHelpers.getService(module, UniversalRetryService);
    standardizedErrorHandler = TestHelpers.getService(module, StandardizedErrorHandlerService);
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

    it("should throw 503 (debug log) when integration service is still initializing", async () => {
      integrationService.isServiceInitialized.mockReturnValue(false);
      jest.spyOn(controller.logger as any, "debug").mockImplementation(() => undefined);

      await expect(controller.getReadiness()).rejects.toBeDefined();
      expect((controller.logger as any).debug).toHaveBeenCalled();
    });

    it("should become ready in production when healthy sources, aggregation, and all feed tests pass", async () => {
      jest.spyOn(ENV_HELPERS, "isDevelopment").mockReturnValue(false);
      integrationService.isServiceInitialized.mockReturnValue(true);
      integrationService.getSystemHealth.mockResolvedValue({
        status: "healthy",
        timestamp: Date.now(),
        sources: [
          { sourceId: "s1", status: "healthy", lastUpdate: Date.now(), errorCount: 0, recoveryCount: 0 },
          { sourceId: "s2", status: "healthy", lastUpdate: Date.now(), errorCount: 0, recoveryCount: 0 },
        ],
        aggregation: { successRate: 100, errorCount: 0 },
        performance: { averageResponseTime: 10, errorRate: 0 },
        accuracy: { averageConfidence: 0.99, outlierRate: 0 },
      });

      const aggregationService = TestHelpers.getService(module, RealTimeAggregationService) as any;
      aggregationService.getAggregatedPrice.mockResolvedValue({
        price: 50000,
        confidence: 0.9,
        timestamp: Date.now(),
        sources: ["test"],
      });

      (controller as any).startupTime = Date.now() - 20000;

      const result = await controller.getReadiness();
      expect(result.ready).toBe(true);
      expect(["healthy", "degraded"]).toContain(result.status);
      expect((controller as any).readyTime).not.toBeNull();
    });

    it("should report warming_up (503) when core connectivity ok but feed test fails", async () => {
      jest.spyOn(ENV_HELPERS, "isDevelopment").mockReturnValue(false);
      integrationService.isServiceInitialized.mockReturnValue(true);
      integrationService.getSystemHealth.mockResolvedValue({
        status: "healthy",
        timestamp: Date.now(),
        sources: [{ sourceId: "s1", status: "healthy", lastUpdate: Date.now(), errorCount: 0, recoveryCount: 0 }],
        aggregation: { successRate: 100, errorCount: 0 },
        performance: { averageResponseTime: 10, errorRate: 0 },
        accuracy: { averageConfidence: 0.99, outlierRate: 0 },
      });

      const aggregationService = TestHelpers.getService(module, RealTimeAggregationService) as any;
      // One of the feed probes returns invalid/null price
      aggregationService.getAggregatedPrice
        .mockResolvedValueOnce({ price: 50000, confidence: 0.9, timestamp: Date.now(), sources: ["test"] })
        .mockResolvedValueOnce({ price: null, confidence: 0, timestamp: Date.now(), sources: ["test"] })
        .mockResolvedValue({ price: 50000, confidence: 0.9, timestamp: Date.now(), sources: ["test"] });

      (controller as any).startupTime = Date.now() - 20000;

      await expect(controller.getReadiness()).rejects.toBeDefined();
    });

    it("logs warn after the system has been ready, but rate-limits warnings within cooldown", async () => {
      // Force readiness to fail deterministically but mark system as previously ready
      (controller as any).readyTime = Date.now() - 60000;
      (controller as any).readinessWarnLastLogged = 0;

      jest.spyOn(controller.logger as any, "warn").mockImplementation(() => undefined);
      jest.spyOn(controller.logger as any, "debug").mockImplementation(() => undefined);

      const performSpy = jest.spyOn(controller as any, "performReadinessChecks").mockResolvedValue({
        checks: {
          integration: { ready: true, status: "healthy", error: null },
          provider: { ready: true, status: "healthy", error: null },
          startup: { ready: false },
        },
        diagnostics: {
          healthySources: 1,
          totalSources: 1,
          aggregationSuccessRate: 100,
          canServeFeedData: false,
          state: "warming_up",
          validFeedCount: 0,
          totalTestFeeds: 4,
        },
      });

      // First failure should warn
      await expect(controller.getReadiness()).rejects.toBeDefined();
      expect((controller.logger as any).warn).toHaveBeenCalled();

      // Second failure inside cooldown should debug
      await expect(controller.getReadiness()).rejects.toBeDefined();
      expect((controller.logger as any).debug).toHaveBeenCalled();

      performSpy.mockRestore();
    });

    it("throws a fallback 503 when an unexpected error occurs", async () => {
      jest.spyOn(controller as any, "performReadinessChecks").mockRejectedValue(new Error("boom"));

      await expect(controller.getReadiness()).rejects.toBeInstanceOf(HttpException);

      try {
        await controller.getReadiness();
      } catch (e) {
        const ex = e as HttpException;
        expect(ex.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
        expect((ex.getResponse() as any).message).toContain("Readiness check failed: boom");
      }
    });

    it("reports not_ready (503) when integration is initialized but no sources are configured", async () => {
      jest.spyOn(ENV_HELPERS, "isDevelopment").mockReturnValue(false);

      integrationService.isServiceInitialized.mockReturnValue(true);
      integrationService.getSystemHealth.mockResolvedValue({
        status: "healthy",
        timestamp: Date.now(),
        sources: [],
        aggregation: { successRate: 0, errorCount: 0 },
        performance: { averageResponseTime: 10, errorRate: 0 },
        accuracy: { averageConfidence: 0.99, outlierRate: 0 },
      });

      jest.spyOn(controller.logger as any, "debug").mockImplementation(() => undefined);

      await expect(controller.getReadiness()).rejects.toBeInstanceOf(HttpException);
    });

    it("logs 'waiting for data sources' when production has 0 configured sources", async () => {
      jest.spyOn(ENV_HELPERS, "isDevelopment").mockReturnValue(false);
      integrationService.isServiceInitialized.mockReturnValue(true);
      integrationService.getSystemHealth.mockResolvedValue({
        status: "healthy",
        timestamp: Date.now(),
        sources: [],
        aggregation: { successRate: 0, errorCount: 0 },
        performance: { averageResponseTime: 10, errorRate: 0 },
        accuracy: { averageConfidence: 0.99, outlierRate: 0 },
      } as any);

      const debugSpy = jest.spyOn(controller.logger as any, "debug").mockImplementation(() => undefined);

      const res = await (controller as any).performReadinessChecks();

      expect(res.diagnostics.state).toBe("not_ready");
      expect(res.checks.startup.ready).toBe(false);
      expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining("Waiting for data sources to connect"));
    });

    it("warns when sources are configured but none are healthy", async () => {
      jest.spyOn(ENV_HELPERS, "isDevelopment").mockReturnValue(false);
      integrationService.isServiceInitialized.mockReturnValue(true);
      integrationService.getSystemHealth.mockResolvedValue({
        status: "healthy",
        timestamp: Date.now(),
        sources: [
          { sourceId: "s1", status: "unhealthy", lastUpdate: Date.now(), errorCount: 1, recoveryCount: 0 },
          { sourceId: "s2", status: "degraded", lastUpdate: Date.now(), errorCount: 1, recoveryCount: 0 },
        ],
        aggregation: { successRate: 100, errorCount: 0 },
        performance: { averageResponseTime: 10, errorRate: 0 },
        accuracy: { averageConfidence: 0.99, outlierRate: 0 },
      } as any);

      const warnSpy = jest.spyOn(controller.logger as any, "warn").mockImplementation(() => undefined);

      // Exercise feed probe error branches (per-feed catch)
      const aggregationService = TestHelpers.getService(module, RealTimeAggregationService) as any;
      aggregationService.getAggregatedPrice.mockRejectedValue(new Error("no data"));

      const res = await (controller as any).performReadinessChecks();

      expect(res.diagnostics.state).toBe("not_ready");
      expect(res.checks.startup.ready).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("sources healthy"));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Check proxy configuration"));
    });

    it("warns when sources are healthy but no successful aggregations yet", async () => {
      jest.spyOn(ENV_HELPERS, "isDevelopment").mockReturnValue(false);
      integrationService.isServiceInitialized.mockReturnValue(true);
      integrationService.getSystemHealth.mockResolvedValue({
        status: "healthy",
        timestamp: Date.now(),
        sources: [{ sourceId: "s1", status: "healthy", lastUpdate: Date.now(), errorCount: 0, recoveryCount: 0 }],
        aggregation: { successRate: 0, errorCount: 0 },
        performance: { averageResponseTime: 10, errorRate: 0 },
        accuracy: { averageConfidence: 0.99, outlierRate: 0 },
      } as any);

      const warnSpy = jest.spyOn(controller.logger as any, "warn").mockImplementation(() => undefined);

      // Exercise invalid feed result branches (non-null but invalid)
      const aggregationService = TestHelpers.getService(module, RealTimeAggregationService) as any;
      aggregationService.getAggregatedPrice.mockResolvedValue({
        price: 0,
        confidence: 0,
        timestamp: Date.now(),
        sources: [],
      });

      const res = await (controller as any).performReadinessChecks();

      expect(res.diagnostics.state).toBe("not_ready");
      expect(res.checks.startup.ready).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("no successful aggregations yet"));
    });

    it("sets startup not ready when system health cannot be determined", async () => {
      jest.spyOn(ENV_HELPERS, "isDevelopment").mockReturnValue(false);
      integrationService.isServiceInitialized.mockReturnValue(true);

      integrationService.getSystemHealth
        .mockResolvedValueOnce({
          status: "healthy",
          timestamp: Date.now(),
          sources: [{ sourceId: "s1", status: "healthy", lastUpdate: Date.now(), errorCount: 0, recoveryCount: 0 }],
          aggregation: { successRate: 100, errorCount: 0 },
          performance: { averageResponseTime: 10, errorRate: 0 },
          accuracy: { averageConfidence: 0.99, outlierRate: 0 },
        } as any)
        .mockRejectedValueOnce(new Error("boom"));

      const debugSpy = jest.spyOn(controller.logger as any, "debug").mockImplementation(() => undefined);

      const res = await (controller as any).performReadinessChecks();

      expect(res.checks.startup.ready).toBe(false);
      expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining("Cannot determine system health"));
    });

    it("does not log initialization debug when not initializing and integration is not ready", async () => {
      (controller as any).isInitializingStartup = false;
      integrationService.isServiceInitialized.mockReturnValue(false);

      const debugSpy = jest.spyOn(controller.logger as any, "debug").mockImplementation(() => undefined);

      await (controller as any).performReadinessChecks();

      expect(debugSpy).not.toHaveBeenCalledWith("System initializing - integration service still starting up");
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

    it("throws 503 when liveness checks indicate dead", async () => {
      jest.spyOn(controller as any, "performLivenessChecks").mockResolvedValue({
        integration: false,
        provider: false,
        memory: true,
        responseTime: 10,
      });

      await expect(controller.getLiveness()).rejects.toBeInstanceOf(HttpException);

      try {
        await controller.getLiveness();
      } catch (e) {
        const ex = e as HttpException;
        expect(ex.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
        expect((ex.getResponse() as any).status).toBe("dead");
      }
    });

    it("throws fallback 503 when liveness check throws an unexpected error", async () => {
      jest.spyOn(controller as any, "performLivenessChecks").mockRejectedValue(new Error("boom"));

      await expect(controller.getLiveness()).rejects.toBeInstanceOf(HttpException);

      try {
        await controller.getLiveness();
      } catch (e) {
        const ex = e as HttpException;
        expect(ex.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
        expect((ex.getResponse() as any).message).toContain("Liveness check failed: boom");
      }
    });
  });

  describe("performLivenessChecks", () => {
    it("marks memory unhealthy when heap usage exceeds 90%", async () => {
      integrationService.getSystemHealth.mockResolvedValue({
        status: "healthy",
        timestamp: Date.now(),
        sources: [],
        aggregation: { successRate: 1, errorCount: 0 },
        performance: { averageResponseTime: 10, errorRate: 0 },
        accuracy: { averageConfidence: 0.99, outlierRate: 0 },
      });

      jest.spyOn(process, "memoryUsage").mockReturnValue({
        rss: 100,
        heapTotal: 100,
        heapUsed: 91,
        external: 0,
        arrayBuffers: 0,
      } as any);

      const checks = await (controller as any).performLivenessChecks();
      expect(checks.integration).toBe(true);
      expect(checks.provider).toBe(true);
      expect(checks.memory).toBe(false);
    });
  });

  describe("getDetailedHealth", () => {
    const mockProbes = () => {
      jest.spyOn(controller as any, "performReadinessChecks").mockResolvedValue({
        checks: {
          integration: { ready: true, status: "healthy", error: null },
          provider: { ready: true, status: "healthy", error: null },
          startup: { ready: true },
        },
        diagnostics: {
          healthySources: 1,
          totalSources: 1,
          aggregationSuccessRate: 100,
          canServeFeedData: true,
          state: "ready",
          validFeedCount: 4,
          totalTestFeeds: 4,
        },
      });

      jest.spyOn(controller as any, "performLivenessChecks").mockResolvedValue({
        integration: true,
        provider: true,
        memory: true,
        responseTime: 10,
      });
    };

    const setBaselineMocks = () => {
      integrationService.getSystemHealth.mockResolvedValue({
        status: "healthy",
        timestamp: Date.now(),
        sources: [],
        aggregation: { successRate: 100, errorCount: 0 },
        performance: { averageResponseTime: 50, errorRate: 0.01 },
        accuracy: { averageConfidence: 0.99, outlierRate: 0.01 },
      } as any);

      (providerService.getPerformanceMetrics as jest.Mock).mockResolvedValue({
        uptime: 3600,
        responseTime: { average: 100, p95: 150, max: 200 },
        requestsPerSecond: 20,
        errorRate: 0,
        cacheStats: { hitRate: 0.9 },
        aggregationStats: { totalRequests: 0 },
        activeFeedCount: 4,
      });

      (apiMonitorService.getApiHealthMetrics as jest.Mock).mockReturnValue({
        totalRequests: 100,
        requestsPerMinute: 60,
        averageResponseTime: 10,
        errorRate: 0,
        slowRequestRate: 0,
        criticalRequestRate: 0,
        topEndpoints: [],
        recentErrors: [],
        timestamp: Date.now(),
      });
      (apiMonitorService.getErrorAnalysis as jest.Mock).mockReturnValue({
        totalErrors: 0,
        errorsByStatusCode: {},
        errorsByEndpoint: {},
        recentErrorTrends: [],
      });

      (rateLimiterService.getStats as jest.Mock).mockReturnValue({
        totalRequests: 100,
        allowedRequests: 100,
        blockedRequests: 0,
        hitRate: 1,
        averageResponseTime: 1,
      });
      (rateLimiterService.getRateLimitConfig as jest.Mock).mockReturnValue({
        windowMs: 60000,
        maxRequests: 1000,
        skipSuccessfulRequests: false,
        skipFailedRequests: false,
      });

      (retryService.getRetryStatistics as jest.Mock).mockReturnValue({
        opA: { totalRetries: 0, successfulRetries: 0, failedRetries: 0 },
      });

      (standardizedErrorHandler.getErrorStatistics as jest.Mock).mockReturnValue({
        modA: { totalErrors: 0, consecutiveFailures: 0 },
      });

      (integrationService.getAdapterStats as jest.Mock).mockReturnValue({
        total: 10,
        active: 10,
        byCategory: {},
        byHealth: { healthy: 10 },
      });

      (cacheService.getStats as jest.Mock).mockReturnValue({ hitRate: 0.9 });
      (cacheService.getCacheHealthStatus as jest.Mock).mockReturnValue({
        status: "healthy",
        reason: "ok",
        metrics: { hitRate: 0.9 },
      });

      (aggregationService.getCacheStats as jest.Mock).mockReturnValue({ totalEntries: 1 });

      mockProbes();
    };

    it("returns overall healthy when all components are healthy", async () => {
      setBaselineMocks();

      const result = await controller.getDetailedHealth();

      expect(result.status).toBe("healthy");
      expect(result.components.api.status).toBe("healthy");
      expect(result.components.rateLimiter.status).toBe("healthy");
      expect(result.components.retries.status).toBe("healthy");
      expect(result.components.errorHandling.status).toBe("healthy");
      expect(result.components.integration.status).toBe("healthy");
      expect(result.components.aggregation.status).toBe("healthy");
    });

    it("marks api as degraded when errorRate is above degraded threshold", async () => {
      setBaselineMocks();
      (apiMonitorService.getApiHealthMetrics as jest.Mock).mockReturnValue({
        totalRequests: 100,
        requestsPerMinute: 60,
        averageResponseTime: 10,
        errorRate: 15,
        slowRequestRate: 0,
        criticalRequestRate: 0,
        topEndpoints: [],
        recentErrors: [],
        timestamp: Date.now(),
      });

      const result = await controller.getDetailedHealth();

      expect(result.components.api.status).toBe("degraded");
      expect(result.status).toBe("degraded");
    });

    it("marks api as unhealthy when errorRate is above unhealthy threshold", async () => {
      setBaselineMocks();
      (apiMonitorService.getApiHealthMetrics as jest.Mock).mockReturnValue({
        totalRequests: 100,
        requestsPerMinute: 60,
        averageResponseTime: 10,
        errorRate: 35,
        slowRequestRate: 0,
        criticalRequestRate: 0,
        topEndpoints: [],
        recentErrors: [],
        timestamp: Date.now(),
      });

      const result = await controller.getDetailedHealth();

      expect(result.components.api.status).toBe("unhealthy");
      expect(result.status).toBe("unhealthy");
    });

    it("marks rate limiter degraded when hitRate is below threshold", async () => {
      setBaselineMocks();
      (rateLimiterService.getStats as jest.Mock).mockReturnValue({
        totalRequests: 100,
        allowedRequests: 50,
        blockedRequests: 50,
        hitRate: 0.5,
        averageResponseTime: 1,
      });

      const result = await controller.getDetailedHealth();
      expect(result.components.rateLimiter.status).toBe("degraded");
      expect(result.status).toBe("degraded");
    });

    it("covers retry and error-handling status thresholds", async () => {
      setBaselineMocks();

      (retryService.getRetryStatistics as jest.Mock).mockReturnValue({
        opA: { totalRetries: 10, successfulRetries: 2, failedRetries: 6 },
      });
      (standardizedErrorHandler.getErrorStatistics as jest.Mock).mockReturnValue({
        modA: { totalErrors: 10, consecutiveFailures: 1 },
      });

      const degraded = await controller.getDetailedHealth();
      expect(degraded.components.retries.status).toBe("degraded");
      expect(degraded.components.errorHandling.status).toBe("degraded");
      expect(degraded.status).toBe("degraded");

      (retryService.getRetryStatistics as jest.Mock).mockReturnValue({
        opA: { totalRetries: 30, successfulRetries: 0, failedRetries: 21 },
      });
      (standardizedErrorHandler.getErrorStatistics as jest.Mock).mockReturnValue({
        modA: { totalErrors: 100, consecutiveFailures: 11 },
      });

      const unhealthy = await controller.getDetailedHealth();
      expect(unhealthy.components.retries.status).toBe("unhealthy");
      expect(unhealthy.components.errorHandling.status).toBe("unhealthy");
      expect(unhealthy.status).toBe("unhealthy");
    });

    it("covers integration active ratio thresholds", async () => {
      setBaselineMocks();

      (integrationService.getAdapterStats as jest.Mock).mockReturnValue({
        total: 10,
        active: 8,
        byCategory: {},
        byHealth: {},
      });
      const degraded = await controller.getDetailedHealth();
      expect(degraded.components.integration.status).toBe("degraded");

      (integrationService.getAdapterStats as jest.Mock).mockReturnValue({
        total: 10,
        active: 6,
        byCategory: {},
        byHealth: {},
      });
      const unhealthy = await controller.getDetailedHealth();
      expect(unhealthy.components.integration.status).toBe("unhealthy");
    });

    it("falls back to an unhealthy response when dependencies throw", async () => {
      setBaselineMocks();
      integrationService.getSystemHealth.mockRejectedValue(new Error("boom"));

      const result = await controller.getDetailedHealth();
      expect(result.status).toBe("unhealthy");
      expect((result.details as any).error).toBe("boom");
      expect(result.components.api.status).toBe("unhealthy");
    });
  });

  describe("getHealth", () => {
    it("throws 503 when detailed health is unhealthy", async () => {
      jest.spyOn(controller, "getDetailedHealth").mockResolvedValue({
        status: "unhealthy",
        timestamp: 123,
      } as any);

      await expect(controller.getHealth()).rejects.toBeInstanceOf(HttpException);

      try {
        await controller.getHealth();
      } catch (e) {
        const ex = e as HttpException;
        expect(ex.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      }
    });
  });
});
