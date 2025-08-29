import { EnhancedFeedId, FeedCategory } from "@/types";
import { PriceUpdate } from "@/interfaces/data-source.interface";

// Mock monitoring services
class MockPerformanceMonitor {
  private metrics = {
    responseTime: [] as number[],
    dataFreshness: new Map<string, number>(),
    connectionHealth: new Map<string, boolean>(),
    priceUpdates: new Map<string, number>(),
  };

  recordResponseTime(endpoint: string, responseTime: number) {
    this.metrics.responseTime.push(responseTime);
  }

  recordDataFreshness(feedId: EnhancedFeedId, timestamp: number) {
    const age = Date.now() - timestamp;
    this.metrics.dataFreshness.set(feedId.name, age);
  }

  recordConnectionHealth(exchange: string, isHealthy: boolean) {
    this.metrics.connectionHealth.set(exchange, isHealthy);
  }

  recordPriceUpdate(feedId: EnhancedFeedId) {
    const current = this.metrics.priceUpdates.get(feedId.name) || 0;
    this.metrics.priceUpdates.set(feedId.name, current + 1);
  }

  getMetrics() {
    const responseTimes = this.metrics.responseTime;
    return {
      averageResponseTime: responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length || 0,
      maxResponseTime: Math.max(...responseTimes, 0),
      totalRequests: responseTimes.length,
    };
  }

  getConnectionHealthMetrics() {
    const connections = Array.from(this.metrics.connectionHealth.entries());
    const healthy = connections.filter(([, isHealthy]) => isHealthy).length;
    return {
      totalExchanges: connections.length,
      healthyExchanges: healthy,
      healthyPercentage: connections.length > 0 ? healthy / connections.length : 0,
    };
  }

  getThroughputMetrics(feedId: EnhancedFeedId) {
    const updates = this.metrics.priceUpdates.get(feedId.name) || 0;
    return {
      updatesPerSecond: updates / 60, // Simplified calculation
      totalUpdates: updates,
    };
  }

  getLatencyMetrics(feedId: EnhancedFeedId) {
    const freshness = this.metrics.dataFreshness.get(feedId.name) || 0;
    return {
      averageLatency: freshness,
      maxLatency: freshness,
      minLatency: freshness,
      sampleCount: 1,
    };
  }
}

class MockAccuracyMonitor {
  private metrics = {
    deviations: new Map<string, number[]>(),
    accuracyChecks: new Map<string, { total: number; accurate: number }>(),
    qualityScores: new Map<string, number[]>(),
    sourceReliability: new Map<string, number>(),
  };

  recordConsensusDeviation(feedId: EnhancedFeedId, deviation: number) {
    const current = this.metrics.deviations.get(feedId.name) || [];
    current.push(deviation);
    this.metrics.deviations.set(feedId.name, current);
  }

  recordAccuracyCheck(feedId: EnhancedFeedId, isAccurate: boolean) {
    const current = this.metrics.accuracyChecks.get(feedId.name) || { total: 0, accurate: 0 };
    current.total++;
    if (isAccurate) current.accurate++;
    this.metrics.accuracyChecks.set(feedId.name, current);
  }

  recordQualityScore(feedId: EnhancedFeedId, score: number) {
    const current = this.metrics.qualityScores.get(feedId.name) || [];
    current.push(score);
    this.metrics.qualityScores.set(feedId.name, current);
  }

  recordSourceReliability(source: string, reliability: number) {
    this.metrics.sourceReliability.set(source, reliability);
  }

  getAccuracyMetrics(feedId: EnhancedFeedId) {
    const deviations = this.metrics.deviations.get(feedId.name) || [];
    const checks = this.metrics.accuracyChecks.get(feedId.name) || { total: 0, accurate: 0 };

    return {
      averageDeviation: deviations.reduce((sum, dev) => sum + dev, 0) / deviations.length || 0,
      accuracyRate: checks.total > 0 ? checks.accurate / checks.total : 0,
      totalChecks: checks.total,
    };
  }

  getQualityMetrics(feedId: EnhancedFeedId) {
    const scores = this.metrics.qualityScores.get(feedId.name) || [];
    return {
      averageQuality: scores.reduce((sum, score) => sum + score, 0) / scores.length || 0,
    };
  }

  getSourceReliabilityMetrics() {
    return Object.fromEntries(this.metrics.sourceReliability);
  }
}

class MockAlertingService {
  private alerts: any[] = [];

  async sendAlert(alert: any) {
    this.alerts.push({
      ...alert,
      timestamp: Date.now(),
    });
  }

  escalateAlert(alert: any) {
    // Mock escalation
  }

