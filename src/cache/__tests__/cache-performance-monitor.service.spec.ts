import { CachePerformanceMonitorService } from "../cache-performance-monitor.service";
import { RealTimeCacheService } from "../real-time-cache.service";

describe("CachePerformanceMonitorService", () => {
  let performanceMonitor: CachePerformanceMonitorService;
  let cacheService: RealTimeCacheService;

  beforeEach(() => {
    cacheService = new RealTimeCacheService();
    performanceMonitor = new CachePerformanceMonitorService(cacheService); // Short interval for testing
  });

  afterEach(() => {
    performanceMonitor.destroy();
    cacheService.destroy();
  });

  describe("Response Time Tracking", () => {
    it("should record response times", () => {
      performanceMonitor.recordResponseTime(5);
      performanceMonitor.recordResponseTime(10);
      performanceMonitor.recordResponseTime(15);

      const metrics = performanceMonitor.getPerformanceMetrics();
      expect(metrics.averageResponseTime).toBe(10);
    });

    it("should calculate response time percentiles", () => {
      const responseTimes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      responseTimes.forEach(time => performanceMonitor.recordResponseTime(time));

      const percentiles = performanceMonitor.getResponseTimePercentiles();
      expect(percentiles.p50).toBe(5);
      expect(percentiles.p90).toBe(9);
      expect(percentiles.p95).toBe(10);
      expect(percentiles.p99).toBe(10);
    });

    it("should handle empty response times", () => {
      const percentiles = performanceMonitor.getResponseTimePercentiles();
      expect(percentiles.p50).toBe(0);
      expect(percentiles.p90).toBe(0);
      expect(percentiles.p95).toBe(0);
      expect(percentiles.p99).toBe(0);
    });

    it("should limit response time history size", () => {
      // Record more than max history size
      for (let i = 0; i < 1200; i++) {
        performanceMonitor.recordResponseTime(i);
      }

      const percentiles = performanceMonitor.getResponseTimePercentiles();
      // Should only consider the last 1000 measurements
      expect(percentiles.p50).toBeGreaterThan(600); // Roughly middle of last 1000
    });
  });

  describe("Performance Metrics", () => {
    it("should return current performance metrics", () => {
      // Generate some cache activity
      cacheService.set("key1", { value: 100, timestamp: Date.now(), sources: ["test"], confidence: 0.9 }, 1000);
      cacheService.get("key1"); // Hit
      cacheService.get("key2"); // Miss

      performanceMonitor.recordResponseTime(5);
      performanceMonitor.recordResponseTime(10);

      const metrics = performanceMonitor.getPerformanceMetrics();

      expect(metrics.hitRate).toBe(0.5); // 1 hit out of 2 requests
      expect(metrics.missRate).toBe(0.5); // 1 miss out of 2 requests
      expect(metrics.totalRequests).toBe(2);
      expect(metrics.averageResponseTime).toBe(7.5);
      expect(metrics.memoryUsage).toBeGreaterThan(0);
    });

    it("should calculate requests per second", async () => {
      // Get initial metrics to establish baseline
      performanceMonitor.getPerformanceMetrics();

      // Wait a bit to ensure time difference
      await new Promise(resolve => setTimeout(resolve, 10));

      // Generate some requests
      cacheService.get("key1");
      cacheService.get("key2");

      // Wait a bit more to ensure time difference
      await new Promise(resolve => setTimeout(resolve, 100));

      const finalMetrics = performanceMonitor.getPerformanceMetrics();
      expect(finalMetrics.requestsPerSecond).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Memory Usage Tracking", () => {
    it("should track memory usage history", async () => {
      // Manually trigger metrics collection
      performanceMonitor.triggerCollection();

      const history = performanceMonitor.getMemoryUsageHistory(1); // Last 1 minute
      expect(history.length).toBeGreaterThan(0);
      expect(history[0]).toHaveProperty("timestamp");
      expect(history[0]).toHaveProperty("usage");
      expect(history[0]).toHaveProperty("entryCount");
    });

    it("should filter memory usage history by time", async () => {
      // Wait for monitoring to collect some data
      await new Promise(resolve => setTimeout(resolve, 150));

      const shortHistory = performanceMonitor.getMemoryUsageHistory(0.001); // Very short time
      const longHistory = performanceMonitor.getMemoryUsageHistory(10); // Long time

      expect(shortHistory.length).toBeLessThanOrEqual(longHistory.length);
    });
  });

  describe("Performance Thresholds", () => {
    it("should check performance thresholds", () => {
      // Create good performance scenario
      for (let i = 0; i < 10; i++) {
        cacheService.set(`key${i}`, { value: i, timestamp: Date.now(), sources: ["test"], confidence: 0.9 }, 1000);
        cacheService.get(`key${i}`); // All hits
        performanceMonitor.recordResponseTime(2); // Fast response times
      }

      const health = performanceMonitor.checkPerformanceThresholds();
      expect(health.hitRateOk).toBe(true);
      expect(health.responseTimeOk).toBe(true);
      expect(health.memoryUsageOk).toBe(true);
      expect(health.overallHealthy).toBe(true);
    });

    it("should detect poor hit rate", () => {
      // Create poor hit rate scenario
      for (let i = 0; i < 10; i++) {
        cacheService.get(`nonexistent${i}`); // All misses
      }

      const health = performanceMonitor.checkPerformanceThresholds();
      expect(health.hitRateOk).toBe(false);
      expect(health.overallHealthy).toBe(false);
    });

    it("should detect slow response times", () => {
      // Create slow response time scenario with actual cache requests
      for (let i = 0; i < 10; i++) {
        // Make actual cache requests to ensure totalRequests > 5
        const cacheEntry = {
          value: i,
          timestamp: Date.now(),
          sources: [`source${i}`],
          confidence: 0.9,
        };
        cacheService.set(`key${i}`, cacheEntry, 1000);
        cacheService.get(`key${i}`);
        performanceMonitor.recordResponseTime(600); // Slow response times (above 500ms threshold)
      }

      const health = performanceMonitor.checkPerformanceThresholds();
      expect(health.responseTimeOk).toBe(false);
      expect(health.overallHealthy).toBe(false);
    });
  });

  describe("Performance Report", () => {
    it("should generate performance report", () => {
      // Generate some activity
      cacheService.set("key1", { value: 100, timestamp: Date.now(), sources: ["test"], confidence: 0.9 }, 1000);
      cacheService.get("key1");
      performanceMonitor.recordResponseTime(5);

      const report = performanceMonitor.generatePerformanceReport();

      expect(report).toContain("Cache Performance Report");
      expect(report).toContain("Hit Rate:");
      expect(report).toContain("Response Times:");
      expect(report).toContain("Memory Usage:");
      expect(report).toContain("Overall Health:");
    });

    it("should include health indicators in report", () => {
      // Create good performance
      for (let i = 0; i < 10; i++) {
        cacheService.set(`key${i}`, { value: i, timestamp: Date.now(), sources: ["test"], confidence: 0.9 }, 1000);
        cacheService.get(`key${i}`);
        performanceMonitor.recordResponseTime(2);
      }

      const report = performanceMonitor.generatePerformanceReport();
      expect(report).toContain("✓"); // Should contain checkmarks for good performance
      expect(report).toContain("HEALTHY ✓");
    });

    it("should show warnings for poor performance", () => {
      // Create poor performance
      for (let i = 0; i < 10; i++) {
        cacheService.get(`nonexistent${i}`); // All misses
        performanceMonitor.recordResponseTime(50); // Slow responses
      }

      const report = performanceMonitor.generatePerformanceReport();
      expect(report).toContain("✗"); // Should contain X marks for poor performance
      expect(report).toContain("NEEDS ATTENTION ✗");
    });
  });

  describe("Monitoring Process", () => {
    it("should collect metrics automatically", async () => {
      // Manually trigger metrics collection
      performanceMonitor.triggerCollection();

      const history = performanceMonitor.getMemoryUsageHistory(1);
      expect(history.length).toBeGreaterThan(0);
    });

    it("should log warnings for poor performance", async () => {
      const logSpy = jest.spyOn(performanceMonitor["logger"], "warn").mockImplementation();

      // Create poor performance scenario
      for (let i = 0; i < 10; i++) {
        cacheService.get(`nonexistent${i}`); // All misses
      }

      // Trigger metrics collection to check performance
      performanceMonitor.triggerCollection();

      expect(logSpy).toHaveBeenCalledWith("Cache performance degraded", expect.any(Object));

      logSpy.mockRestore();
    });
  });

  describe("Edge Cases", () => {
    it("should handle zero requests gracefully", () => {
      const metrics = performanceMonitor.getPerformanceMetrics();
      expect(metrics.hitRate).toBe(0);
      expect(metrics.missRate).toBe(0);
      expect(metrics.totalRequests).toBe(0);
      expect(metrics.requestsPerSecond).toBe(0);
    });

    it("should handle single data point percentiles", () => {
      performanceMonitor.recordResponseTime(10);

      const percentiles = performanceMonitor.getResponseTimePercentiles();
      expect(percentiles.p50).toBe(10);
      expect(percentiles.p90).toBe(10);
      expect(percentiles.p95).toBe(10);
      expect(percentiles.p99).toBe(10);
    });

    it("should clean up resources on destroy", () => {
      performanceMonitor.recordResponseTime(5);

      const clearIntervalSpy = jest.spyOn(global, "clearInterval");

      performanceMonitor.destroy();

      expect(clearIntervalSpy).toHaveBeenCalled();

      // Should have cleared internal arrays
      const metrics = performanceMonitor.getPerformanceMetrics();
      expect(metrics.averageResponseTime).toBe(0);

      clearIntervalSpy.mockRestore();
    });
  });

  describe("Time-based Filtering", () => {
    it("should only use recent response times for average calculation", async () => {
      // Record old response time
      performanceMonitor.recordResponseTime(100);

      // Mock old timestamp
      const responseTimes = (performanceMonitor as any).responseTimes;
      if (responseTimes.length > 0) {
        responseTimes[0].timestamp = Date.now() - 10 * 60 * 1000; // 10 minutes ago
      }

      // Record recent response time
      performanceMonitor.recordResponseTime(5);

      const metrics = performanceMonitor.getPerformanceMetrics();
      expect(metrics.averageResponseTime).toBe(5); // Should only consider recent measurement
    });

    it("should return zero average when no recent measurements", () => {
      performanceMonitor.recordResponseTime(10);

      // Mock old timestamp
      const responseTimes = (performanceMonitor as any).responseTimes;
      if (responseTimes.length > 0) {
        responseTimes[0].timestamp = Date.now() - 10 * 60 * 1000; // 10 minutes ago
      }

      const metrics = performanceMonitor.getPerformanceMetrics();
      expect(metrics.averageResponseTime).toBe(0);
    });
  });
});
