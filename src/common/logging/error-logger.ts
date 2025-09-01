/**
 * Error Logger
 * Extracted from enhanced-logger.service.ts for better separation of concerns
 */

import { Logger } from "@nestjs/common";
import { ErrorLogEntry, LogContext } from "./logger.types";
import * as fs from "fs";
import * as path from "path";

export class ErrorLogger {
  private readonly logger: Logger;
  private readonly errorHistory: ErrorLogEntry[] = [];
  private readonly maxErrorHistory: number;
  private readonly enableFileLogging: boolean;
  private readonly errorLogFile: string;

  constructor(context: string, logDirectory: string, maxErrorHistory = 1000, enableFileLogging = false) {
    this.logger = new Logger(`${context}:Error`);
    this.maxErrorHistory = maxErrorHistory;
    this.enableFileLogging = enableFileLogging;
    this.errorLogFile = path.join(logDirectory, "errors.log");
  }

  /**
   * Log error with enhanced context and tracking
   */
  logError(error: Error, context?: LogContext): void {
    const errorEntry: ErrorLogEntry = {
      error,
      context: context || {},
      stackTrace: error.stack || "No stack trace available",
      timestamp: Date.now(),
      severity: this.determineSeverity(error, context),
      recoverable: this.isRecoverableError(error),
      errorCode: (error as any).code || context?.errorCode,
      errorType: (error as any).type || error.constructor.name,
    };

    this.errorHistory.push(errorEntry);

    // Keep error history within limits
    if (this.errorHistory.length > this.maxErrorHistory) {
      this.errorHistory.shift();
    }

    // Enhanced error message with context
    const enhancedMessage = this.formatErrorMessage(errorEntry);
    this.logger.error(enhancedMessage);

    if (this.enableFileLogging) {
      this.writeToFile(errorEntry);
    }
  }

  /**
   * Get error statistics for monitoring
   */
  getStatistics(): {
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
   * Clear error history
   */
  clearHistory(): void {
    this.errorHistory.length = 0;
  }

  /**
   * Determine error severity based on error and context
   */
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

  /**
   * Check if error is recoverable
   */
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

  /**
   * Format error message with context
   */
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

  /**
   * Write error entry to file
   */
  private writeToFile(errorEntry: ErrorLogEntry): void {
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
}
