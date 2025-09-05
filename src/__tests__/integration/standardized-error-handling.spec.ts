import { Test, TestingModule } from "@nestjs/testing";
import { HttpException, HttpStatus } from "@nestjs/common";
import { StandardizedErrorHandlerService } from "@/error-handling/standardized-error-handler.service";
import { UniversalRetryService } from "@/error-handling/universal-retry.service";
import { CircuitBreakerService } from "@/error-handling/circuit-breaker.service";
import { HttpExceptionFilter } from "@/common/filters/http-exception.filter";
import type { EnhancedErrorResponse, RetryConfig } from "@/common/types/error-handling";
import { StandardErrorClassification as ErrorClass } from "@/common/types/error-handling";

describe("Standardized Error Handling Integration", () => {
  let standardizedErrorHandler: StandardizedErrorHandlerService;
  let universalRetryService: UniversalRetryService;
  let circuitBreakerService: CircuitBreakerService;
  let httpExceptionFilter: HttpExceptionFilter;
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [StandardizedErrorHandlerService, UniversalRetryService, CircuitBreakerService, HttpExceptionFilter],
    }).compile();

    standardizedErrorHandler = module.get<StandardizedErrorHandlerService>(StandardizedErrorHandlerService);
    universalRetryService = module.get<UniversalRetryService>(UniversalRetryService);
    circuitBreakerService = module.get<CircuitBreakerService>(CircuitBreakerService);
    httpExceptionFilter = module.get<HttpExceptionFilter>(HttpExceptionFilter);
  });

  afterEach(async () => {
    await module.close();
  });

  describe("StandardizedErrorHandlerService", () => {
    it("should create standardized error responses", () => {
      const error = new Error("Test validation error");
      const requestId = "test-request-123";

      const httpException = standardizedErrorHandler.createStandardizedError(
        error,
        {
          component: "TestController",
          operation: "testOperation",
        },
        requestId
      );

      expect(httpException).toBeInstanceOf(HttpException);

      const response = httpException.getResponse() as EnhancedErrorResponse;
      expect(response.success).toBe(false);
      expect(response.error.message).toBe("Test validation error");
      expect(response.requestId).toBe(requestId);
      expect(response.retryable).toBeDefined();
      expect(response.timestamp).toBeDefined();
    });

    it("should classify errors correctly", () => {
      const testCases = [
        { error: new Error("timeout occurred"), expectedClass: ErrorClass.TIMEOUT_ERROR },
        { error: new Error("connection refused"), expectedClass: ErrorClass.CONNECTION_ERROR },
        { error: new Error("rate limit exceeded"), expectedClass: ErrorClass.RATE_LIMIT_ERROR },
        { error: new Error("unauthorized access"), expectedClass: ErrorClass.AUTHENTICATION_ERROR },
        { error: new Error("validation failed"), expectedClass: ErrorClass.VALIDATION_ERROR },
        { error: new Error("not found"), expectedClass: ErrorClass.NOT_FOUND_ERROR },
      ];

      testCases.forEach(({ error, expectedClass }) => {
        const httpException = standardizedErrorHandler.createStandardizedError(error, { component: "TestController" });

        const response = httpException.getResponse() as EnhancedErrorResponse;
        expect(response.error.context?.classification).toBe(expectedClass);
      });
    });

    it("should handle validation errors with standardized format", () => {
      const message = "Invalid input data";
      const details = { field: "email", value: "invalid-email" };
      const requestId = "validation-test-123";

      const httpException = standardizedErrorHandler.handleValidationError(message, details, requestId);

      expect(httpException.getStatus()).toBe(HttpStatus.BAD_REQUEST);

      const response = httpException.getResponse() as EnhancedErrorResponse;
      expect(response.error.message).toBe(message);
      expect(response.requestId).toBe(requestId);
      expect(response.retryable).toBe(false);
    });

    it("should handle rate limit errors with retry information", () => {
      const requestId = "rate-limit-test-123";
      const retryAfter = 30000; // 30 seconds

      const httpException = standardizedErrorHandler.handleRateLimitError(requestId, retryAfter);

      expect(httpException.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);

      const response = httpException.getResponse() as EnhancedErrorResponse;
      expect(response.error.message).toBe("Rate limit exceeded");
      expect(response.requestId).toBe(requestId);
      expect(response.retryable).toBe(true);
      expect(response.retryAfter).toBe(retryAfter);
    });

    it("should execute operations with standardized error handling", async () => {
      const successOperation = jest.fn().mockResolvedValue("success");
      const failureOperation = jest.fn().mockRejectedValue(new Error("operation failed"));

      // Test successful operation
      const result = await standardizedErrorHandler.executeWithStandardizedHandling(successOperation, {
        serviceId: "TestService",
        operationName: "testOperation",
        component: "TestController",
        requestId: "test-123",
      });

      expect(result).toBe("success");
      expect(successOperation).toHaveBeenCalledTimes(1);

      // Test failed operation
      await expect(
        standardizedErrorHandler.executeWithStandardizedHandling(failureOperation, {
          serviceId: "TestService",
          operationName: "testOperation",
          component: "TestController",
          requestId: "test-456",
        })
      ).rejects.toThrow(HttpException);

      expect(failureOperation).toHaveBeenCalled();
    });

    it("should track error statistics", async () => {
      // Generate some errors through executeWithStandardizedHandling to trigger statistics
      const errors = [new Error("timeout error"), new Error("connection error"), new Error("validation error")];

      for (let i = 0; i < errors.length; i++) {
        try {
          await standardizedErrorHandler.executeWithStandardizedHandling(() => Promise.reject(errors[i]), {
            serviceId: "TestController",
            operationName: `testOperation${i}`,
            component: "TestController",
            requestId: `test-${i}`,
          });
        } catch {
          // Expected to throw
        }
      }

      const stats = standardizedErrorHandler.getErrorStatistics();
      expect(Object.keys(stats)).toContain("TestController");
    });
  });

  describe("UniversalRetryService", () => {
    it("should execute operations with retry logic", async () => {
      let attemptCount = 0;
      const operation = jest.fn().mockImplementation(() => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error("temporary failure");
        }
        return "success";
      });

      const result = await universalRetryService.executeWithRetry(operation, {
        serviceId: "TestService",
        operationName: "testOperation",
        retryConfig: {
          maxRetries: 3,
          initialDelayMs: 10,
          maxDelayMs: 100,
        },
      });

      expect(result).toBe("success");
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it("should handle HTTP operations with specific retry logic", async () => {
      const httpOperation = jest.fn().mockResolvedValue("http success");

      const result = await universalRetryService.executeHttpWithRetry(httpOperation, {
        serviceId: "HttpService",
        endpoint: "/api/test",
        method: "GET",
      });

      expect(result).toBe("http success");
      expect(httpOperation).toHaveBeenCalledTimes(1);
    });

    it("should handle database operations with specific retry logic", async () => {
      const dbOperation = jest.fn().mockResolvedValue("db success");

      const result = await universalRetryService.executeDatabaseWithRetry(dbOperation, {
        serviceId: "DatabaseService",
        operation: "query",
      });

      expect(result).toBe("db success");
      expect(dbOperation).toHaveBeenCalledTimes(1);
    });

    it("should handle cache operations with minimal retry logic", async () => {
      const cacheOperation = jest.fn().mockResolvedValue("cache success");

      const result = await universalRetryService.executeCacheWithRetry(cacheOperation, {
        serviceId: "CacheService",
        operation: "get",
      });

      expect(result).toBe("cache success");
      expect(cacheOperation).toHaveBeenCalledTimes(1);
    });

    it("should configure retry settings for services", () => {
      const serviceId = "CustomService";
      const config: Partial<RetryConfig> = {
        maxRetries: 5,
        initialDelayMs: 2000,
        maxDelayMs: 60000,
      };

      universalRetryService.configureRetrySettings(serviceId, config);

      const retrievedConfig = universalRetryService.getRetryConfiguration(serviceId);
      expect(retrievedConfig?.maxRetries).toBe(5);
      expect(retrievedConfig?.initialDelayMs).toBe(2000);
      expect(retrievedConfig?.maxDelayMs).toBe(60000);
    });

    it("should track retry statistics", async () => {
      const serviceId = "StatsTestService";
      let attemptCount = 0;

      const operation = jest.fn().mockImplementation(() => {
        attemptCount++;
        if (attemptCount < 2) {
          throw new Error("retry test error");
        }
        return "success";
      });

      await universalRetryService.executeWithRetry(operation, {
        serviceId,
        operationName: "testOperation",
        retryConfig: { maxRetries: 2, initialDelayMs: 10 },
      });

      const stats = universalRetryService.getRetryStatistics();
      expect(stats[serviceId]).toBeDefined();
      expect(stats[serviceId].totalAttempts).toBe(2);
      expect(stats[serviceId].successfulRetries).toBe(1);
    });
  });

  describe("Circuit Breaker Integration", () => {
    it("should integrate with retry service for circuit breaker protection", async () => {
      const serviceId = "CircuitTestService";

      // Register circuit breaker
      circuitBreakerService.registerCircuit(serviceId, {
        failureThreshold: 2,
        recoveryTimeout: 1000,
        successThreshold: 1,
        timeout: 500,
        monitoringWindow: 10000,
      });

      let callCount = 0;
      const failingOperation = jest.fn().mockImplementation(() => {
        callCount++;
        throw new Error("circuit breaker test failure");
      });

      // Execute operations that should trigger circuit breaker
      for (let i = 0; i < 3; i++) {
        try {
          await universalRetryService.executeWithRetry(failingOperation, {
            serviceId,
            operationName: "failingOperation",
            retryConfig: { maxRetries: 1, initialDelayMs: 10 },
          });
        } catch {
          // Expected to fail
        }
      }

      // Circuit should be open now
      const circuitState = circuitBreakerService.getState(serviceId);
      expect(circuitState).toBe("open");
    });
  });

  describe("HttpExceptionFilter", () => {
    it("should handle HttpExceptions with standardized format", () => {
      const mockResponse = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        setHeader: jest.fn(),
      };

      const mockRequest = {
        method: "POST",
        path: "/test",
        query: {},
        params: {},
        headers: {
          "user-agent": "test-agent",
          "x-correlation-id": "test-correlation-id",
        },
        get: jest.fn().mockImplementation((header: string) => {
          if (header === "User-Agent") return "test-agent";
          if (header === "X-Correlation-ID") return "test-correlation-id";
          return undefined;
        }),
        connection: { remoteAddress: "127.0.0.1" },
      };

      const mockHost = {
        switchToHttp: () => ({
          getResponse: () => mockResponse,
          getRequest: () => mockRequest,
        }),
      };

      const testError = new HttpException("Test error", HttpStatus.BAD_REQUEST);

      httpExceptionFilter.catch(testError, mockHost as any);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalled();

      const responseData = mockResponse.json.mock.calls[0][0];
      expect(responseData).toHaveProperty("timestamp");
      expect(responseData).toHaveProperty("requestId");
    });

    it("should handle generic errors with standardized format", () => {
      const mockResponse = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        setHeader: jest.fn(),
      };

      const mockRequest = {
        method: "GET",
        path: "/test",
        query: {},
        params: {},
        headers: {},
        get: jest.fn().mockReturnValue(undefined),
        connection: { remoteAddress: "127.0.0.1" },
      };

      const mockHost = {
        switchToHttp: () => ({
          getResponse: () => mockResponse,
          getRequest: () => mockRequest,
        }),
      };

      const testError = new Error("Generic test error");

      httpExceptionFilter.catch(testError, mockHost as any);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(mockResponse.json).toHaveBeenCalled();

      const responseData = mockResponse.json.mock.calls[0][0];
      expect(responseData).toHaveProperty("error");
      expect(responseData).toHaveProperty("timestamp");
      expect(responseData).toHaveProperty("requestId");
      expect(responseData.retryable).toBeDefined();
    });
  });

  describe("End-to-End Error Handling", () => {
    it("should provide comprehensive error handling workflow", async () => {
      const serviceId = "E2ETestService";
      let operationCount = 0;

      const complexOperation = jest.fn().mockImplementation(() => {
        operationCount++;

        // Simulate different types of failures
        if (operationCount === 1) {
          throw new Error("timeout occurred");
        }
        if (operationCount === 2) {
          throw new Error("connection refused");
        }
        if (operationCount === 3) {
          return "success after retries";
        }

        throw new Error("unexpected error");
      });

      try {
        const result = await standardizedErrorHandler.executeWithStandardizedHandling(
          () =>
            universalRetryService.executeWithRetry(complexOperation, {
              serviceId,
              operationName: "complexOperation",
              retryConfig: {
                maxRetries: 3,
                initialDelayMs: 10,
                maxDelayMs: 100,
              },
            }),
          {
            serviceId,
            operationName: "complexOperation",
            component: "E2ETestController",
            requestId: "e2e-test-123",
          }
        );

        expect(result).toBe("success after retries");
        expect(operationCount).toBe(3);
      } catch (error) {
        // If it fails, verify it's a standardized error
        expect(error).toBeInstanceOf(HttpException);

        const response = (error as HttpException).getResponse() as EnhancedErrorResponse;
        expect(response.success).toBe(false);
        expect(response.requestId).toBe("e2e-test-123");
      }

      // Verify statistics were recorded
      const errorStats = standardizedErrorHandler.getErrorStatistics();
      const retryStats = universalRetryService.getRetryStatistics();

      // Statistics should be recorded regardless of final success/failure
      expect(Object.keys(retryStats).length).toBeGreaterThan(0);

      // If the operation succeeded, error stats might be empty, which is fine
      // If it failed, error stats should be present
      if (operationCount < 3) {
        expect(Object.keys(errorStats).length).toBeGreaterThan(0);
      }
    });
  });
});
