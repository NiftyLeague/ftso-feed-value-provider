import type { LogLevel as NestLogLevel } from "@nestjs/common";

/**
 * Use NestJS LogLevel type for consistency with framework
 * Valid values: "error" | "warn" | "log" | "debug" | "verbose" | "fatal"
 */
export type LogLevel = NestLogLevel;

/**
 * Log level hierarchy for filtering
 * Only includes NestJS-supported log levels
 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  fatal: 0,
  error: 1,
  warn: 2,
  log: 3,
  debug: 4,
  verbose: 5,
};

/**
 * Check if a message should be logged based on current log level
 */
export function shouldLog(messageLevel: LogLevel, currentLevel: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[messageLevel] <= LOG_LEVEL_PRIORITY[currentLevel];
}

/**
 * Defines severity levels for error classification and alerting
 */
export type SeverityLevel = "low" | "medium" | "high" | "critical" | "fatal";

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
  severity: SeverityLevel;
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
  severity?: SeverityLevel;
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
