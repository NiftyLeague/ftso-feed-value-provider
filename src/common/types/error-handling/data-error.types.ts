import { IErrorDetails, ErrorCode, ErrorSeverity } from "./error.types";

/**
 * Error specific to data operations
 */
export interface DataError extends IErrorDetails {
  /**
   * The type of data operation that failed
   */
  operation: string;

  /**
   * The entity or resource that was being accessed
   */
  resource?: string;

  /**
   * The ID of the entity that was being accessed (if applicable)
   */
  resourceId?: string | number;
}

/**
 * Creates a new DataError
 */
export function createDataError(
  message: string,
  operation: string,
  options: {
    code?: string | ErrorCode;
    severity?: ErrorSeverity;
    resource?: string;
    resourceId?: string | number;
    cause?: unknown;
    context?: Record<string, unknown>;
  } = {}
): DataError {
  return {
    code: options.code || ErrorCode.DATA_PROCESSING_ERROR,
    message,
    severity: options.severity || ErrorSeverity.HIGH,
    module: "data",
    operation,
    resource: options.resource,
    resourceId: options.resourceId,
    cause: options.cause,
    context: options.context,
    timestamp: Date.now(),
  };
}

/**
 * Type guard for DataError
 */
export function isDataError(error: unknown): error is DataError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    "severity" in error &&
    "operation" in error
  );
}

/**
 * Specific error for when data is not found
 */
export interface DataNotFoundError extends DataError {
  code: ErrorCode.DATA_NOT_FOUND;
  resource: string;
  resourceId?: string | number;
}

/**
 * Creates a new DataNotFoundError
 */
export function createDataNotFoundError(
  resource: string,
  options: {
    resourceId?: string | number;
    cause?: unknown;
    context?: Record<string, unknown>;
  } = {}
): DataNotFoundError {
  const resourceIdStr = options.resourceId ? ` with ID ${options.resourceId}` : "";
  const baseError = createDataError(`Could not find ${resource}${resourceIdStr}`, "read", {
    code: ErrorCode.DATA_NOT_FOUND,
    severity: ErrorSeverity.MEDIUM,
    resource,
    resourceId: options.resourceId,
    cause: options.cause,
    context: options.context,
  });

  return {
    ...baseError,
    code: ErrorCode.DATA_NOT_FOUND,
    resource,
    resourceId: options.resourceId,
  } as DataNotFoundError;
}

/**
 * Specific error for data validation failures
 */
export interface DataValidationError extends DataError {
  code: ErrorCode.DATA_VALIDATION_FAILED;
  validationErrors: string[];
}

/**
 * Creates a new DataValidationError
 */
export function createDataValidationError(
  message: string,
  operation: string,
  validationErrors: string[],
  options: {
    resource?: string;
    resourceId?: string | number;
    cause?: unknown;
    context?: Record<string, unknown>;
  } = {}
): DataValidationError {
  const baseError = createDataError(message, operation, {
    code: ErrorCode.DATA_VALIDATION_FAILED,
    severity: ErrorSeverity.MEDIUM,
    resource: options.resource,
    resourceId: options.resourceId,
    cause: options.cause,
    context: {
      ...options.context,
      validationErrors,
    },
  });

  return {
    ...baseError,
    code: ErrorCode.DATA_VALIDATION_FAILED,
    validationErrors,
  } as DataValidationError;
}
