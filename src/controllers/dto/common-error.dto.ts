import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsNumber, IsOptional, IsEnum, IsObject } from "class-validator";

export enum ErrorSeverityDto {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
  CRITICAL = "critical",
}

export enum ErrorCodeDto {
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
  CONNECTION_ERROR = "CONNECTION_ERROR",
  TIMEOUT_ERROR = "TIMEOUT_ERROR",
  RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED",

  // Authentication/Authorization (300-399)
  UNAUTHORIZED = "UNAUTHORIZED",
  FORBIDDEN = "FORBIDDEN",
  INVALID_CREDENTIALS = "INVALID_CREDENTIALS",

  // Service errors (400-499)
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

  // API specific errors
  INVALID_FEED_REQUEST = "INVALID_FEED_REQUEST",
  INVALID_FEED_CATEGORY = "INVALID_FEED_CATEGORY",
  INVALID_FEED_NAME = "INVALID_FEED_NAME",
  INVALID_VOTING_ROUND = "INVALID_VOTING_ROUND",
  INVALID_TIME_WINDOW = "INVALID_TIME_WINDOW",
  FEED_NOT_FOUND = "FEED_NOT_FOUND",
  INTERNAL_ERROR = "INTERNAL_ERROR",
  DATA_SOURCE_UNAVAILABLE = "DATA_SOURCE_UNAVAILABLE",
  AGGREGATION_FAILED = "AGGREGATION_FAILED",
  CACHE_ERROR = "CACHE_ERROR",
}

export class ErrorContextDto {
  @ApiProperty({
    description: "Error classification",
    example: "validation",
    required: false,
  })
  @IsOptional()
  @IsString()
  classification?: string;

  @ApiProperty({
    description: "Whether the error is retryable",
    example: true,
    required: false,
  })
  @IsOptional()
  retryable?: boolean;

  @ApiProperty({
    description: "Operation that caused the error",
    example: "getCurrentFeedValues",
    required: false,
  })
  @IsOptional()
  @IsString()
  operation?: string;

  @ApiProperty({
    description: "Correlation ID for tracing",
    example: "corr_1703123456789",
    required: false,
  })
  @IsOptional()
  @IsString()
  correlationId?: string;

  @ApiProperty({
    description: "Trace ID for distributed tracing",
    example: "trace_1703123456789",
    required: false,
  })
  @IsOptional()
  @IsString()
  traceId?: string;

  @ApiProperty({
    description: "Additional context information",
    additionalProperties: true,
    required: false,
  })
  @IsOptional()
  @IsObject()
  additionalContext?: Record<string, unknown>;
}

export class ErrorDetailsDto {
  @ApiProperty({
    description: "Error code",
    enum: ErrorCodeDto,
    example: ErrorCodeDto.VALIDATION_ERROR,
  })
  @IsEnum(ErrorCodeDto)
  code!: ErrorCodeDto;

  @ApiProperty({
    description: "Human-readable error message",
    example: "Invalid feed request: missing required fields",
  })
  @IsString()
  message!: string;

  @ApiProperty({
    description: "Error severity level",
    enum: ErrorSeverityDto,
    example: ErrorSeverityDto.MEDIUM,
  })
  @IsEnum(ErrorSeverityDto)
  severity!: ErrorSeverityDto;

  @ApiProperty({
    description: "Module or component where the error occurred",
    example: "FeedController",
  })
  @IsString()
  module!: string;

  @ApiProperty({
    description: "Error timestamp",
    example: 1703123456789,
  })
  @IsNumber()
  timestamp!: number;

  @ApiProperty({
    description: "Additional error context",
    type: ErrorContextDto,
    required: false,
  })
  @IsOptional()
  context?: ErrorContextDto;

  @ApiProperty({
    description: "High-level error cause (sanitized for external consumption)",
    example: "Validation failed",
    required: false,
  })
  @IsOptional()
  @IsString()
  cause?: string;
}

export class StandardErrorResponseDto {
  @ApiProperty({
    description: "Success status (always false for errors)",
    example: false,
  })
  success!: false;

