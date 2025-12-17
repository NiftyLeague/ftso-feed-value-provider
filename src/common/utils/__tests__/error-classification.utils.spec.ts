import {
  extractStatusCode,
  categorizeConnectionError,
  classifyError,
  getErrorCategoryString,
  isErrorRetryable,
  getBackoffParameters,
} from "../error-classification.utils";
import { StandardErrorClassification as ErrorClass } from "@/common/types/error-handling";

describe("Error Classification Utils", () => {
  describe("extractStatusCode", () => {
    it("should extract status code from various error message formats", () => {
      expect(extractStatusCode("Unexpected server response: 503")).toBe(503);
      expect(extractStatusCode("HTTP 404 Not Found")).toBe(404);
      expect(extractStatusCode("Status code: 500")).toBe(500);
      expect(extractStatusCode("Server response: 502")).toBe(502);
      expect(extractStatusCode("503 Service Unavailable")).toBe(503);
      expect(extractStatusCode("No status code here")).toBeNull();
    });
  });

  describe("categorizeConnectionError", () => {
    it("should categorize 503 errors correctly", () => {
      const error = new Error("Unexpected server response: 503");
      const category = categorizeConnectionError(error);

      expect(category.type).toBe("service_unavailable");
      expect(category.severity).toBe("high");
      expect(category.retryable).toBe(true);
      expect(category.minDelay).toBe(30000);
      expect(category.backoffMultiplier).toBe(2.5);
    });

    it("should categorize rate limit errors correctly", () => {
      const error = new Error("Rate limit exceeded");
      const category = categorizeConnectionError(error);

      expect(category.type).toBe("rate_limit");
      expect(category.severity).toBe("medium");
      expect(category.retryable).toBe(true);
      expect(category.minDelay).toBe(60000);
      expect(category.backoffMultiplier).toBe(3.0);
    });

    it("should categorize authentication errors correctly", () => {
      const error = new Error("Authentication failed");
      const category = categorizeConnectionError(error);

      expect(category.type).toBe("authentication");
      expect(category.severity).toBe("critical");
      expect(category.retryable).toBe(false);
    });

    it("should categorize common HTTP status codes", () => {
      expect(categorizeConnectionError(new Error("HTTP 502 Bad Gateway")).type).toBe("bad_gateway");
      expect(categorizeConnectionError(new Error("Status code: 500")).type).toBe("server_error");
      expect(categorizeConnectionError(new Error("Server response: 429"))).toMatchObject({ type: "rate_limit" });
      expect(categorizeConnectionError(new Error("404 Not Found"))).toMatchObject({
        type: "not_found",
        retryable: false,
      });
      expect(categorizeConnectionError(new Error("401 Unauthorized"))).toMatchObject({
        type: "authentication",
        retryable: false,
      });
      expect(categorizeConnectionError(new Error("403 Forbidden"))).toMatchObject({
        type: "authorization",
        retryable: false,
      });
      expect(categorizeConnectionError(new Error("418 I'm a teapot"))).toMatchObject({ type: "client_error" });
    });

    it("should categorize common text patterns", () => {
      expect(categorizeConnectionError(new Error("Service temporarily unavailable"))).toMatchObject({
        type: "service_unavailable",
        retryable: true,
      });
      expect(categorizeConnectionError(new Error("Bad Gateway from upstream"))).toMatchObject({ type: "bad_gateway" });
      expect(categorizeConnectionError(new Error("Too many requests"))).toMatchObject({ type: "rate_limit" });
      expect(categorizeConnectionError(new Error("Request timed out"))).toMatchObject({ type: "timeout" });
      expect(categorizeConnectionError(new Error("ECONNREFUSED"))).toMatchObject({ type: "network" });
      expect(categorizeConnectionError(new Error("Unauthorized"))).toMatchObject({ type: "authentication" });
      expect(categorizeConnectionError(new Error("Access denied"))).toMatchObject({ type: "authorization" });
      expect(categorizeConnectionError(new Error("Resource not found"))).toMatchObject({ type: "not_found" });
      expect(categorizeConnectionError(new Error("Unexpected server response"))).toMatchObject({
        type: "unexpected_response",
        retryable: true,
      });
      expect(categorizeConnectionError(new Error("some weird error"))).toMatchObject({
        type: "unknown",
        retryable: true,
      });
    });
  });

  describe("classifyError", () => {
    it("should classify WebSocket 503 errors correctly", () => {
      const error = new Error("Unexpected server response: 503");
      expect(classifyError(error)).toBe(ErrorClass.SERVICE_UNAVAILABLE_ERROR);
    });

    it("should classify rate limit errors correctly", () => {
      const error = new Error("Rate limit exceeded");
      expect(classifyError(error)).toBe(ErrorClass.RATE_LIMIT_ERROR);
    });

    it("should classify timeout errors correctly", () => {
      const error = new Error("Connection timeout");
      expect(classifyError(error)).toBe(ErrorClass.TIMEOUT_ERROR);
    });

    it("should classify common HTTP status codes", () => {
      expect(classifyError(new Error("HTTP 400 Bad Request"))).toBe(ErrorClass.VALIDATION_ERROR);
      expect(classifyError(new Error("HTTP 401 Unauthorized"))).toBe(ErrorClass.AUTHENTICATION_ERROR);
      expect(classifyError(new Error("HTTP 403 Forbidden"))).toBe(ErrorClass.AUTHORIZATION_ERROR);
      expect(classifyError(new Error("HTTP 404 Not Found"))).toBe(ErrorClass.NOT_FOUND_ERROR);
      expect(classifyError(new Error("HTTP 429 Too Many Requests"))).toBe(ErrorClass.RATE_LIMIT_ERROR);
      expect(classifyError(new Error("HTTP 500 Internal Server Error"))).toBe(ErrorClass.EXTERNAL_SERVICE_ERROR);
      expect(classifyError(new Error("HTTP 502 Bad Gateway"))).toBe(ErrorClass.EXTERNAL_SERVICE_ERROR);
      expect(classifyError(new Error("Unexpected server response: 503"))).toBe(ErrorClass.SERVICE_UNAVAILABLE_ERROR);
    });

    it("should classify unexpected server response using categorization", () => {
      expect(classifyError(new Error("Unexpected server response"))).toBe(ErrorClass.EXTERNAL_SERVICE_ERROR);
      expect(classifyError(new Error("Unexpected server response: 429"))).toBe(ErrorClass.RATE_LIMIT_ERROR);
      expect(classifyError(new Error("Unexpected server response: 401"))).toBe(ErrorClass.AUTHENTICATION_ERROR);
      expect(classifyError(new Error("Unexpected server response: 403"))).toBe(ErrorClass.AUTHORIZATION_ERROR);
    });

    it("should classify other text patterns and name-based hints", () => {
      expect(classifyError(new Error("Data corrupt"))).toBe(ErrorClass.DATA_ERROR);
      expect(classifyError(new Error("Configuration missing"))).toBe(ErrorClass.CONFIGURATION_ERROR);
      expect(classifyError(new Error("Circuit is open"))).toBe(ErrorClass.CIRCUIT_BREAKER_ERROR);
      expect(classifyError(new Error("Aggregation calculation failed"))).toBe(ErrorClass.PROCESSING_ERROR);
      expect(classifyError(new Error("Upstream adapter error"))).toBe(ErrorClass.EXTERNAL_SERVICE_ERROR);

      const authByName = new Error("nope");
      authByName.name = "AuthError";
      expect(classifyError(authByName)).toBe(ErrorClass.AUTHENTICATION_ERROR);

      const timeoutByName = new Error("nope");
      timeoutByName.name = "TimeoutError";
      expect(classifyError(timeoutByName)).toBe(ErrorClass.TIMEOUT_ERROR);

      const notFoundByName = new Error("nope");
      notFoundByName.name = "NotFoundError";
      expect(classifyError(notFoundByName)).toBe(ErrorClass.NOT_FOUND_ERROR);
    });
  });

  describe("getErrorCategoryString", () => {
    it("should return correct category strings", () => {
      expect(getErrorCategoryString(new Error("Unexpected server response: 503"))).toBe("service_unavailable");
      expect(getErrorCategoryString(new Error("Rate limit exceeded"))).toBe("rate_limit");
      expect(getErrorCategoryString(new Error("Connection timeout"))).toBe("timeout");
    });
  });

  describe("isErrorRetryable", () => {
    it("should correctly identify retryable errors", () => {
      expect(isErrorRetryable(new Error("Unexpected server response: 503"))).toBe(true);
      expect(isErrorRetryable(new Error("Rate limit exceeded"))).toBe(true);
      expect(isErrorRetryable(new Error("Authentication failed"))).toBe(false);
      expect(isErrorRetryable(new Error("Not found"))).toBe(false);
    });
  });

  describe("getBackoffParameters", () => {
    it("should return correct backoff parameters for different error types", () => {
      const serviceUnavailable = getBackoffParameters(new Error("Unexpected server response: 503"));
      expect(serviceUnavailable.minDelay).toBe(30000);
      expect(serviceUnavailable.multiplier).toBe(2.5);

      const rateLimit = getBackoffParameters(new Error("Rate limit exceeded"));
      expect(rateLimit.minDelay).toBe(60000);
      expect(rateLimit.multiplier).toBe(3.0);

      const timeout = getBackoffParameters(new Error("Connection timeout"));
      expect(timeout.minDelay).toBe(5000);
      expect(timeout.multiplier).toBe(2.0);
    });
  });
});
