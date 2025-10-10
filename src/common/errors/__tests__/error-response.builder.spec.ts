import { HttpException, HttpStatus } from "@nestjs/common";
import { ApiErrorCodes } from "@/common/types/error-handling";
import { ErrorResponseBuilder } from "../error-response.builder";

describe("ErrorResponseBuilder", () => {
  describe("generateRequestId", () => {
    it("should generate unique request IDs", () => {
      const id1 = ErrorResponseBuilder.generateRequestId();
      const id2 = ErrorResponseBuilder.generateRequestId();

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^req_\d+_\d+_[a-z0-9]+$/);
    });
  });

  describe("createErrorResponse", () => {
    it("should create standardized error response", () => {
      const response = ErrorResponseBuilder.createErrorResponse(
        ApiErrorCodes.INVALID_FEED_REQUEST,
        "Test error",
        "test-req-id",
        { test: "data" }
      );

      expect(response).toEqual({
        error: "INVALID_FEED_REQUEST",
        code: ApiErrorCodes.INVALID_FEED_REQUEST,
        message: "Test error",
        timestamp: expect.any(Number),
        requestId: "test-req-id",
        details: { test: "data" },
      });
    });

    it("should generate request ID if not provided", () => {
      const response = ErrorResponseBuilder.createErrorResponse(ApiErrorCodes.INTERNAL_ERROR, "Test error");

      expect(response.requestId).toMatch(/^req_\d+_\d+_[a-z0-9]+$/);
    });
  });

  describe("createValidationError", () => {
    it("should create validation error exception", () => {
      const exception = ErrorResponseBuilder.createValidationError("Invalid input");

      expect(exception).toBeInstanceOf(HttpException);
      expect(exception.getStatus()).toBe(HttpStatus.BAD_REQUEST);

      const response = exception.getResponse() as any;
      expect(response.error).toBe("INVALID_FEED_REQUEST");
      expect(response.message).toBe("Invalid input");
    });
  });

  describe("createFeedNotFoundError", () => {
    it("should create feed not found error exception", () => {
      const feedId = { category: 1, name: "BTC/USD" };
      const exception = ErrorResponseBuilder.createFeedNotFoundError(feedId);

      expect(exception).toBeInstanceOf(HttpException);
      expect(exception.getStatus()).toBe(HttpStatus.NOT_FOUND);

      const response = exception.getResponse() as any;
      expect(response.error).toBe("FEED_NOT_FOUND");
      expect(response.details.feedId).toEqual(feedId);
    });
  });

  describe("createDataSourceError", () => {
    it("should create data source error exception", () => {
      const originalError = new Error("Connection failed");
      const exception = ErrorResponseBuilder.createDataSourceError(originalError);

      expect(exception).toBeInstanceOf(HttpException);
      expect(exception.getStatus()).toBe(HttpStatus.BAD_GATEWAY);

      const response = exception.getResponse() as any;
      expect(response.error).toBe("DATA_SOURCE_UNAVAILABLE");
      expect(response.details.originalError).toBe("Connection failed");
    });
  });

  describe("createAggregationError", () => {
    it("should create aggregation error exception", () => {
      const originalError = new Error("Aggregation failed");
      const exception = ErrorResponseBuilder.createAggregationError(originalError);

      expect(exception).toBeInstanceOf(HttpException);
      expect(exception.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);

      const response = exception.getResponse() as any;
      expect(response.error).toBe("AGGREGATION_FAILED");
    });
  });

  describe("createRateLimitError", () => {
    it("should create rate limit error exception", () => {
      const exception = ErrorResponseBuilder.createRateLimitError();

      expect(exception).toBeInstanceOf(HttpException);
      expect(exception.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);

      const response = exception.getResponse() as any;
      expect(response.error).toBe("RATE_LIMIT_EXCEEDED");
    });
  });

  describe("createFromUnknownError", () => {
    it("should create error from Error instance", () => {
      const originalError = new Error("Unknown error");
      const exception = ErrorResponseBuilder.createFromUnknownError(originalError);

      expect(exception).toBeInstanceOf(HttpException);
      expect(exception.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);

      const response = exception.getResponse() as any;
      expect(response.message).toBe("Unknown error");
    });

    it("should create error from string", () => {
      const exception = ErrorResponseBuilder.createFromUnknownError("String error");

      const response = exception.getResponse() as any;
      expect(response.message).toBe("String error");
    });

    it("should create error with context", () => {
      const exception = ErrorResponseBuilder.createFromUnknownError(new Error("Test error"), "req-123", "test-context");

      const response = exception.getResponse() as any;
      expect(response.message).toBe("test-context: Test error");
    });
  });

  describe("createCustomError", () => {
    it("should create custom error with specified status", () => {
      const exception = ErrorResponseBuilder.createCustomError("Custom error", HttpStatus.FORBIDDEN);

      expect(exception.getStatus()).toBe(HttpStatus.FORBIDDEN);

      const response = exception.getResponse() as any;
      expect(response.message).toBe("Custom error");
    });
  });

  describe("isApiError", () => {
    it("should identify standardized API errors", () => {
      const apiError = ErrorResponseBuilder.createValidationError("Test");
      expect(ErrorResponseBuilder.isApiError(apiError)).toBe(true);
    });

    it("should identify non-standardized errors", () => {
      const nonApiError = new HttpException("Simple error", HttpStatus.BAD_REQUEST);
      expect(ErrorResponseBuilder.isApiError(nonApiError)).toBe(false);
    });
  });

  describe("extractRequestId", () => {
    it("should extract request ID from API error", () => {
      const error = ErrorResponseBuilder.createValidationError("Test", "test-req-id");
      const requestId = ErrorResponseBuilder.extractRequestId(error);

      expect(requestId).toBe("test-req-id");
    });

    it("should return undefined for non-API errors", () => {
      const error = new HttpException("Simple error", HttpStatus.BAD_REQUEST);
      const requestId = ErrorResponseBuilder.extractRequestId(error);

      expect(requestId).toBeUndefined();
    });
  });

  describe("standardizeError", () => {
    it("should keep standardized errors unchanged", () => {
      const originalError = ErrorResponseBuilder.createValidationError("Test");
      const standardized = ErrorResponseBuilder.standardizeError(originalError);

      expect(standardized).toBe(originalError);
    });

    it("should standardize non-API HttpException", () => {
      const originalError = new HttpException("Simple error", HttpStatus.BAD_REQUEST);
      const standardized = ErrorResponseBuilder.standardizeError(originalError);

      expect(ErrorResponseBuilder.isApiError(standardized)).toBe(true);
    });

    it("should standardize unknown errors", () => {
      const originalError = new Error("Unknown error");
      const standardized = ErrorResponseBuilder.standardizeError(originalError);

      expect(standardized).toBeInstanceOf(HttpException);
      expect(ErrorResponseBuilder.isApiError(standardized)).toBe(true);
    });
  });
});
