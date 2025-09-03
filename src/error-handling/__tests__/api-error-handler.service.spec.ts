import { Test, TestingModule } from "@nestjs/testing";
import { HttpException, HttpStatus } from "@nestjs/common";
import { ApiErrorCodes } from "@/common/types/error-handling";
import { ApiErrorHandlerService } from "../api-error-handler.service";

describe("ApiErrorHandlerService", () => {
  let service: ApiErrorHandlerService;

  beforeEach(async () => {
    // Mock console methods to suppress expected error logs during tests
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});

    const module: TestingModule = await Test.createTestingModule({
      providers: [ApiErrorHandlerService],
    }).compile();

    service = module.get<ApiErrorHandlerService>(ApiErrorHandlerService);
  });

  afterEach(() => {
    // Restore console methods after each test
    jest.restoreAllMocks();
  });

  describe("Error Response Creation", () => {
    it("should create error response with correct structure", () => {
      const requestId = "test-request-id";
      const message = "Test error message";
      const details = { field: "value" };

      const response = service.createErrorResponse(ApiErrorCodes.INVALID_FEED_REQUEST, message, requestId, details);

      expect(response).toEqual({
        error: "INVALID_FEED_REQUEST",
        code: ApiErrorCodes.INVALID_FEED_REQUEST,
        message,
        timestamp: expect.any(Number),
        requestId,
        details,
      });
    });

    it("should create error response without details", () => {
      const requestId = "test-request-id";
      const message = "Test error message";

      const response = service.createErrorResponse(ApiErrorCodes.INTERNAL_ERROR, message, requestId);

      expect(response.details).toBeUndefined();
    });
  });

  describe("Validation Error Handling", () => {
    it("should handle validation errors correctly", () => {
      const message = "Invalid feed request";
      const requestId = "test-request-id";
      const details = { field: "feedId" };

      const exception = service.handleValidationError(message, requestId, details);

      expect(exception).toBeInstanceOf(HttpException);
      expect(exception.getStatus()).toBe(HttpStatus.BAD_REQUEST);

      const response = exception.getResponse() as any;
      expect(response.error).toBe("INVALID_FEED_REQUEST");
      expect(response.code).toBe(ApiErrorCodes.INVALID_FEED_REQUEST);
      expect(response.message).toBe(message);
      expect(response.requestId).toBe(requestId);
      expect(response.details).toEqual(details);
    });
  });

  describe("Feed Not Found Error Handling", () => {
    it("should handle feed not found errors correctly", () => {
      const feedId = { category: "crypto", name: "BTC/USD" };
      const requestId = "test-request-id";

      const exception = service.handleFeedNotFoundError(feedId, requestId);

      expect(exception).toBeInstanceOf(HttpException);
      expect(exception.getStatus()).toBe(HttpStatus.NOT_FOUND);

      const response = exception.getResponse() as any;
      expect(response.error).toBe("FEED_NOT_FOUND");
      expect(response.code).toBe(ApiErrorCodes.FEED_NOT_FOUND);
      expect(response.details.feedId).toEqual(feedId);
    });
  });

  describe("Data Source Error Handling", () => {
    it("should handle data source errors correctly", () => {
      const error = new Error("Connection failed");
      const requestId = "test-request-id";

      const exception = service.handleDataSourceError(error, requestId);

      expect(exception).toBeInstanceOf(HttpException);
      expect(exception.getStatus()).toBe(HttpStatus.BAD_GATEWAY);

      const response = exception.getResponse() as any;
      expect(response.error).toBe("DATA_SOURCE_UNAVAILABLE");
      expect(response.code).toBe(ApiErrorCodes.DATA_SOURCE_UNAVAILABLE);
      expect(response.details.originalError).toBe(error.message);
    });
  });

  describe("Aggregation Error Handling", () => {
    it("should handle aggregation errors correctly", () => {
      const error = new Error("Aggregation failed");
      const requestId = "test-request-id";

      const exception = service.handleAggregationError(error, requestId);

      expect(exception).toBeInstanceOf(HttpException);
      expect(exception.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);

      const response = exception.getResponse() as any;
      expect(response.error).toBe("AGGREGATION_FAILED");
      expect(response.code).toBe(ApiErrorCodes.AGGREGATION_FAILED);
      expect(response.details.originalError).toBe(error.message);
    });
  });

  describe("Cache Error Handling", () => {
    it("should handle cache errors correctly", () => {
      const error = new Error("Cache operation failed");
      const requestId = "test-request-id";

      const exception = service.handleCacheError(error, requestId);

      expect(exception).toBeInstanceOf(HttpException);
      expect(exception.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);

      const response = exception.getResponse() as any;
      expect(response.error).toBe("CACHE_ERROR");
      expect(response.code).toBe(ApiErrorCodes.CACHE_ERROR);
      expect(response.details.originalError).toBe(error.message);
    });
  });

  describe("Internal Error Handling", () => {
    it("should handle internal errors correctly", () => {
      const error = new Error("Internal server error");
      const requestId = "test-request-id";

      const exception = service.handleInternalError(error, requestId);

      expect(exception).toBeInstanceOf(HttpException);
      expect(exception.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);

      const response = exception.getResponse() as any;
      expect(response.error).toBe("INTERNAL_ERROR");
      expect(response.code).toBe(ApiErrorCodes.INTERNAL_ERROR);
      expect(response.details.originalError).toBe(error.message);
    });
  });

  describe("Rate Limit Error Handling", () => {
    it("should handle rate limit errors correctly", () => {
      const requestId = "test-request-id";

      const exception = service.handleRateLimitError(requestId);

      expect(exception).toBeInstanceOf(HttpException);
      expect(exception.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);

      const response = exception.getResponse() as any;
      expect(response.error).toBe("RATE_LIMIT_EXCEEDED");
      expect(response.code).toBe(ApiErrorCodes.RATE_LIMIT_EXCEEDED);
    });
  });

  describe("Request ID Generation", () => {
    it("should generate unique request IDs", () => {
      const id1 = service.generateRequestId();
      const id2 = service.generateRequestId();

      expect(id1).toMatch(/^req_\d+_[a-z0-9]+$/);
      expect(id2).toMatch(/^req_\d+_[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });
  });

  describe("Performance Logging", () => {
    it("should log performance warnings when response time exceeds target", () => {
      const loggerSpy = jest.spyOn(service["logger"], "warn").mockImplementation();

      service.logPerformanceWarning("test-operation", 150, 100, "test-request-id");

      expect(loggerSpy).toHaveBeenCalledWith("Performance warning: test-operation took 150.00ms (target: 100ms)", {
        requestId: "test-request-id",
        responseTime: 150,
        target: 100,
      });

      loggerSpy.mockRestore();
    });

    it("should not log performance warnings when response time is within target", () => {
      const loggerSpy = jest.spyOn(service["logger"], "warn").mockImplementation();

      service.logPerformanceWarning("test-operation", 50, 100, "test-request-id");

      expect(loggerSpy).not.toHaveBeenCalled();

      loggerSpy.mockRestore();
    });
  });

  describe("API Call Logging", () => {
    it("should log API calls correctly", () => {
      const loggerSpy = jest.spyOn(service["logger"], "log").mockImplementation();

      service.logApiCall("GET", "/api/feeds", 45.5, 200, "test-request-id");

      expect(loggerSpy).toHaveBeenCalledWith("GET /api/feeds - 200 - 45.50ms", {
        requestId: "test-request-id",
        method: "GET",
        url: "/api/feeds",
        responseTime: 45.5,
        statusCode: 200,
      });

      loggerSpy.mockRestore();
    });
  });

  describe("Error Code Enum", () => {
    it("should have correct error code values", () => {
      expect(ApiErrorCodes.INVALID_FEED_REQUEST).toBe(4000);
      expect(ApiErrorCodes.INVALID_FEED_CATEGORY).toBe(4001);
      expect(ApiErrorCodes.INVALID_FEED_NAME).toBe(4002);
      expect(ApiErrorCodes.INVALID_VOTING_ROUND).toBe(4003);
      expect(ApiErrorCodes.INVALID_TIME_WINDOW).toBe(4004);
      expect(ApiErrorCodes.FEED_NOT_FOUND).toBe(4041);
      expect(ApiErrorCodes.RATE_LIMIT_EXCEEDED).toBe(4291);
      expect(ApiErrorCodes.INTERNAL_ERROR).toBe(5001);
      expect(ApiErrorCodes.DATA_SOURCE_UNAVAILABLE).toBe(5021);
      expect(ApiErrorCodes.SERVICE_UNAVAILABLE).toBe(5031);
      expect(ApiErrorCodes.AGGREGATION_FAILED).toBe(5041);
      expect(ApiErrorCodes.CACHE_ERROR).toBe(5051);
    });
  });
});
