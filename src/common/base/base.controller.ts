import { v4 as uuidv4 } from "uuid";
import { HttpException, HttpStatus } from "@nestjs/common";
import type { Request } from "express";
import { MonitoringService } from "./composed.service";
import { ValidationUtils } from "../utils/validation.utils";
import { createSuccessResponse, handleAsyncOperation } from "../utils/http-response.utils";
import type { ApiResponse } from "../types/http/http.types";
import type { StandardErrorMetadata, RetryConfig } from "../types/error-handling";
import { ErrorCode } from "../types/error-handling";
import { createTimer, PerformanceUtils } from "../utils/performance.utils";

/**
 * Controller operation options interface
 */
interface ControllerOperationOptions {
  requestId: string;
  body: unknown;
  timeout: number | undefined;
  performanceThreshold: number;
  userId: string | undefined;
  sessionId: string | undefined;
  clientId: string | undefined;
  userAgent: string | undefined;
  ipAddress: string | undefined;
  useStandardizedErrorHandling: boolean;
  useRetryLogic: boolean;
  retryConfig: Partial<RetryConfig>;
}
import type { StandardizedErrorHandlerService } from "@/error-handling/standardized-error-handler.service";
import type { UniversalRetryService } from "@/error-handling/universal-retry.service";

// Extended Request interface for authentication and session data
interface IExtendedRequest extends Request {
  user?: { id: string; [key: string]: unknown };
  session?: { id: string; [key: string]: unknown };
}

/**
 * Base controller class consolidates common controller patterns
 * Extends BaseService for logging functionality
 * Enhanced with standardized error handling and retry mechanisms
 */
export abstract class BaseController extends MonitoringService {
  protected readonly startupTime: number = Date.now();
  protected readonly controllerName: string;

  // These will be injected by child controllers that need standardized error handling
  protected standardizedErrorHandler?: StandardizedErrorHandlerService;
  protected universalRetryService?: UniversalRetryService;

