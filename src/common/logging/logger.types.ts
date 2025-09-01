/**
 * Logger Types and Interfaces
 * Extracted from enhanced-logger.service.ts to reduce file size and improve organization
 */

export interface LogContext {
  component?: string;
  operation?: string;
  sourceId?: string;
  feedId?: string;
  exchangeName?: string;
  symbol?: string;
  requestId?: string;
  userId?: string;
  sessionId?: string;
  correlationId?: string;
  duration?: number;
  errorCode?: string;
  errorType?: string;
  severity?: string;
  operationId?: string;
  additionalParams?: any[];
  metadata?: Record<string, any>;
}

export interface PerformanceLogEntry {
  operation: string;
  component: string;
  startTime: number;
  endTime: number;
  duration: number;
  success: boolean;
  metadata?: Record<string, any>;
}

export interface ErrorLogEntry {
  error: Error;
  context: LogContext;
  stackTrace: string;
  timestamp: number;
  severity: "low" | "medium" | "high" | "critical";
  recoverable: boolean;
  errorCode?: string;
  errorType?: string;
}

export interface LoggerConfig {
  enableFileLogging: boolean;
  enablePerformanceLogging: boolean;
  enableDebugLogging: boolean;
  logDirectory: string;
  maxErrorHistory: number;
}

export interface LogEntry {
  message: string;
  context: Record<string, any>;
  level: string;
  timestamp: string;
}
