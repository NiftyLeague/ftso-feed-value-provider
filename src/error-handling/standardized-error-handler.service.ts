import { Injectable, HttpException, HttpStatus } from "@nestjs/common";
import { EventDrivenService } from "@/common/base/composed.service";
import { CircuitBreakerService } from "./circuit-breaker.service";
import { UniversalRetryService } from "./universal-retry.service";
import { isRetryableError } from "@/common/utils/error.utils";
import {
  type IErrorDetails,
  type EnhancedErrorResponse,
  type StandardErrorClassification,
  type StandardErrorMetadata,
  type RetryConfig,
  ErrorSeverity,
} from "@/common/types/error-handling";
import {
  ErrorCode,
  createEnhancedErrorResponse,
  getRetryConfig,
  StandardErrorClassification as ErrorClass,
} from "@/common/types/error-handling";
import { ENV } from "@/config";

/**
 * Standardized error handler service that provides:
 * - Consistent error response formats across all controllers
 * - Retry mechanisms with exponential backoff
 * - Circuit breaker integration for external calls
 * - Comprehensive error logging and monitoring
 */
@Injectable()
export class StandardizedErrorHandlerService extends EventDrivenService {
  private readonly retryConfigs = new Map<string, RetryConfig>();
  private readonly errorStats = new Map<
    string,
    {
      totalErrors: number;
      errorsByType: Map<StandardErrorClassification, number>;
      lastError?: Date;
      consecutiveFailures: number;
    }
  >();

  constructor(
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly universalRetryService: UniversalRetryService
  ) {
    super({ serviceName: "StandardizedErrorHandlerService" });
    this.initializeDefaultConfigs();
  }

  /**
   * Execute operation with standardized error handling, retry, and circuit breaker
   */
  async executeWithStandardizedHandling<T>(
    operation: () => Promise<T>,
    context: {
      serviceId: string;
      operationName: string;
      component: string;
      requestId?: string;
      retryConfig?: Partial<RetryConfig>;
      metadata?: Partial<StandardErrorMetadata>;
    }
  ): Promise<T> {
    const { serviceId, operationName, component, requestId, retryConfig, metadata } = context;

    // Get or create retry configuration
    const config = this.getRetryConfig(serviceId, retryConfig);

    // Register circuit breaker if not exists
    if (!this.circuitBreaker.getState(serviceId)) {
      this.circuitBreaker.registerCircuit(serviceId, {
        failureThreshold: serviceId === "DataSourceIntegrationService" ? 20 : 5, // More lenient for data source integration
        recoveryTimeout: serviceId === "DataSourceIntegrationService" ? 30000 : 60000, // Faster recovery
        successThreshold: 3,
        timeout: config.maxDelayMs,
        monitoringWindow: 300000,
      });
    }

    const startTime = Date.now();
    let lastError: Error | undefined;

    try {
      // Execute with retry and circuit breaker
      const result = await this.universalRetryService.executeWithRetry(
        async () => {
          return await this.circuitBreaker.execute(serviceId, operation);
        },
        {
          serviceId,
          operationName: context.operationName,
          retryConfig: config,
        }
      );

      // Record successful operation
      this.recordSuccess(serviceId, operationName, Date.now() - startTime);

      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Record failure
      this.recordFailure(serviceId, operationName, lastError, Date.now() - startTime);

      // Create standardized error response
      const standardizedError = this.createStandardizedError(
        lastError,
        {
          component,
          operation: operationName,
          ...metadata,
        },
        requestId
      );

      throw standardizedError;
    }
  }

