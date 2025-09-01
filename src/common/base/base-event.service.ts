import { EventEmitter } from "events";
import { Logger } from "@nestjs/common";
import { EnhancedLoggerService } from "@/utils/enhanced-logger.service";

/**
 * Base event service class that standardizes EventEmitter patterns
 * Eliminates EventEmitter boilerplate across services (130+ lines)
 */
export abstract class BaseEventService extends EventEmitter {
  protected readonly logger: Logger;
  protected readonly enhancedLogger?: EnhancedLoggerService;
  private readonly eventListeners = new Map<string, number>();

  constructor(serviceName: string, useEnhancedLogger = false) {
    super();
    this.logger = new Logger(serviceName);

    if (useEnhancedLogger) {
      this.enhancedLogger = new EnhancedLoggerService(serviceName);
    }

    // Set up event listener tracking
    this.setupEventTracking();
  }

  /**
   * Emit event with logging
   */
  protected emitWithLogging(event: string, ...args: any[]): boolean {
    this.logger.debug(`Emitting event: ${event}`, { args });
    return this.emit(event, ...args);
  }

  /**
   * Add listener with logging and tracking
   */
  protected addListenerWithTracking(event: string, listener: (...args: any[]) => void): this {
    this.logger.debug(`Adding listener for event: ${event}`);
    this.on(event, listener);
    this.trackListener(event);
    return this;
  }

  /**
   * Remove listener with logging and tracking
   */
  protected removeListenerWithTracking(event: string, listener: (...args: any[]) => void): this {
    this.logger.debug(`Removing listener for event: ${event}`);
    this.off(event, listener);
    this.untrackListener(event);
    return this;
  }

  /**
   * Remove all listeners for an event with logging
   */
  protected removeAllListenersWithLogging(event?: string): this {
    if (event) {
      this.logger.debug(`Removing all listeners for event: ${event}`);
      this.eventListeners.delete(event);
    } else {
      this.logger.debug("Removing all listeners for all events");
      this.eventListeners.clear();
    }
    return this.removeAllListeners(event);
  }

  /**
   * Get event listener statistics
   */
  protected getEventStats(): Record<string, number> {
    return Object.fromEntries(this.eventListeners);
  }

  /**
   * Log event statistics
   */
  protected logEventStats(): void {
    const stats = this.getEventStats();
    this.logger.debug("Event listener statistics:", stats);
  }

  /**
   * Setup event tracking and error handling
   */
  private setupEventTracking(): void {
    // Track when listeners are added
    this.on("newListener", (event: string) => {
      this.trackListener(event);
    });

    // Track when listeners are removed
    this.on("removeListener", (event: string) => {
      this.untrackListener(event);
    });

    // Handle uncaught errors
    this.on("error", (error: Error) => {
      this.logError(error, "EventEmitter");
    });

    // Warn about memory leaks
    this.setMaxListeners(20); // Reasonable default
    this.on("maxListenersExceeded", (event: string) => {
      this.logWarning(`Max listeners exceeded for event: ${event}`, "EventEmitter");
    });
  }

  /**
   * Track listener count for an event
   */
  private trackListener(event: string): void {
    const current = this.eventListeners.get(event) || 0;
    this.eventListeners.set(event, current + 1);
  }

  /**
   * Untrack listener count for an event
   */
  private untrackListener(event: string): void {
    const current = this.eventListeners.get(event) || 0;
    if (current > 1) {
      this.eventListeners.set(event, current - 1);
    } else {
      this.eventListeners.delete(event);
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

  /**
   * Cleanup method to be called on service destruction
   */
  protected cleanup(): void {
    this.logDebug("Cleaning up event listeners");
    this.removeAllListenersWithLogging();
  }
}
