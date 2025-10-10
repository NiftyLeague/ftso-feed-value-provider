import { Test, TestingModule } from "@nestjs/testing";
import { SystemHealthService } from "../system-health.service";
import { AccuracyMonitorService } from "@/monitoring/accuracy-monitor.service";
import { AlertingService } from "@/monitoring/alerting.service";

// Mock the EventDrivenService to avoid complex setup
jest.mock("../../../common/base/composed.service", () => ({
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
    public startTimer = jest.fn();
    public endTimer = jest.fn();
    public logCriticalOperation = jest.fn();
    public logError = jest.fn();
    public setHealthStatus = jest.fn();

    constructor() {
      // Mock constructor
    }
  },
}));

// Mock the monitoring services
jest.mock("../../../monitoring/accuracy-monitor.service", () => ({
  AccuracyMonitorService: class MockAccuracyMonitorService {
    public recordPrice = jest.fn();
    public on = jest.fn();
  },
}));

jest.mock("../../../monitoring/alerting.service", () => ({
  AlertingService: class MockAlertingService {
    public sendAlert = jest.fn();
  },
}));

describe("SystemHealthService", () => {
  let service: SystemHealthService;

  beforeEach(async () => {
    const mockAccuracyMonitor = {
      recordPrice: jest.fn(),
      on: jest.fn(),
    };

    const mockAlertingService = {
      sendAlert: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SystemHealthService,
        {
          provide: AccuracyMonitorService,
          useValue: mockAccuracyMonitor,
        },
        {
          provide: AlertingService,
          useValue: mockAlertingService,
        },
      ],
    }).compile();

    service = module.get<SystemHealthService>(SystemHealthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("recordSourceHealth", () => {
    it("should record healthy source status", () => {
      const sourceId = "test-source";
      const status = "healthy";

      service.recordSourceHealth(sourceId, status);

      const health = service.getSourceHealth(sourceId);
      expect(health).toBeDefined();
      expect(health?.sourceId).toBe(sourceId);
      expect(health?.status).toBe(status);
      expect(health?.errorCount).toBe(0);
      expect(health?.recoveryCount).toBe(0);
    });

    it("should record unhealthy source status and increment error count", () => {
      const sourceId = "test-source";
      const status = "unhealthy";

      service.recordSourceHealth(sourceId, status);

      const health = service.getSourceHealth(sourceId);
      expect(health?.status).toBe(status);
      expect(health?.errorCount).toBe(1);
    });

    it("should record recovered source status and increment recovery count", () => {
      const sourceId = "test-source";
      const status = "recovered";

      service.recordSourceHealth(sourceId, status);

      const health = service.getSourceHealth(sourceId);
      expect(health?.status).toBe(status);
      expect(health?.recoveryCount).toBe(1);
    });

    it("should update existing source health status", () => {
      const sourceId = "test-source";

      // First record as healthy
      service.recordSourceHealth(sourceId, "healthy");
      let health = service.getSourceHealth(sourceId);
      expect(health?.errorCount).toBe(0);

      // Then record as unhealthy
      service.recordSourceHealth(sourceId, "unhealthy");
      health = service.getSourceHealth(sourceId);
      expect(health?.errorCount).toBe(1);
    });
  });

  describe("recordPriceAggregation", () => {
    it("should record successful price aggregation", () => {
      const aggregatedPrice = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        sources: ["source1", "source2"],
        confidence: 0.95,
        consensusScore: 0.85,
      };

      service.recordPriceAggregation(aggregatedPrice);

      // The method should not throw
      expect(() => service.recordPriceAggregation(aggregatedPrice)).not.toThrow();
    });
  });

  describe("recordAggregationError", () => {
    it("should record aggregation error", () => {
      const error = new Error("Test aggregation error");

      service.recordAggregationError(error);

      // Check that error was stored
      const health = service.getOverallHealth();
      expect(health.aggregation.errorCount).toBe(1);
      expect(health.aggregation.lastError).toBe("Test aggregation error");
    });

    it("should limit error history to 100 errors", () => {
      // Add 101 errors
      for (let i = 0; i < 101; i++) {
        service.recordAggregationError(new Error(`Error ${i}`));
      }

      const health = service.getOverallHealth();
      expect(health.aggregation.errorCount).toBe(100);
    });
  });

  describe("getOverallHealth", () => {
    it("should return current health metrics", () => {
      const health = service.getOverallHealth();

      expect(health).toBeDefined();
      expect(health.status).toBe("healthy");
      expect(health.timestamp).toBeDefined();
      expect(health.sources).toEqual([]);
      expect(health.aggregation).toBeDefined();
      expect(health.performance).toBeDefined();
      expect(health.accuracy).toBeDefined();
    });

    it("should update health status based on source health", () => {
      // Add some unhealthy sources
      service.recordSourceHealth("source1", "unhealthy");
      service.recordSourceHealth("source2", "unhealthy");
      service.recordSourceHealth("source3", "healthy");

      const health = service.getOverallHealth();
      expect(health.status).toBe("unhealthy"); // 2/3 unhealthy = 33% healthy, which is < 50%
    });

    it("should mark system as degraded when some sources are unhealthy", () => {
      // Add 1 unhealthy source out of 3 (66% healthy)
      service.recordSourceHealth("source1", "unhealthy");
      service.recordSourceHealth("source2", "healthy");
      service.recordSourceHealth("source3", "healthy");

      const health = service.getOverallHealth();
      expect(health.status).toBe("degraded"); // 1/3 unhealthy = 66% healthy, which is >= 50% but < 80%
    });

    it("should mark system as unhealthy when most sources are unhealthy", () => {
      // Add mostly unhealthy sources
      service.recordSourceHealth("source1", "unhealthy");
      service.recordSourceHealth("source2", "unhealthy");
      service.recordSourceHealth("source3", "unhealthy");
      service.recordSourceHealth("source4", "healthy");

      const health = service.getOverallHealth();
      expect(health.status).toBe("unhealthy"); // 3/4 unhealthy = 25% healthy
    });
  });

  describe("getSourceHealth", () => {
    it("should return null for non-existent source", () => {
      const health = service.getSourceHealth("non-existent");
      expect(health).toBeNull();
    });

    it("should return health for existing source", () => {
      service.recordSourceHealth("test-source", "healthy");
      const health = service.getSourceHealth("test-source");

      expect(health).toBeDefined();
      expect(health?.sourceId).toBe("test-source");
    });
  });

  describe("getAllSourcesHealth", () => {
    it("should return empty array when no sources", () => {
      const sources = service.getAllSourcesHealth();
      expect(sources).toEqual([]);
    });

    it("should return all source health statuses", () => {
      service.recordSourceHealth("source1", "healthy");
      service.recordSourceHealth("source2", "unhealthy");
      service.recordSourceHealth("source3", "recovered");

      const sources = service.getAllSourcesHealth();
      expect(sources).toHaveLength(3);
      expect(sources.map(s => s.sourceId)).toContain("source1");
      expect(sources.map(s => s.sourceId)).toContain("source2");
      expect(sources.map(s => s.sourceId)).toContain("source3");
    });
  });

  describe("shutdown", () => {
    it("should shutdown gracefully", async () => {
      await service.shutdown();

      // The method should not throw
      expect(() => service.shutdown()).not.toThrow();
    });
  });

  describe("health status calculation", () => {
    it("should calculate healthy status correctly", () => {
      service.recordSourceHealth("source1", "healthy");
      service.recordSourceHealth("source2", "healthy");

      const health = service.getOverallHealth();
      expect(health.status).toBe("healthy");
    });

    it("should calculate degraded status correctly", () => {
      service.recordSourceHealth("source1", "healthy");
      service.recordSourceHealth("source2", "unhealthy");

      const health = service.getOverallHealth();
      expect(health.status).toBe("degraded");
    });

    it("should calculate unhealthy status correctly", () => {
      service.recordSourceHealth("source1", "unhealthy");
      service.recordSourceHealth("source2", "unhealthy");

      const health = service.getOverallHealth();
      expect(health.status).toBe("unhealthy");
    });
  });

  describe("aggregation metrics", () => {
    it("should calculate success rate correctly", () => {
      // Record some successful aggregations
      service.recordPriceAggregation({
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        sources: ["source1"],
        confidence: 0.95,
        consensusScore: 0.85,
      });

      // Record some errors
      service.recordAggregationError(new Error("Test error"));

      const health = service.getOverallHealth();
      expect(health.aggregation.successRate).toBeDefined();
      expect(health.aggregation.errorCount).toBe(1);
    });

    it("should update success rate when recording errors", () => {
      // Record some errors
      service.recordAggregationError(new Error("Error 1"));
      service.recordAggregationError(new Error("Error 2"));

      const health = service.getOverallHealth();
      expect(health.aggregation.errorCount).toBe(2);
      expect(health.aggregation.lastError).toBe("Error 2");
    });
  });
});
