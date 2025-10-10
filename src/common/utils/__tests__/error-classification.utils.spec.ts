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
