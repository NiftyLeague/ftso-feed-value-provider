import { Injectable, Logger, LogLevel } from "@nestjs/common";
import { ILogger } from "./ILogger";
import * as fs from "fs";
import * as path from "path";

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

@Injectable()
export class EnhancedLoggerService implements ILogger {
  private readonly logger: Logger;
  private readonly logDirectory: string;
  private readonly performanceLogFile: string;
  private readonly errorLogFile: string;
  private readonly debugLogFile: string;
  private readonly auditLogFile: string;

  // Performance tracking
  private performanceEntries: Map<string, PerformanceLogEntry> = new Map();
  private operationTimers: Map<string, number> = new Map();

  // Error tracking
  private errorHistory: ErrorLogEntry[] = [];
  private readonly maxErrorHistory = 1000;

  // Log level configuration
  private readonly logLevel: LogLevel[];
  private readonly enableFileLogging: boolean;
  private readonly enablePerformanceLogging: boolean;
  private readonly enableDebugLogging: boolean;

  constructor(context: string = "EnhancedLogger") {
    this.logger = new Logger(context);

    // Configure logging based on environment
    this.logLevel = this.getLogLevels();
    this.enableFileLogging = process.env.ENABLE_FILE_LOGGING === "true";
    this.enablePerformanceLogging = process.env.ENABLE_PERFORMANCE_LOGGING !== "false"; // Default true
    this.enableDebugLogging = process.env.ENABLE_DEBUG_LOGGING === "true";

    // Setup log directories and files
    this.logDirectory = path.join(process.cwd(), "logs");
    this.performanceLogFile = path.join(this.logDirectory, "performance.log");
    this.errorLogFile = path.join(this.logDirectory, "errors.log");
    this.debugLogFile = path.join(this.logDirectory, "debug.log");
    this.auditLogFile = path.join(this.logDirectory, "audit.log");

    this.initializeLogDirectory();
  }

  /**
   * Enhanced logging with context and structured data
   * Requirement 6.1: Detailed logging for critical operations
   */
  log(message: any, context?: LogContext, ...optionalParams: any[]): void {
    const logEntry = this.createLogEntry("LOG", message, context, optionalParams);
    this.logger.log(logEntry.message, logEntry.context);

    if (this.enableFileLogging) {
      this.writeToFile("info", logEntry);
    }
  }

  /**
   * Enhanced error logging with root cause analysis information
   * Requirement 6.1: Error logging with sufficient detail for root cause analysis
   */
  error(message: any, context?: LogContext, ...optionalParams: any[]): void {
    const logEntry = this.createLogEntry("ERROR", message, context, optionalParams);

    // Extract error details if message is an Error object
    if (message instanceof Error) {
      const errorEntry: ErrorLogEntry = {
        error: message,
        context: context || {},
        stackTrace: message.stack || "No stack trace available",
        timestamp: Date.now(),
        severity: this.determineSeverity(message, context),
        recoverable: this.isRecoverableError(message),
        errorCode: (message as any).code || context?.errorCode,
        errorType: (message as any).type || message.constructor.name,
      };

      this.errorHistory.push(errorEntry);

      // Keep error history within limits
      if (this.errorHistory.length > this.maxErrorHistory) {
        this.errorHistory.shift();
      }

      // Enhanced error message with context
      const enhancedMessage = this.formatErrorMessage(errorEntry);
      this.logger.error(enhancedMessage, logEntry.context);

      if (this.enableFileLogging) {
        this.writeErrorToFile(errorEntry);
      }
    } else {
      this.logger.error(logEntry.message, logEntry.context);

      if (this.enableFileLogging) {
        this.writeToFile("error", logEntry);
      }
    }
  }

  /**
   * Enhanced warning logging with context
   */
  warn(message: any, context?: LogContext, ...optionalParams: any[]): void {
    const logEntry = this.createLogEntry("WARN", message, context, optionalParams);
    this.logger.warn(logEntry.message, logEntry.context);

    if (this.enableFileLogging) {
      this.writeToFile("warn", logEntry);
    }
  }

  /**
   * Enhanced debug logging with detailed context
   * Requirement 6.5: Debug logging for troubleshooting
   */
  debug(message: any, context?: LogContext, ...optionalParams: any[]): void {
    if (!this.enableDebugLogging) {
      return;
    }

    const logEntry = this.createLogEntry("DEBUG", message, context, optionalParams);
    this.logger.debug(logEntry.message, logEntry.context);

    if (this.enableFileLogging) {
      this.writeToFile("debug", logEntry);
    }
  }

