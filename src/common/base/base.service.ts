import { Logger } from "@nestjs/common";
import { EnhancedLoggerService } from "../logging/enhanced-logger.service";

/**
 * Base service class that provides common logging functionality
 */
export abstract class BaseService {
  protected readonly logger: Logger;
  protected readonly enhancedLogger?: EnhancedLoggerService;

  constructor(serviceName: string, useEnhancedLogger = false) {
    this.logger = new Logger(serviceName);

    if (useEnhancedLogger) {
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
  protected logError(error: Error, context?: string, additionalData?: any): void {
    const contextMessage = context ? `[${context}] ` : "";
    this.logger.error(`${contextMessage}${error.message}`, error.stack, additionalData);

    if (this.enhancedLogger) {
      this.enhancedLogger.error(`${contextMessage}${error.message}`, additionalData);
    }
  }

  /**
   * Log warning with context
   */
  protected logWarning(message: string, context?: string, additionalData?: any): void {
    const contextMessage = context ? `[${context}] ` : "";
    this.logger.warn(`${contextMessage}${message}`, additionalData);

    if (this.enhancedLogger) {
      this.enhancedLogger.warn(`${contextMessage}${message}`, additionalData);
    }
  }

  /**
   * Log debug information
   */
  protected logDebug(message: string, context?: string, additionalData?: any): void {
    const contextMessage = context ? `[${context}] ` : "";
    this.logger.debug(`${contextMessage}${message}`, additionalData);

    if (this.enhancedLogger) {
      this.enhancedLogger.debug(`${contextMessage}${message}`, additionalData);
    }
  }
}
