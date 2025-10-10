import { Test, TestingModule } from "@nestjs/testing";
import { ApiMonitorService } from "../api-monitor.service";

// Mock the EventDrivenService to avoid complex setup
jest.mock("../../common/base/composed.service", () => ({
  EventDrivenService: class MockEventDrivenService {
    public logger = {
      debug: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
    };

    public incrementCounter = jest.fn();
    public recordMetric = jest.fn();
    public createInterval = jest.fn();
    public emit = jest.fn();
    public on = jest.fn();

    constructor() {
      // Mock constructor
    }
  },
}));

describe("ApiMonitorService", () => {
  let service: ApiMonitorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ApiMonitorService],
    }).compile();

    service = module.get<ApiMonitorService>(ApiMonitorService);
  });

  afterEach(() => {
    service.resetMetrics();
  });

  describe("recordApiRequest", () => {
    it("should record successful API request", () => {
      const metrics = {
        timestamp: Date.now(),
        requestCount: 1,
        responseTime: 150,
        errorRate: 0,
        throughput: 1,
        statusCode: 200,
        method: "GET",
        endpoint: "/api/feeds",
        responseSize: 1024,
        requestId: "req-123",
      };

      service.recordApiRequest(metrics);

      expect(service.getMetricsCount()).toBe(1);
    });

    it("should record failed API request", () => {
      const metrics = {
        timestamp: Date.now(),
        requestCount: 1,
        responseTime: 200,
        errorRate: 100,
        throughput: 1,
        statusCode: 500,
        method: "GET",
        endpoint: "/api/feeds",
        responseSize: 0,
        error: "Internal Server Error",
        requestId: "req-124",
      };

      service.recordApiRequest(metrics);

      expect(service.getMetricsCount()).toBe(1);
    });

    it("should maintain metrics history size limit", () => {
      // Add more than maxMetricsHistory requests
      for (let i = 0; i < 10001; i++) {
        const metrics = {
          timestamp: Date.now(),
          requestCount: 1,
          responseTime: 100,
          errorRate: 0,
          throughput: 1,
          statusCode: 200,
          method: "GET",
          endpoint: "/api/feeds",
          responseSize: 512,
          requestId: `req-${i}`,
        };
        service.recordApiRequest(metrics);
      }

      expect(service.getMetricsCount()).toBe(10000);
    });

    it("should call emit method when recording request", () => {
      const metrics = {
        timestamp: Date.now(),
        requestCount: 1,
        responseTime: 150,
        errorRate: 0,
        throughput: 1,
        statusCode: 200,
        method: "GET",
        endpoint: "/api/feeds",
        responseSize: 1024,
        requestId: "req-125",
      };

      const emitSpy = jest.spyOn(service, "emit");
      service.recordApiRequest(metrics);

      expect(emitSpy).toHaveBeenCalledWith("apiRequest", metrics);
    });

    it("should handle errors gracefully", () => {
      const invalidMetrics = null as any;

      expect(() => {
        service.recordApiRequest(invalidMetrics);
      }).not.toThrow();
    });
  });

  describe("getEndpointStats", () => {
    it("should return null for non-existent endpoint", () => {
      const stats = service.getEndpointStats("GET /api/nonexistent");
      expect(stats).toBeNull();
    });

    it("should return stats for existing endpoint", () => {
      const metrics = {
        timestamp: Date.now(),
        requestCount: 1,
        responseTime: 150,
        errorRate: 0,
        throughput: 1,
        statusCode: 200,
        method: "GET",
        endpoint: "/api/feeds",
        responseSize: 1024,
        requestId: "req-126",
      };

      service.recordApiRequest(metrics);

      const stats = service.getEndpointStats("GET /api/feeds");
      expect(stats).toBeDefined();
      expect(stats?.endpoint).toBe("GET /api/feeds");
      expect(stats?.totalRequests).toBe(1);
      expect(stats?.successfulRequests).toBe(1);
      expect(stats?.failedRequests).toBe(0);
    });
  });

  describe("getAllEndpointStats", () => {
    it("should return empty array when no metrics", () => {
      const stats = service.getAllEndpointStats();
      expect(stats).toEqual([]);
    });

    it("should return stats sorted by total requests", () => {
      // Add metrics for different endpoints
      const metrics1 = {
        timestamp: Date.now(),
        requestCount: 1,
        responseTime: 150,
        errorRate: 0,
        throughput: 1,
        statusCode: 200,
        method: "GET",
        endpoint: "/api/feeds",
        responseSize: 1024,
        requestId: "req-127",
      };

      const metrics2 = {
        timestamp: Date.now(),
        requestCount: 1,
        responseTime: 200,
        errorRate: 0,
        throughput: 1,
        statusCode: 200,
        method: "POST",
        endpoint: "/api/feeds",
        responseSize: 512,
        requestId: "req-128",
      };

      service.recordApiRequest(metrics1);
      service.recordApiRequest(metrics2);

      const stats = service.getAllEndpointStats();
      expect(stats).toHaveLength(2);
      expect(stats[0].totalRequests).toBeGreaterThanOrEqual(stats[1].totalRequests);
    });
  });

  describe("getApiHealthMetrics", () => {
    it("should return health metrics with zero values when no data", () => {
      const health = service.getApiHealthMetrics();

      expect(health.totalRequests).toBe(0);
      expect(health.requestsPerMinute).toBe(0);
      expect(health.averageResponseTime).toBe(0);
      expect(health.errorRate).toBe(0);
      expect(health.slowRequestRate).toBe(0);
      expect(health.criticalRequestRate).toBe(0);
      expect(health.topEndpoints).toEqual([]);
      expect(health.recentErrors).toEqual([]);
    });

    it("should calculate correct health metrics", () => {
      const now = Date.now();
      const recentTime = now - 30000; // 30 seconds ago
      const oldTime = now - 120000; // 2 minutes ago

      // Add recent metrics
      const recentMetrics = {
        timestamp: recentTime,
        requestCount: 1,
        responseTime: 150,
        errorRate: 0,
        throughput: 1,
        statusCode: 200,
        method: "GET",
        endpoint: "/api/feeds",
        responseSize: 1024,
        requestId: "req-129",
      };

      // Add old metrics
      const oldMetrics = {
        timestamp: oldTime,
        requestCount: 1,
        responseTime: 200,
        errorRate: 0,
        throughput: 1,
        statusCode: 200,
        method: "GET",
        endpoint: "/api/feeds",
        responseSize: 1024,
        requestId: "req-130",
      };

      service.recordApiRequest(recentMetrics);
      service.recordApiRequest(oldMetrics);

      const health = service.getApiHealthMetrics();

      expect(health.totalRequests).toBe(2);
      expect(health.requestsPerMinute).toBe(1); // Only recent metrics
      expect(health.averageResponseTime).toBe(175); // (150 + 200) / 2
      expect(health.errorRate).toBe(0);
    });

    it("should calculate error rates correctly", () => {
      const now = Date.now();

      // Add successful request
      const successMetrics = {
        timestamp: now,
        requestCount: 1,
        responseTime: 150,
        errorRate: 0,
        throughput: 1,
        statusCode: 200,
        method: "GET",
        endpoint: "/api/feeds",
        responseSize: 1024,
        requestId: "req-131",
      };

      // Add error request
      const errorMetrics = {
        timestamp: now,
        requestCount: 1,
        responseTime: 200,
        errorRate: 100,
        throughput: 1,
        statusCode: 500,
        method: "GET",
        endpoint: "/api/feeds",
        responseSize: 0,
        error: "Internal Server Error",
        requestId: "req-132",
      };

      service.recordApiRequest(successMetrics);
      service.recordApiRequest(errorMetrics);

      const health = service.getApiHealthMetrics();

      expect(health.totalRequests).toBe(2);
      expect(health.errorRate).toBe(50); // 1 error out of 2 requests
    });
  });

  describe("getPerformanceMetrics", () => {
    it("should return performance metrics for specified time window", () => {
      const now = Date.now();
      const recentTime = now - 120000; // 2 minutes ago
      const oldTime = now - 600000; // 10 minutes ago

      // Add recent metrics
      const recentMetrics = {
        timestamp: recentTime,
        requestCount: 1,
        responseTime: 150,
        errorRate: 0,
        throughput: 1,
        statusCode: 200,
        method: "GET",
        endpoint: "/api/feeds",
        responseSize: 1024,
        requestId: "req-137",
      };

      // Add old metrics
      const oldMetrics = {
        timestamp: oldTime,
        requestCount: 1,
        responseTime: 200,
        errorRate: 0,
        throughput: 1,
        statusCode: 200,
        method: "GET",
        endpoint: "/api/feeds",
        responseSize: 1024,
        requestId: "req-138",
      };

      service.recordApiRequest(recentMetrics);
      service.recordApiRequest(oldMetrics);

      const performance = service.getPerformanceMetrics(5); // 5 minutes

      expect(performance.requestCount).toBe(1); // Only recent metrics
      expect(performance.averageResponseTime).toBe(150);
      expect(performance.errorRate).toBe(0);
      expect(performance.throughput).toBe(0.2); // 1 request / 5 minutes
      expect(performance.responseTimes).toEqual([150]);
    });

    it("should return zero values when no metrics in time window", () => {
      const performance = service.getPerformanceMetrics(5);

      expect(performance.requestCount).toBe(0);
      expect(performance.averageResponseTime).toBe(0);
      expect(performance.errorRate).toBe(0);
      expect(performance.throughput).toBe(0);
      expect(performance.responseTimes).toEqual([]);
    });
  });

  describe("getErrorAnalysis", () => {
    it("should return error analysis with zero values when no errors", () => {
      const analysis = service.getErrorAnalysis();

      expect(analysis.totalErrors).toBe(0);
      expect(analysis.errorsByStatusCode).toEqual({});
      expect(analysis.errorsByEndpoint).toEqual({});
      expect(analysis.recentErrorTrends).toEqual([]);
    });

    it("should analyze errors by status code", () => {
      const now = Date.now();

      // Add 500 error
      const error500 = {
        timestamp: now,
        requestCount: 1,
        responseTime: 200,
        errorRate: 100,
        throughput: 1,
        statusCode: 500,
        method: "GET",
        endpoint: "/api/feeds",
        responseSize: 0,
        error: "Internal Server Error",
        requestId: "req-139",
      };

      // Add 404 error
      const error404 = {
        timestamp: now,
        requestCount: 1,
        responseTime: 100,
        errorRate: 100,
        throughput: 1,
        statusCode: 404,
        method: "GET",
        endpoint: "/api/feeds",
        responseSize: 0,
        error: "Not Found",
        requestId: "req-140",
      };

      service.recordApiRequest(error500);
      service.recordApiRequest(error404);

      const analysis = service.getErrorAnalysis();

      expect(analysis.totalErrors).toBe(2);
      expect(analysis.errorsByStatusCode[500]).toBe(1);
      expect(analysis.errorsByStatusCode[404]).toBe(1);
    });
  });

  describe("resetMetrics", () => {
    it("should reset all metrics", () => {
      // Add some metrics
      const metrics = {
        timestamp: Date.now(),
        requestCount: 1,
        responseTime: 150,
        errorRate: 0,
        throughput: 1,
        statusCode: 200,
        method: "GET",
        endpoint: "/api/feeds",
        responseSize: 1024,
        requestId: "req-143",
      };

      service.recordApiRequest(metrics);
      expect(service.getMetricsCount()).toBe(1);

      service.resetMetrics();
      expect(service.getMetricsCount()).toBe(0);
      expect(service.getAllEndpointStats()).toEqual([]);
    });
  });

  describe("getMetricsCount", () => {
    it("should return correct metrics count", () => {
      expect(service.getMetricsCount()).toBe(0);

      const metrics = {
        timestamp: Date.now(),
        requestCount: 1,
        responseTime: 150,
        errorRate: 0,
        throughput: 1,
        statusCode: 200,
        method: "GET",
        endpoint: "/api/feeds",
        responseSize: 1024,
        requestId: "req-144",
      };

      service.recordApiRequest(metrics);
      expect(service.getMetricsCount()).toBe(1);
    });
  });
});
