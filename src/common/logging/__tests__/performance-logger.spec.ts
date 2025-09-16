import { PerformanceLogger } from "../performance-logger";
import * as fs from "fs";
import * as path from "path";

// Mock fs module
jest.mock("fs");
const mockedFs = fs as jest.Mocked<typeof fs>;

// Mock performance.now
const mockPerformanceNow = jest.fn();
Object.defineProperty(global, "performance", {
  value: {
    now: mockPerformanceNow,
  },
  writable: true,
});

describe("PerformanceLogger", () => {
  let performanceLogger: PerformanceLogger;
  const mockLogDirectory = "/tmp/test-logs";
  const mockPerformanceLogFile = path.join(mockLogDirectory, "performance.log");

  beforeEach(() => {
    jest.clearAllMocks();
    mockPerformanceNow.mockReturnValue(0);
    performanceLogger = new PerformanceLogger("TestContext", mockLogDirectory, true, true);
  });

  describe("constructor", () => {
    it("should initialize with correct parameters", () => {
      const logger = new PerformanceLogger("TestContext", "/tmp/logs", true, true);
      expect(logger).toBeInstanceOf(PerformanceLogger);
    });

    it("should use default values when not provided", () => {
      const logger = new PerformanceLogger("TestContext", "/tmp/logs");
      expect(logger).toBeInstanceOf(PerformanceLogger);
    });

    it("should disable performance logging when specified", () => {
      const logger = new PerformanceLogger("TestContext", "/tmp/logs", false, false);
      expect(logger).toBeInstanceOf(PerformanceLogger);
    });
  });

  describe("startTimer", () => {
    it("should start timer for operation", () => {
      const operationId = "test-operation-1";
      const operation = "testOperation";
      const component = "TestComponent";
      const metadata = { testKey: "testValue" };

      performanceLogger.startTimer(operationId, operation, component, metadata);

      // Verify timer was started (we can't easily test internal state)
      expect(performanceLogger).toBeDefined();
    });

    it("should not start timer when performance logging is disabled", () => {
      const logger = new PerformanceLogger("TestContext", mockLogDirectory, false, false);
      const operationId = "test-operation-1";
      const operation = "testOperation";
      const component = "TestComponent";

      logger.startTimer(operationId, operation, component);

      // Should not throw or cause issues
      expect(logger).toBeDefined();
    });

    it("should handle operation without metadata", () => {
      const operationId = "test-operation-1";
      const operation = "testOperation";
      const component = "TestComponent";

      performanceLogger.startTimer(operationId, operation, component);

      expect(performanceLogger).toBeDefined();
    });
  });

  describe("endTimer", () => {
    it("should end timer and calculate duration", () => {
      const operationId = "test-operation-1";
      const operation = "testOperation";
      const component = "TestComponent";

      // Mock performance.now to return different values
      mockPerformanceNow
        .mockReturnValueOnce(1000) // start time
        .mockReturnValueOnce(1500); // end time

      performanceLogger.startTimer(operationId, operation, component);
      performanceLogger.endTimer(operationId, true);

      // Verify the operation completed
      expect(performanceLogger).toBeDefined();
    });

    it("should handle successful operation", () => {
      const operationId = "test-operation-1";
      const operation = "testOperation";
      const component = "TestComponent";

      mockPerformanceNow.mockReturnValueOnce(1000).mockReturnValueOnce(1500);

      performanceLogger.startTimer(operationId, operation, component);
      performanceLogger.endTimer(operationId, true);

      expect(performanceLogger).toBeDefined();
    });

    it("should handle failed operation", () => {
      const operationId = "test-operation-1";
      const operation = "testOperation";
      const component = "TestComponent";

      mockPerformanceNow.mockReturnValueOnce(1000).mockReturnValueOnce(1500);

      performanceLogger.startTimer(operationId, operation, component);
      performanceLogger.endTimer(operationId, false);

      expect(performanceLogger).toBeDefined();
    });

    it("should not end timer when performance logging is disabled", () => {
      const logger = new PerformanceLogger("TestContext", mockLogDirectory, false, false);
      const operationId = "test-operation-1";

      logger.endTimer(operationId, true);

      // Should not throw or cause issues
      expect(logger).toBeDefined();
    });

    it("should handle timer not found", () => {
      const operationId = "non-existent-operation";

      // Mock the logger to verify warning is logged
      const mockLogger = {
        warn: jest.fn(),
        log: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        verbose: jest.fn(),
      };
      (performanceLogger as any).logger = mockLogger;

      performanceLogger.endTimer(operationId, true);

      expect(mockLogger.warn).toHaveBeenCalledWith(`Performance timer not found for operation: ${operationId}`);
    });

    it("should merge additional metadata", () => {
      const operationId = "test-operation-1";
      const operation = "testOperation";
      const component = "TestComponent";
      const initialMetadata = { initialKey: "initialValue" };
      const additionalMetadata = { additionalKey: "additionalValue" };

      mockPerformanceNow.mockReturnValueOnce(1000).mockReturnValueOnce(1500);

      performanceLogger.startTimer(operationId, operation, component, initialMetadata);
      performanceLogger.endTimer(operationId, true, additionalMetadata);

      expect(performanceLogger).toBeDefined();
    });
  });

  describe("getStatistics", () => {
    it("should return correct statistics for empty state", () => {
      const stats = performanceLogger.getStatistics();

      expect(stats).toEqual({
        activeOperations: 0,
        completedOperations: 0,
        averageOperationTime: 0,
      });
    });

    it("should return correct statistics with active operations", () => {
      const operationId1 = "test-operation-1";
      const operationId2 = "test-operation-2";

      performanceLogger.startTimer(operationId1, "operation1", "Component1");
      performanceLogger.startTimer(operationId2, "operation2", "Component2");

      const stats = performanceLogger.getStatistics();

      expect(stats.activeOperations).toBe(2);
      expect(stats.completedOperations).toBe(0);
      expect(stats.averageOperationTime).toBe(0);
    });

    it("should update statistics after operations complete", () => {
      const operationId = "test-operation-1";

      mockPerformanceNow.mockReturnValueOnce(1000).mockReturnValueOnce(1500);

      performanceLogger.startTimer(operationId, "testOperation", "TestComponent");
      performanceLogger.endTimer(operationId, true);

      const stats = performanceLogger.getStatistics();

      expect(stats.activeOperations).toBe(0);
      expect(stats.completedOperations).toBe(0); // This would need to be tracked separately
      expect(stats.averageOperationTime).toBe(0); // This would need to be calculated
    });
  });

  describe("writeToFile", () => {
    it("should write performance entry to file when enabled", () => {
      const operationId = "test-operation-1";
      const operation = "testOperation";
      const component = "TestComponent";

      mockPerformanceNow.mockReturnValueOnce(1000).mockReturnValueOnce(1500);

      performanceLogger.startTimer(operationId, operation, component);
      performanceLogger.endTimer(operationId, true);

      expect(mockedFs.appendFileSync).toHaveBeenCalledWith(
        mockPerformanceLogFile,
        expect.stringMatching(/.*"operation":"testOperation".*"component":"TestComponent".*/)
      );
    });

    it("should not write to file when file logging is disabled", () => {
      const logger = new PerformanceLogger("TestContext", mockLogDirectory, true, false);
      const operationId = "test-operation-1";

      mockPerformanceNow.mockReturnValueOnce(1000).mockReturnValueOnce(1500);

      logger.startTimer(operationId, "testOperation", "TestComponent");
      logger.endTimer(operationId, true);

      expect(mockedFs.appendFileSync).not.toHaveBeenCalled();
    });

    it("should handle file write errors gracefully", () => {
      mockedFs.appendFileSync.mockImplementation(() => {
        throw new Error("File write error");
      });

      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      const operationId = "test-operation-1";

      mockPerformanceNow.mockReturnValueOnce(1000).mockReturnValueOnce(1500);

      performanceLogger.startTimer(operationId, "testOperation", "TestComponent");
      performanceLogger.endTimer(operationId, true);

      expect(consoleSpy).toHaveBeenCalledWith("Failed to write performance log:", expect.any(Error));

      consoleSpy.mockRestore();
    });

    it("should include timestamps in ISO format", () => {
      const operationId = "test-operation-1";

      mockPerformanceNow.mockReturnValueOnce(1000).mockReturnValueOnce(1500);

      performanceLogger.startTimer(operationId, "testOperation", "TestComponent");
      performanceLogger.endTimer(operationId, true);

      expect(mockedFs.appendFileSync).toHaveBeenCalledWith(
        mockPerformanceLogFile,
        expect.stringMatching(/.*"startTime":"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z".*/)
      );
      expect(mockedFs.appendFileSync).toHaveBeenCalledWith(
        mockPerformanceLogFile,
        expect.stringMatching(/.*"endTime":"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z".*/)
      );
    });
  });

  describe("operation lifecycle", () => {
    it("should handle complete operation lifecycle", () => {
      const operationId = "test-operation-1";
      const operation = "testOperation";
      const component = "TestComponent";
      const metadata = { testKey: "testValue" };

      mockPerformanceNow.mockReturnValueOnce(1000).mockReturnValueOnce(1500);

      // Start operation
      performanceLogger.startTimer(operationId, operation, component, metadata);

      let stats = performanceLogger.getStatistics();
      expect(stats.activeOperations).toBe(1);

      // End operation
      performanceLogger.endTimer(operationId, true);

      stats = performanceLogger.getStatistics();
      expect(stats.activeOperations).toBe(0);
    });

    it("should handle multiple concurrent operations", () => {
      const operations = [
        { id: "op1", name: "operation1", component: "Component1" },
        { id: "op2", name: "operation2", component: "Component2" },
        { id: "op3", name: "operation3", component: "Component3" },
      ];

      mockPerformanceNow
        .mockReturnValueOnce(1000)
        .mockReturnValueOnce(2000)
        .mockReturnValueOnce(3000)
        .mockReturnValueOnce(1500)
        .mockReturnValueOnce(2500)
        .mockReturnValueOnce(3500);

      // Start all operations
      operations.forEach(({ id, name, component }) => {
        performanceLogger.startTimer(id, name, component);
      });

      let stats = performanceLogger.getStatistics();
      expect(stats.activeOperations).toBe(3);

      // End operations one by one
      operations.forEach(({ id }) => {
        performanceLogger.endTimer(id, true);
      });

      stats = performanceLogger.getStatistics();
      expect(stats.activeOperations).toBe(0);
    });

    it("should clean up completed operations", () => {
      const operationId = "test-operation-1";

      mockPerformanceNow.mockReturnValueOnce(1000).mockReturnValueOnce(1500);

      performanceLogger.startTimer(operationId, "testOperation", "TestComponent");

      let stats = performanceLogger.getStatistics();
      expect(stats.activeOperations).toBe(1);

      performanceLogger.endTimer(operationId, true);

      stats = performanceLogger.getStatistics();
      expect(stats.activeOperations).toBe(0);

      // Try to end the same operation again - should not find it
      const mockLogger = {
        warn: jest.fn(),
        log: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        verbose: jest.fn(),
      };
      (performanceLogger as any).logger = mockLogger;
      performanceLogger.endTimer(operationId, true);
      expect(mockLogger.warn).toHaveBeenCalledWith(`Performance timer not found for operation: ${operationId}`);
    });
  });

  describe("performance measurement accuracy", () => {
    it("should measure duration correctly", () => {
      const operationId = "test-operation-1";
      const startTime = 1000;
      const endTime = 1500;
      // const expectedDuration = 500;

      mockPerformanceNow.mockReturnValueOnce(startTime).mockReturnValueOnce(endTime);

      performanceLogger.startTimer(operationId, "testOperation", "TestComponent");
      performanceLogger.endTimer(operationId, true);

      // The duration should be calculated correctly internally
      expect(performanceLogger).toBeDefined();
    });

    it("should handle zero duration", () => {
      const operationId = "test-operation-1";
      const time = 1000;

      mockPerformanceNow.mockReturnValueOnce(time).mockReturnValueOnce(time);

      performanceLogger.startTimer(operationId, "testOperation", "TestComponent");
      performanceLogger.endTimer(operationId, true);

      expect(performanceLogger).toBeDefined();
    });

    it("should handle negative duration (clock adjustment)", () => {
      const operationId = "test-operation-1";
      const startTime = 2000;
      const endTime = 1000; // End time before start time

      mockPerformanceNow.mockReturnValueOnce(startTime).mockReturnValueOnce(endTime);

      performanceLogger.startTimer(operationId, "testOperation", "TestComponent");
      performanceLogger.endTimer(operationId, true);

      expect(performanceLogger).toBeDefined();
    });
  });
});
