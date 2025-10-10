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
  const errorName = error.name.toLowerCase();

  // Non-retryable error patterns (take precedence)
  const nonRetryablePatterns = [
    "authentication",
    "authorization",
    "forbidden",
    "invalid api key",
    "invalid signature",
    "permission denied",
    "bad request",
    "malformed",
    "invalid json",
    "syntax error",
    "validation error",
    "not found", // 404 errors are usually not retryable
    "method not allowed",
    "unsupported",
  ];

  // Check for non-retryable patterns first
  if (nonRetryablePatterns.some(pattern => message.includes(pattern) || errorName.includes(pattern))) {
    return false;
  }

  // Retryable error patterns
  const retryablePatterns = [
    "timeout",
    "connection",
    "network",
    "temporary",
    "rate limit",
    "service unavailable",
    "too many requests",
    "server error", // 5xx errors
    "internal server error",
    "bad gateway",
    "service temporarily unavailable",
    "gateway timeout",
    "econnreset",
    "enotfound",
    "etimedout",
    "econnrefused",
    "socket hang up",
    "fetch failed",
    "request timeout",
    "connect econnrefused",
    "getaddrinfo enotfound",
    "websocket",
    "connection lost",
    "disconnected",
    "reconnect",
    "circuit breaker",
    "quota exceeded",
    "api unavailable",
    "maintenance mode",
    "overloaded",
    "throttled",
  ];

  return retryablePatterns.some(pattern => message.includes(pattern) || errorName.includes(pattern));
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