  @ApiProperty({
    description: "Error details",
    type: ErrorDetailsDto,
  })
  error!: ErrorDetailsDto;

  @ApiProperty({
    description: "Response timestamp",
    example: 1703123456789,
  })
  @IsNumber()
  timestamp!: number;

  @ApiProperty({
    description: "Request ID for tracing",
    example: "req_1703123456789_abc123",
    required: false,
  })
  @IsOptional()
  @IsString()
  requestId?: string;
}

export class HttpErrorResponseDto extends StandardErrorResponseDto {
  @ApiProperty({
    description: "HTTP status code",
    example: 400,
  })
  @IsNumber()
  statusCode!: number;

  @ApiProperty({
    description: "HTTP status message",
    example: "Bad Request",
  })
  @IsString()
  statusMessage!: string;
}

export class ValidationErrorDto {
  @ApiProperty({
    description: "Field that failed validation",
    example: "feeds",
    required: false,
  })
  @IsOptional()
  @IsString()
  field?: string;

  @ApiProperty({
    description: "Validation error message",
    example: "feeds must contain at least 1 item",
  })
  @IsString()
  message!: string;

  @ApiProperty({
    description: "Value that failed validation",
    example: [],
    required: false,
  })
  @IsOptional()
  value?: unknown;

  @ApiProperty({
    description: "Validation constraint that failed",
    example: "ArrayMinSize",
    required: false,
  })
  @IsOptional()
  @IsString()
  constraint?: string;
}

export class ValidationErrorResponseDto extends HttpErrorResponseDto {
  @ApiProperty({
    description: "Validation errors",
    type: [ValidationErrorDto],
    required: false,
  })
  @IsOptional()
  validationErrors?: ValidationErrorDto[];
}

// Specific error response DTOs for common scenarios
export class BadRequestErrorResponseDto extends HttpErrorResponseDto {
  @ApiProperty({
    description: "Bad Request error response",
    example: {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request parameters",
        severity: "medium",
        module: "FeedController",
        timestamp: 1703123456789,
      },
      timestamp: 1703123456789,
      statusCode: 400,
      statusMessage: "Bad Request",
    },
  })
  example!: HttpErrorResponseDto;
}

export class NotFoundErrorResponseDto extends HttpErrorResponseDto {
  @ApiProperty({
    description: "Not Found error response",
    example: {
      success: false,
      error: {
        code: "DATA_NOT_FOUND",
        message: "Resource not found",
        severity: "medium",
        module: "FeedController",
        timestamp: 1703123456789,
      },
      timestamp: 1703123456789,
      statusCode: 404,
      statusMessage: "Not Found",
    },
  })
  example!: HttpErrorResponseDto;
}

export class InternalServerErrorResponseDto extends HttpErrorResponseDto {
  @ApiProperty({
    description: "Internal Server Error response",
    example: {
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
        severity: "high",
        module: "FeedController",
        timestamp: 1703123456789,
      },
      timestamp: 1703123456789,
      statusCode: 500,
      statusMessage: "Internal Server Error",
    },
  })
  example!: HttpErrorResponseDto;
}

export class ServiceUnavailableErrorResponseDto extends HttpErrorResponseDto {
  @ApiProperty({
    description: "Service Unavailable error response",
    example: {
      success: false,
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "Service temporarily unavailable",
        severity: "high",
        module: "HealthController",
        timestamp: 1703123456789,
      },
      timestamp: 1703123456789,
      statusCode: 503,
      statusMessage: "Service Unavailable",
    },
  })
  example!: HttpErrorResponseDto;
}

export class RateLimitErrorResponseDto extends HttpErrorResponseDto {
  @ApiProperty({
    description: "Rate Limit Exceeded error response",
    example: {
      success: false,
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Rate limit exceeded. Please try again later.",
        severity: "medium",
        module: "RateLimitGuard",
        timestamp: 1703123456789,
      },
      timestamp: 1703123456789,
      statusCode: 429,
      statusMessage: "Too Many Requests",
    },
  })
  example!: HttpErrorResponseDto;
}
