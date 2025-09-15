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
