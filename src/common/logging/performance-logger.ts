/**
 * Performance Logger
 * Extracted from enhanced-logger.service.ts for better separation of concerns
 */

import { Logger } from "@nestjs/common";
import type { PerformanceLogEntry } from "../types/logging";
import * as fs from "fs";
import * as path from "path";

export class PerformanceLogger {
  private readonly logger: Logger;
  private readonly performanceEntries = new Map<string, PerformanceLogEntry>();
  private readonly operationTimers = new Map<string, number>();
  private readonly enablePerformanceLogging: boolean;
  private readonly enableFileLogging: boolean;
  private readonly performanceLogFile: string;

  constructor(context: string, logDirectory: string, enablePerformanceLogging = true, enableFileLogging = false) {
    this.logger = new Logger(`${context}:Performance`);
    this.enablePerformanceLogging = enablePerformanceLogging;
    this.enableFileLogging = enableFileLogging;
    this.performanceLogFile = path.join(logDirectory, "performance.log");
  }

  /**
   * Start performance timer for an operation
   */
  startTimer(operationId: string, operation: string, component: string, metadata?: Record<string, unknown>): void {
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
      timestamp: Date.now(),
      metadata,
    };

    this.performanceEntries.set(operationId, entry);

    this.logger.debug(`Performance timer started: ${operation}`, {
      component,
      operation,
      operationId,
      metadata,
    });
  }

  /**
   * End performance timer and log results
   */
  endTimer(operationId: string, success = true, additionalMetadata?: Record<string, unknown>): void {
    if (!this.enablePerformanceLogging) {
      return;
    }

    const startTime = this.operationTimers.get(operationId);
    const entry = this.performanceEntries.get(operationId);

    if (!startTime || !entry) {
      this.logger.warn(`Performance timer not found for operation: ${operationId}`);
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
    // const context: LogContext = {
    //   component: entry.component,
    //   operation: entry.operation,
    //   duration,
    //   metadata: entry.metadata,
    // };

    if (success) {
      this.logger.log(performanceMessage);
    } else {
      this.logger.warn(`${performanceMessage} (FAILED)`);
    }

    // Write to performance log file
    if (this.enableFileLogging) {
      this.writeToFile(entry);
    }

    // Cleanup
    this.operationTimers.delete(operationId);
    this.performanceEntries.delete(operationId);
  }

  /**
   * Get performance statistics
   */
  getStatistics(): {
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

  /**
   * Write performance entry to file
   */
  private writeToFile(entry: PerformanceLogEntry): void {
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
}
