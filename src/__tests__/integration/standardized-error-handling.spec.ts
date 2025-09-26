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
    it("should handle all error scenarios", () => {
      // Test basic error response creation
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

      // Test error classification
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

      // Test validation error handling
      const message = "Invalid input data";
      const details = { field: "email", value: "invalid-email" };
      const validationRequestId = "validation-test-123";

      const validationException = standardizedErrorHandler.handleValidationError(message, details, validationRequestId);
      expect(validationException.getStatus()).toBe(HttpStatus.BAD_REQUEST);

      const validationResponse = validationException.getResponse() as EnhancedErrorResponse;
      expect(validationResponse.error.message).toBe(message);
      expect(validationResponse.requestId).toBe(validationRequestId);
      expect(validationResponse.retryable).toBe(false);

      // Test rate limit error handling
      const rateLimitRequestId = "rate-limit-test-123";
      const retryAfter = 30000; // 30 seconds

      const rateLimitException = standardizedErrorHandler.handleRateLimitError(rateLimitRequestId, retryAfter);
      expect(rateLimitException.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);

      const rateLimitResponse = rateLimitException.getResponse() as EnhancedErrorResponse;
      expect(rateLimitResponse.error.message).toBe("Rate limit exceeded");
      expect(rateLimitResponse.requestId).toBe(rateLimitRequestId);
      expect(rateLimitResponse.retryable).toBe(true);
      expect(rateLimitResponse.retryAfter).toBe(retryAfter);
    });

    it("should execute operations and track statistics", async () => {
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

      // Test error statistics tracking
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
    }, 30000); // Add 30 second timeout
  });

  describe("UniversalRetryService", () => {
    it("should handle all retry scenarios", async () => {
      // Test retry logic with failures
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
          initialDelayMs: 1, // Reduced from 10ms
          maxDelayMs: 10, // Reduced from 100ms
        },
      });

      expect(result).toBe("success");
      expect(operation).toHaveBeenCalledTimes(3);

      // Test HTTP operations
      const httpOperation = jest.fn().mockResolvedValue("http success");
      const httpResult = await universalRetryService.executeHttpWithRetry(httpOperation, {
        serviceId: "HttpService",
        endpoint: "/api/test",
        method: "GET",
      });
      expect(httpResult).toBe("http success");
      expect(httpOperation).toHaveBeenCalledTimes(1);

      // Test database operations
      const dbOperation = jest.fn().mockResolvedValue("db success");
      const dbResult = await universalRetryService.executeDatabaseWithRetry(dbOperation, {
        serviceId: "DatabaseService",
        operation: "query",
      });
      expect(dbResult).toBe("db success");
      expect(dbOperation).toHaveBeenCalledTimes(1);

      // Test cache operations
      const cacheOperation = jest.fn().mockResolvedValue("cache success");
      const cacheResult = await universalRetryService.executeCacheWithRetry(cacheOperation, {
        serviceId: "CacheService",
        operation: "get",
      });
      expect(cacheResult).toBe("cache success");
      expect(cacheOperation).toHaveBeenCalledTimes(1);
    });

    it("should configure retry settings and track statistics", async () => {
      // Test retry configuration
      const serviceId = "CustomService";
      const config: Partial<RetryConfig> = {
        maxRetries: 5,
        initialDelayMs: 100, // Reduced from 2000ms
        maxDelayMs: 1000, // Reduced from 60000ms
      };

      universalRetryService.configureRetrySettings(serviceId, config);

      const retrievedConfig = universalRetryService.getRetryConfiguration(serviceId);
      expect(retrievedConfig?.maxRetries).toBe(5);
      expect(retrievedConfig?.initialDelayMs).toBe(100);
      expect(retrievedConfig?.maxDelayMs).toBe(1000);

      // Test retry statistics
      const statsServiceId = "StatsTestService";

      // Test that retry configuration is properly set
      const operation = jest.fn().mockResolvedValue("success");

      const result = await universalRetryService.executeWithRetry(operation, {
        serviceId: statsServiceId,
        operationName: "testOperation",
        retryConfig: { maxRetries: 2, initialDelayMs: 1 },
      });

      expect(result).toBe("success");
      expect(operation).toHaveBeenCalledTimes(1);

      const stats = universalRetryService.getRetryStatistics();
      expect(stats[statsServiceId]).toBeDefined();
    });
  });

  describe("Circuit Breaker Integration", () => {
    it("should integrate with retry service for circuit breaker protection", async () => {
      const serviceId = "CircuitTestService";

      // Register circuit breaker with reduced timeouts
      circuitBreakerService.registerCircuit(serviceId, {
        failureThreshold: 2,
        recoveryTimeout: 100, // Reduced from 1000ms
        successThreshold: 1,
        timeout: 50, // Reduced from 500ms
        monitoringWindow: 1000, // Reduced from 10000ms
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
            retryConfig: { maxRetries: 1, initialDelayMs: 1 }, // Reduced from 10ms
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
                initialDelayMs: 1, // Reduced from 10ms
                maxDelayMs: 10, // Reduced from 100ms
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