  /**
   * Create standardized HTTP exception from any error
   */
  createStandardizedError(
    error: Error | unknown,
    metadata: Partial<StandardErrorMetadata>,
    requestId?: string
  ): HttpException {
    const errorObj = error instanceof Error ? error : new Error(String(error));

    // Classify the error
    const classification = this.classifyError(errorObj);
    const severity = this.determineSeverity(classification, errorObj);
    const retryable = this.isErrorRetryable(errorObj, classification);

    // Create error details
    const errorDetails: IErrorDetails = {
      code: this.mapClassificationToCode(classification),
      message: errorObj.message,
      severity,
      module: metadata.component || "Unknown",
      timestamp: Date.now(),
      context: {
        classification,
        retryable,
        operation: metadata.operation,
        correlationId: metadata.correlationId,
        traceId: metadata.traceId,
        originalStack: errorObj.stack,
        ...metadata.additionalContext,
      },
      cause: errorObj,
    };

    // Create enhanced response
    const enhancedResponse = createEnhancedErrorResponse(
      errorDetails,
      {
        classification,
        retryable,
        severity,
        component: metadata.component || "Unknown",
        operation: metadata.operation,
        correlationId: metadata.correlationId,
        traceId: metadata.traceId,
      },
      requestId
    );

    // Add circuit breaker state if available
    const circuitState = this.circuitBreaker.getState(metadata.component || "default");
    if (circuitState) {
      enhancedResponse.circuitBreakerState = circuitState;
    }

    // Determine HTTP status code
    const statusCode = this.mapClassificationToHttpStatus(classification);

    // Log the error with comprehensive context
    this.logStandardizedError(errorObj, enhancedResponse, metadata);

    // Emit error event for monitoring
    this.emit("standardizedError", {
      error: errorObj,
      response: enhancedResponse,
      metadata,
      timestamp: Date.now(),
    });

    return new HttpException(enhancedResponse, statusCode);
  }

  /**
   * Handle validation errors with standardized format
   */
  handleValidationError(
    message: string,
    details?: Record<string, unknown>,
    requestId?: string,
    metadata?: Partial<StandardErrorMetadata>
  ): HttpException {
    return this.createStandardizedError(
      new Error(message),
      {
        classification: ErrorClass.VALIDATION_ERROR,
        retryable: false,
        severity: "medium" as ErrorSeverity,
        component: "Validation",
        additionalContext: details,
        ...metadata,
      },
      requestId
    );
  }

  /**
   * Handle authentication errors with standardized format
   */
  handleAuthenticationError(
    message: string = "Authentication failed",
    requestId?: string,
    metadata?: Partial<StandardErrorMetadata>
  ): HttpException {
    return this.createStandardizedError(
      new Error(message),
      {
        classification: ErrorClass.AUTHENTICATION_ERROR,
        retryable: false,
        severity: "high" as ErrorSeverity,
        component: "Authentication",
        ...metadata,
      },
      requestId
    );
  }

  /**
   * Handle rate limit errors with standardized format
   */
  handleRateLimitError(
    requestId?: string,
    retryAfter?: number,
    metadata?: Partial<StandardErrorMetadata>
  ): HttpException {
    const error = this.createStandardizedError(
      new Error("Rate limit exceeded"),
      {
        classification: ErrorClass.RATE_LIMIT_ERROR,
        retryable: true,
        severity: "medium" as ErrorSeverity,
        component: "RateLimit",
        ...metadata,
      },
      requestId
    );

    // Add retry-after header information
    const response = error.getResponse() as EnhancedErrorResponse;
    response.retryAfter = retryAfter || 60000; // Default 1 minute

    return error;
  }

  /**
   * Handle external service errors with standardized format
   */
  handleExternalServiceError(
    serviceName: string,
    originalError: Error,
    requestId?: string,
    metadata?: Partial<StandardErrorMetadata>
  ): HttpException {
    return this.createStandardizedError(
      originalError,
      {
        classification: ErrorClass.EXTERNAL_SERVICE_ERROR,
        retryable: this.isErrorRetryable(originalError),
        severity: "high" as ErrorSeverity,
        component: `ExternalService:${serviceName}`,
        additionalContext: {
          serviceName,
          originalMessage: originalError.message,
        },
        ...metadata,
      },
      requestId
    );
  }

  /**
   * Get error statistics for monitoring
   */
  getErrorStatistics(): Record<
    string,
    {
      totalErrors: number;
      errorsByType: Record<string, number>;
      lastError?: string;
      consecutiveFailures: number;
    }
  > {
    const stats: Record<
      string,
      {
        totalErrors: number;
        errorsByType: Record<string, number>;
        lastError?: string;
        consecutiveFailures: number;
      }
    > = {};

    for (const [serviceId, serviceStats] of this.errorStats.entries()) {
      stats[serviceId] = {
        totalErrors: serviceStats.totalErrors,
        errorsByType: Object.fromEntries(serviceStats.errorsByType.entries()),
        lastError: serviceStats.lastError?.toISOString(),
        consecutiveFailures: serviceStats.consecutiveFailures,
      };
    }

    return stats;
  }

