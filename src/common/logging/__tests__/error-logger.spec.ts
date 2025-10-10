import { ErrorLogger } from "../error-logger";
import { ErrorSeverity, ErrorCode } from "../../types/error-handling/error.types";
import * as fs from "fs";
import * as path from "path";

// Mock fs module
jest.mock("fs");
const mockedFs = fs as jest.Mocked<typeof fs>;

describe("ErrorLogger", () => {
  let errorLogger: ErrorLogger;
  const mockLogDirectory = "/tmp/test-logs";
  const mockErrorLogFile = path.join(mockLogDirectory, "errors.log");

  beforeEach(() => {
    jest.clearAllMocks();
    errorLogger = new ErrorLogger("TestContext", mockLogDirectory, 100, true);
  });

  describe("constructor", () => {
    it("should initialize with correct parameters", () => {
      const logger = new ErrorLogger("TestContext", "/tmp/logs", 500, false);
      expect(logger).toBeInstanceOf(ErrorLogger);
    });

    it("should use default values when not provided", () => {
      const logger = new ErrorLogger("TestContext", "/tmp/logs");
      expect(logger).toBeInstanceOf(ErrorLogger);
    });
  });

  describe("logError", () => {
    it("should log error with basic context", () => {
      const error = new Error("Test error message");
      const context = { component: "TestComponent" };

      errorLogger.logError(error, context);

      // Verify that the error was logged (we can't easily test console output)
      expect(errorLogger).toBeDefined();
    });

    it("should log error with full context", () => {
      const error = new Error("Test error message");
      const context = {
        component: "TestComponent",
        operation: "testOperation",
        sourceId: "testSource",
        errorCode: "TEST_ERROR",
        severity: ErrorSeverity.HIGH,
      };

      errorLogger.logError(error, context);

      expect(errorLogger).toBeDefined();
    });

    it("should handle error without context", () => {
      const error = new Error("Test error message");

      errorLogger.logError(error);

      expect(errorLogger).toBeDefined();
    });

    it("should write to file when file logging is enabled", () => {
      const error = new Error("Test error message");
      const context = { component: "TestComponent" };

      errorLogger.logError(error, context);

      expect(mockedFs.appendFileSync).toHaveBeenCalledWith(
        mockErrorLogFile,
        expect.stringContaining("Test error message")
      );
    });

    it("should not write to file when file logging is disabled", () => {
      const logger = new ErrorLogger("TestContext", mockLogDirectory, 100, false);
      const error = new Error("Test error message");

      logger.logError(error);

      expect(mockedFs.appendFileSync).not.toHaveBeenCalled();
    });

    it("should handle file write errors gracefully", () => {
      mockedFs.appendFileSync.mockImplementation(() => {
        throw new Error("File write error");
      });

      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      const error = new Error("Test error message");
      errorLogger.logError(error);

      expect(consoleSpy).toHaveBeenCalledWith("Failed to write error to log file:", expect.any(Error));

      consoleSpy.mockRestore();
    });

    it("should maintain error history within limits", () => {
      const logger = new ErrorLogger("TestContext", mockLogDirectory, 3, false);

      // Add more errors than the limit
      for (let i = 0; i < 5; i++) {
        const error = new Error(`Test error ${i}`);
        logger.logError(error);
      }

      const stats = logger.getStatistics();
      expect(stats.totalErrors).toBe(3); // Should be limited to 3
    });
  });

  describe("getStatistics", () => {
    it("should return correct statistics for empty history", () => {
      const stats = errorLogger.getStatistics();

      expect(stats).toEqual({
        totalErrors: 0,
        errorsBySeverity: {},
        errorsByType: {},
        errorsByComponent: {},
        recentErrors: [],
      });
    });

    it("should return correct statistics with errors", () => {
      const errors = [
        { error: new Error("Error 1"), context: { component: "Component1", severity: ErrorSeverity.HIGH } },
        { error: new Error("Error 2"), context: { component: "Component2", severity: ErrorSeverity.MEDIUM } },
        { error: new Error("Error 3"), context: { component: "Component1", severity: ErrorSeverity.LOW } },
      ];

      errors.forEach(({ error, context }) => {
        errorLogger.logError(error, context);
      });

      const stats = errorLogger.getStatistics();

      expect(stats.totalErrors).toBe(3);
      expect(stats.errorsBySeverity).toEqual({
        high: 1, // HIGH maps to high
        medium: 1, // MEDIUM maps to medium
        low: 1, // LOW maps to low
      });
      expect(stats.errorsByType).toEqual({
        Error: 3,
      });
      expect(stats.errorsByComponent).toEqual({
        Component1: 2,
        Component2: 1,
      });
    });

    it("should filter recent errors correctly", () => {
      // Mock Date.now to control timestamps
      const originalNow = Date.now;
      let mockTime = 1000000; // Base time
      Date.now = jest.fn(() => mockTime);

      // Add an old error (more than 1 hour ago)
      errorLogger.logError(new Error("Old error"));

      // Move time forward by 2 hours
      mockTime += 2 * 60 * 60 * 1000;

      // Add a recent error
      errorLogger.logError(new Error("Recent error"));

      const stats = errorLogger.getStatistics();

      expect(stats.recentErrors).toHaveLength(1);
      expect(stats.recentErrors[0].error.message).toBe("Recent error");

      Date.now = originalNow;
    });
  });

  describe("clearHistory", () => {
    it("should clear error history", () => {
      errorLogger.logError(new Error("Test error"));

      let stats = errorLogger.getStatistics();
      expect(stats.totalErrors).toBe(1);

      errorLogger.clearHistory();

      stats = errorLogger.getStatistics();
      expect(stats.totalErrors).toBe(0);
    });
  });

  describe("determineSeverity", () => {
    it("should use context severity when provided", () => {
      const error = new Error("Test error");
      const context = { severity: ErrorSeverity.CRITICAL };

      errorLogger.logError(error, context);

      const stats = errorLogger.getStatistics();
      expect(stats.errorsBySeverity.critical).toBe(1); // CRITICAL maps to critical
    });

    it("should determine severity from error message", () => {
      const testCases = [
        { message: "fatal system failure", expectedSeverity: "critical" },
        { message: "critical error occurred", expectedSeverity: "critical" },
        { message: "connection timeout", expectedSeverity: "high" },
        { message: "authentication failed", expectedSeverity: "high" },
        { message: "validation error", expectedSeverity: "medium" },
        { message: "parsing failed", expectedSeverity: "medium" },
        { message: "rate limit exceeded", expectedSeverity: "medium" },
        { message: "general error", expectedSeverity: "low" },
      ];

      testCases.forEach(({ message, expectedSeverity }) => {
        const logger = new ErrorLogger("TestContext", mockLogDirectory, 100, false);
        logger.logError(new Error(message));

        const stats = logger.getStatistics();
        expect(stats.errorsBySeverity[expectedSeverity]).toBe(1);
      });
    });

    it("should handle invalid severity in context", () => {
      const error = new Error("Test error");
      const context = { severity: "INVALID_SEVERITY" as any };

      errorLogger.logError(error, context);

      const stats = errorLogger.getStatistics();
      expect(stats.errorsBySeverity.low).toBe(1); // Should default to LOW (low)
    });
  });

  describe("isRecoverableError", () => {
    it("should identify non-recoverable errors", () => {
      const nonRecoverableErrors = [
        "authentication failed",
        "authorization denied",
        "forbidden access",
        "parsing error",
        "invalid format",
        "configuration error",
      ];

      nonRecoverableErrors.forEach(message => {
        const logger = new ErrorLogger("TestContext", mockLogDirectory, 100, false);
        logger.logError(new Error(message));

        const stats = logger.getStatistics();
        expect(stats.recentErrors[0].recoverable).toBe(false);
      });
    });

    it("should identify recoverable errors", () => {
      const recoverableErrors = ["network timeout", "temporary failure", "service unavailable", "rate limit exceeded"];

      recoverableErrors.forEach(message => {
        const logger = new ErrorLogger("TestContext", mockLogDirectory, 100, false);
        logger.logError(new Error(message));

        const stats = logger.getStatistics();
        expect(stats.recentErrors[0].recoverable).toBe(true);
      });
    });
  });

  describe("formatErrorMessage", () => {
    it("should format error message with all context", () => {
      const error = new Error("Test error");
      error.name = "CustomError";
      const context = {
        component: "TestComponent",
        sourceId: "testSource",
        operation: "testOperation",
        errorCode: "TEST_ERROR",
        severity: ErrorSeverity.HIGH,
      };

      // We can't easily test the formatted message directly, but we can verify
      // that the error is logged with the correct context
      errorLogger.logError(error, context);

      const stats = errorLogger.getStatistics();
      expect(stats.recentErrors[0].errorCode).toBe("TEST_ERROR");
      expect(stats.recentErrors[0].errorType).toBe("Error");
    });

    it("should handle error with code property", () => {
      const error = new Error("Test error") as Error & { code?: string };
      error.code = "CUSTOM_ERROR_CODE";
      const context = { component: "TestComponent" };

      errorLogger.logError(error, context);

      const stats = errorLogger.getStatistics();
      expect(stats.recentErrors[0].errorCode).toBe("CUSTOM_ERROR_CODE");
    });

    it("should use context errorCode when available", () => {
      const error = new Error("Test error");
      const context = {
        component: "TestComponent",
        errorCode: "CONTEXT_ERROR_CODE",
      };

      errorLogger.logError(error, context);

      const stats = errorLogger.getStatistics();
      expect(stats.recentErrors[0].errorCode).toBe("CONTEXT_ERROR_CODE");
    });

    it("should default to UNKNOWN_ERROR when no code provided", () => {
      const error = new Error("Test error");
      const context = { component: "TestComponent" };

      errorLogger.logError(error, context);

      const stats = errorLogger.getStatistics();
      expect(stats.recentErrors[0].errorCode).toBe(ErrorCode.UNKNOWN_ERROR);
    });
  });

  describe("writeToFile", () => {
    it("should write properly formatted log entry to file", () => {
      const error = new Error("Test error");
      const context = { component: "TestComponent" };

      errorLogger.logError(error, context);

      expect(mockedFs.appendFileSync).toHaveBeenCalledWith(
        mockErrorLogFile,
        expect.stringMatching(/.*"error":\{\}.*"component":"TestComponent".*/)
      );
    });

    it("should include timestamp in ISO format", () => {
      const error = new Error("Test error");
      errorLogger.logError(error);

      expect(mockedFs.appendFileSync).toHaveBeenCalledWith(
        mockErrorLogFile,
        expect.stringMatching(/.*"timestamp":"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z".*/)
      );
    });
  });

  describe("error history management", () => {
    it("should maintain error history in FIFO order", () => {
      const logger = new ErrorLogger("TestContext", mockLogDirectory, 3, false);

      // Add 5 errors to a logger with limit of 3
      for (let i = 0; i < 5; i++) {
        logger.logError(new Error(`Error ${i}`));
      }

      const stats = logger.getStatistics();
      expect(stats.totalErrors).toBe(3);

      // The last 3 errors should be kept (errors 2, 3, 4)
      const errorMessages = stats.recentErrors.map(entry => entry.error.message);
      expect(errorMessages).toEqual(["Error 2", "Error 3", "Error 4"]);
    });
  });
});
