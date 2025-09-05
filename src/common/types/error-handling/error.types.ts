import { IContext } from "../logging/logging.types";

/**
 * Defines the severity levels for errors, allowing for prioritized handling.
 */
export enum ErrorSeverity {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
  CRITICAL = "critical",
  ERROR = "error", // For backward compatibility
}

/**
 * Common error codes used across the application
 */
export enum ErrorCode {
  // Generic errors (1-99)
  UNKNOWN_ERROR = "UNKNOWN_ERROR",
  VALIDATION_ERROR = "VALIDATION_ERROR",
  CONFIGURATION_ERROR = "CONFIGURATION_ERROR",

  // Data errors (100-199)
  DATA_NOT_FOUND = "DATA_NOT_FOUND",
  DATA_VALIDATION_FAILED = "DATA_VALIDATION_FAILED",
  DATA_PROCESSING_ERROR = "DATA_PROCESSING_ERROR",

  // Network/IO errors (200-299)
  NETWORK_ERROR = "NETWORK_ERROR",
  TIMEOUT_ERROR = "TIMEOUT_ERROR",
  RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED",

  // Authentication/Authorization (300-399)
  UNAUTHORIZED = "UNAUTHORIZED",
  FORBIDDEN = "FORBIDDEN",
  INVALID_CREDENTIALS = "INVALID_CREDENTIALS",

  // Service errors (400-499)
  SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE",
  SERVICE_TIMEOUT = "SERVICE_TIMEOUT",

  // Adapter specific (1000-1999)
  ADAPTER_CONNECTION_ERROR = "ADAPTER_CONNECTION_ERROR",
  ADAPTER_VALIDATION_ERROR = "ADAPTER_VALIDATION_ERROR",
  ADAPTER_PROCESSING_ERROR = "ADAPTER_PROCESSING_ERROR",

  // Data manager specific (2000-2999)
  DATA_MANAGER_ERROR = "DATA_MANAGER_ERROR",
  DATA_SOURCE_ERROR = "DATA_SOURCE_ERROR",

  // Validation specific (3000-3999)
  VALIDATION_RULE_ERROR = "VALIDATION_RULE_ERROR",
  VALIDATION_SCHEMA_ERROR = "VALIDATION_SCHEMA_ERROR",
}

/**
 * Base interface for all error details.
 * All error types should extend this interface.
 */
export interface IErrorDetails {
  /**
   * Machine-readable error code
   */
  code: string | ErrorCode;

  /**
   * Human-readable error message
   */
  message: string;

  /**
   * Severity level of the error
   */
  severity: ErrorSeverity;

  /**
   * Optional module name where the error originated
   */
  module?: string;

  /**
   * Optional timestamp when the error occurred
   */
  timestamp?: number;

  /**
   * Optional additional context about the error
   */
  context?: Record<string, unknown>;

  /**
   * Optional error cause (for error chaining)
   */
  cause?: unknown;
}

/**
 * Standardized error response for APIs.
 */
export interface StandardErrorResponse {
  success: false;
  error: IErrorDetails;
  timestamp: number;
  requestId?: string;
}

/**
 * Extended error response for HTTP-specific errors.
 */
export interface HttpErrorResponse extends StandardErrorResponse {
  statusCode: number;
  path: string;
  method: string;
}

/**
 * Provides context for where and how an error occurred.
 */
export interface ErrorContext extends IContext {
  requestId?: string;
  [key: string]: unknown;
}

/**
 * Type guard to check if an object is a StandardErrorResponse
 */
export function isStandardErrorResponse(obj: unknown): obj is StandardErrorResponse {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "success" in obj &&
    (obj as { success: boolean }).success === false &&
    "error" in obj &&
    typeof (obj as { error: unknown }).error === "object" &&
    (obj as StandardErrorResponse).error !== null
  );
}

/**
 * Type guard to check if an object is an HttpErrorResponse
 */
export function isHttpErrorResponse(obj: unknown): obj is HttpErrorResponse {
  return (
    isStandardErrorResponse(obj) &&
    "statusCode" in obj &&
    typeof (obj as { statusCode: unknown }).statusCode === "number"
  );
}

/**
 * Creates a standardized error object
 */
export function createError(
  code: string | ErrorCode,
  message: string,
  severity: ErrorSeverity = ErrorSeverity.HIGH,
  options: {
    module?: string;
    context?: Record<string, unknown>;
    cause?: unknown;
  } = {}
): IErrorDetails {
  return {
    code,
    message,
    severity,
    timestamp: Date.now(),
    ...options,
  };
}

