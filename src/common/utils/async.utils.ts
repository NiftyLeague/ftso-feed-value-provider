/**
 * Async Utilities
 * Consolidates common async patterns and error handling
 */

import { isRetryableError } from "./error.utils";
import type { ILogger } from "../types/logging";

/**
 * Execute multiple async operations with controlled concurrency
 */
export async function executeWithConcurrency<T, R>(
  items: T[],
  operation: (item: T, index: number) => Promise<R>,
  options: {
    concurrency?: number;
    onError?: "throw" | "continue" | "collect";
    logger?: ILogger;
  } = {}
): Promise<{
  results: (R | null)[];
  errors: (Error | null)[];
  successful: number;
  failed: number;
}> {
  const { concurrency = 5, onError = "continue", logger } = options;
  const results: (R | null)[] = new Array(items.length).fill(null);
  const errors: (Error | null)[] = new Array(items.length).fill(null);
  let successful = 0;
  let failed = 0;

  // Process items in batches with controlled concurrency
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchPromises = batch.map(async (item, batchIndex) => {
      const itemIndex = i + batchIndex;
      try {
        const result = await operation(item, itemIndex);
        results[itemIndex] = result;
        successful++;
        return result;
      } catch (error) {
        const err = error as Error;
        errors[itemIndex] = err;
        failed++;

        logger?.warn(`Operation failed for item ${itemIndex}: ${err.message}`);

        if (onError === "throw") {
          throw err;
        }
        return null;
      }
    });

    if (onError === "throw") {
      await Promise.all(batchPromises);
    } else {
      await Promise.allSettled(batchPromises);
    }
  }

  return { results, errors, successful, failed };
}

/**
 * Execute operations in parallel with timeout
 */
