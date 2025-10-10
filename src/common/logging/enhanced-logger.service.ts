import * as fs from "fs";
import * as path from "path";
import { Injectable, Logger } from "@nestjs/common";
import type {
  ILogger,
  LogMessage,
  EnhancedLogContext,
  LogParameters,
  StructuredLogEntry,
  LogLevel,
} from "../types/logging";
import { shouldLog } from "../types/logging";
import { ErrorLogger } from "./error-logger";
import { PerformanceLogger } from "./performance-logger";

import { ENV } from "@/config/environment.constants";

@Injectable()
export class EnhancedLoggerService implements ILogger {
  private readonly logger: Logger;
  private readonly logDirectory: string;
  private readonly debugLogFile: string;
  private readonly auditLogFile: string;

  // Specialized loggers
  private readonly errorLogger: ErrorLogger;
  private readonly performanceLogger: PerformanceLogger;

  // Log level configuration
  private readonly enableFileLogging: boolean;
  private readonly enablePerformanceLogging: boolean;
  private readonly enableDebugLogging: boolean;
  private readonly currentLogLevel: LogLevel;

  constructor(context: string = "EnhancedLogger") {
    this.logger = new Logger(context);

    // Use ENV constants directly - no circular dependency when importing from environment.constants
    this.enableFileLogging = ENV.LOGGING.ENABLE_FILE_LOGGING;
    this.enablePerformanceLogging = ENV.LOGGING.ENABLE_PERFORMANCE_LOGGING;
    this.enableDebugLogging = ENV.LOGGING.ENABLE_DEBUG_LOGGING;
    this.logDirectory = path.join(process.cwd(), ENV.LOGGING.LOG_DIRECTORY);
    this.currentLogLevel = ENV.LOGGING.LOG_LEVEL;

    // Setup log files
    this.debugLogFile = path.join(this.logDirectory, "debug.log");
    this.auditLogFile = path.join(this.logDirectory, "audit.log");

    this.initializeLogDirectory();

    // Initialize specialized loggers
    this.errorLogger = new ErrorLogger(context, this.logDirectory, 1000, this.enableFileLogging);
    this.performanceLogger = new PerformanceLogger(
      context,
      this.logDirectory,
      this.enablePerformanceLogging,
      this.enableFileLogging
    );
  }

  /**
   * Enhanced logging with context and structured data
   * Requirement 6.1: Detailed logging for critical operations
   */
  log(message: LogMessage, context?: EnhancedLogContext, ...optionalParams: LogParameters): void {
    if (!shouldLog("log", this.currentLogLevel)) {
      return;
    }

    const logEntry = this.createLogEntry("LOG", message, context, optionalParams);
    this.logger.log(logEntry.message, logEntry.context);

    if (this.enableFileLogging) {
      this.writeToFile("log", logEntry);
    }
  }

