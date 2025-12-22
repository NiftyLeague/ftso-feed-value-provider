import { FilteredLogger } from "../../logging/filtered-logger";
import { EnhancedLoggerService } from "../../logging/enhanced-logger.service";
import type { AnyConstructor, ConstructorArgs, ConstructorInstance } from "../../types/services/mixins";
import type { LoggingCapabilities } from "../../types/services/mixin-capabilities.types";

/**
 * Mixin that adds logging capabilities to a service
 */
export function WithLogging<TBase extends AnyConstructor>(
  Base: TBase
): AnyConstructor<
  ConstructorArgs<TBase>,
  ConstructorInstance<TBase> &
    LoggingCapabilities & {
      readonly logger: FilteredLogger;
      enhancedLogger?: EnhancedLoggerService;
    }
> {
  return class LoggingMixin extends Base implements LoggingCapabilities {
    public readonly logger: FilteredLogger = new FilteredLogger(this.constructor.name);
    public enhancedLogger?: EnhancedLoggerService;

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
      if (additionalData) {
        this.logger.error(`${contextMessage}${error.message}`, error.stack, additionalData);
      } else {
        this.logger.error(`${contextMessage}${error.message}`, error.stack);
      }
    }

    logWarning(message: string, context?: string, additionalData?: Record<string, unknown>): void {
      const contextMessage = context ? `[${context}] ` : "";
      if (additionalData) {
        this.logger.warn(`${contextMessage}${message}`, additionalData);
      } else {
        this.logger.warn(`${contextMessage}${message}`);
      }
    }

    logDebug(message: string, context?: string, additionalData?: unknown): void {
      const contextMessage = context ? `[${context}] ` : "";
      if (additionalData !== undefined) {
        this.logger.debug(`${contextMessage}${message}`, additionalData);
      } else {
        this.logger.debug(`${contextMessage}${message}`);
      }
    }

    logFatal(message: string, context?: string, additionalData?: Record<string, unknown>): void {
      const contextMessage = context ? `[${context}] ` : "";
      if (additionalData) {
        this.logger.fatal(`${contextMessage}${message}`, additionalData);
      } else {
        this.logger.fatal(`${contextMessage}${message}`);
      }
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
      this.enhancedLogger?.startPerformanceTimer(operationId, operation, this.constructor.name, metadata);
    }

    endPerformanceTimer(operationId: string, success = true, additionalMetadata?: Record<string, unknown>): void {
      this.enhancedLogger?.endPerformanceTimer(operationId, success, additionalMetadata);
    }
  } as unknown as AnyConstructor<
    ConstructorArgs<TBase>,
    ConstructorInstance<TBase> &
      LoggingCapabilities & {
        readonly logger: FilteredLogger;
        enhancedLogger?: EnhancedLoggerService;
      }
  >;
}