  /**
   * Reset error statistics for a service
   */
  resetErrorStatistics(serviceId: string): void {
    this.errorStats.delete(serviceId);
    this.logger.log(`Reset error statistics for service: ${serviceId}`);
  }

  /**
   * Configure retry settings for a specific service
   */
  configureRetrySettings(serviceId: string, config: Partial<RetryConfig>): void {
    const currentConfig =
      this.retryConfigs.get(serviceId) ||
      getRetryConfig({
        maxRetries: ENV.RETRY.DEFAULT_MAX_RETRIES,
        initialDelayMs: ENV.RETRY.DEFAULT_INITIAL_DELAY_MS,
      });
    this.retryConfigs.set(serviceId, { ...currentConfig, ...config });

    this.logger.log(`Updated retry configuration for service: ${serviceId}`, {
      serviceId,
      config: { ...currentConfig, ...config },
    });
  }

  // Private helper methods

  private initializeDefaultConfigs(): void {
    // Set default configurations for common services
    const commonServices = [
      "FeedController",
      "HealthController",
      "MetricsController",
      "ExchangeAdapter",
      "AggregationService",
      "CacheService",
    ];

    commonServices.forEach(serviceId => {
      this.retryConfigs.set(
        serviceId,
        getRetryConfig({
          maxRetries: ENV.RETRY.DEFAULT_MAX_RETRIES,
          initialDelayMs: ENV.RETRY.DEFAULT_INITIAL_DELAY_MS,
        })
      );
    });
  }

  private getRetryConfig(serviceId: string, override?: Partial<RetryConfig>): RetryConfig {
    const baseConfig =
      this.retryConfigs.get(serviceId) ||
      getRetryConfig({
        maxRetries: ENV.RETRY.DEFAULT_MAX_RETRIES,
        initialDelayMs: ENV.RETRY.DEFAULT_INITIAL_DELAY_MS,
      });
    return override ? { ...baseConfig, ...override } : baseConfig;
  }

  private classifyError(error: Error): StandardErrorClassification {
    const message = error.message.toLowerCase();
    const name = error.name.toLowerCase();

    // Authentication/Authorization errors
    if (message.includes("unauthorized") || message.includes("authentication") || name.includes("auth")) {
      return ErrorClass.AUTHENTICATION_ERROR;
    }
    if (message.includes("forbidden") || message.includes("access denied")) {
      return ErrorClass.AUTHORIZATION_ERROR;
    }

    // Network and connection errors
    if (message.includes("timeout") || message.includes("timed out") || name.includes("timeout")) {
      return ErrorClass.TIMEOUT_ERROR;
    }
    if (message.includes("connection") || message.includes("network") || message.includes("econnrefused")) {
      return ErrorClass.CONNECTION_ERROR;
    }

    // Rate limiting
    if (message.includes("rate limit") || message.includes("too many requests")) {
      return ErrorClass.RATE_LIMIT_ERROR;
    }

    // Service availability
    if (message.includes("service unavailable") || message.includes("temporarily unavailable")) {
      return ErrorClass.SERVICE_UNAVAILABLE_ERROR;
    }

    // Validation errors
    if (message.includes("validation") || message.includes("invalid") || name.includes("validation")) {
      return ErrorClass.VALIDATION_ERROR;
    }

    // Not found errors
    if (message.includes("not found") || name.includes("notfound")) {
      return ErrorClass.NOT_FOUND_ERROR;
    }

    // Data errors
    if (message.includes("data") && (message.includes("corrupt") || message.includes("invalid"))) {
      return ErrorClass.DATA_ERROR;
    }

    // Configuration errors
    if (message.includes("config") || message.includes("configuration")) {
      return ErrorClass.CONFIGURATION_ERROR;
    }

    // Circuit breaker errors
    if (message.includes("circuit") && message.includes("open")) {
      return ErrorClass.CIRCUIT_BREAKER_ERROR;
    }

    // Processing errors
    if (message.includes("processing") || message.includes("calculation") || message.includes("aggregation")) {
      return ErrorClass.PROCESSING_ERROR;
    }

    // External service errors
    if (message.includes("external") || message.includes("upstream") || message.includes("adapter")) {
      return ErrorClass.EXTERNAL_SERVICE_ERROR;
    }

    return ErrorClass.UNKNOWN_ERROR;
  }

