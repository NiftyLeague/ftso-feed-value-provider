// Test for error.utils.ts
import { asError, errorString, throwError, RetryError, isRetryableError } from "../error.utils";

describe("Error Utils", () => {
  describe("asError", () => {
    it("should convert Error to Error", () => {
      const error = new Error("test error");
      const result = asError(error);

      expect(result).toBe(error);
      expect(result.message).toBe("test error");
    });

    it("should throw error for non-Error objects", () => {
      const errorString = "test error string";

      expect(() => asError(errorString)).toThrow("Unknown object thrown as error");
    });

    it("should throw error for unknown objects", () => {
      const unknownError = { some: "object" };

      expect(() => asError(unknownError)).toThrow("Unknown object thrown as error");
    });

    it("should throw error for null", () => {
      expect(() => asError(null)).toThrow("Unknown object thrown as error");
    });

    it("should throw error for undefined", () => {
      expect(() => asError(undefined)).toThrow("Unknown object thrown as error");
    });
  });

  describe("errorString", () => {
    it("should convert Error to string", () => {
      const error = new Error("test error");
      const result = errorString(error);

      expect(result).toContain("test error");
      expect(result).toContain("Error:");
    });

    it("should convert string to string", () => {
      const errorStr = "test error string";
      const result = errorString(errorStr);

      expect(result).toBe('Caught a non-error object: "test error string"');
    });

    it("should convert unknown to string", () => {
      const unknownError = { some: "object" };
      const result = errorString(unknownError);

      expect(result).toBe('Caught a non-error object: {"some":"object"}');
    });

    it("should handle null", () => {
      const result = errorString(null);

      expect(result).toBe("Caught a non-error object: null");
    });

    it("should handle undefined", () => {
      const result = errorString(undefined);

      expect(result).toBe("Caught a non-error object: undefined");
    });
  });

  describe("throwError", () => {
    it("should throw Error with message", () => {
      const errorMessage = "test error";

      expect(() => throwError(errorMessage)).toThrow("test error");
    });

    it("should throw Error with custom message", () => {
      const errorMessage = "custom error message";

      expect(() => throwError(errorMessage)).toThrow("custom error message");
    });
  });

  describe("RetryError", () => {
    it("should create RetryError with message", () => {
      const error = new RetryError("retry failed");

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(RetryError);
      expect(error.message).toBe("retry failed");
      expect(error.name).toBe("Error");
    });

    it("should create RetryError with cause", () => {
      const cause = new Error("original error");
      const error = new RetryError("retry failed", cause);

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(RetryError);
      expect(error.message).toBe("retry failed");
      expect(error.cause).toBe(cause);
    });
  });

  describe("isRetryableError", () => {
    it("should return true for timeout error", () => {
      const error = new Error("Request timeout");

      expect(isRetryableError(error)).toBe(true);
    });

    it("should return true for connection error", () => {
      const error = new Error("Connection failed");

      expect(isRetryableError(error)).toBe(true);
    });

    it("should return true for network error", () => {
      const error = new Error("Network error occurred");

      expect(isRetryableError(error)).toBe(true);
    });

    it("should return true for rate limit error", () => {
      const error = new Error("Rate limit exceeded");

      expect(isRetryableError(error)).toBe(true);
    });

    it("should return true for service unavailable error", () => {
      const error = new Error("Service unavailable");

      expect(isRetryableError(error)).toBe(true);
    });

    it("should return true for ECONNRESET error", () => {
      const error = new Error("ECONNRESET");

      expect(isRetryableError(error)).toBe(true);
    });

    it("should return false for regular Error", () => {
      const error = new Error("regular error");

      expect(isRetryableError(error)).toBe(false);
    });

    it("should return false for validation error", () => {
      const error = new Error("Invalid input data");

      expect(isRetryableError(error)).toBe(false);
    });
  });
});