  /**
   * Verbose logging for detailed system behavior
   */
  verbose(message: any, context?: LogContext, ...optionalParams: any[]): void {
    const logEntry = this.createLogEntry("VERBOSE", message, context, optionalParams);
    this.logger.verbose(logEntry.message, logEntry.context);

    if (this.enableFileLogging) {
      this.writeToFile("verbose", logEntry);
    }
  }

  /**
   * Fatal error logging for critical system failures
   */
  fatal(message: any, context?: LogContext, ...optionalParams: any[]): void {
    const logEntry = this.createLogEntry("FATAL", message, context, optionalParams);
    this.logger.error(`[FATAL] ${logEntry.message}`, logEntry.context);

    if (this.enableFileLogging) {
      this.writeToFile("fatal", logEntry);
    }
  }

  /**
   * Directory listing for debugging
   */
  dir(message: any, context?: LogContext, ...optionalParams: any[]): void {
    const logEntry = this.createLogEntry("DIR", message, context, optionalParams);
    console.dir(message, { depth: 3, colors: true });

    if (this.enableFileLogging) {
      this.writeToFile("debug", { ...logEntry, message: `DIR: ${JSON.stringify(message, null, 2)}` });
    }
  }

  /**
   * Performance logging for monitoring system behavior
   * Requirement 6.1: Performance logging for monitoring system behavior
   */
  startPerformanceTimer(
    operationId: string,
    operation: string,
    component: string,
    metadata?: Record<string, any>
  ): void {
    if (!this.enablePerformanceLogging) {
      return;
    }

    const startTime = performance.now();
    this.operationTimers.set(operationId, startTime);

    const entry: PerformanceLogEntry = {
      operation,
      component,
      startTime,
      endTime: 0,
      duration: 0,
      success: false,
      metadata,
    };

    this.performanceEntries.set(operationId, entry);

    this.debug(`Performance timer started: ${operation}`, {
      component,
      operation,
      operationId,
      metadata,
    });
  }

  /**
   * End performance timer and log results
   */
  endPerformanceTimer(operationId: string, success: boolean = true, additionalMetadata?: Record<string, any>): void {
    if (!this.enablePerformanceLogging) {
      return;
    }

    const startTime = this.operationTimers.get(operationId);
    const entry = this.performanceEntries.get(operationId);

    if (!startTime || !entry) {
      this.warn(`Performance timer not found for operation: ${operationId}`);
      return;
    }

    const endTime = performance.now();
    const duration = endTime - startTime;

    entry.endTime = endTime;
    entry.duration = duration;
    entry.success = success;

    if (additionalMetadata) {
      entry.metadata = { ...entry.metadata, ...additionalMetadata };
    }

    // Log performance result
    const performanceMessage = `Performance: ${entry.operation} completed in ${duration.toFixed(2)}ms`;
    const context: LogContext = {
      component: entry.component,
      operation: entry.operation,
      duration,
      metadata: entry.metadata,
    };

    if (success) {
      this.log(performanceMessage, context);
    } else {
      this.warn(`${performanceMessage} (FAILED)`, context);
    }

    // Write to performance log file
    if (this.enableFileLogging) {
      this.writePerformanceToFile(entry);
    }

    // Cleanup
    this.operationTimers.delete(operationId);
    this.performanceEntries.delete(operationId);
  }

  /**
   * Log critical operations with enhanced context
   * Requirement 6.1: Detailed logging for critical operations
   */
  logCriticalOperation(
    operation: string,
    component: string,
    details: Record<string, any>,
    success: boolean = true
  ): void {
    const context: LogContext = {
      component,
      operation,
      severity: success ? "info" : "high",
      metadata: details,
    };

    const message = `Critical Operation: ${operation} ${success ? "completed successfully" : "failed"}`;

    if (success) {
      this.log(message, context);
    } else {
      this.error(message, context);
    }

    // Also write to audit log
    if (this.enableFileLogging) {
      this.writeAuditLog(operation, component, details, success);
    }
  }

  /**
   * Log data flow operations
   */
  logDataFlow(
    source: string,
    destination: string,
    dataType: string,
    count: number,
    metadata?: Record<string, any>
  ): void {
    const context: LogContext = {
      component: "DataFlow",
      operation: "data_transfer",
      sourceId: source,
      metadata: {
        destination,
        dataType,
        count,
        ...metadata,
      },
    };

    this.log(`Data flow: ${count} ${dataType} records from ${source} to ${destination}`, context);
  }

