import { IErrorDetails, ErrorCode, ErrorSeverity } from "./error.types";

/**
 * Error specific to adapter operations
 *
 * @property {string} source - The source of the error (e.g., 'binance', 'coinbase')
 * @property {boolean} recoverable - Whether the error is recoverable
 * @property {"websocket" | "rest"} [connectionType] - The type of connection that failed
 * @property {string} [endpoint] - The endpoint that was being accessed
 */
export interface AdapterError extends IErrorDetails {
  /** Timestamp when the error occurred */
  timestamp: number;
  /**
   * The source of the error (e.g., 'binance', 'coinbase')
   */
  source: string;

  /**
   * Whether the error is recoverable
   */
  recoverable: boolean;

  /**
   * The type of connection that failed (if applicable)
   */
  connectionType?: "websocket" | "rest";

  /**
   * The endpoint that was being accessed (if applicable)
   */
  endpoint?: string;
}

/**
 * Creates a new AdapterError
 */
export function createAdapterError(
  message: string,
  source: string,
  options: {
    code?: string | ErrorCode;
    severity?: ErrorSeverity;
    recoverable?: boolean;
    connectionType?: "websocket" | "rest";
    endpoint?: string;
    cause?: unknown;
    context?: Record<string, unknown>;
  } = {}
): AdapterError {
  return {
    code: options.code || ErrorCode.ADAPTER_PROCESSING_ERROR,
    message,
    severity: options.severity || ErrorSeverity.HIGH,
    module: "adapter",
    source,
    timestamp: Date.now(),
    recoverable: options.recoverable ?? true,
    connectionType: options.connectionType,
    endpoint: options.endpoint,
    cause: options.cause,
    context: options.context,
  };
}

/**
 * Type guard for AdapterError
 */
export function isAdapterError(error: unknown): error is AdapterError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    "severity" in error &&
    "source" in error &&
    "recoverable" in error
  );
}

/**
 * Specific error for adapter connection failures
 */
export interface AdapterConnectionError extends AdapterError {
  code: ErrorCode.ADAPTER_CONNECTION_ERROR;
  connectionType: "websocket" | "rest";
  endpoint: string;
  retryable: boolean;
}

/**
 * Creates a new AdapterConnectionError
 */
export function createAdapterConnectionError(
  message: string,
  source: string,
  connectionType: "websocket" | "rest",
  endpoint: string,
  options: {
    retryable?: boolean;
    cause?: unknown;
    context?: Record<string, unknown>;
  } = {}
): AdapterConnectionError {
  const cause = options.cause;
  const errorDetails: IErrorDetails =
    cause instanceof Error
      ? {
          code: ErrorCode.UNKNOWN_ERROR,
          message: cause.message,
          severity: ErrorSeverity.HIGH,
          cause,
          timestamp: Date.now(),
        }
      : cause
        ? {
            code: ErrorCode.UNKNOWN_ERROR,
            message: "Unknown error occurred",
            severity: ErrorSeverity.HIGH,
            cause,
            timestamp: Date.now(),
          }
        : {
            code: ErrorCode.UNKNOWN_ERROR,
            message: "Unknown error occurred",
            severity: ErrorSeverity.HIGH,
            timestamp: Date.now(),
          };

  const baseError = createAdapterError(message, source, {
    code: ErrorCode.ADAPTER_CONNECTION_ERROR,
    severity: ErrorSeverity.HIGH,
    recoverable: options.retryable ?? true,
    connectionType,
    endpoint,
    cause: errorDetails,
    context: options.context,
  });

  return {
    ...baseError,
    code: ErrorCode.ADAPTER_CONNECTION_ERROR,
    connectionType,
    endpoint,
    retryable: options.retryable ?? true,
  } as AdapterConnectionError;
}

/**
 * Specific error for adapter data validation failures
 */
export interface AdapterDataError extends AdapterError {
  code: ErrorCode.ADAPTER_VALIDATION_ERROR;
  symbol: string;
  rawData: unknown;
  validationErrors: string[];
}

/**
 * Creates a new AdapterDataError
 */
export function createAdapterDataError(
  message: string,
  source: string,
  symbol: string,
  rawData: unknown,
  validationErrors: string[] = [],
  options: {
    cause?: unknown;
    context?: Record<string, unknown>;
  } = {}
): AdapterDataError {
  const baseError = createAdapterError(message, source, {
    code: ErrorCode.ADAPTER_VALIDATION_ERROR,
    severity: ErrorSeverity.MEDIUM,
    recoverable: true,
    cause: options.cause,
    context: {
      ...options.context,
      symbol,
      validationErrors,
    },
  });

  return {
    ...baseError,
    code: ErrorCode.ADAPTER_VALIDATION_ERROR,
    symbol,
    rawData,
    validationErrors,
  } as AdapterDataError;
}
