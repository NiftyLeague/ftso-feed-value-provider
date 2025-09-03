import { Test, TestingModule } from "@nestjs/testing";
import type { MonitoringConfig } from "@/common/types/monitoring";
import { PerformanceMonitorService } from "../performance-monitor.service";

describe("PerformanceMonitorService", () => {
  let service: PerformanceMonitorService;
  let mockConfig: MonitoringConfig;

  beforeEach(async () => {
    mockConfig = {
      enabled: true,
      interval: 1000,
      thresholds: {
        accuracy: {
          warning: 0.5,
          critical: 1,
          maxDeviation: 1,
          minParticipants: 3,
          maxConsensusDeviation: 0.5,
          minAccuracyRate: 80,
          minQualityScore: 70,
        },
        performance: {
          maxResponseLatency: 100, // 100ms target
          maxDataAge: 2000, // 2s target
          minThroughput: 100,
          minCacheHitRate: 80,
        },
        health: {
          maxErrorRate: 5,
          maxCpuUsage: 80,
          maxMemoryUsage: 80,
          minConnectionRate: 90,
        },
      },
      alerting: {
        enabled: true,
        rules: [],
        rateLimits: {
          windowMs: 60_000,
          maxRequests: 1000,
        },
        deliveryConfig: {
          email: {
            enabled: false,
            subject: "FTSO Alerts",
            from: "alerts@ftso.com",
            to: ["admin@ftso.com"],
          },
          webhook: {
            enabled: false,
            url: "",
            method: "POST",
            headers: {},
            timeout: 5000,
          },
        },
        maxAlertsPerHour: 10,
        alertRetention: 30,
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [PerformanceMonitorService, { provide: "MonitoringConfig", useValue: mockConfig }],
    }).compile();

    service = module.get<PerformanceMonitorService>(PerformanceMonitorService);
  });

  afterEach(() => {
    service.resetMonitoringData();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("trackResponseLatency", () => {
    it("should track response latency within threshold", () => {
      const endpoint = "/feed-values";
      const latency = 50; // Within 100ms threshold

      service.trackResponseLatency(endpoint, latency);

      const stats = service.getEndpointStats(endpoint);
      expect(stats.averageLatency).toBe(50);
      expect(stats.maxLatency).toBe(50);
      expect(stats.minLatency).toBe(50);
      expect(stats.requestCount).toBe(1);
    });

    it("should track response latency exceeding threshold", () => {
      const endpoint = "/feed-values";
      const latency = 150; // Exceeds 100ms threshold

      service.trackResponseLatency(endpoint, latency);

      const stats = service.getEndpointStats(endpoint);
      expect(stats.averageLatency).toBe(150);
    });

    it("should calculate statistics for multiple measurements", () => {
      const endpoint = "/feed-values";
      const latencies = [50, 75, 100, 125, 150];

      latencies.forEach(latency => {
        service.trackResponseLatency(endpoint, latency);
      });

      const stats = service.getEndpointStats(endpoint);
      expect(stats.averageLatency).toBe(100); // (50+75+100+125+150)/5
      expect(stats.maxLatency).toBe(150);
      expect(stats.minLatency).toBe(50);
      expect(stats.requestCount).toBe(5);
    });

    it("should calculate P95 latency correctly", () => {
      const endpoint = "/feed-values";

      // Add 100 measurements: 0-99ms
      for (let i = 0; i < 100; i++) {
        service.trackResponseLatency(endpoint, i);
      }

      const stats = service.getEndpointStats(endpoint);
      expect(stats.p95Latency).toBe(95); // 95th percentile of 0-99
    });
  });

  describe("trackDataFreshness", () => {
    it("should track data freshness within threshold", () => {
      const feedId = "BTC/USD";
      const dataAge = 1000; // 1s, within 2s threshold

      service.trackDataFreshness(feedId, dataAge);

      const stats = service.getFeedFreshnessStats(feedId);
      expect(stats.averageFreshness).toBe(1000);
      expect(stats.staleDataPercentage).toBe(0);
    });

    it("should track stale data exceeding threshold", () => {
      const feedId = "BTC/USD";
      const dataAge = 3000; // 3s, exceeds 2s threshold

      service.trackDataFreshness(feedId, dataAge);

      const stats = service.getFeedFreshnessStats(feedId);
      expect(stats.averageFreshness).toBe(3000);
      expect(stats.staleDataPercentage).toBe(100);
    });

    it("should calculate stale data percentage correctly", () => {
      const feedId = "ETH/USD";

      // 7 fresh measurements, 3 stale
      for (let i = 0; i < 7; i++) {
        service.trackDataFreshness(feedId, 1500); // Fresh
      }
      for (let i = 0; i < 3; i++) {
        service.trackDataFreshness(feedId, 2500); // Stale
      }

      const stats = service.getFeedFreshnessStats(feedId);
      expect(stats.staleDataPercentage).toBe(30); // 3/10 = 30%
    });
  });

  describe("updateConnectionStatus", () => {
    it("should track connection status changes", () => {
      const exchange = "binance";

      service.updateConnectionStatus(exchange, true);
      service.updateConnectionStatus(exchange, false);
      service.updateConnectionStatus(exchange, true);

      const summary = service.getConnectionSummary();
      expect(summary.totalExchanges).toBe(1);
      expect(summary.connectedExchanges).toBe(1);
      expect(summary.connectionRate).toBe(100);
    });

    it("should calculate connection rate correctly", () => {
      service.updateConnectionStatus("binance", true);
      service.updateConnectionStatus("coinbase", true);
      service.updateConnectionStatus("kraken", false);
      service.updateConnectionStatus("okx", false);

      const summary = service.getConnectionSummary();
      expect(summary.totalExchanges).toBe(4);
      expect(summary.connectedExchanges).toBe(2);
      expect(summary.disconnectedExchanges).toBe(2);
      expect(summary.connectionRate).toBe(50);
    });
  });

  describe("trackError", () => {
    it("should track errors by source and type", () => {
      const error1 = new Error("Connection failed");
      const error2 = new TypeError("Invalid type");

      service.trackError("binance", error1);
      service.trackError("binance", error1);
      service.trackError("coinbase", error2);

      const stats = service.getErrorStats();
      expect(stats.totalErrors).toBe(3);
      expect(stats.topErrors).toHaveLength(2);
      expect(stats.topErrors[0].count).toBe(2); // binance:Error appears twice
    });
  });

  describe("getCurrentPerformanceMetrics", () => {
    it("should return current performance metrics", () => {
      // Add some test data
      service.trackResponseLatency("/feed-values", 75);
      service.trackDataFreshness("BTC/USD", 1500);

      const metrics = service.getCurrentPerformanceMetrics();

      expect(metrics.responseLatency).toBe(75);
      expect(metrics.dataFreshness).toBe(1500);
      expect(metrics.timestamp).toBeDefined();
      expect(typeof metrics.throughput).toBe("number");
      expect(typeof metrics.cacheHitRate).toBe("number");
    });
  });

  describe("getCurrentHealthMetrics", () => {
    it("should return current health metrics", () => {
      // Add some test data
      service.updateConnectionStatus("binance", true);
      service.trackError("test", new Error("Test error"));

      const metrics = service.getCurrentHealthMetrics();

      expect(metrics.connectionStatus.get("binance")).toBe(true);
      expect(typeof metrics.errorRate).toBe("number");
      expect(typeof metrics.cpuUsage).toBe("number");
      expect(typeof metrics.memoryUsage).toBe("number");
      expect(typeof metrics.uptime).toBe("number");
      expect(metrics.timestamp).toBeDefined();
    });
  });

  describe("checkPerformanceThresholds", () => {
    it("should return true when all thresholds are met", () => {
      // Add data within thresholds
      service.trackResponseLatency("/test", 50); // Within 100ms
      service.trackDataFreshness("BTC/USD", 1000); // Within 2000ms

      const result = service.checkPerformanceThresholds();

      expect(result.latencyOk).toBe(true);
      expect(result.freshnessOk).toBe(true);
      // throughputOk and cacheHitRateOk depend on mock implementations
    });

    it("should return false when thresholds are exceeded", () => {
      // Add data exceeding thresholds
      service.trackResponseLatency("/test", 150); // Exceeds 100ms
      service.trackDataFreshness("BTC/USD", 3000); // Exceeds 2000ms

      const result = service.checkPerformanceThresholds();

      expect(result.latencyOk).toBe(false);
      expect(result.freshnessOk).toBe(false);
    });
  });

  describe("checkHealthThresholds", () => {
    it("should check health thresholds correctly", () => {
      // Set up connections
      service.updateConnectionStatus("binance", true);
      service.updateConnectionStatus("coinbase", true);
      service.updateConnectionStatus("kraken", false);

      const result = service.checkHealthThresholds();

      // Connection rate is 66.7% (2/3), below 90% threshold
      expect(result.connectionRateOk).toBe(false);
      expect(typeof result.errorRateOk).toBe("boolean");
      expect(typeof result.cpuUsageOk).toBe("boolean");
      expect(typeof result.memoryUsageOk).toBe("boolean");
    });
  });

  describe("getEndpointStats", () => {
    it("should return zero stats for non-existent endpoint", () => {
      const stats = service.getEndpointStats("/non-existent");

      expect(stats.averageLatency).toBe(0);
      expect(stats.maxLatency).toBe(0);
      expect(stats.minLatency).toBe(0);
      expect(stats.p95Latency).toBe(0);
      expect(stats.requestCount).toBe(0);
    });
  });

  describe("getFeedFreshnessStats", () => {
    it("should return zero stats for non-existent feed", () => {
      const stats = service.getFeedFreshnessStats("NON_EXISTENT");

      expect(stats.averageFreshness).toBe(0);
      expect(stats.maxFreshness).toBe(0);
      expect(stats.minFreshness).toBe(0);
      expect(stats.staleDataPercentage).toBe(0);
    });
  });

  describe("resetMonitoringData", () => {
    it("should reset all monitoring data", () => {
      // Add some data
      service.trackResponseLatency("/test", 100);
      service.trackDataFreshness("BTC/USD", 1000);
      service.updateConnectionStatus("binance", true);
      service.trackError("test", new Error("Test"));

      // Verify data exists
      expect(service.getEndpointStats("/test").requestCount).toBe(1);
      expect(service.getConnectionSummary().totalExchanges).toBe(1);

      // Reset and verify data is cleared
      service.resetMonitoringData();

      expect(service.getEndpointStats("/test").requestCount).toBe(0);
      expect(service.getErrorStats().totalErrors).toBe(0);
    });
  });
});
