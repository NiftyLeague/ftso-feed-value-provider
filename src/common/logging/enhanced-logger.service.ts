import { Injectable } from "@nestjs/common";
import { ILogger } from "./logger.interface";
import { LogContext } from "./logger.types";
import { ErrorLogger } from "./error-logger";
import { PerformanceLogger } from "./performance-logger";
import { BaseService } from "../base/base.service";
import * as fs from "fs";
import * as path from "path";

@Injectable()
export class EnhancedLoggerService extends BaseService implements ILogger {
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

  constructor(context: string = "EnhancedLogger") {
    super(context);

    // Configure logging based on environment
    this.enableFileLogging = process.env.ENABLE_FILE_LOGGING === "true";
    this.enablePerformanceLogging = process.env.ENABLE_PERFORMANCE_LOGGING !== "false"; // Default true
    this.enableDebugLogging = process.env.ENABLE_DEBUG_LOGGING === "true";

    // Setup log directories and files
    this.logDirectory = path.join(process.cwd(), "logs");
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
    this.performanceLogger.startTimer(operationId, operation, component, metadata);
  }

  /**
   * End performance timer and log results
   */
  endPerformanceTimer(operationId: string, success: boolean = true, additionalMetadata?: Record<string, any>): void {
    this.performanceLogger.endTimer(operationId, success, additionalMetadata);
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
