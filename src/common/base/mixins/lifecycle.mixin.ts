import { OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import type { Constructor, AbstractConstructor, IBaseService } from "../../types/services";

/**
 * Lifecycle management capabilities
 */
export interface LifecycleCapabilities {
  isServiceInitialized(): boolean;
  isServiceDestroyed(): boolean;
  ensureInitialized(): void;
  createTimeout(callback: () => void, delay: number): NodeJS.Timeout;
  createInterval(callback: () => void, delay: number): NodeJS.Timeout;
  clearTimer(timer: NodeJS.Timeout): void;
  clearInterval(interval: NodeJS.Timeout): void;
  createEventDrivenScheduler(callback: () => void, batchDelay?: number): () => void;
  waitForCondition(
    condition: () => boolean | Promise<boolean>,
    options?: {
      maxAttempts?: number;
      checkInterval?: number;
      timeout?: number;
    }
  ): Promise<boolean>;
  initialize?(): Promise<void>;
  cleanup?(): Promise<void>;
}

/**
 * Mixin that adds lifecycle management to a service
 */
export function WithLifecycle<TBase extends Constructor | AbstractConstructor>(Base: TBase) {
  return class LifecycleMixin extends Base implements OnModuleInit, OnModuleDestroy, LifecycleCapabilities {
    public isInitialized = false;
    public isDestroyed = false;
    public initializationPromise?: Promise<void>;
    public cleanupPromise?: Promise<void>;
    public managedTimers = new Set<NodeJS.Timeout>();
    public managedIntervals = new Set<NodeJS.Timeout>();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args);
    }

    async onModuleInit(): Promise<void> {
      if (this.isInitialized || this.initializationPromise) {
        return this.initializationPromise;
      }

      this.initializationPromise = this.performInitialization();
      return this.initializationPromise;
    }

    async onModuleDestroy(): Promise<void> {
      if (this.isDestroyed || this.cleanupPromise) {
        return this.cleanupPromise;
      }

      this.cleanupPromise = this.performCleanup();
      return this.cleanupPromise;
    }

    isServiceInitialized(): boolean {
      return this.isInitialized;
    }

    isServiceDestroyed(): boolean {
      return this.isDestroyed;
    }

    ensureInitialized(): void {
      if (!this.isInitialized) {
        throw new Error(`${this.constructor.name} is not initialized`);
      }
      if (this.isDestroyed) {
        throw new Error(`${this.constructor.name} has been destroyed`);
      }
    }

    createTimeout(callback: () => void, delay: number): NodeJS.Timeout {
      const timer = setTimeout(() => {
        this.managedTimers.delete(timer);
        callback();
      }, delay);
      this.managedTimers.add(timer);
      return timer;
    }

    createInterval(callback: () => void, delay: number): NodeJS.Timeout {
      const interval = setInterval(callback, delay);
      this.managedIntervals.add(interval);
      return interval;
    }

    /**
     * Create an event-driven scheduler that batches multiple events
     * This replaces fixed intervals with event-driven scheduling
     */
    createEventDrivenScheduler(callback: () => void, batchDelay = 100): () => void {
      let scheduled = false;

      return () => {
        if (scheduled) return;

        scheduled = true;
        const timer = setTimeout(() => {
          scheduled = false;
          if (!this.isDestroyed) {
            callback();
          }
        }, batchDelay);

        this.managedTimers.add(timer);
      };
    }

    /**
     * Wait for a condition to be true instead of using fixed delays
     */
    async waitForCondition(
      condition: () => boolean | Promise<boolean>,
      options: {
        maxAttempts?: number;
        checkInterval?: number;
        timeout?: number;
      } = {}
    ): Promise<boolean> {
      const { maxAttempts = 60, checkInterval = 1000, timeout } = options;
      const startTime = Date.now();

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (this.isDestroyed) {
          return false;
        }

        // Check timeout
        if (timeout && Date.now() - startTime > timeout) {
          return false;
        }

        try {
          const result = await condition();
          if (result) {
            return true;
          }
        } catch {
          // Continue checking on errors
        }

        // Wait before next check
        await new Promise(resolve => {
          const timer = setTimeout(resolve, checkInterval);
          this.managedTimers.add(timer);
        });
      }

      return false;
    }

    clearTimer(timer: NodeJS.Timeout): void {
      clearTimeout(timer);
      this.managedTimers.delete(timer);
    }

    clearInterval(interval: NodeJS.Timeout): void {
      clearInterval(interval);
      this.managedIntervals.delete(interval);
    }

    initialize?(): Promise<void>;
    cleanup?(): Promise<void>;

    public async performInitialization(): Promise<void> {
      try {
        (this as unknown as IBaseService).logger.log("Initializing service...");
        await this.initialize?.();
        this.isInitialized = true;
        (this as unknown as IBaseService).logger.log("Service initialized successfully");
      } catch (error) {
        (this as unknown as IBaseService).logError(error as Error, "Service initialization failed");
        throw error;
      }
    }

    public async performCleanup(): Promise<void> {
      try {
        (this as unknown as IBaseService).logger.log("Cleaning up service...");

        // Clear all timers and intervals
        this.managedTimers.forEach(timer => clearTimeout(timer));
        this.managedIntervals.forEach(interval => clearInterval(interval));
        this.managedTimers.clear();
        this.managedIntervals.clear();

        // Perform custom cleanup
        await this.cleanup?.();

        this.isDestroyed = true;
        (this as unknown as IBaseService).logger.log("Service cleanup completed");
      } catch (error) {
        (this as unknown as IBaseService).logError(error as Error, "Service cleanup failed");
        throw error;
      }
    }
  };
}
