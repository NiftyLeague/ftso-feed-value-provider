import { v4 as uuidv4 } from "uuid";
import { HttpException, HttpStatus } from "@nestjs/common";
import { BaseService } from "./base.service";
import { ValidationUtils } from "../utils/validation.utils";
import { createSuccessResponse, handleAsyncOperation, ApiResponse } from "../utils/http-response.utils";
import { createTimer, PerformanceUtils } from "../utils/performance.utils";

/**
 * Base controller class consolidates common controller patterns
 * Extends BaseService for logging functionality
 */
export abstract class BaseController extends BaseService {
  protected readonly startupTime: number = Date.now();

  constructor(controllerName: string, useEnhancedLogger = false) {
    super(controllerName, useEnhancedLogger);
  }

  /**
   * Generate unique request ID
   */
  public generateRequestId(): string {
    return uuidv4();
  }

  /**
   * Execute controller operation with standardized error handling and timing
   */
  protected async executeOperation<T>(
    operation: () => Promise<T>,
    operationName: string,
    options: {
      requestId?: string;
      timeout?: number;
      performanceThreshold?: number;
    } = {}
  ): Promise<ApiResponse<T>> {
    const { requestId = this.generateRequestId(), timeout, performanceThreshold = 1000 } = options;
    const timer = createTimer();

    try {
      this.logger.debug(`Starting ${operationName}`, { requestId });

      const result = await handleAsyncOperation(operation, operationName, { requestId, timeout });

      const responseTime = timer.end();

      // Log performance warning if operation is slow
      if (responseTime > performanceThreshold) {
        this.logger.warn(PerformanceUtils.createWarningMessage(operationName, responseTime, performanceThreshold), {
          requestId,
          responseTime,
        });
      } else {
        this.logger.debug(`${operationName} completed in ${PerformanceUtils.formatDuration(responseTime)}`, {
          requestId,
          responseTime,
        });
      }

      return createSuccessResponse(result, { responseTime, requestId });
    } catch (error) {
      const responseTime = timer.end();
      const err = error as Error;

      this.logger.error(`${operationName} failed in ${PerformanceUtils.formatDuration(responseTime)}:`, err, {
        requestId,
        responseTime,
      });

      throw error; // Re-throw to let HTTP exception handling work
    }
  }

  /**
   * Validate request parameters using ValidationUtils
   */
  protected validateRequired<T>(value: T, fieldName: string): T {
    return ValidationUtils.validateRequired(value, fieldName);
  }

  /**
   * Validate array parameters using ValidationUtils
   */
  protected validateArray<T>(
    value: T[],
    fieldName: string,
    options: { minLength?: number; maxLength?: number; itemValidator?: (item: unknown, index: number) => T } = {}
  ): T[] {
    return ValidationUtils.validateArray(value, fieldName, options);
  }

  /**
   * Validate numeric parameters using ValidationUtils
   */
  protected validateNumber(
    value: number,
    fieldName: string,
    options: { min?: number; max?: number; allowFloat?: boolean } = {}
  ): number {
    const { min, max, allowFloat = true } = options;
    return ValidationUtils.validateNumericRange(value, fieldName, min, max, allowFloat);
  }

  /**
   * Get system uptime since controller startup
   */
  protected getUptime(): number {
    return Date.now() - this.startupTime;
  }

  /**
   * Create health check response
   */
  protected createHealthResponse(
    status: "healthy" | "unhealthy" | "degraded",
    details: Record<string, unknown> = {},
    responseTime?: number
  ): ApiResponse<unknown> {
    return {
      status,
      timestamp: Date.now(),
      responseTime,
      data: {
        version: "1.0.0",
        uptime: process.uptime(),
        controllerUptime: this.getUptime(),
        ...details,
      },
    };
  }

  /**
   * Log request start
   */
  protected logRequestStart(endpoint: string, requestId: string, params?: unknown): void {
    this.logger.log(`${endpoint} request started`, {
      requestId,
      endpoint,
      params: params ? JSON.stringify(params) : undefined,
    });
  }

  /**
   * Log request completion
   */
  protected logRequestComplete(
    endpoint: string,
    requestId: string,
    responseTime: number,
    status: "success" | "error" = "success"
  ): void {
    this.logger.log(`${endpoint} request completed`, {
      requestId,
      endpoint,
      responseTime,
      status,
      formattedTime: PerformanceUtils.formatDuration(responseTime),
    });
  }

  /**
   * Handle pagination parameters using ValidationUtils
   */
  protected validatePagination(page?: number, limit?: number): { page: number; limit: number; offset: number } {
    return ValidationUtils.validatePagination(page, limit);
  }

