/**
 * HTTP Response Utilities
 * Consolidates duplicate HTTP response and exception handling patterns
 */

import { HttpException, HttpStatus } from "@nestjs/common";
import type { ApiResponse, ErrorResponse } from "../types/http/http.types";

/**
 * Create standardized success response
 */
export function createSuccessResponse<T>(
  data: T,
  options: {
    responseTime?: number;
    requestId?: string;
    message?: string;
  } = {}
): ApiResponse<T> {
  const { requestId } = options;
  return {
    success: true,
    timestamp: Date.now(),
    data,
    ...(requestId ? { requestId } : {}),
  };
}

/**
 * Create standardized error response
 */
export function createErrorResponse(
  error: string,
  message: string,
  options: {
    responseTime?: number;
    requestId?: string;
    details?: Record<string, unknown>;
    path?: string;
    stack?: string;
  } = {}
): ErrorResponse {
  return {
    status: "error",
    timestamp: Date.now(),
    error,
    message,
    ...options,
  };
}

/**
 * Create and throw HTTP exception with standardized response
 */
export function throwHttpException(
  status: HttpStatus,
  error: string,
  message: string,
  options: {
    responseTime?: number;
    requestId?: string;
    details?: Record<string, unknown>;
    path?: string;
  } = {}
): never {
  const response = createErrorResponse(error, message, options);

  throw new HttpException(response, status);
}

/**
 * Common HTTP exception creators
 */
export const HttpExceptions = {
  badRequest: (message: string, options?: { requestId?: string; details?: Record<string, unknown> }) =>
    throwHttpException(HttpStatus.BAD_REQUEST, "Bad Request", message, options),

  notFound: (message: string, options?: { requestId?: string; details?: Record<string, unknown> }) =>
    throwHttpException(HttpStatus.NOT_FOUND, "Not Found", message, options),

  internalServerError: (
    message: string,
    options?: { requestId?: string; details?: Record<string, unknown>; stack?: string }
  ) => throwHttpException(HttpStatus.INTERNAL_SERVER_ERROR, "Internal Server Error", message, options),

  serviceUnavailable: (message: string, options?: { requestId?: string; details?: Record<string, unknown> }) =>
    throwHttpException(HttpStatus.SERVICE_UNAVAILABLE, "Service Unavailable", message, options),

  badGateway: (message: string, options?: { requestId?: string; details?: Record<string, unknown> }) =>
    throwHttpException(HttpStatus.BAD_GATEWAY, "Bad Gateway", message, options),

  tooManyRequests: (message: string, options?: { requestId?: string; details?: Record<string, unknown> }) =>
    throwHttpException(HttpStatus.TOO_MANY_REQUESTS, "Too Many Requests", message, options),
};

/**
 * Handle async operations with standardized error handling
 */
export async function handleAsyncOperation<T>(
  operation: () => Promise<T>,
  errorContext: string,
  options: {
    requestId?: string;
    timeout?: number;
    onError?: (error: Error) => HttpException;
  } = {}
): Promise<T> {
  const { requestId, timeout = 30000, onError } = options;

  try {
    if (timeout > 0) {
      return await Promise.race([
        operation(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Operation timeout: ${errorContext}`)), timeout)
        ),
      ]);
    }
    return await operation();
  } catch (error) {
    const err = error as Error;

    // Preserve existing HttpException status and response
    if (error instanceof HttpException) {
      throw error;
    }

    if (onError) {
      throw onError(err);
    }

    // Default error handling
    if (err.message.includes("timeout")) {
      throwHttpException(HttpStatus.REQUEST_TIMEOUT, "Request Timeout", err.message, { requestId });
    }

    if (err.message.includes("not found") || err.message.includes("404")) {
      throwHttpException(HttpStatus.NOT_FOUND, "Not Found", err.message, { requestId });
    }

    if (err.message.includes("validation") || err.message.includes("invalid")) {
      throwHttpException(HttpStatus.BAD_REQUEST, "Validation Error", err.message, { requestId });
    }

    throwHttpException(HttpStatus.INTERNAL_SERVER_ERROR, "Internal Server Error", err.message, {
      requestId,
    });
  }
}
