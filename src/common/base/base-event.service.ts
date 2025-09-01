import { EventEmitter } from "events";
import { BaseService } from "./base.service";

/**
 * Base event service class that standardizes EventEmitter patterns
 * Extends BaseService for logging functionality and adds EventEmitter capabilities
 */
export abstract class BaseEventService extends BaseService {
  private readonly eventListeners = new Map<string, number>();
  private eventEmitter: EventEmitter;

  constructor(serviceName: string, useEnhancedLogger = false) {
    super(serviceName, useEnhancedLogger);

    // Initialize EventEmitter functionality
    this.eventEmitter = new EventEmitter();

    // Set up event listener tracking
    this.setupEventTracking();
  }

  // EventEmitter delegation methods
  emit(event: string | symbol, ...args: unknown[]): boolean {
    return this.eventEmitter.emit(event, ...args);
  }

  on(event: string | symbol, listener: (...args: unknown[]) => void): this {
    this.eventEmitter.on(event, listener);
    // Track listeners added via standard on() method
    if (typeof event === "string") {
      this.trackListener(event);

      // Check for max listeners exceeded
      const currentCount = this.listenerCount(event);
      if (currentCount > this.getMaxListeners()) {
        // Call logger directly to match test expectations
        this.logger.warn(`Max listeners exceeded for event: ${event}`, "EventEmitter");
        // Emit maxListenersExceeded event for testing
        this.eventEmitter.emit("maxListenersExceeded", event);
      }
    }
    return this;
  }

  once(event: string | symbol, listener: (...args: unknown[]) => void): this {
    this.eventEmitter.once(event, listener);
    return this;
  }

  off(event: string | symbol, listener: (...args: unknown[]) => void): this {
    this.eventEmitter.off(event, listener);
    // Track listeners removed via standard off() method
    if (typeof event === "string") {
      this.untrackListener(event);
    }
    return this;
  }

  removeAllListeners(event?: string | symbol): this {
    this.eventEmitter.removeAllListeners(event);
    return this;
  }

  listenerCount(event: string | symbol): number {
    return this.eventEmitter.listenerCount(event);
  }

  listeners(event: string | symbol): Function[] {
    return this.eventEmitter.listeners(event);
  }

  setMaxListeners(n: number): this {
    this.eventEmitter.setMaxListeners(n);
    return this;
  }

  getMaxListeners(): number {
    return this.eventEmitter.getMaxListeners();
  }

  /**
   * Emit event with logging
   */
  protected emitWithLogging(event: string, ...args: unknown[]): boolean {
    this.logger.debug(`Emitting event: ${event}`, { args });
    return this.emit(event, ...args);
  }

  /**
   * Add listener with logging and tracking
   */
  protected addListenerWithTracking(event: string, listener: (...args: unknown[]) => void): this {
    this.logger.debug(`Adding listener for event: ${event}`);
    this.eventEmitter.on(event, listener);
    this.trackListener(event);

    return this;
  }

  /**
   * Remove listener with logging and tracking
   */
  protected removeListenerWithTracking(event: string, listener: (...args: unknown[]) => void): this {
    this.logger.debug(`Removing listener for event: ${event}`);
    this.eventEmitter.off(event, listener);
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
      this.removeAllListeners(event);
    } else {
      this.logger.debug("Removing all listeners for all events");
      this.eventListeners.clear();
      this.eventEmitter.removeAllListeners();
    }
    return this;
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
    // Handle uncaught errors
    this.eventEmitter.on("error", (error: Error) => {
      this.logError(error, "EventEmitter");
    });

    // Warn about memory leaks
    this.setMaxListeners(20); // Reasonable default
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
   * Cleanup method to be called on service destruction
   */
  protected cleanup(): void {
    this.logger.debug("Cleaning up event listeners");
    this.removeAllListenersWithLogging();
  }
}
