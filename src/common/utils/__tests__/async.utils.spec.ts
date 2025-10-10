import {
  executeWithConcurrency,
  executeWithTimeout,
  batchProcessWithRetry,
  debounceAsync,
  throttleAsync,
  executeWithExponentialBackoff,
} from "../async.utils";
import { isRetryableError } from "../error.utils";

// Mock the error utils
jest.mock("../error.utils", () => ({
  isRetryableError: jest.fn(),
}));

const mockedIsRetryableError = isRetryableError as jest.MockedFunction<typeof isRetryableError>;

describe("Async Utils", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedIsRetryableError.mockReturnValue(true);
  });

  describe("executeWithConcurrency", () => {
    it("should execute operations with controlled concurrency", async () => {
      const items = [1, 2, 3, 4, 5];
      const operation = jest.fn().mockImplementation((item: number) => Promise.resolve(item * 2));

      const result = await executeWithConcurrency(items, operation, { concurrency: 2 });

      expect(result.results).toEqual([2, 4, 6, 8, 10]);
      expect(result.errors).toEqual([null, null, null, null, null]);
      expect(result.successful).toBe(5);
      expect(result.failed).toBe(0);
      expect(operation).toHaveBeenCalledTimes(5);
    });

    it("should handle errors with continue strategy", async () => {
      const items = [1, 2, 3, 4, 5];
      const operation = jest.fn().mockImplementation((item: number) => {
        if (item === 3) {
          throw new Error("Test error");
        }
        return Promise.resolve(item * 2);
      });

      const result = await executeWithConcurrency(items, operation, {
        concurrency: 2,
        onError: "continue",
      });

      expect(result.results).toEqual([2, 4, null, 8, 10]);
      expect(result.errors[2]).toBeInstanceOf(Error);
      expect(result.successful).toBe(4);
      expect(result.failed).toBe(1);
    });

    it("should handle errors with throw strategy", async () => {
      const items = [1, 2, 3, 4, 5];
      const operation = jest.fn().mockImplementation((item: number) => {
        if (item === 3) {
          throw new Error("Test error");
        }
        return Promise.resolve(item * 2);
      });

      await expect(
        executeWithConcurrency(items, operation, {
          concurrency: 2,
          onError: "throw",
        })
      ).rejects.toThrow("Test error");
    });

    it("should handle errors with collect strategy", async () => {
      const items = [1, 2, 3, 4, 5];
      const operation = jest.fn().mockImplementation((item: number) => {
        if (item % 2 === 0) {
          throw new Error(`Error for ${item}`);
        }
        return Promise.resolve(item * 2);
      });

      const result = await executeWithConcurrency(items, operation, {
        concurrency: 2,
        onError: "collect",
      });

      expect(result.results).toEqual([2, null, 6, null, 10]);
      expect(result.errors.filter(e => e !== null)).toHaveLength(2);
      expect(result.successful).toBe(3);
      expect(result.failed).toBe(2);
    });

    it("should use default concurrency when not specified", async () => {
      const items = [1, 2, 3];
      const operation = jest.fn().mockImplementation((item: number) => Promise.resolve(item * 2));

      const result = await executeWithConcurrency(items, operation);

      expect(result.results).toEqual([2, 4, 6]);
      expect(result.successful).toBe(3);
      expect(result.failed).toBe(0);
    });

    it("should log errors when logger is provided", async () => {
      const items = [1, 2, 3];
      const operation = jest.fn().mockImplementation((item: number) => {
        if (item === 2) {
          throw new Error("Test error");
        }
        return Promise.resolve(item * 2);
      });

      const mockLogger = {
        warn: jest.fn(),
        log: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        verbose: jest.fn(),
      };

      await executeWithConcurrency(items, operation, {
        concurrency: 2,
        onError: "continue",
        logger: mockLogger,
      });

      expect(mockLogger.warn).toHaveBeenCalledWith("Operation failed for item 1: Test error");
    });
  });

  describe("executeWithTimeout", () => {
    it("should resolve when operation completes within timeout", async () => {
      const operation = jest.fn().mockResolvedValue("success");

      const result = await executeWithTimeout([operation], 1000);

      expect(result.results[0]).toBe("success");
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it("should reject when operation exceeds timeout", async () => {
      const operation = jest
        .fn()
        .mockImplementation(() => new Promise(resolve => setTimeout(() => resolve("success"), 200)));

      const result = await executeWithTimeout([operation], 100);

      expect(result.timedOut[0]).toBe(true);
      expect(result.results[0]).toBe(null);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it("should handle operation rejection", async () => {
      const operation = jest.fn().mockRejectedValue(new Error("Operation failed"));

      const result = await executeWithTimeout([operation], 1000);

      expect(result.results[0]).toBe(null);
      expect(operation).toHaveBeenCalledTimes(1);
    });
  });

  describe("batchProcessWithRetry", () => {
    it("should process items in batches with retry", async () => {
      const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const processor = jest.fn().mockImplementation((batch: number[]) => Promise.resolve(batch.map(item => item * 2)));

      const result = await batchProcessWithRetry(items, processor, { batchSize: 3 });

      expect(result.results).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
      expect(processor).toHaveBeenCalledTimes(4); // 10 items / 3 batch size = 4 batches
    });

    it("should handle empty items array", async () => {
      const processor = jest.fn();
      const result = await batchProcessWithRetry([], processor, { batchSize: 3 });

      expect(result.results).toEqual([]);
      expect(processor).not.toHaveBeenCalled();
    });

    it("should retry on failure", async () => {
      const items = [1, 2, 3];
      let attemptCount = 0;
      const processor = jest.fn().mockImplementation(() => {
        attemptCount++;
        if (attemptCount < 2) {
          throw new Error("Processor error");
        }
        return Promise.resolve([1, 2, 3]);
      });

      const result = await batchProcessWithRetry(items, processor, {
        batchSize: 2,
        maxRetries: 2,
      });

      expect(result.results).toEqual([1, 2, 3, 1, 2, 3]); // Results are duplicated due to retry
      expect(processor).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it("should handle processor errors after max retries", async () => {
      const items = [1, 2, 3];
      const processor = jest.fn().mockRejectedValue(new Error("Processor error"));

      const result = await batchProcessWithRetry(items, processor, { batchSize: 2, maxRetries: 1 });

      expect(result.failedBatches).toBeGreaterThan(0);
      expect(result.results).toEqual([]);
    });
  });

  describe("debounceAsync", () => {
    it("should create debounced function", () => {
      const fn = jest.fn().mockResolvedValue("result");
      const debouncedFn = debounceAsync(fn, 100);

      expect(typeof debouncedFn).toBe("function");
    });

    it("should handle single call", async () => {
      const fn = jest.fn().mockResolvedValue("result");
      const debouncedFn = debounceAsync(fn, 100);

      const result = await debouncedFn("arg1");

      expect(fn).toHaveBeenCalledWith("arg1");
      expect(result).toBe("result");
    });
  });

  describe("throttleAsync", () => {
    it("should create throttled function", () => {
      const fn = jest.fn().mockResolvedValue("result");
      const throttledFn = throttleAsync(fn, 100);

      expect(typeof throttledFn).toBe("function");
    });

    it("should handle single call", async () => {
      const fn = jest.fn().mockResolvedValue("result");
      const throttledFn = throttleAsync(fn, 100);

      const result = await throttledFn("arg1");

      expect(fn).toHaveBeenCalledWith("arg1");
      expect(result).toBe("result");
    });
  });

  describe("executeWithExponentialBackoff", () => {
    it("should retry operation on failure", async () => {
      let attemptCount = 0;
      const operation = jest.fn().mockImplementation(() => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error("Temporary error");
        }
        return Promise.resolve("success");
      });

      const result = await executeWithExponentialBackoff(operation, {
        maxAttempts: 3,
        initialDelay: 10,
        maxDelay: 100,
      });

      expect(result).toBe("success");
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it("should not retry non-retryable errors", async () => {
      mockedIsRetryableError.mockReturnValue(false);

      const operation = jest.fn().mockImplementation(() => {
        throw new Error("Non-retryable error");
      });

      await expect(
        executeWithExponentialBackoff(operation, {
          maxAttempts: 3,
          initialDelay: 10,
        })
      ).rejects.toThrow("Non-retryable error");

      expect(operation).toHaveBeenCalledTimes(1);
    });

    it("should respect max retries", async () => {
      const operation = jest.fn().mockImplementation(() => {
        throw new Error("Always fails");
      });

      await expect(
        executeWithExponentialBackoff(operation, {
          maxAttempts: 3,
          initialDelay: 10,
        })
      ).rejects.toThrow("Always fails");

      expect(operation).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it("should use exponential backoff", async () => {
      const operation = jest.fn().mockImplementation(() => {
        throw new Error("Always fails");
      });

      const startTime = Date.now();

      await expect(
        executeWithExponentialBackoff(operation, {
          maxAttempts: 2,
          initialDelay: 10,
          maxDelay: 100,
        })
      ).rejects.toThrow("Always fails");

      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Should have waited at least 5ms (exponential backoff)
      expect(totalTime).toBeGreaterThanOrEqual(5);
    });

    it("should handle successful operation on first try", async () => {
      const operation = jest.fn().mockResolvedValue("success");

      const result = await executeWithExponentialBackoff(operation, {
        maxAttempts: 3,
        initialDelay: 10,
      });

      expect(result).toBe("success");
      expect(operation).toHaveBeenCalledTimes(1);
    });
  });
});
