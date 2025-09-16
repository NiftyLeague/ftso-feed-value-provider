import { Logger } from "@nestjs/common";
import { TestHelpers } from "@/__tests__/utils/test.helpers";
import { EnhancedLoggerService } from "../../logging/enhanced-logger.service";
import { BaseService } from "../base.service";

// Test implementation of BaseService
class TestService extends BaseService {
  constructor() {
    super();
  }

  public testLogInitialization() {
    this.logInitialization();
  }

  public testLogShutdown() {
    this.logShutdown();
  }

  public testLogPerformance(operation: string, duration: number) {
    this.logPerformance(operation, duration);
  }

  public testLogError(error: Error, context?: string) {
    this.logError(error, context);
  }

  public testLogWarning(message: string, context?: string) {
    this.logWarning(message, context);
  }

  public testLogDebug(message: string, context?: string) {
    this.logDebug(message, context);
  }

  // Method to enable enhanced logging for testing
  public enableEnhancedLogging() {
    this.updateConfig({ useEnhancedLogging: true });
  }
}

// Test implementation for enhanced logging
class EnhancedTestService extends BaseService {
  constructor() {
    super();
    // Enable enhanced logging via config
    this.updateConfig({ useEnhancedLogging: true });
  }
}

describe("BaseService", () => {
  let service: TestService;
  let loggerSpy: jest.SpyInstance;

  beforeEach(() => {
    service = new TestService();
    loggerSpy = TestHelpers.spyOn(Logger.prototype, "log").mockImplementation();
    TestHelpers.spyOn(Logger.prototype, "warn").mockImplementation();
    TestHelpers.spyOn(Logger.prototype, "error").mockImplementation();
    TestHelpers.spyOn(Logger.prototype, "debug").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should create logger with service name", () => {
      expect(service["logger"]).toBeInstanceOf(Logger);
    });

    it("should create enhanced logger when enabled via config", () => {
      const serviceWithEnhanced = new TestService();
      serviceWithEnhanced.enableEnhancedLogging();
      expect(serviceWithEnhanced["enhancedLogger"]).toBeDefined();
      expect(serviceWithEnhanced["enhancedLogger"]).toBeInstanceOf(EnhancedLoggerService);
    });

    it("should not create enhanced logger by default", () => {
      expect(service["enhancedLogger"]).toBeUndefined();
    });

    it("should auto-detect service name from constructor", () => {
      const loggerContext = (service["logger"] as any).context;
      expect(loggerContext).toBe("TestService");
    });

    it("should auto-detect service name for enhanced service", () => {
      const enhancedService = new EnhancedTestService();
      const loggerContext = (enhancedService["logger"] as any).context;
      expect(loggerContext).toBe("EnhancedTestService");
    });
  });

  describe("logInitialization", () => {
    it("should log default initialization message", () => {
      service.testLogInitialization();
      expect(loggerSpy).toHaveBeenCalledWith("TestService initialized");
    });

    it("should log custom initialization message", () => {
      service.testLogInitialization();
      expect(loggerSpy).toHaveBeenCalled();
    });
  });

  describe("logShutdown", () => {
    it("should log default shutdown message", () => {
      service.testLogShutdown();
      expect(loggerSpy).toHaveBeenCalledWith("TestService shutting down");
    });
  });

  describe("logPerformance", () => {
    it("should log warning for slow operations", () => {
      const warnSpy = jest.spyOn(Logger.prototype, "warn");
      service.testLogPerformance("test-operation", 2000);
      expect(warnSpy).toHaveBeenCalledWith("Performance warning: test-operation took 2000ms (threshold: 1000ms)");
    });

    it("should log debug for fast operations", () => {
      const debugSpy = jest.spyOn(Logger.prototype, "debug");
      service.testLogPerformance("test-operation", 500);
      expect(debugSpy).toHaveBeenCalledWith("test-operation completed in 500ms");
    });
  });

  describe("logError", () => {
    it("should log error with context", () => {
      const errorSpy = jest.spyOn(Logger.prototype, "error");
      const testError = new Error("Test error");

      service.testLogError(testError, "test-context");

      expect(errorSpy).toHaveBeenCalledWith("[test-context] Test error", testError.stack, undefined);
    });

    it("should log error without context", () => {
      const errorSpy = jest.spyOn(Logger.prototype, "error");
      const testError = new Error("Test error");

      service.testLogError(testError);

      expect(errorSpy).toHaveBeenCalledWith("Test error", testError.stack, undefined);
    });
  });

  describe("logWarning", () => {
    it("should log warning with context", () => {
      const warnSpy = jest.spyOn(Logger.prototype, "warn");

      service.testLogWarning("Test warning", "test-context");

      expect(warnSpy).toHaveBeenCalledWith("[test-context] Test warning", undefined);
    });
  });

  describe("logDebug", () => {
    it("should log debug with context", () => {
      const debugSpy = jest.spyOn(Logger.prototype, "debug");

      service.testLogDebug("Test debug", "test-context");

      expect(debugSpy).toHaveBeenCalledWith("[test-context] Test debug", undefined);
    });
  });
});
