import {
  Timer,
  createTimer,
  measureAsync,
  measureSync,
  checkPerformanceThreshold,
  checkResponseLatency,
  PerformanceStats,
  PerformanceLogger,
  PerformanceUtils,
} from "../performance.utils";

// Mock performance.now
const mockPerformanceNow = jest.fn();
Object.defineProperty(global, "performance", {
  value: {
    now: mockPerformanceNow,
  },
  writable: true,
});

describe("Performance Utils - Comprehensive Tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPerformanceNow.mockReturnValue(0);
  });

  describe("Timer class", () => {
    let timer: Timer;

    beforeEach(() => {
      timer = new Timer();
    });

    it("should start timer and reset end time", () => {
      mockPerformanceNow
        .mockReturnValueOnce(1000) // start
        .mockReturnValueOnce(1000); // elapsed call

      timer.start();

      // After start, elapsed should be 0 since endTime is reset
      expect(timer.elapsed()).toBe(0);
    });

    it("should end timer and return elapsed time", () => {
      mockPerformanceNow
        .mockReturnValueOnce(1000) // start
        .mockReturnValueOnce(1500); // end

      timer.start();
      const elapsed = timer.end();

      expect(elapsed).toBe(500);
    });

    it("should calculate elapsed time without ending", () => {
      mockPerformanceNow
        .mockReturnValueOnce(1000) // start
        .mockReturnValueOnce(1200); // elapsed call

      timer.start();
      const elapsed = timer.elapsed();

      expect(elapsed).toBe(200);
    });

    it("should reset timer", () => {
      mockPerformanceNow
        .mockReturnValueOnce(1000) // start
        .mockReturnValueOnce(1500); // end

      timer.start();
      timer.end();
      timer.reset();

      expect(timer.elapsed()).toBe(0);
    });

    it("should handle multiple start calls", () => {
      mockPerformanceNow
        .mockReturnValueOnce(1000) // first start
        .mockReturnValueOnce(1200) // second start
        .mockReturnValueOnce(1500); // end

      timer.start();
      timer.start(); // Should reset
      const elapsed = timer.end();

      expect(elapsed).toBe(300);
    });
  });

  describe("createTimer function", () => {
    it("should create and start a new timer", () => {
      mockPerformanceNow
        .mockReturnValueOnce(1000) // start in createTimer
        .mockReturnValueOnce(1000); // elapsed call

      const timer = createTimer();

      expect(timer).toBeInstanceOf(Timer);
      expect(timer.elapsed()).toBe(0);
    });
  });

  describe("measureAsync function", () => {
    it("should measure async operation execution time", async () => {
      mockPerformanceNow
        .mockReturnValueOnce(1000) // start
        .mockReturnValueOnce(1500); // end

      const operation = jest.fn().mockResolvedValue("result");

      const result = await measureAsync(operation, "test-operation");

      expect(result.result).toBe("result");
      expect(result.duration).toBe(500);
      expect(result.metric.operation).toBe("test-operation");
      expect(operation).toHaveBeenCalled();
    });

    it("should handle async operation errors", async () => {
      mockPerformanceNow
        .mockReturnValueOnce(1000) // start
        .mockReturnValueOnce(1500); // end

      const operation = jest.fn().mockRejectedValue(new Error("Test error"));

      await expect(measureAsync(operation, "test-operation")).rejects.toMatchObject({
        error: expect.any(Error),
        duration: 500,
        metric: expect.objectContaining({
          operation: "test-operation",
          metadata: { error: "Test error" },
        }),
      });
    });

    it("should work without operation name", async () => {
      mockPerformanceNow
        .mockReturnValueOnce(1000) // start
        .mockReturnValueOnce(1500); // end

      const operation = jest.fn().mockResolvedValue("result");

      const result = await measureAsync(operation);

      expect(result.result).toBe("result");
      expect(result.metric.operation).toBe("async_operation");
    });
  });

  describe("measureSync function", () => {
    it("should measure sync operation execution time", () => {
      mockPerformanceNow
        .mockReturnValueOnce(1000) // start
        .mockReturnValueOnce(1500); // end

      const operation = jest.fn().mockReturnValue("result");

      const result = measureSync(operation, "test-operation");

      expect(result.result).toBe("result");
      expect(result.duration).toBe(500);
      expect(result.metric.operation).toBe("test-operation");
      expect(operation).toHaveBeenCalled();
    });

    it("should handle sync operation errors", () => {
      const operation = jest.fn().mockImplementation(() => {
        throw new Error("Test error");
      });

      expect(() => measureSync(operation, "test-operation")).toThrow();

      try {
        measureSync(operation, "test-operation");
      } catch (error: any) {
        expect(error.error).toBeInstanceOf(Error);
        expect(error.duration).toBeDefined();
        expect(error.metric.operation).toBe("test-operation");
        expect(error.metric.metadata).toEqual({ error: "Test error" });
      }
    });

    it("should work without operation name", () => {
      mockPerformanceNow
        .mockReturnValueOnce(1000) // start
        .mockReturnValueOnce(1500); // end

      const operation = jest.fn().mockReturnValue("result");

      const result = measureSync(operation);

      expect(result.result).toBe("result");
      expect(result.metric.operation).toBe("sync_operation");
    });
  });

  describe("checkPerformanceThreshold function", () => {
    it("should return ok when duration is below threshold", () => {
      const result = checkPerformanceThreshold(50, 100, "test-operation");
      expect(result.level).toBe("ok");
      expect(result.message).toBeUndefined();
    });

    it("should return warning when duration is above threshold but below 2x threshold", () => {
      const result = checkPerformanceThreshold(150, 100, "test-operation");
      expect(result.level).toBe("warning");
      expect(result.message).toContain("warning threshold");
    });

    it("should return error when duration is above 2x threshold", () => {
      const result = checkPerformanceThreshold(250, 100, "test-operation");
      expect(result.level).toBe("error");
      expect(result.message).toContain("error threshold");
    });

    it("should return warning when duration equals threshold", () => {
      const result = checkPerformanceThreshold(100, 100, "test-operation");
      expect(result.level).toBe("warning");
    });
  });

  describe("checkResponseLatency function", () => {
    const mockThresholds = {
      maxResponseLatency: 100,
      maxDataAge: 5000,
      minThroughput: 10,
      minCacheHitRate: 0.8,
    };

    it("should return ok for acceptable latency", () => {
      const result = checkResponseLatency(50, mockThresholds, "test-operation");
      expect(result.level).toBe("ok");
    });

    it("should return warning for high latency", () => {
      const result = checkResponseLatency(150, mockThresholds, "test-operation");
      expect(result.level).toBe("warning");
    });

    it("should return error for very high latency", () => {
      const result = checkResponseLatency(250, mockThresholds, "test-operation");
      expect(result.level).toBe("error");
    });
  });

  describe("PerformanceStats class", () => {
    let stats: PerformanceStats;

    beforeEach(() => {
      stats = new PerformanceStats();
    });

    it("should add measurements", () => {
      stats.addMeasurement(100);
      stats.addMeasurement(200);

      const statsData = stats.getStats();
      expect(statsData.count).toBe(2);
      expect(statsData.average).toBe(150);
    });

    it("should calculate percentiles", () => {
      // Add measurements for percentile calculation
      for (let i = 1; i <= 100; i++) {
        stats.addMeasurement(i);
      }

      const statsData = stats.getStats();
      expect(statsData.p50).toBe(51); // Math.floor(100 * 0.5) = 50, but array is 1-indexed
      expect(statsData.p95).toBe(96); // Math.floor(100 * 0.95) = 95, but array is 1-indexed
      expect(statsData.p99).toBe(100); // Math.floor(100 * 0.99) = 99, but array is 1-indexed
    });

    it("should handle empty measurements", () => {
      const statsData = stats.getStats();
      expect(statsData.count).toBe(0);
      expect(statsData.average).toBe(0);
    });

    it("should reset measurements", () => {
      stats.addMeasurement(100);
      stats.reset();

      const statsData = stats.getStats();
      expect(statsData.count).toBe(0);
    });

    it("should limit measurements to maxMeasurements", () => {
      const limitedStats = new PerformanceStats(5);

      // Add more measurements than the limit
      for (let i = 1; i <= 10; i++) {
        limitedStats.addMeasurement(i);
      }

      const statsData = limitedStats.getStats();
      expect(statsData.count).toBe(5);
      // Should keep the last 5 measurements (6, 7, 8, 9, 10)
      expect(statsData.min).toBe(6);
      expect(statsData.max).toBe(10);
    });
  });

  describe("PerformanceLogger class", () => {
    let logger: PerformanceLogger;
    let mockOnFlush: jest.Mock;

    beforeEach(() => {
      mockOnFlush = jest.fn();
      logger = new PerformanceLogger(mockOnFlush);
    });

    it("should log performance metrics", () => {
      const metric = {
        operation: "test-operation",
        duration: 100,
        timestamp: Date.now(),
      };

      logger.log(metric);

      // Should not flush immediately
      expect(mockOnFlush).not.toHaveBeenCalled();
    });

    it("should flush when buffer is full", () => {
      const metric = {
        operation: "test-operation",
        duration: 100,
        timestamp: Date.now(),
      };

      // Fill the buffer (default maxBufferSize is 100)
      for (let i = 0; i < 100; i++) {
        logger.log({ ...metric, operation: `operation-${i}` });
      }

      expect(mockOnFlush).toHaveBeenCalledTimes(1);
      expect(mockOnFlush).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ operation: "operation-0" }),
          expect.objectContaining({ operation: "operation-99" }),
        ])
      );
    });

    it("should flush on destroy", () => {
      const metric = {
        operation: "test-operation",
        duration: 100,
        timestamp: Date.now(),
      };

      logger.log(metric);
      logger.destroy();

      expect(mockOnFlush).toHaveBeenCalledTimes(1);
    });

    it("should handle custom options", () => {
      const customLogger = new PerformanceLogger(mockOnFlush, {
        flushInterval: 1000,
        maxBufferSize: 5,
      });

      const metric = {
        operation: "test-operation",
        duration: 100,
        timestamp: Date.now(),
      };

      // Fill the smaller buffer
      for (let i = 0; i < 5; i++) {
        customLogger.log({ ...metric, operation: `operation-${i}` });
      }

      expect(mockOnFlush).toHaveBeenCalledTimes(1);
    });
  });

  describe("PerformanceUtils object", () => {
    it("should get current timestamp", () => {
      const now = PerformanceUtils.now();
      expect(typeof now).toBe("number");
      expect(now).toBeGreaterThan(0);
    });

    it("should get high-resolution timestamp", () => {
      mockPerformanceNow.mockReturnValueOnce(1234.567);

      const hrNow = PerformanceUtils.hrNow();
      expect(hrNow).toBe(1234.567);
    });

    it("should calculate duration", () => {
      const start = 1000;
      const end = 1500;

      const duration = PerformanceUtils.duration(start, end);
      expect(duration).toBe(500);
    });

    it("should calculate duration with current time", () => {
      const start = 1000;
      const mockNow = 1500;
      jest.spyOn(Date, "now").mockReturnValue(mockNow);

      const duration = PerformanceUtils.duration(start);
      expect(duration).toBe(500);

      jest.restoreAllMocks();
    });

    it("should format duration in milliseconds", () => {
      const formatted = PerformanceUtils.formatDuration(500);
      expect(formatted).toBe("500.00ms");
    });

    it("should format duration in seconds", () => {
      const formatted = PerformanceUtils.formatDuration(1500);
      expect(formatted).toBe("1.50s");
    });

    it("should check if duration exceeds threshold", () => {
      expect(PerformanceUtils.exceedsThreshold(150, 100)).toBe(true);
      expect(PerformanceUtils.exceedsThreshold(50, 100)).toBe(false);
    });

    it("should create warning message", () => {
      const message = PerformanceUtils.createWarningMessage("test", 150, 100);
      expect(message).toContain("Performance warning");
      expect(message).toContain("test");
      expect(message).toContain("150.00ms");
      expect(message).toContain("100.00ms");
    });
  });

  describe("edge cases and error handling", () => {
    it("should handle negative elapsed time", () => {
      mockPerformanceNow
        .mockReturnValueOnce(1500) // start
        .mockReturnValueOnce(1000); // end (negative elapsed)

      const timer = new Timer();
      timer.start();
      const elapsed = timer.end();

      expect(elapsed).toBe(-500);
    });

    it("should handle very small elapsed times", () => {
      mockPerformanceNow
        .mockReturnValueOnce(1000) // start
        .mockReturnValueOnce(1000.001); // end (very small elapsed)

      const timer = new Timer();
      timer.start();
      const elapsed = timer.end();

      expect(elapsed).toBeCloseTo(0.001, 10);
    });

    it("should handle multiple timer operations", () => {
      const timers: Timer[] = [];

      // Create multiple timers
      for (let i = 0; i < 100; i++) {
        const timer = new Timer();
        timer.start();
        timers.push(timer);
      }

      // End all timers
      timers.forEach(timer => timer.end());

      // All timers should have elapsed time
      timers.forEach(timer => {
        expect(timer.elapsed()).toBeGreaterThanOrEqual(0);
      });
    });

    it("should handle performance stats with zero values", () => {
      const stats = new PerformanceStats();
      stats.addMeasurement(0);

      const statsData = stats.getStats();
      expect(statsData.average).toBe(0);
    });

    it("should handle performance stats with very large values", () => {
      const stats = new PerformanceStats();
      stats.addMeasurement(Number.MAX_SAFE_INTEGER);

      const statsData = stats.getStats();
      expect(statsData.max).toBe(Number.MAX_SAFE_INTEGER);
    });
  });

  describe("performance characteristics", () => {
    it("should handle large numbers of measurements efficiently", () => {
      const stats = new PerformanceStats();

      const start = performance.now();
      for (let i = 0; i < 10000; i++) {
        stats.addMeasurement(Math.random() * 1000);
      }
      const end = performance.now();

      expect(end - start).toBeLessThan(100); // Should complete within 100ms
    });

    it("should handle concurrent timer operations", () => {
      const timers: Timer[] = [];

      // Create multiple timers concurrently
      for (let i = 0; i < 1000; i++) {
        const timer = new Timer();
        timer.start();
        timers.push(timer);
      }

      // End all timers
      timers.forEach(timer => timer.end());

      // All timers should have elapsed time
      timers.forEach(timer => {
        expect(timer.elapsed()).toBeGreaterThanOrEqual(0);
      });
    });
  });
});
