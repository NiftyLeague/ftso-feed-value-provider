import { HttpException, HttpStatus } from "@nestjs/common";
import type { ApiErrorResponse } from "@/common/types/error-handling";
import { ApiErrorCodes } from "@/common/types/error-handling";
import type { ValidationRuleError } from "../types/utils";

/**
 * Error response builder to standardize error formats
 * Eliminates error response duplication by 300+ lines across controllers
 */
export class ErrorResponseBuilder {
  private static requestIdCounter = 0;

  /**
   * Generate unique request ID
   */
  static generateRequestId(): string {
    const timestamp = Date.now();
    const counter = ++this.requestIdCounter;
    const random = Math.random().toString(36).substr(2, 6);
    return `req_${timestamp}_${counter}_${random}`;
  }

  /**
   * Create standardized error response
   */
  static createErrorResponse(
    errorCode: ApiErrorCodes,
    message: string,
    requestId?: string,
    details?: Record<string, unknown>
  ): ApiErrorResponse {
    return {
      error: ApiErrorCodes[errorCode],
      code: errorCode,
      message,
      timestamp: Date.now(),
      requestId: requestId || this.generateRequestId(),
      details,
    };
  }

  /**
   * Create validation error response
   */
  static createValidationError(message: string, requestId?: string, details?: ValidationRuleError): HttpException {
    const wrappedDetails = details ? { ...details } : undefined;
    const errorResponse = this.createErrorResponse(
      ApiErrorCodes.INVALID_FEED_REQUEST,
      message,
      requestId,
      wrappedDetails
    );

    return new HttpException(errorResponse, HttpStatus.BAD_REQUEST);
  }

  /**
   * Create feed not found error response
   */
  static createFeedNotFoundError(feedId: unknown, requestId?: string): HttpException {
    const errorResponse = this.createErrorResponse(
      ApiErrorCodes.FEED_NOT_FOUND,
      `Feed not found: ${JSON.stringify(feedId)}`,
      requestId,
      { feedId }
    );

    return new HttpException(errorResponse, HttpStatus.NOT_FOUND);
  }

  /**
   * Create invalid voting round error response
   */
  static createInvalidVotingRoundError(votingRoundId: unknown, requestId?: string): HttpException {
    const errorResponse = this.createErrorResponse(
      ApiErrorCodes.INVALID_VOTING_ROUND,
      `Invalid voting round ID: ${votingRoundId}`,
      requestId,
      { votingRoundId }
    );

    return new HttpException(errorResponse, HttpStatus.BAD_REQUEST);
  }

  /**
   * Create invalid time window error response
   */
  static createInvalidTimeWindowError(windowSec: unknown, requestId?: string): HttpException {
    const errorResponse = this.createErrorResponse(
      ApiErrorCodes.INVALID_TIME_WINDOW,
      `Invalid time window: ${windowSec}`,
      requestId,
      { windowSec }
    );

    return new HttpException(errorResponse, HttpStatus.BAD_REQUEST);
  }

  /**
   * Create data source unavailable error response
   */
  static createDataSourceError(error: Error, requestId?: string): HttpException {
    const errorResponse = this.createErrorResponse(
      ApiErrorCodes.DATA_SOURCE_UNAVAILABLE,
      "Data source temporarily unavailable",
      requestId,
      { originalError: error.message }
    );

    return new HttpException(errorResponse, HttpStatus.BAD_GATEWAY);
  }