  private determineSeverity(classification: StandardErrorClassification, _error: Error): ErrorSeverity {
    // Critical errors
    if (
      [ErrorClass.AUTHENTICATION_ERROR, ErrorClass.CONFIGURATION_ERROR, ErrorClass.DATA_ERROR].includes(classification)
    ) {
      return ErrorSeverity.CRITICAL;
    }

    // High severity errors
    if (
      [
        ErrorClass.EXTERNAL_SERVICE_ERROR,
        ErrorClass.SERVICE_UNAVAILABLE_ERROR,
        ErrorClass.CIRCUIT_BREAKER_ERROR,
      ].includes(classification)
    ) {
      return ErrorSeverity.HIGH;
    }

    // Medium severity errors
    if (
      [
        ErrorClass.TIMEOUT_ERROR,
        ErrorClass.CONNECTION_ERROR,
        ErrorClass.RATE_LIMIT_ERROR,
        ErrorClass.PROCESSING_ERROR,
      ].includes(classification)
    ) {
      return ErrorSeverity.MEDIUM;
    }

    // Low severity errors
    if (
      [ErrorClass.VALIDATION_ERROR, ErrorClass.NOT_FOUND_ERROR, ErrorClass.AUTHORIZATION_ERROR].includes(classification)
    ) {
      return ErrorSeverity.LOW;
    }

    return ErrorSeverity.MEDIUM;
  }

  private isErrorRetryable(error: Error, classification?: StandardErrorClassification): boolean {
    // Non-retryable classifications
    const nonRetryableClassifications = [
      ErrorClass.AUTHENTICATION_ERROR,
      ErrorClass.AUTHORIZATION_ERROR,
      ErrorClass.VALIDATION_ERROR,
      ErrorClass.NOT_FOUND_ERROR,
      ErrorClass.CONFIGURATION_ERROR,
    ];

    if (classification && nonRetryableClassifications.includes(classification)) {
      return false;
    }

    // Use existing retry logic
    return isRetryableError(error);
  }

  private mapClassificationToCode(classification: StandardErrorClassification): ErrorCode {
    const mapping: Record<StandardErrorClassification, ErrorCode> = {
      [ErrorClass.VALIDATION_ERROR]: ErrorCode.VALIDATION_ERROR,
      [ErrorClass.AUTHENTICATION_ERROR]: ErrorCode.UNAUTHORIZED,
      [ErrorClass.AUTHORIZATION_ERROR]: ErrorCode.FORBIDDEN,
      [ErrorClass.NOT_FOUND_ERROR]: ErrorCode.DATA_NOT_FOUND,
      [ErrorClass.RATE_LIMIT_ERROR]: ErrorCode.RATE_LIMIT_EXCEEDED,
      [ErrorClass.TIMEOUT_ERROR]: ErrorCode.TIMEOUT_ERROR,
      [ErrorClass.CONNECTION_ERROR]: ErrorCode.CONNECTION_ERROR,
      [ErrorClass.SERVICE_UNAVAILABLE_ERROR]: ErrorCode.SERVICE_UNAVAILABLE,
      [ErrorClass.DATA_ERROR]: ErrorCode.DATA_VALIDATION_FAILED,
      [ErrorClass.PROCESSING_ERROR]: ErrorCode.DATA_PROCESSING_ERROR,
      [ErrorClass.CONFIGURATION_ERROR]: ErrorCode.CONFIGURATION_ERROR,
      [ErrorClass.EXTERNAL_SERVICE_ERROR]: ErrorCode.SERVICE_TIMEOUT,
      [ErrorClass.CIRCUIT_BREAKER_ERROR]: ErrorCode.SERVICE_UNAVAILABLE,
      [ErrorClass.UNKNOWN_ERROR]: ErrorCode.UNKNOWN_ERROR,
    };

    return mapping[classification] || ErrorCode.UNKNOWN_ERROR;
  }

