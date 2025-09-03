import { Injectable, HttpException, HttpStatus } from "@nestjs/common";
import { BaseService } from "@/common/base/base.service";
import type { ApiErrorResponse } from "@/common/types/error-handling";
import { ApiErrorCodes } from "@/common/types/error-handling";

@Injectable()
export class ApiErrorHandlerService extends BaseService {
  constructor() {
    super(ApiErrorHandlerService.name);
  }

  createErrorResponse(
    errorCode: ApiErrorCodes,
    message: string,
    requestId: string,
    details?: Record<string, unknown>
  ): ApiErrorResponse {
    return {
      error: ApiErrorCodes[errorCode],
      code: errorCode,
      message,
      timestamp: Date.now(),
      requestId,
      details,
    };
  }

  handleValidationError(message: string, requestId: string, details?: Record<string, unknown>): HttpException {
    const errorResponse = this.createErrorResponse(ApiErrorCodes.INVALID_FEED_REQUEST, message, requestId, details);

    this.logger.warn(`Validation error: ${message}`, { requestId, details });

    return new HttpException(errorResponse, HttpStatus.BAD_REQUEST);
  }

  handleFeedNotFoundError(feedId: unknown, requestId: string): HttpException {
    const errorResponse = this.createErrorResponse(
      ApiErrorCodes.FEED_NOT_FOUND,
      `Feed not found: ${JSON.stringify(feedId)}`,
      requestId,
      { feedId }
    );

    this.logger.warn(`Feed not found: ${JSON.stringify(feedId)}`, { requestId });

    return new HttpException(errorResponse, HttpStatus.NOT_FOUND);
  }

  handleDataSourceError(error: Error, requestId: string): HttpException {
    const errorResponse = this.createErrorResponse(
      ApiErrorCodes.DATA_SOURCE_UNAVAILABLE,
      "Data source temporarily unavailable",
      requestId,
      { originalError: error.message }
    );

    this.logger.error(`Data source error: ${error.message}`, error.stack, { requestId });

    return new HttpException(errorResponse, HttpStatus.BAD_GATEWAY);
  }

  handleAggregationError(error: Error, requestId: string): HttpException {
    const errorResponse = this.createErrorResponse(
      ApiErrorCodes.AGGREGATION_FAILED,
      "Price aggregation failed",
      requestId,
      { originalError: error.message }
    );

    this.logger.error(`Aggregation error: ${error.message}`, error.stack, { requestId });

    return new HttpException(errorResponse, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  handleCacheError(error: Error, requestId: string): HttpException {
    const errorResponse = this.createErrorResponse(ApiErrorCodes.CACHE_ERROR, "Cache operation failed", requestId, {
      originalError: error.message,
    });

    this.logger.error(`Cache error: ${error.message}`, error.stack, { requestId });

    return new HttpException(errorResponse, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  handleInternalError(error: Error, requestId: string): HttpException {
    const errorResponse = this.createErrorResponse(ApiErrorCodes.INTERNAL_ERROR, "Internal server error", requestId, {
      originalError: error.message,
    });

    this.logger.error(`Internal error: ${error.message}`, error.stack, { requestId });

    return new HttpException(errorResponse, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  handleRateLimitError(requestId: string): HttpException {
    const errorResponse = this.createErrorResponse(ApiErrorCodes.RATE_LIMIT_EXCEEDED, "Rate limit exceeded", requestId);

    this.logger.warn(`Rate limit exceeded`, { requestId });

    return new HttpException(errorResponse, HttpStatus.TOO_MANY_REQUESTS);
  }

  generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  logPerformanceWarning(operation: string, responseTime: number, target: number, requestId?: string): void {
    if (responseTime > target) {
      this.logger.warn(`Performance warning: ${operation} took ${responseTime.toFixed(2)}ms (target: ${target}ms)`, {
        requestId,
        responseTime,
        target,
      });
    }
  }

  logApiCall(method: string, url: string, responseTime: number, statusCode: number, requestId?: string): void {
    this.logger.log(`${method} ${url} - ${statusCode} - ${responseTime.toFixed(2)}ms`, {
      requestId,
      method,
      url,
      responseTime,
      statusCode,
    });
  }
}