  /**
   * Log price update operations
   */
  logPriceUpdate(symbol: string, source: string, price: number, timestamp: number, confidence: number): void {
    const age = Date.now() - timestamp;
    const context: LogContext = {
      component: "PriceUpdate",
      operation: "price_received",
      sourceId: source,
      symbol,
      metadata: {
        price,
        timestamp,
        confidence,
        age,
      },
    };

    if (age > 2000) {
      this.warn(`Stale price update received: ${symbol} from ${source} (age: ${age}ms)`, context);
    } else {
      this.debug(`Price update: ${symbol} = ${price} from ${source}`, context);
    }
  }

  /**
   * Log aggregation operations
   */
  logAggregation(
    symbol: string,
    sourceCount: number,
    finalPrice: number,
    confidence: number,
    consensusScore: number
  ): void {
    const context: LogContext = {
      component: "Aggregation",
      operation: "price_aggregated",
      symbol,
      metadata: {
        sourceCount,
        finalPrice,
        confidence,
        consensusScore,
      },
    };

    this.log(
      `Price aggregated: ${symbol} = ${finalPrice} (${sourceCount} sources, confidence: ${confidence})`,
      context
    );
  }

  /**
   * Log connection events
   */
  logConnection(
    sourceId: string,
    event: "connected" | "disconnected" | "reconnecting" | "failed",
    details?: Record<string, any>
  ): void {
    const context: LogContext = {
      component: "Connection",
      operation: `connection_${event}`,
      sourceId,
      metadata: details,
    };

    const message = `Connection ${event}: ${sourceId}`;

    switch (event) {
      case "connected":
        this.log(message, context);
        break;
      case "disconnected":
        this.warn(message, context);
        break;
      case "reconnecting":
        this.log(message, context);
        break;
      case "failed":
        this.error(message, context);
        break;
    }
  }

  /**
   * Log error recovery operations
   */
  logErrorRecovery(
    sourceId: string,
    errorType: string,
    recoveryAction: string,
    success: boolean,
    details?: Record<string, any>
  ): void {
    const context: LogContext = {
      component: "ErrorRecovery",
      operation: "error_recovery",
      sourceId,
      errorType,
      metadata: {
        recoveryAction,
        success,
        ...details,
      },
    };

    const message = `Error recovery: ${recoveryAction} for ${sourceId} (${errorType}) - ${success ? "SUCCESS" : "FAILED"}`;

    if (success) {
      this.log(message, context);
    } else {
      this.error(message, context);
    }
  }

  /**
   * Get error statistics for monitoring
   */
  getErrorStatistics(): {
    totalErrors: number;
    errorsBySeverity: Record<string, number>;
    errorsByType: Record<string, number>;
    errorsByComponent: Record<string, number>;
    recentErrors: ErrorLogEntry[];
  } {
    const errorsBySeverity: Record<string, number> = {};
    const errorsByType: Record<string, number> = {};
    const errorsByComponent: Record<string, number> = {};

    // Get recent errors (last hour)
    const oneHourAgo = Date.now() - 3600000;
    const recentErrors = this.errorHistory.filter(entry => entry.timestamp > oneHourAgo);

    for (const entry of this.errorHistory) {
      // Count by severity
      errorsBySeverity[entry.severity] = (errorsBySeverity[entry.severity] || 0) + 1;

      // Count by type
      const errorType = entry.errorType || "unknown";
      errorsByType[errorType] = (errorsByType[errorType] || 0) + 1;

      // Count by component
      const component = entry.context.component || "unknown";
      errorsByComponent[component] = (errorsByComponent[component] || 0) + 1;
    }

    return {
      totalErrors: this.errorHistory.length,
      errorsBySeverity,
      errorsByType,
      errorsByComponent,
      recentErrors,
    };
  }

  /**
   * Get performance statistics
   */
  getPerformanceStatistics(): {
    activeOperations: number;
    completedOperations: number;
    averageOperationTime: number;
  } {
    return {
      activeOperations: this.operationTimers.size,
      completedOperations: 0, // Would need to track this separately
      averageOperationTime: 0, // Would need to calculate from completed operations
    };
  }

  // Private helper methods

  private createLogEntry(
    level: string,
    message: any,
    context?: LogContext,
    optionalParams?: any[]
  ): {
    message: string;
    context: Record<string, any>;
  } {
    const timestamp = new Date().toISOString();
    const formattedMessage = typeof message === "string" ? message : JSON.stringify(message);

    const logContext = {
      timestamp,
      level,
      pid: process.pid,
      ...context,
    };

    if (optionalParams && optionalParams.length > 0) {
      logContext.additionalParams = optionalParams;
    }

    return {
      message: formattedMessage,
      context: logContext,
    };
  }

