import { Test, TestingModule } from "@nestjs/testing";
import { MetricsController } from "../metrics.controller";

import { StandardizedErrorHandlerService } from "../../error-handling/standardized-error-handler.service";
import { UniversalRetryService } from "../../error-handling/universal-retry.service";
import { ApiMonitorService } from "../../monitoring/api-monitor.service";
import { RateLimitGuard } from "@/common/rate-limiting/rate-limit.guard";

describe("MetricsController - Metrics and Monitoring Endpoints", () => {
  let controller: MetricsController;
  let apiMonitor: jest.Mocked<ApiMonitorService>;

  beforeEach(async () => {
    const mockApiMonitor = {
      getApiHealthMetrics: jest.fn(),
      getAllEndpointStats: jest.fn(),
      getPerformanceMetrics: jest.fn(),
      getErrorAnalysis: jest.fn(),
      getMetricsCount: jest.fn(),
      recordApiRequest: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MetricsController],
      providers: [
        {
          provide: ApiMonitorService,
          useValue: mockApiMonitor,
        },
        {
          provide: StandardizedErrorHandlerService,
          useValue: {
            executeWithStandardizedHandling: jest.fn().mockImplementation(operation => operation()),
            handleValidationError: jest.fn(),
            handleAuthenticationError: jest.fn(),
            handleRateLimitError: jest.fn(),
            handleExternalServiceError: jest.fn(),
            getErrorStatistics: jest.fn().mockReturnValue({}),
          },
        },
        {
          provide: UniversalRetryService,
          useValue: {
            executeWithRetry: jest.fn().mockImplementation(operation => operation()),
            executeHttpWithRetry: jest.fn().mockImplementation(operation => operation()),
            executeDatabaseWithRetry: jest.fn().mockImplementation(operation => operation()),
            executeCacheWithRetry: jest.fn().mockImplementation(operation => operation()),
            executeExternalApiWithRetry: jest.fn().mockImplementation(operation => operation()),
            configureRetrySettings: jest.fn(),
            getRetryStatistics: jest.fn().mockReturnValue({}),
          },
        },
      ],
    })
      .overrideGuard(RateLimitGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<MetricsController>(MetricsController);
    apiMonitor = module.get(ApiMonitorService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("getApiMetrics", () => {
    it("should return comprehensive API metrics", async () => {
      const mockHealthMetrics = {
        timestamp: Date.now(),
        totalRequests: 1000,
        requestsPerMinute: 50,
        averageResponseTime: 75,
        errorRate: 0.02,
        slowRequestRate: 0.1,
        criticalRequestRate: 0.01,
        topEndpoints: [],
        recentErrors: [],
      };

      const mockEndpointStats = [
        {
          endpoint: "/feed-values/",
          totalRequests: 500,
          successfulRequests: 495,
          failedRequests: 5,
          averageResponseTime: 50,
          maxResponseTime: 200,
          minResponseTime: 10,
          p95ResponseTime: 100,
          p99ResponseTime: 150,
          averageResponseSize: 1024,
          errorRate: 0.01,
          lastRequest: Date.now(),
          statusCodeDistribution: { 200: 495, 400: 3, 500: 2 },
        },
        {
          endpoint: "/volumes/",
          totalRequests: 300,
          successfulRequests: 290,
          failedRequests: 10,
          averageResponseTime: 100,
          maxResponseTime: 300,
          minResponseTime: 20,
          p95ResponseTime: 200,
          p99ResponseTime: 250,
          averageResponseSize: 2048,
          errorRate: 0.03,
          lastRequest: Date.now(),
          statusCodeDistribution: { 200: 290, 400: 5, 500: 5 },
        },
      ];

      const mockPerformanceMetrics = {
        requestCount: 1000,
        averageResponseTime: 75,
        errorRate: 0.02,
        throughput: 16.67,
        responseTimes: [50, 75, 100, 125],
      };

      const mockErrorAnalysis = {
        totalErrors: 20,
        errorsByStatusCode: { 400: 10, 500: 10 },
        errorsByEndpoint: { "/feed-values/": 15, "/volumes/": 5 },
        recentErrorTrends: [
          { timestamp: Date.now() - 60000, errorCount: 5 },
          { timestamp: Date.now() - 30000, errorCount: 3 },
        ],
      };

      apiMonitor.getApiHealthMetrics.mockReturnValue(mockHealthMetrics);
      apiMonitor.getAllEndpointStats.mockReturnValue(mockEndpointStats);
      apiMonitor.getPerformanceMetrics.mockReturnValue(mockPerformanceMetrics);
      apiMonitor.getErrorAnalysis.mockReturnValue(mockErrorAnalysis);
      apiMonitor.getMetricsCount.mockReturnValue(1000);

      const result = await controller.getApiMetrics();

      expect((result as any).health).toEqual(mockHealthMetrics);
      expect((result as any).endpoints).toEqual(mockEndpointStats);
      expect((result as any).performance).toEqual(mockPerformanceMetrics);
      expect((result as any).errors).toEqual(mockErrorAnalysis);
      expect((result as any).system.metricsCount).toBe(1000);
      expect((result as any).timestamp).toBeDefined();
      expect((result as any).requestId).toBeDefined();
    });

    it("should handle errors gracefully", async () => {
      apiMonitor.getApiHealthMetrics.mockImplementation(() => {
        throw new Error("Metrics service error");
      });

      await expect(controller.getApiMetrics()).rejects.toThrow();
    });
  });

  describe("getApiMetricsGet", () => {
    it("delegates to getApiMetrics", async () => {
      const response = { ok: true } as any;
      const spy = jest.spyOn(controller as any, "getApiMetrics").mockResolvedValueOnce(response);

      await expect(controller.getApiMetricsGet()).resolves.toEqual(response);
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe("getPerformanceMetrics", () => {
    it("should return detailed performance metrics", async () => {
      const mockPerformanceMetrics = {
        requestCount: 1000,
        averageResponseTime: 75,
        errorRate: 0.02,
        throughput: 16.67,
        responseTimes: [50, 75, 100, 125],
      };

      apiMonitor.getPerformanceMetrics.mockReturnValue(mockPerformanceMetrics);

      const result = await controller.getPerformanceMetrics();

      expect((result as any).performance).toEqual(mockPerformanceMetrics);
      expect((result as any).system.uptime).toBeDefined();
      expect((result as any).system.memory).toBeDefined();
      expect((result as any).timestamp).toBeDefined();
    });
  });

  describe("getEndpointStats", () => {
    it("should return endpoint statistics", async () => {
      const mockEndpointStats = [
        {
          endpoint: "/feed-values/",
          totalRequests: 500,
          successfulRequests: 495,
          failedRequests: 5,
          averageResponseTime: 50,
          maxResponseTime: 200,
          minResponseTime: 10,
          p95ResponseTime: 100,
          p99ResponseTime: 150,
          averageResponseSize: 1024,
          errorRate: 0.01,
          lastRequest: Date.now(),
          statusCodeDistribution: { 200: 495, 400: 3, 500: 2 },
        },
        {
          endpoint: "/volumes/",
          totalRequests: 300,
          successfulRequests: 290,
          failedRequests: 10,
          averageResponseTime: 100,
          maxResponseTime: 300,
          minResponseTime: 20,
          p95ResponseTime: 200,
          p99ResponseTime: 250,
          averageResponseSize: 2048,
          errorRate: 0.03,
          lastRequest: Date.now(),
          statusCodeDistribution: { 200: 290, 400: 5, 500: 5 },
        },
        {
          endpoint: "/health",
          totalRequests: 200,
          successfulRequests: 200,
          failedRequests: 0,
          averageResponseTime: 25,
          maxResponseTime: 100,
          minResponseTime: 5,
          p95ResponseTime: 50,
          p99ResponseTime: 75,
          averageResponseSize: 512,
          errorRate: 0.0,
          lastRequest: Date.now(),
          statusCodeDistribution: { 200: 200, 400: 0, 500: 0 },
        },
      ];

      const mockHealthMetrics = {
        timestamp: Date.now(),
        totalRequests: 1000,
        requestsPerMinute: 50,
        averageResponseTime: 75,
        errorRate: 0.02,
        slowRequestRate: 0.1,
        criticalRequestRate: 0.01,
        topEndpoints: [],
        recentErrors: [],
      };

      apiMonitor.getAllEndpointStats.mockReturnValue(mockEndpointStats);
      apiMonitor.getApiHealthMetrics.mockReturnValue(mockHealthMetrics);

      const result = await controller.getEndpointStats();

      expect((result as any).endpoints).toEqual(mockEndpointStats);
      expect((result as any).summary.totalEndpoints).toBe(3);
      expect((result as any).summary.totalRequests).toBe(1000);
      expect((result as any).summary.averageResponseTime).toBe(75);
      expect((result as any).summary.errorRate).toBe(0.02);
    });
  });

  describe("getErrorAnalysis", () => {
    it("should return error analysis", async () => {
      const mockErrorAnalysis = {
        totalErrors: 20,
        errorsByStatusCode: { "400": 10, "404": 5, "500": 5 },
        errorsByEndpoint: { "/feed-values/": 15, "/volumes/": 5 },
        recentErrorTrends: [
          { timestamp: Date.now() - 60000, errorCount: 5 },
          { timestamp: Date.now() - 30000, errorCount: 3 },
        ],
      };

      apiMonitor.getErrorAnalysis.mockReturnValue(mockErrorAnalysis);

      const result = await controller.getErrorAnalysis();

      expect((result as any).errors).toEqual(mockErrorAnalysis);
      expect((result as any).timestamp).toBeDefined();
      expect((result as any).requestId).toBeDefined();
    });
  });

  describe("getPrometheusMetrics", () => {
    it("returns Prometheus text including percentiles and endpoint metrics", async () => {
      apiMonitor.getApiHealthMetrics.mockReturnValue({
        timestamp: Date.now(),
        totalRequests: 10,
        requestsPerMinute: 1,
        averageResponseTime: 20,
        errorRate: 0.1,
        slowRequestRate: 0.2,
        criticalRequestRate: 0.3,
        topEndpoints: [],
        recentErrors: [],
      } as any);

      apiMonitor.getPerformanceMetrics.mockReturnValue({
        requestCount: 10,
        averageResponseTime: 20,
        errorRate: 0.1,
        throughput: 0.5,
        responseTimes: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
      } as any);

      apiMonitor.getAllEndpointStats.mockReturnValue([
        {
          endpoint: "/feed-values",
          method: "POST",
          totalRequests: 5,
          averageResponseTime: 12,
          errorRate: 0.0,
        },
        {
          endpoint: "/metrics",
          method: "GET",
          totalRequests: 5,
          averageResponseTime: 34,
          errorRate: 0.2,
        },
      ] as any);

      const result = await controller.getPrometheusMetrics();
      expect(typeof result).toBe("string");

      // core health metrics
      expect(result).toContain("# HELP ftso_api_requests_total");
      expect(result).toContain("ftso_api_requests_total 10");

      // percentiles (sorted list already)
      expect(result).toContain("ftso_api_response_time_p50_ms 60");
      expect(result).toContain("ftso_api_response_time_p95_ms 100");
      expect(result).toContain("ftso_api_response_time_p99_ms 100");

      // endpoint metrics
      expect(result).toContain('ftso_endpoint_requests_total{endpoint="/feed-values",method="POST"} 5');
      expect(result).toContain('ftso_endpoint_response_time_ms{endpoint="/metrics",method="GET"} 34');
      expect(result).toContain('ftso_endpoint_error_rate{endpoint="/metrics",method="GET"} 0.2');
    });

    it("handles missing responseTimes by using 0 percentiles", async () => {
      apiMonitor.getApiHealthMetrics.mockReturnValue({
        timestamp: Date.now(),
        totalRequests: 1,
        requestsPerMinute: 1,
        averageResponseTime: 1,
        errorRate: 0,
        slowRequestRate: 0,
        criticalRequestRate: 0,
        topEndpoints: [],
        recentErrors: [],
      } as any);

      apiMonitor.getPerformanceMetrics.mockReturnValue({
        requestCount: 1,
        averageResponseTime: 1,
        errorRate: 0,
        throughput: 1,
      } as any);

      apiMonitor.getAllEndpointStats.mockReturnValue([] as any);

      const result = await controller.getPrometheusMetrics();
      expect(result).toContain("ftso_api_response_time_p50_ms 0");
      expect(result).toContain("ftso_api_response_time_p95_ms 0");
      expect(result).toContain("ftso_api_response_time_p99_ms 0");
    });

    it("bubbles up errors from the API monitor", async () => {
      apiMonitor.getApiHealthMetrics.mockImplementation(() => {
        throw new Error("boom");
      });

      await expect(controller.getPrometheusMetrics()).rejects.toThrow("boom");
    });
  });

  describe("logApiResponse override", () => {
    it("records requests via ApiMonitorService", () => {
      (controller as any).logApiResponse("GET", "/health", 200, 12, 34, "req-1");

      expect(apiMonitor.recordApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: "/health",
          method: "GET",
          statusCode: 200,
          responseTime: 12,
          responseSize: 34,
          requestId: "req-1",
        })
      );
    });
  });
});
