/**
 * Defines the available log levels.
 */
export type LogLevel =
  | "error"
  | "warn"
  | "info"
  | "debug"
  | "verbose"
  | "low"
  | "medium"
  | "high"
  | "critical"
  | "fatal";

/**
 * Base interface for common contextual information.
 */
export interface IContext {
  component?: string;
  operation?: string;
}

/**
 * Represents the contextual information for a log entry.
 */
export interface LogContext extends IContext {
  [key: string]: unknown;
}

/**
 * Defines the structure of a log entry.
 */
export interface LogEntry {
  level: LogLevel;
  message: string;
  context?: LogContext;
  timestamp: number;
}

/**
 * Configuration for the logger.
 */
export interface LoggerConfig {
  level: LogLevel;
  prettyPrint: boolean;
  colorize: boolean;
}

/**
 * Interface for a logger implementation.
 */
export interface ILogger {
  log(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  debug(message: string, context?: LogContext): void;
  verbose(message: string, context?: LogContext): void;
}

export interface EnhancedErrorLogEntry {
  error: Error;
  context: LogContext;
  stackTrace: string;
  timestamp: number;
  severity: LogLevel;
  recoverable: boolean;
  errorCode?: string;
  errorType?: string;
}

/**
 * Defines a log entry for performance monitoring.
 */
export interface PerformanceLogEntry {
  operation: string;
  duration: number; // in milliseconds
  startTime: number; // timestamp when operation started
  endTime: number; // timestamp when operation ended
  component: string;
  success: boolean;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export type LogMessage = string | Error;

export interface EnhancedLogContext extends IContext {
  severity?: LogLevel;
  metadata?: Record<string, unknown>;
  additionalParams?: unknown[];
  [key: string]: unknown;
}

export type LogParameters = unknown[];

export interface StructuredLogEntry extends LogEntry {
  data?: Record<string, unknown>;
}

/**
 * Defines a log entry for auditing purposes.
 */
export interface AuditLogEntry {
  userId: string;
  action: string;
  resource: string;
  timestamp: number;
  success: boolean;
  ipAddress?: string;
  details?: Record<string, unknown>;
}