  private determineSeverity(error: Error, context?: LogContext): "low" | "medium" | "high" | "critical" {
    // Check context for explicit severity
    if (context?.severity) {
      return context.severity as "low" | "medium" | "high" | "critical";
    }

    const message = error.message.toLowerCase();

    // Critical errors
    if (message.includes("fatal") || message.includes("critical") || message.includes("system failure")) {
      return "critical";
    }

    // High severity errors
    if (message.includes("connection") || message.includes("timeout") || message.includes("authentication")) {
      return "high";
    }

    // Medium severity errors
    if (message.includes("validation") || message.includes("parsing") || message.includes("rate limit")) {
      return "medium";
    }

    // Default to low severity
    return "low";
  }

  private isRecoverableError(error: Error): boolean {
    const message = error.message.toLowerCase();

    // Non-recoverable errors
    const nonRecoverablePatterns = [
      "authentication",
      "authorization",
      "forbidden",
      "parsing",
      "invalid format",
      "configuration",
    ];

    return !nonRecoverablePatterns.some(pattern => message.includes(pattern));
  }

  private formatErrorMessage(errorEntry: ErrorLogEntry): string {
    const { error, context, severity, recoverable, errorCode, errorType } = errorEntry;

    let message = `[${severity.toUpperCase()}] ${error.message}`;

    if (errorCode) {
      message += ` (Code: ${errorCode})`;
    }

    if (errorType) {
      message += ` (Type: ${errorType})`;
    }

    if (context.component) {
      message += ` [Component: ${context.component}]`;
    }

    if (context.sourceId) {
      message += ` [Source: ${context.sourceId}]`;
    }

    if (context.operation) {
      message += ` [Operation: ${context.operation}]`;
    }

    message += ` [Recoverable: ${recoverable ? "Yes" : "No"}]`;

    return message;
  }

  private getLogLevels(): LogLevel[] {
    const logLevel = process.env.LOG_LEVEL?.toLowerCase();

    switch (logLevel) {
      case "error":
        return ["error"];
      case "warn":
        return ["error", "warn"];
      case "debug":
        return ["error", "warn", "log", "debug", "verbose"];
      case "verbose":
        return ["error", "warn", "log", "debug", "verbose"];
      default:
        return ["error", "warn", "log"];
    }
  }

  private initializeLogDirectory(): void {
    if (!this.enableFileLogging) {
      return;
    }

    try {
      if (!fs.existsSync(this.logDirectory)) {
        fs.mkdirSync(this.logDirectory, { recursive: true });
      }
    } catch (error) {
      this.logger.error("Failed to create log directory:", error);
    }
  }

  private writeToFile(level: string, logEntry: any): void {
    try {
      const logLine =
        JSON.stringify({
          ...logEntry,
          level,
          timestamp: new Date().toISOString(),
        }) + "\n";

      const logFile =
        level === "debug"
          ? this.debugLogFile
          : level === "error" || level === "fatal"
            ? this.errorLogFile
            : path.join(this.logDirectory, "application.log");

      fs.appendFileSync(logFile, logLine);
    } catch (error) {
      // Don't log file write errors to avoid infinite loops
      console.error("Failed to write to log file:", error);
    }
  }

  private writeErrorToFile(errorEntry: ErrorLogEntry): void {
    try {
      const logLine =
        JSON.stringify({
          ...errorEntry,
          timestamp: new Date(errorEntry.timestamp).toISOString(),
        }) + "\n";

      fs.appendFileSync(this.errorLogFile, logLine);
    } catch (error) {
      console.error("Failed to write error to log file:", error);
    }
  }

  private writePerformanceToFile(entry: PerformanceLogEntry): void {
    try {
      const logLine =
        JSON.stringify({
          ...entry,
          startTime: new Date(entry.startTime).toISOString(),
          endTime: new Date(entry.endTime).toISOString(),
          timestamp: new Date().toISOString(),
        }) + "\n";

      fs.appendFileSync(this.performanceLogFile, logLine);
    } catch (error) {
      console.error("Failed to write performance log:", error);
    }
  }

  private writeAuditLog(operation: string, component: string, details: Record<string, any>, success: boolean): void {
    try {
      const auditEntry = {
        timestamp: new Date().toISOString(),
        operation,
        component,
        success,
        details,
        pid: process.pid,
      };

      const logLine = JSON.stringify(auditEntry) + "\n";
      fs.appendFileSync(this.auditLogFile, logLine);
    } catch (error) {
      console.error("Failed to write audit log:", error);
    }
  }
}