  /**
   * Enhanced error logging with root cause analysis information
   * Requirement 6.1: Error logging with sufficient detail for root cause analysis
   */
  error(message: LogMessage, context?: EnhancedLogContext, ...optionalParams: LogParameters): void {
    if (!shouldLog("error", this.currentLogLevel)) {
      return;
    }

    const logEntry = this.createLogEntry("ERROR", message, context, optionalParams);

    // Extract error details if message is an Error object
    if (message instanceof Error) {
      this.errorLogger.logError(message, context);
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
  warn(message: LogMessage, context?: EnhancedLogContext, ...optionalParams: LogParameters): void {
    if (!shouldLog("warn", this.currentLogLevel)) {
      return;
    }

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
  debug(message: LogMessage, context?: EnhancedLogContext, ...optionalParams: LogParameters): void {
    if (!shouldLog("debug", this.currentLogLevel) || !this.enableDebugLogging) {
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
  verbose(message: LogMessage, context?: EnhancedLogContext, ...optionalParams: LogParameters): void {
    if (!shouldLog("verbose", this.currentLogLevel)) {
      return;
    }

    const logEntry = this.createLogEntry("VERBOSE", message, context, optionalParams);
    this.logger.verbose(logEntry.message, logEntry.context);

    if (this.enableFileLogging) {
      this.writeToFile("verbose", logEntry);
    }
  }

  /**
   * Fatal error logging for critical system failures
   */
  fatal(message: LogMessage, context?: EnhancedLogContext, ...optionalParams: LogParameters): void {
    if (!shouldLog("fatal", this.currentLogLevel)) {
      return;
    }

    const logEntry = this.createLogEntry("FATAL", message, context, optionalParams);
    this.logger.error(`[FATAL] ${logEntry.message}`, logEntry.context);

    if (this.enableFileLogging) {
      this.writeToFile("fatal", logEntry);
    }
  }

  /**
   * Directory listing for debugging
   */
  dir(message: LogMessage, context?: EnhancedLogContext, ...optionalParams: LogParameters): void {
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
    metadata?: Record<string, unknown>
  ): void {
    this.performanceLogger.startTimer(operationId, operation, component, metadata);
  }

  /**
   * End performance timer and log results
   */
  endPerformanceTimer(
    operationId: string,
    success: boolean = true,
    additionalMetadata?: Record<string, unknown>
  ): void {
    this.performanceLogger.endTimer(operationId, success, additionalMetadata);
  }

  /**
   * Log critical operations with enhanced context
   * Requirement 6.1: Detailed logging for critical operations
   */
  logCriticalOperation(
    operation: string,
    component: string,
    details: Record<string, unknown>,
    success: boolean = true
  ): void {
    const context: EnhancedLogContext = {
      component,
      operation,
      severity: success ? "low" : "high",
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
    metadata?: Record<string, unknown>
  ): void {
    const context: EnhancedLogContext = {
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

    this.debug(`Data flow: ${count} ${dataType} records from ${source} to ${destination}`, context);
  }

  /**
   * Log price update operations
   */
  logPriceUpdate(symbol: string, source: string, price: number, timestamp: number, confidence: number): void {
    const age = Date.now() - timestamp;
    const context: EnhancedLogContext = {
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

    if (age > ENV.DATA_FRESHNESS.STALE_WARNING_MS) {
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
    const context: EnhancedLogContext = {
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

    this.debug(
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
    details?: Record<string, unknown>
  ): void {
    const context: EnhancedLogContext = {
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
    details?: Record<string, unknown>
  ): void {
    const context: EnhancedLogContext = {
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
  getErrorStatistics() {
    return this.errorLogger.getStatistics();
  }

  /**
   * Get performance statistics
   */
  getPerformanceStatistics() {
    return this.performanceLogger.getStatistics();
  }

  // Private helper methods

  private createLogEntry(
    level: string,
    message: LogMessage,
    context?: EnhancedLogContext,
    optionalParams?: LogParameters
  ): StructuredLogEntry {
    const timestamp = Date.now();
    const formattedMessage = typeof message === "string" ? message : JSON.stringify(message);

    const logContext = {
      pid: process.pid,
      ...context,
    };

    if (optionalParams && optionalParams.length > 0) {
      logContext.additionalParams = optionalParams;
    }

    return {
      level: level.toLowerCase() as LogLevel,
      message: formattedMessage,
      timestamp,
      context: logContext,
      data: optionalParams && optionalParams.length > 0 ? { additionalParams: optionalParams } : undefined,
    };
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

  private writeToFile(level: string, logEntry: unknown): void {
    try {
      const logLine =
        JSON.stringify({
          ...(typeof logEntry === "object" && logEntry !== null ? logEntry : { message: logEntry }),
          level,
          timestamp: new Date().toISOString(),
        }) + "\n";

      const logFile = level === "debug" ? this.debugLogFile : path.join(this.logDirectory, "application.log");

      fs.appendFileSync(logFile, logLine);
    } catch (error) {
      // Don't log file write errors to avoid infinite loops
      console.error("Failed to write to log file:", error);
    }
  }

  private writeAuditLog(
    operation: string,
    component: string,
    details: Record<string, unknown>,
    success: boolean
  ): void {
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