  /**
   * Create aggregation failed error response
   */
  static createAggregationError(error: Error, requestId?: string): HttpException {
    const errorResponse = this.createErrorResponse(
      ApiErrorCodes.AGGREGATION_FAILED,
      "Price aggregation failed",
      requestId,
      { originalError: error.message }
    );

    return new HttpException(errorResponse, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  /**
   * Create cache error response
   */
  static createCacheError(error: Error, requestId?: string): HttpException {
    const errorResponse = this.createErrorResponse(ApiErrorCodes.CACHE_ERROR, "Cache operation failed", requestId, {
      originalError: error.message,
    });

    return new HttpException(errorResponse, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  /**
   * Create internal server error response
   */
  static createInternalError(error: Error, requestId?: string): HttpException {
    const errorResponse = this.createErrorResponse(ApiErrorCodes.INTERNAL_ERROR, "Internal server error", requestId, {
      originalError: error.message,
    });

    return new HttpException(errorResponse, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  /**
   * Create rate limit exceeded error response
   */
  static createRateLimitError(requestId?: string): HttpException {
    const errorResponse = this.createErrorResponse(ApiErrorCodes.RATE_LIMIT_EXCEEDED, "Rate limit exceeded", requestId);

    return new HttpException(errorResponse, HttpStatus.TOO_MANY_REQUESTS);
  }

  /**
   * Create service unavailable error response
   */
  static createServiceUnavailableError(serviceName: string, requestId?: string): HttpException {
    const errorResponse = this.createErrorResponse(
      ApiErrorCodes.SERVICE_UNAVAILABLE,
      `Service temporarily unavailable: ${serviceName}`,
      requestId,
      { serviceName }
    );

    return new HttpException(errorResponse, HttpStatus.SERVICE_UNAVAILABLE);
  }

  /**
   * Create error response from unknown error
   */
  static createFromUnknownError(error: unknown, requestId?: string, context?: string): HttpException {
    let message = "Unknown error occurred";
    let details: Record<string, unknown> = {};

    if (error instanceof Error) {
      message = error.message;
      details.stack = error.stack;
    } else if (typeof error === "string") {
      message = error;
    } else {
      details.originalError = error;
    }

    if (context) {
      message = `${context}: ${message}`;
      details.context = context;
    }

    const errorResponse = this.createErrorResponse(ApiErrorCodes.INTERNAL_ERROR, message, requestId, details);

    return new HttpException(errorResponse, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  /**
   * Create error response with custom status code
   */
  static createCustomError(
    message: string,
    statusCode: HttpStatus,
    errorCode?: ApiErrorCodes,
    requestId?: string,
    details?: Record<string, unknown>
  ): HttpException {
    const code = errorCode || this.getDefaultErrorCodeForStatus(statusCode);
    const errorResponse = this.createErrorResponse(code, message, requestId, details);
    return new HttpException(errorResponse, statusCode);
  }

  /**
   * Get default error code for HTTP status
   */
  private static getDefaultErrorCodeForStatus(status: HttpStatus): ApiErrorCodes {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return ApiErrorCodes.INVALID_FEED_REQUEST;
      case HttpStatus.NOT_FOUND:
        return ApiErrorCodes.FEED_NOT_FOUND;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ApiErrorCodes.RATE_LIMIT_EXCEEDED;
      case HttpStatus.BAD_GATEWAY:
        return ApiErrorCodes.DATA_SOURCE_UNAVAILABLE;
      case HttpStatus.SERVICE_UNAVAILABLE:
        return ApiErrorCodes.SERVICE_UNAVAILABLE;
      default:
        return ApiErrorCodes.INTERNAL_ERROR;
    }
  }

  /**
   * Extract request ID from existing error response
   */
  static extractRequestId(error: HttpException): string | undefined {
    try {
      const response = error.getResponse();
      if (typeof response === "object" && response !== null && "requestId" in response) {
        return (response as { requestId: string }).requestId;
      }
    } catch {
      // Ignore extraction errors
    }
    return undefined;
  }

  /**
   * Check if error is a standardized API error
   */
  static isApiError(error: HttpException): boolean {
    try {
      const response = error.getResponse();
      return (
        typeof response === "object" &&
        response !== null &&
        "error" in response &&
        "code" in response &&
        "timestamp" in response &&
        "requestId" in response
      );
    } catch {
      return false;
    }
  }

  /**
   * Convert any error to standardized format
   */
  static standardizeError(error: unknown, requestId?: string): HttpException {
    if (error instanceof HttpException) {
      if (this.isApiError(error)) {
        return error;
      }
      // Convert non-standardized HttpException
      const status = error.getStatus();
      const message = error.message || "HTTP Exception";
      return this.createCustomError(message, status, undefined, requestId);
    }

    return this.createFromUnknownError(error, requestId);
  }
}