export async function executeWithTimeout<T>(
  operations: (() => Promise<T>)[],
  timeout: number,
  options: {
    onTimeout?: "throw" | "partial";
    logger?: ILogger;
  } = {}
): Promise<{
  results: (T | null)[];
  timedOut: boolean[];
  completed: number;
  timedOutCount: number;
}> {
  const { onTimeout = "partial", logger } = options;
  const results: (T | null)[] = new Array(operations.length).fill(null);
  const timedOut: boolean[] = new Array(operations.length).fill(false);
  let completed = 0;
  let timedOutCount = 0;

  const promises = operations.map(async (operation, index) => {
    try {
      const result = await Promise.race([
        operation(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Operation ${index} timed out after ${timeout}ms`)), timeout)
        ),
      ]);
      results[index] = result;
      completed++;
      return result;
    } catch (error) {
      const err = error as Error;
      if (err.message.includes("timed out")) {
        timedOut[index] = true;
        timedOutCount++;
        logger?.warn(`Operation ${index} timed out after ${timeout}ms`);
      } else {
        logger?.error(`Operation ${index} failed: ${err.message}`);
      }

      if (onTimeout === "throw") {
        throw err;
      }
      return null;
    }
  });

  if (onTimeout === "throw") {
    await Promise.all(promises);
  } else {
    await Promise.allSettled(promises);
  }

  return { results, timedOut, completed, timedOutCount };
}

/**
 * Batch process items with retry logic
 */
export async function batchProcessWithRetry<T, R>(
  items: T[],
  processor: (batch: T[]) => Promise<R[]>,
  options: {
    batchSize?: number;
    maxRetries?: number;
    retryDelay?: number;
    onBatchError?: "retry" | "skip" | "throw";
    logger?: ILogger;
  } = {}
): Promise<{
  results: R[];
  processedBatches: number;
  failedBatches: number;
  totalItems: number;
  processedItems: number;
}> {
  const { batchSize = 10, maxRetries = 3, retryDelay = 1000, onBatchError = "retry", logger } = options;

  const results: R[] = [];
  let processedBatches = 0;
  let failedBatches = 0;
  let processedItems = 0;

  // Split items into batches
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }

  for (const [batchIndex, batch] of batches.entries()) {
    try {
      // Simple retry implementation
      let batchResults: R[] | undefined;
      let lastError: Error | undefined;

      for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
        try {
          batchResults = await processor(batch);
          break;
        } catch (error) {
          lastError = error as Error;

          if (attempt === maxRetries + 1) {
            throw lastError;
          }

          logger?.warn(`Batch ${batchIndex + 1} attempt ${attempt} failed: ${lastError.message}. Retrying...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
        }
      }

      if (!batchResults) {
        throw new Error("Failed to process batch after all retry attempts");
      }

      results.push(...batchResults);
      processedBatches++;
      processedItems += batch.length;

      logger?.debug(`Processed batch ${batchIndex + 1}/${batches.length} (${batch.length} items)`);
    } catch (error) {
      const err = error as Error;
      failedBatches++;

      logger?.error(`Batch ${batchIndex + 1} failed after ${maxRetries} retries: ${err.message}`);

      if (onBatchError === "throw") {
        throw err;
      }
      // For "skip" and "retry", we continue to the next batch
    }
  }

  return {
    results,
    processedBatches,
    failedBatches,
    totalItems: items.length,
    processedItems,
  };
}

/**
 * Debounce async function calls
 */
export function debounceAsync<T extends unknown[], R>(
  fn: (...args: T) => Promise<R>,
  delay: number
): (...args: T) => Promise<R> {
  let timeoutId: NodeJS.Timeout | null = null;
  let resolvePromise: ((value: R) => void) | null = null;
  let rejectPromise: ((reason: unknown) => void) | null = null;

  return (...args: T): Promise<R> => {
    return new Promise<R>((resolve, reject) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      resolvePromise = resolve;
      rejectPromise = reject;

      timeoutId = setTimeout(async () => {
        try {
          const result = await fn(...args);
          resolvePromise?.(result);
        } catch (error) {
          rejectPromise?.(error);
        }
      }, delay);
    });
  };
}

/**
 * Throttle async function calls
 */
export function throttleAsync<T extends unknown[], R>(
  fn: (...args: T) => Promise<R>,
  interval: number
): (...args: T) => Promise<R | null> {
  let lastExecution = 0;
  let pendingPromise: Promise<R> | null = null;

  return async (...args: T): Promise<R | null> => {
    const now = Date.now();

    if (now - lastExecution >= interval) {
      lastExecution = now;
      pendingPromise = fn(...args);
      return pendingPromise;
    }

    // Return the pending promise if one exists, otherwise null
    return pendingPromise;
  };
}

/**
 * Execute with exponential backoff
 */
export async function executeWithExponentialBackoff<T>(
  operation: () => Promise<T>,
  options: {
    maxAttempts?: number;
    initialDelay?: number;
    maxDelay?: number;
    backoffFactor?: number;
    jitter?: boolean;
    shouldRetry?: (error: Error) => boolean;
    logger?: ILogger;
  } = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelay = 1000,
    maxDelay = 30000,
    backoffFactor = 2,
    jitter = true,
    shouldRetry = isRetryableError,
    logger,
  } = options;

  let attempt = 1;
  let delay = initialDelay;

  while (attempt <= maxAttempts) {
    try {
      return await operation();
    } catch (error) {
      const err = error as Error;

      if (attempt === maxAttempts || !shouldRetry(err)) {
        throw err;
      }

      const actualDelay = jitter ? delay * (0.5 + Math.random() * 0.5) : delay;

      logger?.warn(
        `Attempt ${attempt}/${maxAttempts} failed: ${err.message}. Retrying in ${actualDelay.toFixed(0)}ms...`
      );

      await new Promise(resolve => setTimeout(resolve, actualDelay));

      delay = Math.min(delay * backoffFactor, maxDelay);
      attempt++;
    }
  }

  throw new Error("Unreachable");
}
