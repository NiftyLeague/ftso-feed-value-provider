import { Test, TestingModule } from "@nestjs/testing";
import { PerformanceMonitorService } from "../performance-monitor.service";
import { AccuracyMonitorService } from "../accuracy-monitor.service";
import { AlertingService } from "../alerting.service";
import { EnhancedFeedId } from "@/types/enhanced-feed-id.types";
import { FeedCategory } from "@/types/feed-category.enum";
import { PriceUpdate } from "@/interfaces/data-source.interface";

describe("Monitoring Integration Tests", () => {
  let module: TestingModule;
  let performanceMonitor: PerformanceMonitorService;
  let accuracyMonitor: AccuracyMonitorService;
  let alertingService: AlertingService;

  const mockFeedId: EnhancedFeedId = {
    category: FeedCategory.Crypto,
    name: "BTC/USD",
  };

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [PerformanceMonitorService, AccuracyMonitorService, AlertingService],
    }).compile();

    performanceMonitor = module.get<PerformanceMonitorService>(PerformanceMonitorService);
    accuracyMonitor = module.get<AccuracyMonitorService>(AccuracyMonitorService);
    alertingService = module.get<AlertingService>(AlertingService);

    await module.init();
  });

  afterEach(async () => {
    await module.close();
  });

  describe("Performance Monitoring Integration", () => {
    it("should track API response times and trigger alerts", async () => {
      const alertSpy = jest.spyOn(alertingService, "sendAlert");

      // Simulate slow API responses
      for (let i = 0; i < 10; i++) {
        const startTime = Date.now();

        // Simulate processing delay
        await new Promise(resolve => setTimeout(resolve, 150)); // 150ms delay

        const endTime = Date.now();
        const responseTime = endTime - startTime;

        performanceMonitor.recordResponseTime("/feed-values", responseTime);
      }

      // Wait for monitoring to process
      await new Promise(resolve => setTimeout(resolve, 100));

      const metrics = performanceMonitor.getMetrics();
      expect(metrics.averageResponseTime).toBeGreaterThan(100); // Should be > 100ms

      // Should trigger performance alert
      expect(alertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "PERFORMANCE_DEGRADATION",
          severity: "WARNING",
          message: expect.stringContaining("response time"),
        })
      );
    });

    it("should monitor data freshness and alert on staleness", async () => {
      const alertSpy = jest.spyOn(alertingService, "sendAlert");

      // Simulate stale data
      const staleUpdate: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now() - 5000, // 5 seconds old
        source: "binance",
        confidence: 0.9,
      };

      performanceMonitor.recordDataFreshness(mockFeedId, staleUpdate.timestamp);

      await new Promise(resolve => setTimeout(resolve, 100));

      // Should trigger staleness alert
      expect(alertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "DATA_STALENESS",
          severity: "ERROR",
          message: expect.stringContaining("stale"),
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

      await new Promise(resolve => setTimeout(resolve, 100));

      const healthMetrics = performanceMonitor.getConnectionHealthMetrics();
      expect(healthMetrics.totalExchanges).toBe(4);
      expect(healthMetrics.healthyExchanges).toBe(2);
      expect(healthMetrics.healthyPercentage).toBe(0.5);

      // Should trigger connection health alert
      expect(alertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "CONNECTION_HEALTH",
          severity: "WARNING",
          message: expect.stringContaining("connection"),
        })
      );
    });

    it("should measure and alert on throughput degradation", async () => {
      const alertSpy = jest.spyOn(alertingService, "sendAlert");

      // Simulate low throughput
      const startTime = Date.now();

      // Record only a few updates over time
      for (let i = 0; i < 5; i++) {
        performanceMonitor.recordPriceUpdate(mockFeedId);
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      const throughputMetrics = performanceMonitor.getThroughputMetrics(mockFeedId);
      const updatesPerSecond = (5 / duration) * 1000;

      expect(updatesPerSecond).toBeLessThan(10); // Low throughput

      // Should trigger throughput alert if below threshold
      if (updatesPerSecond < 1) {
        expect(alertSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "THROUGHPUT_DEGRADATION",
            severity: "WARNING",
          })
        );
      }
    });
  });

  describe("Accuracy Monitoring Integration", () => {
    it("should track consensus deviation and trigger alerts", async () => {
      const alertSpy = jest.spyOn(alertingService, "sendAlert");

      // Simulate price updates with high deviation from consensus
      const consensusMedian = 50000;
      const deviatingUpdates: PriceUpdate[] = [
        {
          symbol: "BTC/USD",
          price: 52000, // 4% deviation
          timestamp: Date.now(),
          source: "binance",
          confidence: 0.9,
        },
        {
          symbol: "BTC/USD",
          price: 48000, // 4% deviation
          timestamp: Date.now(),
          source: "coinbase",
          confidence: 0.9,
        },
      ];

      deviatingUpdates.forEach(update => {
        const deviation = Math.abs(update.price - consensusMedian) / consensusMedian;
        accuracyMonitor.recordConsensusDeviation(mockFeedId, deviation);
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      const accuracyMetrics = accuracyMonitor.getAccuracyMetrics(mockFeedId);
      expect(accuracyMetrics.averageDeviation).toBeGreaterThan(0.03); // > 3%

      // Should trigger accuracy alert
      expect(alertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "ACCURACY_DEGRADATION",
          severity: "ERROR",
          message: expect.stringContaining("consensus"),
        })
      );
    });

    it("should monitor accuracy rate and alert when below threshold", async () => {
      const alertSpy = jest.spyOn(alertingService, "sendAlert");

      // Simulate low accuracy rate (many updates outside 0.5% threshold)
      const consensusMedian = 50000;
      const threshold = 0.005; // 0.5%

      for (let i = 0; i < 100; i++) {
        const price = consensusMedian + (Math.random() - 0.5) * 2000; // Random price with high variance
        const deviation = Math.abs(price - consensusMedian) / consensusMedian;
        const isAccurate = deviation <= threshold;

        accuracyMonitor.recordAccuracyCheck(mockFeedId, isAccurate);
      }

      await new Promise(resolve => setTimeout(resolve, 100));

      const accuracyMetrics = accuracyMonitor.getAccuracyMetrics(mockFeedId);

      // Should have low accuracy rate due to high variance
      if (accuracyMetrics.accuracyRate < 0.8) {
        expect(alertSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "ACCURACY_RATE_LOW",
            severity: "CRITICAL",
            message: expect.stringContaining("accuracy rate"),
          })
        );
      }
    });

    it("should track quality score degradation", async () => {
      const alertSpy = jest.spyOn(alertingService, "sendAlert");

      // Simulate declining quality scores
      const qualityScores = [0.9, 0.8, 0.7, 0.6, 0.5]; // Declining quality

      qualityScores.forEach(score => {
        accuracyMonitor.recordQualityScore(mockFeedId, score);
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      const qualityMetrics = accuracyMonitor.getQualityMetrics(mockFeedId);
      expect(qualityMetrics.averageQuality).toBeLessThan(0.8);

      // Should trigger quality alert
      expect(alertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "QUALITY_DEGRADATION",
          severity: "WARNING",
          message: expect.stringContaining("quality"),
        })
      );
    });

    it("should monitor source reliability and alert on failures", async () => {
      const alertSpy = jest.spyOn(alertingService, "sendAlert");

      const sources = ["binance", "coinbase", "kraken"];

      // Simulate source reliability issues
      sources.forEach((source, index) => {
        const reliability = index === 0 ? 0.5 : 0.9; // Binance has low reliability
        accuracyMonitor.recordSourceReliability(source, reliability);
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      const reliabilityMetrics = accuracyMonitor.getSourceReliabilityMetrics();
      expect(reliabilityMetrics["binance"]).toBeLessThan(0.8);

      // Should trigger source reliability alert
      expect(alertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "SOURCE_RELIABILITY_LOW",
          severity: "WARNING",
          message: expect.stringContaining("binance"),
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

      // Send alerts with different priorities
      for (const alert of alerts) {
        await alertingService.sendAlert(alert);
      }

      expect(sendAlertSpy).toHaveBeenCalledTimes(3);

      // Verify alert history
      const alertHistory = alertingService.getAlertHistory();
      expect(alertHistory).toHaveLength(3);

      // Critical alerts should be processed first
      const criticalAlerts = alertHistory.filter(a => a.severity === "CRITICAL");
      expect(criticalAlerts).toHaveLength(1);
    });

    it("should implement alert rate limiting to prevent spam", async () => {
      const sendAlertSpy = jest.spyOn(alertingService, "sendAlert");

      const duplicateAlert = {
        type: "PERFORMANCE_DEGRADATION" as const,
        severity: "WARNING" as const,
        message: "API response time exceeded threshold",
        metadata: { responseTime: 150 },
      };

      // Send the same alert multiple times rapidly
      for (let i = 0; i < 10; i++) {
        await alertingService.sendAlert(duplicateAlert);
      }

      // Should rate limit duplicate alerts
      const alertHistory = alertingService.getAlertHistory();
      const duplicateAlerts = alertHistory.filter(a => a.type === "PERFORMANCE_DEGRADATION");

      expect(duplicateAlerts.length).toBeLessThan(10); // Should be rate limited
    });

    it("should escalate alerts based on severity and duration", async () => {
      const escalationSpy = jest.spyOn(alertingService, "escalateAlert");

      const persistentAlert = {
        type: "CONNECTION_FAILURE" as const,
        severity: "ERROR" as const,
        message: "Exchange connection lost",
        metadata: { exchange: "binance" },
      };

      await alertingService.sendAlert(persistentAlert);

      // Simulate time passing for escalation
      await new Promise(resolve => setTimeout(resolve, 100));

      // Send the same alert again (simulating persistence)
      await alertingService.sendAlert(persistentAlert);

      // Should escalate persistent errors
      expect(escalationSpy).toHaveBeenCalled();
    });

    it("should support multiple alert delivery channels", async () => {
      const logSpy = jest.spyOn(console, "log").mockImplementation();
      const emailSpy = jest.spyOn(alertingService, "sendEmailAlert").mockImplementation();
      const webhookSpy = jest.spyOn(alertingService, "sendWebhookAlert").mockImplementation();

      const criticalAlert = {
        type: "SYSTEM_FAILURE" as const,
        severity: "CRITICAL" as const,
        message: "System-wide failure detected",
        metadata: { component: "data-manager" },
      };

      await alertingService.sendAlert(criticalAlert);

      // Critical alerts should use multiple channels
      expect(logSpy).toHaveBeenCalled();
      expect(emailSpy).toHaveBeenCalled();
      expect(webhookSpy).toHaveBeenCalled();

      logSpy.mockRestore();
    });
  });

  describe("End-to-End Monitoring Workflow", () => {
    it("should detect, monitor, and alert on system degradation", async () => {
      const alertSpy = jest.spyOn(alertingService, "sendAlert");

      // Simulate system degradation scenario

      // 1. Performance degradation
      for (let i = 0; i < 5; i++) {
        performanceMonitor.recordResponseTime("/feed-values", 200); // Slow responses
      }

      // 2. Accuracy issues
      for (let i = 0; i < 10; i++) {
        accuracyMonitor.recordConsensusDeviation(mockFeedId, 0.01); // High deviation
      }

      // 3. Connection issues
      performanceMonitor.recordConnectionHealth("binance", false);
      performanceMonitor.recordConnectionHealth("coinbase", false);

      // Wait for monitoring systems to process
      await new Promise(resolve => setTimeout(resolve, 200));

      // Should trigger multiple related alerts
      expect(alertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "PERFORMANCE_DEGRADATION",
        })
      );

      expect(alertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "ACCURACY_DEGRADATION",
        })
      );

      expect(alertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "CONNECTION_HEALTH",
        })
      );

      // Should correlate alerts and potentially escalate
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

      await new Promise(resolve => setTimeout(resolve, 100));

      // Get comprehensive health status
      const performanceMetrics = performanceMonitor.getMetrics();
      const accuracyMetrics = accuracyMonitor.getAccuracyMetrics(mockFeedId);
      const connectionHealth = performanceMonitor.getConnectionHealthMetrics();

      expect(performanceMetrics).toHaveProperty("averageResponseTime");
      expect(performanceMetrics).toHaveProperty("dataFreshness");
      expect(accuracyMetrics).toHaveProperty("averageDeviation");
      expect(accuracyMetrics).toHaveProperty("accuracyRate");
      expect(connectionHealth).toHaveProperty("healthyPercentage");

      // All metrics should indicate healthy system
      expect(performanceMetrics.averageResponseTime).toBeLessThan(100);
      expect(accuracyMetrics.averageDeviation).toBeLessThan(0.005);
      expect(connectionHealth.healthyPercentage).toBe(1.0);
    });

    it("should handle monitoring system failures gracefully", async () => {
      // Simulate monitoring system failure
      const originalRecordResponseTime = performanceMonitor.recordResponseTime;
      jest.spyOn(performanceMonitor, "recordResponseTime").mockImplementation(() => {
        throw new Error("Monitoring system failure");
      });

      // System should continue operating despite monitoring failures
      expect(() => {
        performanceMonitor.recordResponseTime("/feed-values", 100);
      }).not.toThrow();

      // Restore original method
      performanceMonitor.recordResponseTime = originalRecordResponseTime;
    });
  });

  describe("Performance Under Load", () => {
    it("should handle high-frequency monitoring data efficiently", async () => {
      const startTime = Date.now();

      // Generate high volume of monitoring data
      const promises = [];
      for (let i = 0; i < 1000; i++) {
        promises.push(
          Promise.resolve().then(() => {
            performanceMonitor.recordResponseTime("/feed-values", 50 + Math.random() * 50);
            accuracyMonitor.recordConsensusDeviation(mockFeedId, Math.random() * 0.01);
            performanceMonitor.recordPriceUpdate(mockFeedId);
          })
        );
      }

      await Promise.all(promises);

      const processingTime = Date.now() - startTime;

      // Should handle high volume efficiently
      expect(processingTime).toBeLessThan(1000); // Less than 1 second for 1000 data points

      // Metrics should be accurate
      const metrics = performanceMonitor.getMetrics();
      expect(metrics.totalRequests).toBeGreaterThanOrEqual(1000);
    });

    it("should maintain monitoring accuracy under concurrent load", async () => {
      const concurrentOperations = 100;
      const promises = [];

      for (let i = 0; i < concurrentOperations; i++) {
        promises.push(
          Promise.resolve().then(async () => {
            // Simulate concurrent monitoring operations
            performanceMonitor.recordResponseTime("/feed-values", 75);
            accuracyMonitor.recordAccuracyCheck(mockFeedId, true);
            performanceMonitor.recordConnectionHealth("binance", true);

            await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
          })
        );
      }

      await Promise.all(promises);

      // Verify data integrity
      const performanceMetrics = performanceMonitor.getMetrics();
      const accuracyMetrics = accuracyMonitor.getAccuracyMetrics(mockFeedId);

      expect(performanceMetrics.totalRequests).toBe(concurrentOperations);
      expect(accuracyMetrics.totalChecks).toBe(concurrentOperations);
      expect(accuracyMetrics.accuracyRate).toBe(1.0); // All checks were accurate
    });
  });
});
