import { Test, TestingModule } from "@nestjs/testing";
import { AccuracyMonitorService } from "../accuracy-monitor.service";
import { MonitoringConfig } from "../interfaces/monitoring.interfaces";

describe("AccuracyMonitorService", () => {
  let service: AccuracyMonitorService;
  let mockConfig: MonitoringConfig;

  beforeEach(async () => {
    mockConfig = {
      accuracyThresholds: {
        maxConsensusDeviation: 0.5, // 0.5% FTSO requirement
        minAccuracyRate: 80, // 80% target
        minQualityScore: 70,
      },
      performanceThresholds: {
        maxResponseLatency: 100,
        maxDataAge: 2000,
        minThroughput: 100,
        minCacheHitRate: 80,
      },
      healthThresholds: {
        maxErrorRate: 5,
        maxCpuUsage: 80,
        maxMemoryUsage: 80,
        minConnectionRate: 90,
      },
      monitoringInterval: 1000,
      alerting: {
        rules: [],
        deliveryConfig: {},
        maxAlertsPerHour: 10,
        alertRetention: 30,
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [AccuracyMonitorService, { provide: "MonitoringConfig", useValue: mockConfig }],
    }).compile();

    service = module.get<AccuracyMonitorService>(AccuracyMonitorService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("trackConsensusDeviation", () => {
    it("should track consensus deviation within threshold", () => {
      const feedId = "BTC/USD";
      const actualValue = 50000;
      const consensusMedian = 50100; // 0.2% deviation

      const metrics = service.trackConsensusDeviation(feedId, actualValue, consensusMedian);

      expect(metrics.consensusDeviation).toBeCloseTo(0.2, 2);
      expect(metrics.accuracyRate).toBe(100); // First measurement, within threshold
      expect(metrics.feedId).toBe(feedId);
      expect(metrics.timestamp).toBeDefined();
    });

    it("should track consensus deviation exceeding threshold", () => {
      const feedId = "BTC/USD";
      const actualValue = 50000;
      const consensusMedian = 50300; // 0.6% deviation (exceeds 0.5% threshold)

      const metrics = service.trackConsensusDeviation(feedId, actualValue, consensusMedian);

      expect(metrics.consensusDeviation).toBeCloseTo(0.6, 2);
      expect(metrics.accuracyRate).toBe(0); // First measurement, exceeds threshold
      expect(metrics.qualityScore).toBeLessThan(100);
    });

    it("should calculate accuracy rate over multiple measurements", () => {
      const feedId = "ETH/USD";

      // 8 measurements within threshold, 2 exceeding
      for (let i = 0; i < 8; i++) {
        service.trackConsensusDeviation(feedId, 3000, 3010); // 0.33% deviation
      }
      for (let i = 0; i < 2; i++) {
        service.trackConsensusDeviation(feedId, 3000, 3020); // 0.67% deviation
      }

      const metrics = service.getAccuracyMetrics(feedId);
      expect(metrics?.accuracyRate).toBe(80); // 8/10 = 80%
    });
  });

  describe("calculateQualityScore", () => {
    it("should calculate quality score with perfect metrics", () => {
      const feedId = "BTC/USD";
      const qualityScore = service.calculateQualityScore(feedId, 0.1, 100, {
        latency: 50,
        sourceCount: 5,
        uptime: 100,
      });

      expect(qualityScore.accuracy).toBeGreaterThan(75);
      expect(qualityScore.latency).toBe(50); // 50ms latency = 50% score
      expect(qualityScore.coverage).toBe(100);
      expect(qualityScore.reliability).toBe(100);
      expect(qualityScore.overall).toBeGreaterThan(80);
    });

    it("should calculate quality score with poor metrics", () => {
      const feedId = "BTC/USD";
      const qualityScore = service.calculateQualityScore(feedId, 0.8, 60, {
        latency: 150,
        sourceCount: 2,
        uptime: 70,
      });

      expect(qualityScore.accuracy).toBeLessThan(50); // High deviation
      expect(qualityScore.latency).toBe(0); // Latency exceeds threshold
      expect(qualityScore.coverage).toBe(40); // Only 2/5 sources
      expect(qualityScore.reliability).toBe(70);
      expect(qualityScore.overall).toBeLessThan(50);
    });
  });

  describe("getSystemAccuracyStats", () => {
    it("should return zero stats for empty system", () => {
      const stats = service.getSystemAccuracyStats();

      expect(stats.averageDeviation).toBe(0);
      expect(stats.averageAccuracyRate).toBe(0);
      expect(stats.averageQualityScore).toBe(0);
      expect(stats.feedsWithinThreshold).toBe(0);
      expect(stats.totalFeeds).toBe(0);
    });

    it("should calculate system-wide statistics", () => {
      // Add metrics for multiple feeds
      service.trackConsensusDeviation("BTC/USD", 50000, 50100); // 0.2% deviation
      service.trackConsensusDeviation("ETH/USD", 3000, 3020); // 0.67% deviation
      service.trackConsensusDeviation("ADA/USD", 1, 1.002); // 0.2% deviation

      const stats = service.getSystemAccuracyStats();

      expect(stats.totalFeeds).toBe(3);
      expect(stats.feedsWithinThreshold).toBe(2); // BTC and ADA within 0.5%
      expect(stats.averageDeviation).toBeCloseTo(0.35, 1); // Approximately (0.2 + 0.67 + 0.2) / 3
    });
  });

  describe("checkAccuracyThresholds", () => {
    it("should return false for non-existent feed", () => {
      const result = service.checkAccuracyThresholds("NON_EXISTENT");

      expect(result.consensusDeviationOk).toBe(false);
      expect(result.accuracyRateOk).toBe(false);
      expect(result.qualityScoreOk).toBe(false);
      expect(result.overallOk).toBe(false);
    });

    it("should check thresholds for existing feed", () => {
      const feedId = "BTC/USD";

      // Create metrics that meet all thresholds
      service.trackConsensusDeviation(feedId, 50000, 50100); // 0.2% deviation

      const result = service.checkAccuracyThresholds(feedId);

      expect(result.consensusDeviationOk).toBe(true);
      expect(result.accuracyRateOk).toBe(true); // 100% accuracy rate
      expect(result.overallOk).toBe(true);
    });
  });

  describe("getAccuracyHistory", () => {
    it("should return limited history", () => {
      const feedId = "BTC/USD";

      // Add 10 measurements
      for (let i = 0; i < 10; i++) {
        service.trackConsensusDeviation(feedId, 50000, 50100 + i);
      }

      const history = service.getAccuracyHistory(feedId, 5);
      expect(history).toHaveLength(5);
      expect(history[0].timestamp).toBeLessThanOrEqual(history[4].timestamp);
    });

    it("should return empty array for non-existent feed", () => {
      const history = service.getAccuracyHistory("NON_EXISTENT");
      expect(history).toHaveLength(0);
    });
  });

  describe("resetMetrics", () => {
    it("should reset metrics for specific feed", () => {
      const feedId = "BTC/USD";
      service.trackConsensusDeviation(feedId, 50000, 50100);

      expect(service.getAccuracyMetrics(feedId)).toBeDefined();

      service.resetMetrics(feedId);

      expect(service.getAccuracyMetrics(feedId)).toBeNull();
    });

    it("should reset all metrics", () => {
      service.trackConsensusDeviation("BTC/USD", 50000, 50100);
      service.trackConsensusDeviation("ETH/USD", 3000, 3010);

      expect(service.getSystemAccuracyStats().totalFeeds).toBe(2);

      service.resetMetrics();

      expect(service.getSystemAccuracyStats().totalFeeds).toBe(0);
    });
  });
});
