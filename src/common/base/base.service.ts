import { Logger } from "@nestjs/common";
import { EnhancedLoggerService } from "../logging/enhanced-logger.service";

/**
 * Base service class that provides common logging functionality
 */
export abstract class BaseService {
  protected readonly logger: Logger;
  protected readonly enhancedLogger?: EnhancedLoggerService;

  constructor(serviceName: string, useEnhancedLogging: boolean = false) {
    this.logger = new Logger(serviceName);

    // Only create enhanced logger if explicitly requested
    if (useEnhancedLogging) {
      this.enhancedLogger = new EnhancedLoggerService(serviceName);
    }
  }

  /**
   * Log service initialization
   */
  protected logInitialization(message?: string): void {
    const defaultMessage = `${this.constructor.name} initialized`;
    this.logger.log(message || defaultMessage);
  }

  /**
   * Log service shutdown
   */
  protected logShutdown(message?: string): void {
    const defaultMessage = `${this.constructor.name} shutting down`;
    this.logger.log(message || defaultMessage);
  }

  /**
   * Log performance metrics
   */
  protected logPerformance(operation: string, duration: number, threshold = 1000): void {
    if (duration > threshold) {
      this.logger.warn(`Performance warning: ${operation} took ${duration}ms (threshold: ${threshold}ms)`);
    } else {
      this.logger.debug(`${operation} completed in ${duration}ms`);
    }
  }

  /**
   * Log error with context
   */
  protected logError(error: Error, context?: string, additionalData?: Record<string, unknown>): void {
    const contextMessage = context ? `[${context}] ` : "";
    this.logger.error(`${contextMessage}${error.message}`, error.stack, additionalData);
  }

  /**
   * Log warning with context
   */
  protected logWarning(message: string, context?: string, additionalData?: Record<string, unknown>): void {
    const contextMessage = context ? `[${context}] ` : "";
    this.logger.warn(`${contextMessage}${message}`, additionalData);
  }

  /**
   * Log debug information
   */
  protected logDebug(message: string, context?: string, additionalData?: unknown): void {
    const contextMessage = context ? `[${context}] ` : "";
    this.logger.debug(`${contextMessage}${message}`, additionalData);
  }

  /**
   * Log critical operation with enhanced logging if available, otherwise regular logging
   */
  protected logCriticalOperation(operation: string, details: Record<string, unknown>, success: boolean = true): void {
    if (this.enhancedLogger) {
      this.enhancedLogger?.logCriticalOperation(operation, this.constructor.name, details, success);
    } else {
      const message = `Critical Operation: ${operation} ${success ? "completed successfully" : "failed"}`;
      if (success) {
        this.logger.log(message, details);
      } else {
        this.logger.error(message, details);
      }
    }
  }

  /**
   * Start performance timer with enhanced logging if available
   */
  protected startPerformanceTimer(operationId: string, operation: string, metadata?: Record<string, unknown>): void {
    if (this.enhancedLogger) {
      this.enhancedLogger?.startPerformanceTimer(operationId, operation, this.constructor.name, metadata);
    }
    // Regular logger doesn't have performance timers, so we just skip
  }

  /**
   * End performance timer with enhanced logging if available
   */
  protected endPerformanceTimer(
    operationId: string,
    success: boolean = true,
    additionalMetadata?: Record<string, unknown>
  ): void {
    if (this.enhancedLogger) {
      this.enhancedLogger?.endPerformanceTimer(operationId, success, additionalMetadata);
    }
    // Regular logger doesn't have performance timers, so we just skip
  }
}
