import { IErrorDetails, ErrorCode, ErrorSeverity } from "./error.types";

/**
 * Enum for validation error types.
 */
export enum ValidationErrorType {
  STALE_DATA = "STALE_DATA",
  PRICE_OUT_OF_RANGE = "PRICE_OUT_OF_RANGE",
  MISSING_REQUIRED_FIELD = "MISSING_REQUIRED_FIELD",
  INVALID_FORMAT = "INVALID_FORMAT",
  // Additional error types used by validators
  FORMAT_ERROR = "FORMAT_ERROR",
  OUTLIER_ERROR = "OUTLIER_ERROR",
  CROSS_SOURCE_ERROR = "CROSS_SOURCE_ERROR",
  CONSENSUS_ERROR = "CONSENSUS_ERROR",
  CONSENSUS_DEVIATION = "CONSENSUS_DEVIATION",
  SOURCE_UNRELIABLE = "SOURCE_UNRELIABLE",
}

/**
 * Error specific to validation operations
 */
export interface ValidationError extends IErrorDetails {
  /**
   * High-level validation type/category (e.g., OUTLIER_ERROR)
   */
  type?: ValidationErrorType;

  /**
   * Simple field name for the error location (when a full path isn't needed)
   */
  field?: string;
  /**
   * The path to the field that failed validation (e.g., 'user.email')
   */
  path?: string;

  /**
   * The value that failed validation
   */
  value?: unknown;

  /**
   * The validation rule that was violated
   */
  rule?: string;

  /**
   * Additional validation errors (for nested validations)
   */
  errors?: ValidationError[];
}

/**
 * Creates a new ValidationError
 */
export function createValidationError(
  message: string,
  options: {
    code?: string | ErrorCode;
    severity?: ErrorSeverity;
    type?: ValidationErrorType;
    field?: string;
    path?: string;
    value?: unknown;
    rule?: string;
    errors?: ValidationError[];
    cause?: unknown;
    context?: Record<string, unknown>;
  } = {}
): ValidationError {
  return {
    code: options.code || ErrorCode.VALIDATION_ERROR,
    message,
    severity: options.severity || ErrorSeverity.MEDIUM,
    module: "validation",
    type: options.type,
    field: options.field,
    path: options.path,
    value: options.value,
    rule: options.rule,
    errors: options.errors,
    cause: options.cause,
    context: options.context,
    timestamp: Date.now(),
  };
}

/**
 * Type guard for ValidationError
 */
export function isValidationError(error: unknown): error is ValidationError {
  return typeof error === "object" && error !== null && "code" in error && "message" in error && "severity" in error;
}

/**
 * Specific error for schema validation failures
 */
export interface SchemaValidationError extends ValidationError {
  code: ErrorCode.VALIDATION_SCHEMA_ERROR;
  schema: string | object;
  errors: ValidationError[];
}

/**
 * Creates a new SchemaValidationError
 */
export function createSchemaValidationError(
  message: string,
  schema: string | object,
  errors: ValidationError[],
  options: {
    path?: string;
    cause?: unknown;
    context?: Record<string, unknown>;
  } = {}
): SchemaValidationError {
  const baseError = createValidationError(message, {
    code: ErrorCode.VALIDATION_SCHEMA_ERROR,
    severity: ErrorSeverity.HIGH,
    path: options.path,
    errors,
    cause: options.cause,
    context: options.context,
  });

  return {
    ...baseError,
    code: ErrorCode.VALIDATION_SCHEMA_ERROR,
    schema,
  } as SchemaValidationError;
}

/**
 * Specific error for rule validation failures
 */
export interface RuleValidationError extends ValidationError {
  code: ErrorCode.VALIDATION_RULE_ERROR;
  rule: string;
  expected?: unknown;
  received: unknown;
}

/**
 * Creates a new RuleValidationError
 */
export function createRuleValidationError(
  message: string,
  rule: string,
  received: unknown,
  options: {
    path?: string;
    expected?: unknown;
    cause?: unknown;
    context?: Record<string, unknown>;
  } = {}
): RuleValidationError {
  const baseError = createValidationError(message, {
    code: ErrorCode.VALIDATION_RULE_ERROR,
    severity: ErrorSeverity.MEDIUM,
    path: options.path,
    rule,
    value: received,
    cause: options.cause,
    context: options.context,
  });

  return {
    ...baseError,
    code: ErrorCode.VALIDATION_RULE_ERROR,
    rule,
    expected: options.expected,
    received,
  } as RuleValidationError;
}
