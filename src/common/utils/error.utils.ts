/**
 * Error and Retry Utilities
 */

import type { ILogger } from "../types/logging";
import { sleepFor } from "./common.utils";

// Error handling utilities
export function asError(e: unknown): Error {
  if (e instanceof Error) {
    return e;
  } else {
    throw new Error(`Unknown object thrown as error: ${JSON.stringify(e)}`);
  }
}

/** Returns error message including stack trace and the `cause` error, if defined. */
export function errorString(error: unknown) {
  if (error instanceof Error) {
    const errorDetails = (e: Error) => (e.stack ? `\n${e.stack}` : e.message);
    const cause = error.cause instanceof Error ? `\n[Caused by]: ${errorDetails(error.cause)}` : "";
    return errorDetails(error) + cause;
  } else {
    return `Caught a non-error object: ${JSON.stringify(error)}`;
  }
}

export function throwError(msg: string): never {
  throw new Error(msg);
}

// Retry utilities
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_BACKOFF_MS = 1_000;
const DEFAULT_BACKOFF_MULTIPLIER = 2;

export class RetryError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, { cause: cause });
  }
}

/** Retries the {@link action} {@link maxRetries} times until it completes without an error. */
export async function retry<T>(
  action: () => T,
  maxRetries: number = DEFAULT_MAX_RETRIES,
  initialBackOffMs: number = DEFAULT_INITIAL_BACKOFF_MS,
  logger?: ILogger
): Promise<T> {
  let attempt = 1;
  let backoffMs = initialBackOffMs;
  while (attempt <= maxRetries) {
    try {
      return await action();
    } catch (e) {
      const error = asError(e);
      logger?.warn(`Error in retry attempt ${attempt}/${maxRetries}: ${errorString(error)}`);
      attempt++;
      if (attempt > maxRetries) {
        throw new RetryError(`Failed to execute action after ${maxRetries} attempts`, error);
      }
      const randomisedBackOffMs = backoffMs / 2 + Math.floor(backoffMs * Math.random());
      await sleepFor(randomisedBackOffMs);
      backoffMs *= DEFAULT_BACKOFF_MULTIPLIER;
    }
  }

  throw new Error("Unreachable");
}

/** Retry with exponential backoff and jitter */
export async function retryWithBackoff<T>(
  action: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    backoffMultiplier?: number;
    jitter?: boolean;
    logger?: ILogger;
  } = {}
): Promise<T> {
  const {
    maxRetries = DEFAULT_MAX_RETRIES,
    initialDelayMs = DEFAULT_INITIAL_BACKOFF_MS,
    maxDelayMs = 30000,
    backoffMultiplier = DEFAULT_BACKOFF_MULTIPLIER,
    jitter = true,
    logger,
  } = options;

  let attempt = 1;
  let delayMs = initialDelayMs;

  while (attempt <= maxRetries) {
    try {
      return await action();
    } catch (e) {
      const error = asError(e);

      if (attempt === maxRetries) {
        throw new RetryError(`Failed after ${maxRetries} attempts: ${error.message}`, error);
      }

      logger?.warn(`Attempt ${attempt}/${maxRetries} failed: ${error.message}. Retrying in ${delayMs}ms...`);

      // Apply jitter if enabled
      const actualDelay = jitter ? delayMs * (0.5 + Math.random() * 0.5) : delayMs;

      await sleepFor(actualDelay);

      // Calculate next delay with backoff
      delayMs = Math.min(delayMs * backoffMultiplier, maxDelayMs);
      attempt++;
    }
  }

  throw new Error("Unreachable");
}

/** Check if error is retryable based on common patterns */
export function isRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase();
  const retryablePatterns = [
    "timeout",
    "connection",
    "network",
    "temporary",
    "rate limit",
    "service unavailable",
    "too many requests",
    "econnreset",
    "enotfound",
    "etimedout",
  ];

  return retryablePatterns.some(pattern => message.includes(pattern));
}

/** Retry only if error is retryable */
export async function retryIfRetryable<T>(
  action: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelayMs?: number;
    logger?: ILogger;
  } = {}
): Promise<T> {
  const { maxRetries = DEFAULT_MAX_RETRIES, initialDelayMs = DEFAULT_INITIAL_BACKOFF_MS, logger } = options;

  let attempt = 1;
  let delayMs = initialDelayMs;

  while (attempt <= maxRetries) {
    try {
      return await action();
    } catch (e) {
      const error = asError(e);

      if (!isRetryableError(error) || attempt === maxRetries) {
        throw error;
      }

      logger?.warn(
        `Retryable error on attempt ${attempt}/${maxRetries}: ${error.message}. Retrying in ${delayMs}ms...`
      );

      await sleepFor(delayMs);
      delayMs *= DEFAULT_BACKOFF_MULTIPLIER;
      attempt++;
    }
  }

  throw new Error("Unreachable");
}