  /**
   * Create paginated response
   */
  protected createPaginatedResponse<T>(
    data: T[],
    total: number,
    page: number,
    limit: number,
    options: { requestId?: string; responseTime?: number } = {}
  ): ApiResponse<{
    items: T[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
      hasNext: boolean;
      hasPrev: boolean;
    };
  }> {
    const totalPages = Math.ceil(total / limit);

    return createSuccessResponse(
      {
        items: data,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      },
      options
    );
  }

  /**
   * Log API request with standardized format
   */
  protected logApiRequest(method: string, url: string, body?: unknown, requestId?: string): void {
    const sanitizedBody = this.sanitizeRequestBody(body);
    this.logger.log(`API Request: ${method} ${url}`, {
      requestId,
      method,
      url,
      bodySize: JSON.stringify(sanitizedBody).length,
      timestamp: Date.now(),
    });
  }

  /**
   * Log API response with standardized format
   */
  protected logApiResponse(
    method: string,
    url: string,
    statusCode: number,
    responseTime: number,
    responseSize: number,
    requestId?: string,
    errorMessage?: string
  ): void {
    this.logger.log(`API Response: ${method} ${url} - ${statusCode}`, {
      requestId,
      method,
      url,
      statusCode,
      responseTime: Math.round(responseTime),
      responseSize,
      timestamp: Date.now(),
      error: errorMessage,
    });
  }

  /**
   * Sanitize request body for logging (limit size and sensitive data)
   */
  protected sanitizeRequestBody(body: unknown): unknown {
    if (!body) return body;

    try {
      // Create a copy and limit the size for logging
      const sanitized = JSON.parse(JSON.stringify(body));

      // Limit feeds array for logging (show first 3 feeds)
      if (sanitized.feeds && Array.isArray(sanitized.feeds) && sanitized.feeds.length > 3) {
        sanitized.feeds = [
          ...sanitized.feeds.slice(0, 3),
          { truncated: `... and ${sanitized.feeds.length - 3} more feeds` },
        ];
      }

      return sanitized;
    } catch {
      return { error: "Unable to sanitize request body" };
    }
  }

  /**
   * Calculate response size for logging
   */
  protected calculateResponseSize(response: unknown): number {
    try {
      return JSON.stringify(response).length;
    } catch {
      return 0;
    }
  }

  /**
   * Create standardized error response
   */
  protected createErrorResponse(
    error: string,
    code: number,
    message: string,
    requestId?: string,
    details?: unknown
  ): Record<string, unknown> {
    return {
      error,
      code,
      message,
      timestamp: Date.now(),
      requestId,
      ...(details && { details }),
    };
  }

  /**
   * Throw HTTP exception with standardized error response
   */
  protected throwHttpException(
    status: HttpStatus,
    error: string,
    code: number,
    message: string,
    requestId?: string,
    details?: unknown
  ): never {
    const errorResponse = this.createErrorResponse(error, code, message, requestId, details);
    throw new HttpException(errorResponse, status);
  }

  /**
   * Handle controller operation with comprehensive error handling and logging
   */
  protected async handleControllerOperation<T>(
    operation: () => Promise<T>,
    operationName: string,
    method: string,
    url: string,
    options: {
      requestId?: string;
      body?: unknown;
      timeout?: number;
      performanceThreshold?: number;
    } = {}
  ): Promise<T> {
    const { requestId = this.generateRequestId(), body, timeout, performanceThreshold = 1000 } = options;
    const startTime = performance.now();

    // Log API request
    this.logApiRequest(method, url, body, requestId);

    try {
      const result = await handleAsyncOperation(operation, operationName, { requestId, timeout });
      const responseTime = performance.now() - startTime;

      // Log API response
      this.logApiResponse(method, url, 200, responseTime, this.calculateResponseSize(result), requestId);

      // Log performance warning if operation is slow
      if (responseTime > performanceThreshold) {
        this.logger.warn(PerformanceUtils.createWarningMessage(operationName, responseTime, performanceThreshold), {
          requestId,
          responseTime,
        });
      } else {
        this.logger.debug(`${operationName} completed in ${PerformanceUtils.formatDuration(responseTime)}`, {
          requestId,
          responseTime,
        });
      }

      return result;
    } catch (error) {
      const responseTime = performance.now() - startTime;
      const err = error as Error;

      // Determine status code based on error type
      let statusCode = 500;
      if (error instanceof HttpException) {
        statusCode = error.getStatus();
      }

      // Log error response
      this.logApiResponse(method, url, statusCode, responseTime, 0, requestId, err.message);

      this.logger.error(`${operationName} failed in ${PerformanceUtils.formatDuration(responseTime)}:`, err, {
        requestId,
        responseTime,
      });

      throw error; // Re-throw to let HTTP exception handling work
    }
  }
}
