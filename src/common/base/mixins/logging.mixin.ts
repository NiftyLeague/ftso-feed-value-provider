import { Logger } from "@nestjs/common";
import { EnhancedLoggerService } from "../../logging/enhanced-logger.service";
import type { Constructor, AbstractConstructor } from "../../types/services/mixins";

/**
 * Logging capabilities interface
 */
export interface LoggingCapabilities {
  logInitialization(message?: string): void;
  logShutdown(message?: string): void;
  logPerformance(operation: string, duration: number, threshold?: number): void;
  logError(error: Error, context?: string, additionalData?: Record<string, unknown>): void;
  logWarning(message: string, context?: string, additionalData?: Record<string, unknown>): void;
  logDebug(message: string, context?: string, additionalData?: unknown): void;
  logCriticalOperation(operation: string, details: Record<string, unknown>, success?: boolean): void;
  startPerformanceTimer(operationId: string, operation: string, metadata?: Record<string, unknown>): void;
  endPerformanceTimer(operationId: string, success?: boolean, additionalMetadata?: Record<string, unknown>): void;
}

/**
 * Mixin that adds logging capabilities to a service
 */
export function WithLogging<TBase extends Constructor | AbstractConstructor>(Base: TBase) {
  return class LoggingMixin extends Base implements LoggingCapabilities {
    public readonly logger: Logger;
    public enhancedLogger?: EnhancedLoggerService;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args);
      this.logger = new Logger(this.constructor.name);
    }

    initializeEnhancedLogging(useEnhancedLogging: boolean): void {
      if (useEnhancedLogging) {
        this.enhancedLogger = new EnhancedLoggerService(this.constructor.name);
      } else {
        this.enhancedLogger = undefined;
      }
    }

    logInitialization(message?: string): void {
      const defaultMessage = `${this.constructor.name} initialized`;
      this.logger.log(message || defaultMessage);
    }

    logShutdown(message?: string): void {
      const defaultMessage = `${this.constructor.name} shutting down`;
      this.logger.log(message || defaultMessage);
    }

    logPerformance(operation: string, duration: number, threshold = 1000): void {
      if (duration > threshold) {
        this.logger.warn(`Performance warning: ${operation} took ${duration}ms (threshold: ${threshold}ms)`);
      } else {
        this.logger.debug(`${operation} completed in ${duration}ms`);
      }
    }

    logError(error: Error, context?: string, additionalData?: Record<string, unknown>): void {
      const contextMessage = context ? `[${context}] ` : "";
      this.logger.error(`${contextMessage}${error.message}`, error.stack, additionalData);
    }

    logWarning(message: string, context?: string, additionalData?: Record<string, unknown>): void {
      const contextMessage = context ? `[${context}] ` : "";
      this.logger.warn(`${contextMessage}${message}`, additionalData);
    }

    logDebug(message: string, context?: string, additionalData?: unknown): void {
      const contextMessage = context ? `[${context}] ` : "";
      this.logger.debug(`${contextMessage}${message}`, additionalData);
    }

    logCriticalOperation(operation: string, details: Record<string, unknown>, success = true): void {
      if (this.enhancedLogger) {
        this.enhancedLogger.logCriticalOperation(operation, this.constructor.name, details, success);
      } else {
        const message = `Critical Operation: ${operation} ${success ? "completed successfully" : "failed"}`;
        if (success) {
          this.logger.log(message, details);
        } else {
          this.logger.error(message, details);
        }
      }
    }

    startPerformanceTimer(operationId: string, operation: string, metadata?: Record<string, unknown>): void {
      if (this.enhancedLogger) {
        this.enhancedLogger.startPerformanceTimer(operationId, operation, this.constructor.name, metadata);
      }
    }

    endPerformanceTimer(operationId: string, success = true, additionalMetadata?: Record<string, unknown>): void {
      if (this.enhancedLogger) {
        this.enhancedLogger.endPerformanceTimer(operationId, success, additionalMetadata);
      }
    }
  };
}
