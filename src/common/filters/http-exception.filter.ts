import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { Request, Response } from "express";
import type { EnhancedErrorResponse, StandardErrorMetadata } from "@/common/types/error-handling";
import { StandardErrorClassification, createEnhancedErrorResponse, ErrorSeverity } from "@/common/types/error-handling";

// Extended Request interface for authentication and session data
interface IExtendedRequest extends Request {
  user?: { id: string; [key: string]: unknown };
  session?: { id: string; [key: string]: unknown };
}

// Type for HTTP exception response objects
interface HttpExceptionResponse {
  error?: string;
  code?: string;
  message?: string;
  timestamp?: number;
  context?: Record<string, unknown>;
}

/**
 * Enhanced global exception filter that provides standardized error responses
 * with comprehensive logging, monitoring, and retry information
 */
@Catch()
@Injectable()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Extract request metadata
    const requestMetadata = this.extractRequestMetadata(request);

    let errorResponse: EnhancedErrorResponse;
    let status: HttpStatus;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      errorResponse = this.handleHttpException(exception, requestMetadata);
    } else if (exception instanceof Error) {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      errorResponse = this.handleGenericError(exception, requestMetadata);
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      errorResponse = this.handleUnknownError(exception, requestMetadata);
    }

    // Ensure response has required fields
    errorResponse = this.ensureStandardizedResponse(errorResponse, status, request);

    // Add security headers for error responses
    this.addSecurityHeaders(response);

    // Add retry-after header if applicable
    if (errorResponse.retryAfter) {
      response.setHeader("Retry-After", Math.ceil(errorResponse.retryAfter / 1000));
    }

    // Log the error with comprehensive context
    this.logError(exception, errorResponse, request, status);

    // Send standardized response
    response.status(status).json(errorResponse);
  }

  private handleHttpException(exception: HttpException, requestMetadata: StandardErrorMetadata): EnhancedErrorResponse {
    const exceptionResponse = exception.getResponse();

    // Check if it's already a standardized response
    if (this.isEnhancedErrorResponse(exceptionResponse)) {
      return exceptionResponse as EnhancedErrorResponse;
    }

    // Handle string responses
    if (typeof exceptionResponse === "string") {
      return createEnhancedErrorResponse(
        new Error(exceptionResponse),
        {
          ...requestMetadata,
          classification: this.classifyHttpStatus(exception.getStatus()),
          retryable: this.isStatusRetryable(exception.getStatus()),
          severity: this.getSeverityForStatus(exception.getStatus()),
          component: "HttpException",
        },
        requestMetadata.correlationId
      );
    }

    // Handle object responses
    if (typeof exceptionResponse === "object" && exceptionResponse !== null) {
      const objResponse = exceptionResponse as HttpExceptionResponse;

      return {
        success: false,
        error: {
          code: objResponse.error || objResponse.code || "HTTP_EXCEPTION",
          message: objResponse.message || "HTTP Exception occurred",
          severity: this.getSeverityForStatus(exception.getStatus()),
          module: requestMetadata.component,
          timestamp: objResponse.timestamp || Date.now(),
          context: {
            classification: this.classifyHttpStatus(exception.getStatus()),
            ...objResponse.context,
            ...requestMetadata.additionalContext,
          },
        },
        timestamp: Date.now(),
        requestId: requestMetadata.correlationId || this.generateRequestId(),
        retryable: this.isStatusRetryable(exception.getStatus()),
        retryAfter: this.isStatusRetryable(exception.getStatus())
          ? this.calculateRetryAfter(exception.getStatus())
          : undefined,
      };
    }

    // Fallback for other response types
    return createEnhancedErrorResponse(
      new Error("HTTP Exception"),
      {
        ...requestMetadata,
        classification: this.classifyHttpStatus(exception.getStatus()),
        retryable: this.isStatusRetryable(exception.getStatus()),
        severity: this.getSeverityForStatus(exception.getStatus()),
        component: "HttpException",
      },
      requestMetadata.correlationId
    );
  }

  private handleGenericError(error: Error, requestMetadata: StandardErrorMetadata): EnhancedErrorResponse {
    return createEnhancedErrorResponse(
      error,
      {
        ...requestMetadata,
        classification: this.classifyError(error),
        retryable: this.isErrorRetryable(error),
        severity: "high" as ErrorSeverity,
        component: "GenericError",
      },
      requestMetadata.correlationId
    );
  }

  private handleUnknownError(error: unknown, requestMetadata: StandardErrorMetadata): EnhancedErrorResponse {
    const errorMessage =
      typeof error === "string"
        ? error
        : error && typeof error === "object" && "message" in error
          ? String((error as { message: unknown }).message)
          : "Unknown error occurred";

    return createEnhancedErrorResponse(
      new Error(errorMessage),
      {
        ...requestMetadata,
        classification: StandardErrorClassification.UNKNOWN_ERROR,
        retryable: false,
        severity: "critical" as ErrorSeverity,
        component: "UnknownError",
        additionalContext: { originalError: error },
      },
      requestMetadata.correlationId
    );
  }

  private extractRequestMetadata(request: Request): StandardErrorMetadata {
    return {
      classification: StandardErrorClassification.UNKNOWN_ERROR,
      retryable: false,
      severity: "medium" as ErrorSeverity,
      component: "HttpFilter",
      correlationId: this.extractCorrelationId(request),
      traceId: this.extractTraceId(request),
      userId: this.extractUserId(request),
      sessionId: this.extractSessionId(request),
      clientId: this.extractClientId(request),
      userAgent: request.get("User-Agent"),
      ipAddress: this.extractClientIp(request),
      additionalContext: {
        method: request.method,
        url: request.url,
        path: request.path,
        query: request.query,
        headers: this.sanitizeHeaders(request.headers),
      },
    };
  }

  private extractCorrelationId(request: Request): string {
    return (
      request.get("X-Correlation-ID") ||
      request.get("X-Request-ID") ||
      request.get("Request-ID") ||
      this.generateRequestId()
    );
  }

  private extractTraceId(request: Request): string | undefined {
    return request.get("X-Trace-ID") || request.get("Trace-ID");
  }

  private extractUserId(request: Request): string | undefined {
    return request.get("X-User-ID") || (request as IExtendedRequest).user?.id;
  }

  private extractSessionId(request: Request): string | undefined {
    return request.get("X-Session-ID") || (request as IExtendedRequest).session?.id;
  }

  private extractClientId(request: Request): string | undefined {
    return request.get("X-Client-ID") || request.get("Client-ID");
  }

  private extractClientIp(request: Request): string {
    return (
      request.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
      request.get("X-Real-IP") ||
      request.connection.remoteAddress ||
      request.socket.remoteAddress ||
      "unknown"
    );
  }

  private sanitizeHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
    const sanitized: Record<string, string> = {};
    const sensitiveHeaders = ["authorization", "cookie", "x-api-key", "x-auth-token"];

    if (!headers || typeof headers !== "object") {
      return sanitized;
    }

    for (const [key, value] of Object.entries(headers)) {
      if (sensitiveHeaders.includes(key.toLowerCase())) {
        sanitized[key] = "[REDACTED]";
      } else {
        sanitized[key] = String(value);
      }
    }

    return sanitized;
  }

  private classifyHttpStatus(status: HttpStatus): StandardErrorClassification {
    if (status === HttpStatus.UNAUTHORIZED) {
      return StandardErrorClassification.AUTHENTICATION_ERROR;
    }
    if (status === HttpStatus.FORBIDDEN) {
      return StandardErrorClassification.AUTHORIZATION_ERROR;
    }
    if (status === HttpStatus.NOT_FOUND) {
      return StandardErrorClassification.NOT_FOUND_ERROR;
    }
    if (status === HttpStatus.BAD_REQUEST || status === HttpStatus.UNPROCESSABLE_ENTITY) {
      return StandardErrorClassification.VALIDATION_ERROR;
    }
    if (status === HttpStatus.TOO_MANY_REQUESTS) {
      return StandardErrorClassification.RATE_LIMIT_ERROR;
    }
    if (status === HttpStatus.REQUEST_TIMEOUT) {
      return StandardErrorClassification.TIMEOUT_ERROR;
    }
    if (status === HttpStatus.BAD_GATEWAY || status === HttpStatus.GATEWAY_TIMEOUT) {
      return StandardErrorClassification.EXTERNAL_SERVICE_ERROR;
    }
    if (status === HttpStatus.SERVICE_UNAVAILABLE) {
      return StandardErrorClassification.SERVICE_UNAVAILABLE_ERROR;
    }
    if (status >= 500) {
      return StandardErrorClassification.PROCESSING_ERROR;
    }

    return StandardErrorClassification.UNKNOWN_ERROR;
  }

  private classifyError(error: Error): StandardErrorClassification {
    const message = error.message.toLowerCase();

    if (message.includes("timeout")) {
      return StandardErrorClassification.TIMEOUT_ERROR;
    }
    if (message.includes("connection") || message.includes("network")) {
      return StandardErrorClassification.CONNECTION_ERROR;
    }
    if (message.includes("validation") || message.includes("invalid")) {
      return StandardErrorClassification.VALIDATION_ERROR;
    }
    if (message.includes("not found")) {
      return StandardErrorClassification.NOT_FOUND_ERROR;
    }
    if (message.includes("rate limit")) {
      return StandardErrorClassification.RATE_LIMIT_ERROR;
    }

    return StandardErrorClassification.PROCESSING_ERROR;
  }

  private getSeverityForStatus(status: HttpStatus): ErrorSeverity {
    if (status >= 500) {
      return "critical" as ErrorSeverity;
    }
    if (status >= 400) {
      return "medium" as ErrorSeverity;
    }
    return "low" as ErrorSeverity;
  }

  private isStatusRetryable(status: HttpStatus): boolean {
    const retryableStatuses = [
      HttpStatus.REQUEST_TIMEOUT,
      HttpStatus.TOO_MANY_REQUESTS,
      HttpStatus.INTERNAL_SERVER_ERROR,
      HttpStatus.BAD_GATEWAY,
      HttpStatus.SERVICE_UNAVAILABLE,
      HttpStatus.GATEWAY_TIMEOUT,
    ];

    return retryableStatuses.includes(status);
  }

  private isErrorRetryable(error: Error): boolean {
    const message = error.message.toLowerCase();
    const retryablePatterns = ["timeout", "connection", "network", "temporary", "rate limit", "service unavailable"];

    return retryablePatterns.some(pattern => message.includes(pattern));
  }

  private calculateRetryAfter(status: HttpStatus): number {
    switch (status) {
      case HttpStatus.TOO_MANY_REQUESTS:
        return 60000; // 1 minute
      case HttpStatus.SERVICE_UNAVAILABLE:
        return 30000; // 30 seconds
      case HttpStatus.BAD_GATEWAY:
      case HttpStatus.GATEWAY_TIMEOUT:
        return 15000; // 15 seconds
      default:
        return 5000; // 5 seconds
    }
  }

  private ensureStandardizedResponse(
    response: EnhancedErrorResponse,
    status: HttpStatus,
    request: Request
  ): EnhancedErrorResponse {
    return {
      ...response,
      timestamp: response.timestamp || Date.now(),
      requestId: response.requestId || this.generateRequestId(),
      error: {
        ...response.error,
        timestamp: response.error.timestamp || Date.now(),
        context: {
          ...response.error.context,
          httpStatus: status,
          path: request.path,
          method: request.method,
        },
      },
    };
  }

  private addSecurityHeaders(response: Response): void {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("X-XSS-Protection", "1; mode=block");
  }

  private isEnhancedErrorResponse(obj: unknown): obj is EnhancedErrorResponse {
    return (
      obj !== null &&
      typeof obj === "object" &&
      "success" in obj &&
      (obj as { success: boolean }).success === false &&
      "error" in obj &&
      "retryable" in obj
    );
  }

  private logError(
    exception: unknown,
    errorResponse: EnhancedErrorResponse,
    request: Request,
    status: HttpStatus
  ): void {
    const logLevel = status >= 500 ? "error" : status >= 400 ? "warn" : "log";
    const message = `${request.method} ${request.path} - ${status} - ${errorResponse.error.message}`;

    const logContext = {
      requestId: errorResponse.requestId,
      method: request.method,
      path: request.path,
      status,
      userAgent: request.get("User-Agent"),
      ip: this.extractClientIp(request),
      classification: errorResponse.error.context?.classification,
      retryable: errorResponse.retryable,
      severity: errorResponse.error.severity,
    };

    switch (logLevel) {
      case "error":
        this.logger.error(message, exception instanceof Error ? exception.stack : undefined, logContext);
        break;
      case "warn":
        this.logger.warn(message, logContext);
        break;
      default:
        this.logger.log(message, logContext);
    }
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