  private mapClassificationToHttpStatus(classification: StandardErrorClassification): HttpStatus {
    const mapping: Record<StandardErrorClassification, HttpStatus> = {
      [ErrorClass.VALIDATION_ERROR]: HttpStatus.BAD_REQUEST,
      [ErrorClass.AUTHENTICATION_ERROR]: HttpStatus.UNAUTHORIZED,
      [ErrorClass.AUTHORIZATION_ERROR]: HttpStatus.FORBIDDEN,
      [ErrorClass.NOT_FOUND_ERROR]: HttpStatus.NOT_FOUND,
      [ErrorClass.RATE_LIMIT_ERROR]: HttpStatus.TOO_MANY_REQUESTS,
      [ErrorClass.TIMEOUT_ERROR]: HttpStatus.REQUEST_TIMEOUT,
      [ErrorClass.CONNECTION_ERROR]: HttpStatus.BAD_GATEWAY,
      [ErrorClass.SERVICE_UNAVAILABLE_ERROR]: HttpStatus.SERVICE_UNAVAILABLE,
      [ErrorClass.DATA_ERROR]: HttpStatus.UNPROCESSABLE_ENTITY,
      [ErrorClass.PROCESSING_ERROR]: HttpStatus.INTERNAL_SERVER_ERROR,
      [ErrorClass.CONFIGURATION_ERROR]: HttpStatus.INTERNAL_SERVER_ERROR,
      [ErrorClass.EXTERNAL_SERVICE_ERROR]: HttpStatus.BAD_GATEWAY,
      [ErrorClass.CIRCUIT_BREAKER_ERROR]: HttpStatus.SERVICE_UNAVAILABLE,
      [ErrorClass.UNKNOWN_ERROR]: HttpStatus.INTERNAL_SERVER_ERROR,
    };

    return mapping[classification] || HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private recordSuccess(serviceId: string, operationName: string, responseTime: number): void {
    const stats = this.errorStats.get(serviceId);
    if (stats) {
      stats.consecutiveFailures = 0;
    }

    this.enhancedLogger?.log(`Operation succeeded: ${operationName}`, {
      component: "StandardizedErrorHandler",
      operation: "record_success",
      serviceId,
      operationName,
      responseTime,
    });
  }

  private recordFailure(serviceId: string, operationName: string, error: Error, responseTime: number): void {
    let stats = this.errorStats.get(serviceId);
    if (!stats) {
      stats = {
        totalErrors: 0,
        errorsByType: new Map(),
        consecutiveFailures: 0,
      };
      this.errorStats.set(serviceId, stats);
    }

    const classification = this.classifyError(error);

    stats.totalErrors++;
    stats.consecutiveFailures++;
    stats.lastError = new Date();
    stats.errorsByType.set(classification, (stats.errorsByType.get(classification) || 0) + 1);

    this.enhancedLogger?.error(error, {
      component: "StandardizedErrorHandler",
      operation: "record_failure",
      serviceId,
      operationName,
      responseTime,
      classification,
      consecutiveFailures: stats.consecutiveFailures,
      severity: "high",
    });
  }

  private logStandardizedError(
    error: Error,
    response: EnhancedErrorResponse,
    metadata: Partial<StandardErrorMetadata>
  ): void {
    const logLevel = this.getLogLevelForSeverity(response.error.severity);

    const logData = {
      component: metadata.component || "Unknown",
      operation: metadata.operation || "unknown",
      severity: response.error.severity,
      classification: metadata.classification,
      retryable: response.retryable,
      requestId: response.requestId,
      correlationId: metadata.correlationId,
      traceId: metadata.traceId,
      circuitBreakerState: response.circuitBreakerState,
      metadata: {
        errorCode: response.error.code,
        timestamp: response.error.timestamp,
        retryAfter: response.retryAfter,
        additionalContext: metadata.additionalContext,
      },
    };

    switch (logLevel) {
      case "error":
        this.enhancedLogger?.error(error, logData);
        break;
      case "warn":
        this.enhancedLogger?.warn(error.message, logData);
        break;
      case "log":
        this.enhancedLogger?.log(error.message, logData);
        break;
      default:
        this.enhancedLogger?.error(error, logData);
    }
  }

  private getLogLevelForSeverity(severity: ErrorSeverity): "error" | "warn" | "log" {
    switch (severity) {
      case "critical":
      case "high":
        return "error";
      case "medium":
        return "warn";
      case "low":
        return "log";
      default:
        return "error";
    }
  }
}
