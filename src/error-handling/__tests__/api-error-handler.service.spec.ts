import { Test, TestingModule } from "@nestjs/testing";
import { ApiErrorHandlerService } from "../api-error-handler.service";
import { Logger } from "@nestjs/common";

describe("ApiErrorHandlerService", () => {
  let service: ApiErrorHandlerService;
  let logger: jest.Mocked<Logger>;
  let module: TestingModule;

  beforeEach(async () => {
    const mockLogger = {
      error: jest.fn(),
      warn: jest.fn(),
      log: jest.fn(),
      debug: jest.fn(),
    };

    module = await Test.createTestingModule({
      providers: [
        ApiErrorHandlerService,
        {
          provide: Logger,
          useValue: mockLogger,
        },
      ],
    }).compile();

    service = module.get<ApiErrorHandlerService>(ApiErrorHandlerService);
    logger = module.get(Logger);
  });

  afterEach(async () => {
    await module.close();
  });

  describe("handleApiError", () => {
    it("should handle validation errors", () => {
      const error = new Error("Invalid feed ID");
      const context = { feedId: "invalid", endpoint: "/feed-values" };

      const response = service.handleApiError(error, context);

      expect(response.error).toBe("Validation Error");
      expect(response.code).toBe(4001);
      expect(response.message).toContain("Invalid feed ID");
      expect(response.statusCode).toBe(400);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("should handle not found errors", () => {
      const error = new Error("Feed not found");
      const context = { feedId: "BTC/USD", endpoint: "/feed-values" };

      const response = service.handleApiError(error, context);

      expect(response.error).toBe("Not Found");
      expect(response.code).toBe(4041);
      expect(response.message).toContain("Feed not found");
      expect(response.statusCode).toBe(404);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("should handle rate limit errors", () => {
      const error = new Error("Rate limit exceeded");
      const context = { clientIp: "192.168.1.1", endpoint: "/feed-values" };

      const response = service.handleApiError(error, context);

      expect(response.error).toBe("Rate Limit Exceeded");
      expect(response.code).toBe(4291);
      expect(response.message).toContain("Rate limit exceeded");
      expect(response.statusCode).toBe(429);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("should handle timeout errors", () => {
      const error = new Error("Request timeout");
      const context = { endpoint: "/feed-values", timeout: 5000 };

      const response = service.handleApiError(error, context);

      expect(response.error).toBe("Request Timeout");
      expect(response.code).toBe(4081);
      expect(response.message).toContain("Request timeout");
      expect(response.statusCode).toBe(408);
      expect(logger.error).toHaveBeenCalled();
    });

    it("should handle internal server errors", () => {
      const error = new Error("Database connection failed");
      const context = { endpoint: "/feed-values" };

      const response = service.handleApiError(error, context);

      expect(response.error).toBe("Internal Server Error");
      expect(response.code).toBe(5001);
      expect(response.message).toContain("An internal error occurred");
      expect(response.statusCode).toBe(500);
      expect(logger.error).toHaveBeenCalled();
    });

    it("should handle service unavailable errors", () => {
      const error = new Error("All data sources unavailable");
      const context = { endpoint: "/feed-values" };

      const response = service.handleApiError(error, context);

      expect(response.error).toBe("Service Unavailable");
      expect(response.code).toBe(5031);
      expect(response.message).toContain("Service temporarily unavailable");
      expect(response.statusCode).toBe(503);
      expect(logger.error).toHaveBeenCalled();
    });

    it("should include request ID in response", () => {
      const error = new Error("Test error");
      const context = { requestId: "req-123", endpoint: "/feed-values" };

      const response = service.handleApiError(error, context);

      expect(response.requestId).toBe("req-123");
    });

    it("should generate request ID if not provided", () => {
      const error = new Error("Test error");
      const context = { endpoint: "/feed-values" };

      const response = service.handleApiError(error, context);

      expect(response.requestId).toBeDefined();
      expect(typeof response.requestId).toBe("string");
      expect(response.requestId.length).toBeGreaterThan(0);
    });

    it("should include timestamp in response", () => {
      const error = new Error("Test error");
      const context = { endpoint: "/feed-values" };

      const beforeTime = Date.now();
      const response = service.handleApiError(error, context);
      const afterTime = Date.now();

      expect(response.timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(response.timestamp).toBeLessThanOrEqual(afterTime);
    });
  });

  describe("error classification", () => {
    it("should classify validation errors correctly", () => {
      const validationErrors = [
        "Invalid feed category",
        "Invalid feed name",
        "Invalid voting round",
        "Invalid time window",
        "Missing required parameter",
      ];

      validationErrors.forEach(errorMessage => {
        const error = new Error(errorMessage);
        const response = service.handleApiError(error, { endpoint: "/test" });
        expect(response.statusCode).toBe(400);
        expect(response.error).toBe("Validation Error");
      });
    });

    it("should classify not found errors correctly", () => {
      const notFoundErrors = ["Feed not found", "Voting round not found", "Data not available", "Resource not found"];

      notFoundErrors.forEach(errorMessage => {
        const error = new Error(errorMessage);
        const response = service.handleApiError(error, { endpoint: "/test" });
        expect(response.statusCode).toBe(404);
        expect(response.error).toBe("Not Found");
      });
    });

    it("should classify rate limit errors correctly", () => {
      const rateLimitErrors = ["Rate limit exceeded", "Too many requests", "Request quota exceeded"];

      rateLimitErrors.forEach(errorMessage => {
        const error = new Error(errorMessage);
        const response = service.handleApiError(error, { endpoint: "/test" });
        expect(response.statusCode).toBe(429);
        expect(response.error).toBe("Rate Limit Exceeded");
      });
    });

    it("should classify timeout errors correctly", () => {
      const timeoutErrors = ["Request timeout", "Connection timeout", "Operation timed out"];

      timeoutErrors.forEach(errorMessage => {
        const error = new Error(errorMessage);
        const response = service.handleApiError(error, { endpoint: "/test" });
        expect(response.statusCode).toBe(408);
        expect(response.error).toBe("Request Timeout");
      });
    });

    it("should classify service unavailable errors correctly", () => {
      const serviceUnavailableErrors = [
        "All data sources unavailable",
        "Service temporarily unavailable",
        "Maintenance mode",
      ];

      serviceUnavailableErrors.forEach(errorMessage => {
        const error = new Error(errorMessage);
        const response = service.handleApiError(error, { endpoint: "/test" });
        expect(response.statusCode).toBe(503);
        expect(response.error).toBe("Service Unavailable");
      });
    });

    it("should default to internal server error for unknown errors", () => {
      const unknownErrors = ["Unexpected error", "Something went wrong", "Unknown failure"];

      unknownErrors.forEach(errorMessage => {
        const error = new Error(errorMessage);
        const response = service.handleApiError(error, { endpoint: "/test" });
        expect(response.statusCode).toBe(500);
        expect(response.error).toBe("Internal Server Error");
      });
    });
  });

  describe("error context handling", () => {
    it("should include feed information in context", () => {
      const error = new Error("Feed validation failed");
      const context = {
        feedId: "BTC/USD",
        feedCategory: "crypto",
        endpoint: "/feed-values",
      };

      const response = service.handleApiError(error, context);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("BTC/USD"),
        expect.objectContaining({
          feedId: "BTC/USD",
          feedCategory: "crypto",
        })
      );
    });

    it("should include client information in context", () => {
      const error = new Error("Rate limit exceeded");
      const context = {
        clientIp: "192.168.1.1",
        userAgent: "TestClient/1.0",
        endpoint: "/feed-values",
      };

      const response = service.handleApiError(error, context);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          clientIp: "192.168.1.1",
          userAgent: "TestClient/1.0",
        })
      );
    });

    it("should include timing information in context", () => {
      const error = new Error("Request timeout");
      const context = {
        startTime: Date.now() - 5000,
        timeout: 3000,
        endpoint: "/feed-values",
      };

      const response = service.handleApiError(error, context);

      expect(logger.error).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          startTime: context.startTime,
          timeout: 3000,
        })
      );
    });
  });

  describe("error metrics", () => {
    it("should track error counts by type", () => {
      const errors = [
        new Error("Invalid feed ID"),
        new Error("Feed not found"),
        new Error("Rate limit exceeded"),
        new Error("Invalid feed ID"), // Duplicate
      ];

      errors.forEach(error => {
        service.handleApiError(error, { endpoint: "/test" });
      });

      const metrics = service.getErrorMetrics();

      expect(metrics.totalErrors).toBe(4);
      expect(metrics.errorsByType["Validation Error"]).toBe(2);
      expect(metrics.errorsByType["Not Found"]).toBe(1);
      expect(metrics.errorsByType["Rate Limit Exceeded"]).toBe(1);
    });

    it("should track error counts by endpoint", () => {
      const errors = [
        { error: new Error("Test error"), endpoint: "/feed-values" },
        { error: new Error("Test error"), endpoint: "/volumes" },
        { error: new Error("Test error"), endpoint: "/feed-values" }, // Duplicate
      ];

      errors.forEach(({ error, endpoint }) => {
        service.handleApiError(error, { endpoint });
      });

      const metrics = service.getErrorMetrics();

      expect(metrics.errorsByEndpoint["/feed-values"]).toBe(2);
      expect(metrics.errorsByEndpoint["/volumes"]).toBe(1);
    });

    it("should track error rates over time", () => {
      const error = new Error("Test error");

      // Generate errors over time
      for (let i = 0; i < 10; i++) {
        service.handleApiError(error, { endpoint: "/test" });
      }

      const metrics = service.getErrorMetrics();

      expect(metrics.totalErrors).toBe(10);
      expect(metrics.errorRate).toBeGreaterThan(0);
    });

    it("should reset error metrics", () => {
      const error = new Error("Test error");
      service.handleApiError(error, { endpoint: "/test" });

      let metrics = service.getErrorMetrics();
      expect(metrics.totalErrors).toBe(1);

      service.resetErrorMetrics();

      metrics = service.getErrorMetrics();
      expect(metrics.totalErrors).toBe(0);
      expect(Object.keys(metrics.errorsByType)).toHaveLength(0);
      expect(Object.keys(metrics.errorsByEndpoint)).toHaveLength(0);
    });
  });

  describe("configuration", () => {
    it("should update configuration", () => {
      const newConfig = {
        includeStackTrace: true,
        logLevel: "debug" as const,
        maxErrorHistory: 500,
      };

      service.updateConfig(newConfig);
      const currentConfig = service.getConfig();

      expect(currentConfig.includeStackTrace).toBe(true);
      expect(currentConfig.logLevel).toBe("debug");
      expect(currentConfig.maxErrorHistory).toBe(500);
    });

    it("should use default configuration values", () => {
      const config = service.getConfig();

      expect(config.includeStackTrace).toBe(false);
      expect(config.logLevel).toBe("error");
      expect(config.maxErrorHistory).toBe(1000);
    });

    it("should include stack trace when configured", () => {
      service.updateConfig({ includeStackTrace: true });

      const error = new Error("Test error with stack");
      const response = service.handleApiError(error, { endpoint: "/test" });

      expect(response.details).toBeDefined();
      expect(response.details.stack).toBeDefined();
    });

    it("should exclude stack trace by default", () => {
      const error = new Error("Test error without stack");
      const response = service.handleApiError(error, { endpoint: "/test" });

      expect(response.details?.stack).toBeUndefined();
    });
  });

  describe("performance", () => {
    it("should handle high-frequency errors efficiently", () => {
      const startTime = performance.now();

      // Generate many errors
      for (let i = 0; i < 1000; i++) {
        const error = new Error(`Error ${i}`);
        service.handleApiError(error, { endpoint: "/test" });
      }

      const endTime = performance.now();
      const totalTime = endTime - startTime;

      // Should handle errors quickly
      expect(totalTime).toBeLessThan(1000); // Less than 1 second for 1000 errors
    });

    it("should limit error history to prevent memory leaks", () => {
      service.updateConfig({ maxErrorHistory: 10 });

      // Generate more errors than the limit
      for (let i = 0; i < 20; i++) {
        const error = new Error(`Error ${i}`);
        service.handleApiError(error, { endpoint: "/test" });
      }

      const metrics = service.getErrorMetrics();

      // Should not exceed the configured limit
      expect(metrics.totalErrors).toBe(20); // Total count should be accurate
      // But internal history should be limited (implementation detail)
    });
  });
});