  constructor() {
    super();
    this.controllerName = this.constructor.name;
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
  ): ApiResponse<Record<string, unknown>> {
    const data = {
      status,
      version: "1.0.0",
      uptime: process.uptime(),
      controllerUptime: this.getUptime(),
      ...details,
    } as Record<string, unknown>;

    return createSuccessResponse(data, { responseTime });
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
      bodySize: sanitizedBody === undefined ? 0 : JSON.stringify(sanitizedBody).length,
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
    const response: Record<string, unknown> = {
      error,
      code,
      message,
      timestamp: Date.now(),
      requestId,
    };
    if (details !== undefined) {
      response.details = details;
    }
    return response;
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
   * Enhanced with standardized error handling and retry mechanisms
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
      userId?: string;
      sessionId?: string;
      clientId?: string;
      userAgent?: string;
      ipAddress?: string;
      useStandardizedErrorHandling?: boolean;
      useRetryLogic?: boolean;
      retryConfig?: Partial<RetryConfig>;
    } = {}
  ): Promise<T> {
    const normalizedOptions = this.normalizeControllerOptions(options);
    const startTime = performance.now();

    this.logApiRequest(method, url, normalizedOptions.body, normalizedOptions.requestId);

    try {
      const result = await this.executeOperationWithErrorHandling(
        operation,
        operationName,
        normalizedOptions,
        method,
        url
      );
      this.handleSuccessfulOperation(result, operationName, method, url, startTime, normalizedOptions);
      return result;
    } catch (error) {
      this.handleFailedOperation(error, operationName, method, url, startTime, normalizedOptions);
      throw error;
    }
  }

  /**
   * Normalize controller operation options with defaults
   */
  private normalizeControllerOptions(options: Record<string, unknown>) {
    return {
      requestId: (options.requestId as string) || this.generateRequestId(),
      body: options.body,
      timeout: options.timeout as number | undefined,
      performanceThreshold: (options.performanceThreshold as number) || 1000,
      userId: options.userId as string | undefined,
      sessionId: options.sessionId as string | undefined,
      clientId: options.clientId as string | undefined,
      userAgent: options.userAgent as string | undefined,
      ipAddress: options.ipAddress as string | undefined,
      useStandardizedErrorHandling: (options.useStandardizedErrorHandling as boolean) ?? true,
      useRetryLogic: (options.useRetryLogic as boolean) ?? false,
      retryConfig: options.retryConfig,
    } as ControllerOperationOptions;
  }

  /**
   * Execute operation with appropriate error handling strategy
   */
  private async executeOperationWithErrorHandling<T>(
    operation: () => Promise<T>,
    operationName: string,
    options: ControllerOperationOptions,
    method: string,
    url: string
  ): Promise<T> {
    const executeOperation = () =>
      handleAsyncOperation(operation, operationName, {
        requestId: options.requestId,
        timeout: options.timeout,
      });

    if (options.useStandardizedErrorHandling && this.standardizedErrorHandler) {
      return await this.standardizedErrorHandler.executeWithStandardizedHandling(
        async () => this.executeWithRetryIfNeeded(executeOperation, operationName, options),
        this.buildErrorHandlingMetadata(operationName, options, method, url)
      );
    } else {
      return await this.executeWithRetryIfNeeded(executeOperation, operationName, options);
    }
  }

  /**
   * Execute operation with retry logic if configured
   */
  private async executeWithRetryIfNeeded<T>(
    operation: () => Promise<T>,
    operationName: string,
    options: ControllerOperationOptions
  ): Promise<T> {
    if (options.useRetryLogic && this.universalRetryService) {
      return await this.universalRetryService.executeWithRetry(operation, {
        serviceId: this.controllerName,
        operationName,
        retryConfig: options.retryConfig,
      });
    } else {
      return await operation();
    }
  }

  /**
   * Build error handling metadata for standardized error handler
   */
  private buildErrorHandlingMetadata(
    operationName: string,
    options: ControllerOperationOptions,
    method: string,
    url: string
  ) {
    return {
      serviceId: this.controllerName,
      operationName,
      component: this.controllerName,
      requestId: options.requestId,
      metadata: {
        operation: operationName,
        correlationId: options.requestId,
        userId: options.userId,
        sessionId: options.sessionId,
        clientId: options.clientId,
        userAgent: options.userAgent,
        ipAddress: options.ipAddress,
        additionalContext: {
          method,
          path: url,
          body: this.sanitizeForLogging(options.body),
        },
      },
    };
  }

  /**
   * Handle successful operation completion
   */
  private handleSuccessfulOperation<T>(
    result: T,
    operationName: string,
    method: string,
    url: string,
    startTime: number,
    options: ControllerOperationOptions
  ): void {
    const responseTime = performance.now() - startTime;

    this.logApiResponse(method, url, 200, responseTime, this.calculateResponseSize(result), options.requestId);
    this.logPerformanceMetrics(operationName, responseTime, options.performanceThreshold, options.requestId);
  }

  /**
   * Handle failed operation
   */
  private handleFailedOperation(
    error: unknown,
    operationName: string,
    method: string,
    url: string,
    startTime: number,
    options: ControllerOperationOptions
  ): void {
    const responseTime = performance.now() - startTime;
    const err = error as Error;
    const statusCode = error instanceof HttpException ? error.getStatus() : 500;

    this.logApiResponse(method, url, statusCode, responseTime, 0, options.requestId, err.message);
    this.logger.error(`${operationName} failed in ${PerformanceUtils.formatDuration(responseTime)}:`, err, {
      requestId: options.requestId,
      responseTime,
    });
  }

  /**
   * Log performance metrics for operation
   */
  private logPerformanceMetrics(
    operationName: string,
    responseTime: number,
    performanceThreshold: number,
    requestId: string
  ): void {
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
  }

  /**
   * Handle validation errors with standardized format
   */
  protected handleValidationError(
    message: string,
    details?: Record<string, unknown>,
    requestId?: string
  ): HttpException {
    if (this.standardizedErrorHandler) {
      return this.standardizedErrorHandler.handleValidationError(message, details, requestId, {
        component: this.controllerName,
      });
    }

    // Fallback to existing error handling
    return new HttpException(
      this.createErrorResponse(ErrorCode.VALIDATION_ERROR, 4000, message, requestId, details),
      HttpStatus.BAD_REQUEST
    );
  }

  /**
   * Handle authentication errors with standardized format
   */
  protected handleAuthenticationError(message: string = "Authentication required", requestId?: string): HttpException {
    if (this.standardizedErrorHandler) {
      return this.standardizedErrorHandler.handleAuthenticationError(message, requestId, {
        component: this.controllerName,
      });
    }

    // Fallback to existing error handling
    return new HttpException(
      this.createErrorResponse("AUTHENTICATION_ERROR", 4010, message, requestId),
      HttpStatus.UNAUTHORIZED
    );
  }

  /**
   * Handle rate limit errors with standardized format
   */
  protected handleRateLimitError(requestId?: string, retryAfter?: number): HttpException {
    if (this.standardizedErrorHandler) {
      return this.standardizedErrorHandler.handleRateLimitError(requestId, retryAfter, {
        component: this.controllerName,
      });
    }

    // Fallback to existing error handling
    return new HttpException(
      {
        ...this.createErrorResponse("RATE_LIMIT_EXCEEDED", 4290, "Rate limit exceeded", requestId),
        retryAfter: retryAfter || 60000,
      },
      HttpStatus.TOO_MANY_REQUESTS
    );
  }

  /**
   * Handle external service errors with standardized format
   */
  protected handleExternalServiceError(serviceName: string, originalError: Error, requestId?: string): HttpException {
    if (this.standardizedErrorHandler) {
      return this.standardizedErrorHandler.handleExternalServiceError(serviceName, originalError, requestId, {
        component: this.controllerName,
      });
    }

    // Fallback to existing error handling
    return new HttpException(
      this.createErrorResponse("EXTERNAL_SERVICE_ERROR", 5020, `External service error: ${serviceName}`, requestId, {
        originalError: originalError.message,
      }),
      HttpStatus.BAD_GATEWAY
    );
  }

  /**
   * Execute operation with retry logic (if retry service is available)
   */
  protected async executeWithRetry<T>(
    operation: () => Promise<T>,
    context: {
      operationName: string;
      serviceType?: "http" | "database" | "cache" | "external-api" | "websocket";
      endpoint?: string;
      retryConfig?: Partial<RetryConfig>;
    }
  ): Promise<T> {
    if (this.universalRetryService) {
      const serviceId = `${this.controllerName}:${context.serviceType || "default"}`;

      switch (context.serviceType) {
        case "http":
          return this.universalRetryService.executeHttpWithRetry(operation, {
            serviceId,
            endpoint: context.endpoint || "unknown",
            method: "POST", // Default method
            retryConfig: context.retryConfig,
          });

        case "database":
          return this.universalRetryService.executeDatabaseWithRetry(operation, {
            serviceId,
            operation: context.operationName,
            retryConfig: context.retryConfig,
          });

        case "cache":
          return this.universalRetryService.executeCacheWithRetry(operation, {
            serviceId,
            operation: context.operationName,
            retryConfig: context.retryConfig,
          });

        case "external-api":
          try {
            const result = await this.universalRetryService.executeExternalApiWithRetry(operation, {
              serviceId,
              apiName: this.controllerName,
              endpoint: context.endpoint || "unknown",
              retryConfig: context.retryConfig,
            });
            // If the retry service returns undefined, call the operation directly as fallback
            if (result === undefined) {
              return await operation();
            }
            return result;
          } catch (error) {
            console.log(`executeExternalApiWithRetry error:`, error);
            // Fallback to direct operation call
            return await operation();
          }

        default:
          return this.universalRetryService.executeWithRetry(operation, {
            serviceId,
            operationName: context.operationName,
            retryConfig: context.retryConfig,
          });
      }
    }

    // Fallback to direct execution
    return operation();
  }

  /**
   * Extract request metadata from request object
   */
  protected extractRequestMetadata(request: Request): Partial<StandardErrorMetadata> {
    return {
      correlationId: request.get?.("X-Correlation-ID") || request.get?.("X-Request-ID") || this.generateRequestId(),
      traceId: request.get?.("X-Trace-ID"),
      userId: request.get?.("X-User-ID") || (request as IExtendedRequest).user?.id,
      sessionId: request.get?.("X-Session-ID") || (request as IExtendedRequest).session?.id,
      clientId: request.get?.("X-Client-ID"),
      userAgent: request.get?.("User-Agent"),
      ipAddress: this.extractClientIp(request),
      additionalContext: {
        method: request.method,
        path: request.path,
        query: request.query,
        params: request.params,
      },
    };
  }

  /**
   * Extract client IP address from request
   */
  protected extractClientIp(request: Request): string {
    return (
      request.get?.("X-Forwarded-For")?.split(",")[0]?.trim() ||
      request.get?.("X-Real-IP") ||
      request.socket?.remoteAddress ||
      "unknown"
    );
  }

  /**
   * Sanitize sensitive data for logging
   */
  protected sanitizeForLogging(data: unknown): unknown {
    if (!data || typeof data !== "object") {
      return data;
    }

    const sensitiveFields = [
      "password",
      "token",
      "authorization",
      "auth",
      "secret",
      "key",
      "apikey",
      "api_key",
      "private",
      "credential",
    ];

    const sanitized = { ...data } as Record<string, unknown>;

    for (const field of sensitiveFields) {
      if (field in sanitized) {
        sanitized[field] = "[REDACTED]";
      }
    }

    return sanitized;
  }
}