/**
 * Creates a standardized error response
 */
export function createErrorResponse(error: IErrorDetails | Error, requestId?: string): StandardErrorResponse {
  const errorDetails: IErrorDetails =
    error instanceof Error
      ? {
          code: ErrorCode.UNKNOWN_ERROR,
          message: error.message,
          severity: ErrorSeverity.HIGH,
          cause: error,
        }
      : error;

  return {
    success: false,
    error: {
      ...errorDetails,
      timestamp: errorDetails.timestamp || Date.now(),
    },
    timestamp: Date.now(),
    requestId,
  };
}

/**
 * Creates an HTTP error response
 */
export function createHttpErrorResponse(
  statusCode: number,
  error: IErrorDetails | Error,
  requestId?: string,
  path = "/",
  method = "GET"
): HttpErrorResponse {
  const response = createErrorResponse(error, requestId) as HttpErrorResponse;
  response.statusCode = statusCode;
  response.path = path;
  response.method = method;
  return response;
}

/**
 * Retry configuration interface
 */
export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitter: boolean;
  retryableErrors: string[];
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitter: true,
  retryableErrors: [
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
    "socket hang up",
    "connect timeout",
  ],
};

/**
 * Enhanced error response with retry information
 */
export interface EnhancedErrorResponse extends StandardErrorResponse {
  retryable: boolean;
  retryAfter?: number;
  circuitBreakerState?: string;
  failureCount?: number;
}

/**
 * Error classification for standardized handling
 */
export enum StandardErrorClassification {
  VALIDATION_ERROR = "VALIDATION_ERROR",
  AUTHENTICATION_ERROR = "AUTHENTICATION_ERROR",
  AUTHORIZATION_ERROR = "AUTHORIZATION_ERROR",
  NOT_FOUND_ERROR = "NOT_FOUND_ERROR",
  RATE_LIMIT_ERROR = "RATE_LIMIT_ERROR",
  TIMEOUT_ERROR = "TIMEOUT_ERROR",
  CONNECTION_ERROR = "CONNECTION_ERROR",
  SERVICE_UNAVAILABLE_ERROR = "SERVICE_UNAVAILABLE_ERROR",
  DATA_ERROR = "DATA_ERROR",
  PROCESSING_ERROR = "PROCESSING_ERROR",
  CONFIGURATION_ERROR = "CONFIGURATION_ERROR",
  EXTERNAL_SERVICE_ERROR = "EXTERNAL_SERVICE_ERROR",
  CIRCUIT_BREAKER_ERROR = "CIRCUIT_BREAKER_ERROR",
  UNKNOWN_ERROR = "UNKNOWN_ERROR",
}

/**
 * Standardized error metadata
 */
export interface StandardErrorMetadata {
  classification: StandardErrorClassification;
  retryable: boolean;
  severity: ErrorSeverity;
  component: string;
  operation?: string;
  correlationId?: string;
  traceId?: string;
  userId?: string;
  sessionId?: string;
  clientId?: string;
  userAgent?: string;
  ipAddress?: string;
  additionalContext?: Record<string, unknown>;
}

/**
 * Creates enhanced error response with retry information
 */
export function createEnhancedErrorResponse(
  error: IErrorDetails | Error,
  metadata: Partial<StandardErrorMetadata>,
  requestId?: string
): EnhancedErrorResponse {
  const baseResponse = createErrorResponse(error, requestId);

  return {
    ...baseResponse,
    retryable: metadata.retryable ?? false,
    retryAfter: metadata.retryable ? calculateRetryAfter(metadata.severity) : undefined,
    circuitBreakerState: undefined, // Will be set by circuit breaker service
    failureCount: undefined, // Will be set by retry mechanism
  };
}

/**
 * Calculate retry after time based on error severity
 */
function calculateRetryAfter(severity?: ErrorSeverity): number {
  switch (severity) {
    case ErrorSeverity.LOW:
      return 1000; // 1 second
    case ErrorSeverity.MEDIUM:
      return 5000; // 5 seconds
    case ErrorSeverity.HIGH:
      return 15000; // 15 seconds
    case ErrorSeverity.CRITICAL:
      return 60000; // 1 minute
    default:
      return 5000; // Default 5 seconds
  }
}