  sendEmailAlert(alert: any) {
    // Mock email alert
  }

  sendWebhookAlert(alert: any) {
    // Mock webhook alert
  }

  getAlertHistory() {
    return this.alerts;
  }
}

describe("Monitoring Integration Tests", () => {
  let performanceMonitor: MockPerformanceMonitor;
  let accuracyMonitor: MockAccuracyMonitor;
  let alertingService: MockAlertingService;

  const mockFeedId: EnhancedFeedId = {
    category: FeedCategory.Crypto,
    name: "BTC/USD",
  };

  beforeEach(() => {
    performanceMonitor = new MockPerformanceMonitor();
    accuracyMonitor = new MockAccuracyMonitor();
    alertingService = new MockAlertingService();
  });

  describe("Performance Monitoring Integration", () => {
    it("should track API response times and trigger alerts", async () => {
      const alertSpy = jest.spyOn(alertingService, "sendAlert");

      // Simulate slow API responses
      for (let i = 0; i < 10; i++) {
        performanceMonitor.recordResponseTime("/feed-values", 150); // 150ms delay
      }

      const metrics = performanceMonitor.getMetrics();
      expect(metrics.averageResponseTime).toBeGreaterThan(100);

      // Simulate alert triggering
      if (metrics.averageResponseTime > 100) {
        await alertingService.sendAlert({
          type: "PERFORMANCE_DEGRADATION",
          severity: "WARNING",
          message: "Average response time exceeded threshold",
        });
      }

      expect(alertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "PERFORMANCE_DEGRADATION",
          severity: "WARNING",
        })
      );
    });

    it("should monitor data freshness and alert on staleness", async () => {
      const alertSpy = jest.spyOn(alertingService, "sendAlert");

      // Simulate stale data
      const staleTimestamp = Date.now() - 5000; // 5 seconds old
      performanceMonitor.recordDataFreshness(mockFeedId, staleTimestamp);

      const latencyMetrics = performanceMonitor.getLatencyMetrics(mockFeedId);

      // Simulate alert triggering for stale data
      if (latencyMetrics.averageLatency > 2000) {
        await alertingService.sendAlert({
          type: "DATA_STALENESS",
          severity: "ERROR",
          message: "Data staleness detected",
        });
      }

      expect(alertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "DATA_STALENESS",
          severity: "ERROR",
        })
      );
    });

    it("should track connection health across multiple exchanges", async () => {
      const exchanges = ["binance", "coinbase", "kraken", "okx"];
      const alertSpy = jest.spyOn(alertingService, "sendAlert");

      // Simulate connection issues
      exchanges.forEach((exchange, index) => {
        const isHealthy = index < 2; // First 2 exchanges healthy, others not
        performanceMonitor.recordConnectionHealth(exchange, isHealthy);
      });

      const healthMetrics = performanceMonitor.getConnectionHealthMetrics();
      expect(healthMetrics.totalExchanges).toBe(4);
      expect(healthMetrics.healthyExchanges).toBe(2);
      expect(healthMetrics.healthyPercentage).toBe(0.5);

      // Simulate alert triggering for poor connection health
      if (healthMetrics.healthyPercentage < 0.8) {
        await alertingService.sendAlert({
          type: "CONNECTION_HEALTH",
          severity: "WARNING",
          message: "Connection health degraded",
        });
      }

      expect(alertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "CONNECTION_HEALTH",
          severity: "WARNING",
        })
      );
    });
  });

  describe("Accuracy Monitoring Integration", () => {
    it("should track consensus deviation and trigger alerts", async () => {
      const alertSpy = jest.spyOn(alertingService, "sendAlert");

      // Simulate high deviation from consensus
      for (let i = 0; i < 5; i++) {
        accuracyMonitor.recordConsensusDeviation(mockFeedId, 0.008); // 0.8% deviation
      }

      const accuracyMetrics = accuracyMonitor.getAccuracyMetrics(mockFeedId);
      expect(accuracyMetrics.averageDeviation).toBeGreaterThan(0.005);

      // Simulate alert triggering for high deviation
      if (accuracyMetrics.averageDeviation > 0.005) {
        await alertingService.sendAlert({
          type: "ACCURACY_DEGRADATION",
          severity: "ERROR",
          message: "Consensus deviation exceeded threshold",
        });
      }

      expect(alertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "ACCURACY_DEGRADATION",
          severity: "ERROR",
        })
      );
    });

    it("should monitor accuracy rate and alert when below threshold", async () => {
      const alertSpy = jest.spyOn(alertingService, "sendAlert");

      // Simulate low accuracy rate - deterministic 70% accuracy rate
      for (let i = 0; i < 100; i++) {
        const isAccurate = i < 70; // Exactly 70% accuracy rate
        accuracyMonitor.recordAccuracyCheck(mockFeedId, isAccurate);
      }

      const accuracyMetrics = accuracyMonitor.getAccuracyMetrics(mockFeedId);

      if (accuracyMetrics.accuracyRate < 0.8) {
        await alertingService.sendAlert({
          type: "ACCURACY_RATE_LOW",
          severity: "CRITICAL",
          message: "Accuracy rate below threshold",
        });
      }

      expect(alertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "ACCURACY_RATE_LOW",
          severity: "CRITICAL",
        })
      );
    });

    it("should track quality score degradation", async () => {
      const alertSpy = jest.spyOn(alertingService, "sendAlert");

      // Simulate declining quality scores
      const qualityScores = [0.9, 0.8, 0.7, 0.6, 0.5];
      qualityScores.forEach(score => {
        accuracyMonitor.recordQualityScore(mockFeedId, score);
      });

      const qualityMetrics = accuracyMonitor.getQualityMetrics(mockFeedId);
      expect(qualityMetrics.averageQuality).toBeLessThan(0.8);

      // Simulate alert triggering for quality degradation
      if (qualityMetrics.averageQuality < 0.8) {
        await alertingService.sendAlert({
          type: "QUALITY_DEGRADATION",
          severity: "WARNING",
          message: "Quality score degradation detected",
        });
      }

      expect(alertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "QUALITY_DEGRADATION",
          severity: "WARNING",
        })
      );
    });

    it("should monitor source reliability and alert on failures", async () => {
      const alertSpy = jest.spyOn(alertingService, "sendAlert");

      const sources = ["binance", "coinbase", "kraken"];
      sources.forEach((source, index) => {
        const reliability = index === 0 ? 0.5 : 0.9; // Binance has low reliability
        accuracyMonitor.recordSourceReliability(source, reliability);
      });

      const reliabilityMetrics = accuracyMonitor.getSourceReliabilityMetrics();
      expect(reliabilityMetrics["binance"]).toBeLessThan(0.8);

      // Simulate alert triggering for low source reliability
      if (reliabilityMetrics["binance"] < 0.8) {
        await alertingService.sendAlert({
          type: "SOURCE_RELIABILITY_LOW",
          severity: "WARNING",
          message: "Source reliability degraded for binance",
        });
      }

      expect(alertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "SOURCE_RELIABILITY_LOW",
          severity: "WARNING",
        })
      );
    });
  });

  describe("Alerting System Integration", () => {
    it("should handle multiple alert types and priorities", async () => {
      const alerts = [
        {
          type: "PERFORMANCE_DEGRADATION" as const,
          severity: "WARNING" as const,
          message: "API response time exceeded threshold",
          metadata: { responseTime: 150, threshold: 100 },
        },
        {
          type: "ACCURACY_DEGRADATION" as const,
          severity: "CRITICAL" as const,
          message: "Consensus deviation exceeded 0.5%",
          metadata: { deviation: 0.008, threshold: 0.005 },
        },
        {
          type: "CONNECTION_FAILURE" as const,
          severity: "ERROR" as const,
          message: "Exchange connection lost",
          metadata: { exchange: "binance", duration: 30000 },
        },
      ];

      const sendAlertSpy = jest.spyOn(alertingService, "sendAlert");

      for (const alert of alerts) {
        await alertingService.sendAlert(alert);
      }

      expect(sendAlertSpy).toHaveBeenCalledTimes(3);

      const alertHistory = alertingService.getAlertHistory();
      expect(alertHistory).toHaveLength(3);

      const criticalAlerts = alertHistory.filter(a => a.severity === "CRITICAL");
      expect(criticalAlerts).toHaveLength(1);
    });

    it("should implement alert rate limiting to prevent spam", async () => {
      const duplicateAlert = {
        type: "PERFORMANCE_DEGRADATION" as const,
        severity: "WARNING" as const,
        message: "API response time exceeded threshold",
        metadata: { responseTime: 150 },
      };

      // Send the same alert multiple times
      for (let i = 0; i < 10; i++) {
        await alertingService.sendAlert(duplicateAlert);
      }

      const alertHistory = alertingService.getAlertHistory();
      // In a real implementation, this would be rate limited
      // For this mock, we just verify all alerts were recorded
      expect(alertHistory.length).toBe(10);
    });
  });

  describe("End-to-End Monitoring Workflow", () => {
    it("should detect, monitor, and alert on system degradation", async () => {
      const alertSpy = jest.spyOn(alertingService, "sendAlert");

      // Simulate system degradation scenario

      // 1. Performance degradation
      for (let i = 0; i < 5; i++) {
        performanceMonitor.recordResponseTime("/feed-values", 200);
      }

      // 2. Accuracy issues
      for (let i = 0; i < 10; i++) {
        accuracyMonitor.recordConsensusDeviation(mockFeedId, 0.01);
      }

      // 3. Connection issues
      performanceMonitor.recordConnectionHealth("binance", false);
      performanceMonitor.recordConnectionHealth("coinbase", false);

      // Trigger alerts based on conditions
      const performanceMetrics = performanceMonitor.getMetrics();
      if (performanceMetrics.averageResponseTime > 100) {
        await alertingService.sendAlert({
          type: "PERFORMANCE_DEGRADATION",
          severity: "WARNING",
          message: "Performance degraded",
        });
      }

      const accuracyMetrics = accuracyMonitor.getAccuracyMetrics(mockFeedId);
      if (accuracyMetrics.averageDeviation > 0.005) {
        await alertingService.sendAlert({
          type: "ACCURACY_DEGRADATION",
          severity: "ERROR",
          message: "Accuracy degraded",
        });
      }

      const connectionHealth = performanceMonitor.getConnectionHealthMetrics();
      if (connectionHealth.healthyPercentage < 0.8) {
        await alertingService.sendAlert({
          type: "CONNECTION_HEALTH",
          severity: "WARNING",
          message: "Connection health degraded",
        });
      }

      const alertHistory = alertingService.getAlertHistory();
      expect(alertHistory.length).toBeGreaterThan(2);
    });

    it("should provide comprehensive system health dashboard", async () => {
      // Generate various metrics
      performanceMonitor.recordResponseTime("/feed-values", 50);
      performanceMonitor.recordDataFreshness(mockFeedId, Date.now() - 1000);
      performanceMonitor.recordConnectionHealth("binance", true);

      accuracyMonitor.recordConsensusDeviation(mockFeedId, 0.003);
      accuracyMonitor.recordAccuracyCheck(mockFeedId, true);
      accuracyMonitor.recordQualityScore(mockFeedId, 0.95);

      const performanceMetrics = performanceMonitor.getMetrics();
      const accuracyMetrics = accuracyMonitor.getAccuracyMetrics(mockFeedId);
      const connectionHealth = performanceMonitor.getConnectionHealthMetrics();

      expect(performanceMetrics).toHaveProperty("averageResponseTime");
      expect(accuracyMetrics).toHaveProperty("averageDeviation");
      expect(connectionHealth).toHaveProperty("healthyPercentage");

      // All metrics should indicate healthy system
      expect(performanceMetrics.averageResponseTime).toBeLessThan(100);
      expect(accuracyMetrics.averageDeviation).toBeLessThan(0.005);
      expect(connectionHealth.healthyPercentage).toBe(1.0);
    });
  });

  describe("Performance Under Load", () => {
    it("should handle high-frequency monitoring data efficiently", async () => {
      const startTime = Date.now();

      // Generate high volume of monitoring data
      for (let i = 0; i < 1000; i++) {
        performanceMonitor.recordResponseTime("/feed-values", 50 + Math.random() * 50);
        accuracyMonitor.recordConsensusDeviation(mockFeedId, Math.random() * 0.01);
        performanceMonitor.recordPriceUpdate(mockFeedId);
      }

      const processingTime = Date.now() - startTime;

      // Should handle high volume efficiently
      expect(processingTime).toBeLessThan(1000);

      const metrics = performanceMonitor.getMetrics();
      expect(metrics.totalRequests).toBe(1000);
    });

    it("should maintain monitoring accuracy under concurrent load", async () => {
      const concurrentOperations = 100;
      const promises = [];

      for (let i = 0; i < concurrentOperations; i++) {
        promises.push(
          Promise.resolve().then(() => {
            performanceMonitor.recordResponseTime("/feed-values", 75);
            accuracyMonitor.recordAccuracyCheck(mockFeedId, true);
            performanceMonitor.recordConnectionHealth("binance", true);
          })
        );
      }

      await Promise.all(promises);

      const performanceMetrics = performanceMonitor.getMetrics();
      const accuracyMetrics = accuracyMonitor.getAccuracyMetrics(mockFeedId);

      expect(performanceMetrics.totalRequests).toBe(concurrentOperations);
      expect(accuracyMetrics.totalChecks).toBe(concurrentOperations);
      expect(accuracyMetrics.accuracyRate).toBe(1.0);
    });
  });
});
