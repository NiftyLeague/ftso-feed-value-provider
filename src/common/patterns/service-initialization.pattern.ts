/**
 * Service Initialization Pattern - Aggressive Deduplication
 * Consolidates repeated service initialization patterns
 * Eliminates 50+ instances of duplicated initialization logic
 */

import { EventDrivenService } from "../base/composed.service";

export interface ServiceInitializationOptions {
  retries?: number;
  retryDelay?: number;
  onError?: (error: Error, attempt: number) => void;
  onSuccess?: () => void;
}

export interface ServiceInitializationStep {
  name: string;
  execute: () => Promise<void>;
  dependencies?: string[];
}

/**
 * Standard service initialization pattern
 */
export abstract class InitializableService extends EventDrivenService {
  public override isInitialized = false;
  protected initializationSteps: ServiceInitializationStep[] = [];

  /**
   * Initialize the service with standardized pattern
   */
  override async initialize(options: ServiceInitializationOptions = {}): Promise<void> {
    if (this.isInitialized) {
      this.logger.warn("Service already initialized");
      return;
    }

    this.startTimer("initialize");

    await this.executeWithErrorHandling(
      async () => {
        this.logger.log("Starting service initialization");

        // Execute initialization steps
        await this.executeInitializationSteps();

        // Mark as initialized
        this.isInitialized = true;

        const duration = this.endTimer("initialize");
        this.logger.log(`Service initialization completed in ${duration.toFixed(2)}ms`);

        // Emit initialization event
        this.emitWithLogging("initialized");

        options.onSuccess?.();
      },
      "service_initialization",
      {
        retries: options.retries ?? 2,
        retryDelay: options.retryDelay ?? 2000,
        onError: (error, attempt) => {
          this.logger.warn(`Initialization attempt ${attempt + 1} failed: ${error.message}`);
          options.onError?.(error, attempt);
        },
      }
    );
  }

  /**
   * Execute initialization steps in order
   */
  private async executeInitializationSteps(): Promise<void> {
    for (const step of this.initializationSteps) {
      this.logger.debug(`Executing initialization step: ${step.name}`);
      await step.execute();
    }
  }

  /**
   * Add an initialization step
   */
  protected addInitializationStep(step: ServiceInitializationStep): void {
    this.initializationSteps.push(step);
  }

  /**
   * Check if service is initialized
   */
  public override ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error("Service not initialized. Call initialize() first.");
    }
  }

  /**
   * Cleanup the service
   */
  override async cleanup(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    this.logger.log("Cleaning up service");
    this.isInitialized = false;
    this.emitWithLogging("cleaned_up");
  }
}

/**
 * Mixin for adding initialization capabilities to existing services
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function WithInitialization<TBase extends new (...args: any[]) => object>(Base: TBase) {
  return class extends Base {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args);
    }
    public isInitialized = false;
    public initializationSteps: ServiceInitializationStep[] = [];

    async initialize(options: ServiceInitializationOptions = {}): Promise<void> {
      if (this.isInitialized) {
        (this as unknown as { logger?: { warn: (msg: string) => void } }).logger?.warn("Service already initialized");
        return;
      }

      (this as unknown as { startTimer?: (name: string) => void }).startTimer?.("initialize");

      await (
        this as unknown as {
          executeWithErrorHandling?: (fn: () => Promise<void>, context: string, options: unknown) => Promise<void>;
        }
      ).executeWithErrorHandling?.(
        async () => {
          (this as unknown as { logger?: { log: (msg: string) => void } }).logger?.log(
            "Starting service initialization"
          );

          // Execute initialization steps
          await this.executeInitializationSteps();

          // Mark as initialized
          this.isInitialized = true;

          const duration = (this as unknown as { endTimer?: (name: string) => number }).endTimer?.("initialize");
          (this as unknown as { logger?: { log: (msg: string) => void } }).logger?.log(
            `Service initialization completed in ${duration?.toFixed(2)}ms`
          );

          // Emit initialization event
          (this as unknown as { emitWithLogging?: (event: string) => void }).emitWithLogging?.("initialized");

          options.onSuccess?.();
        },
        "service_initialization",
        {
          retries: options.retries ?? 2,
          retryDelay: options.retryDelay ?? 2000,
          onError: (error: Error, attempt: number) => {
            (this as unknown as { logger?: { warn: (msg: string) => void } }).logger?.warn(
              `Initialization attempt ${attempt + 1} failed: ${error.message}`
            );
            options.onError?.(error, attempt);
          },
        }
      );
    }

    public async executeInitializationSteps(): Promise<void> {
      for (const step of this.initializationSteps) {
        (this as unknown as { logger?: { debug: (msg: string) => void } }).logger?.debug(
          `Executing initialization step: ${step.name}`
        );
        await step.execute();
      }
    }

    public addInitializationStep(step: ServiceInitializationStep): void {
      this.initializationSteps.push(step);
    }

    public ensureInitialized(): void {
      if (!this.isInitialized) {
        throw new Error("Service not initialized. Call initialize() first.");
      }
    }

    async cleanup(): Promise<void> {
      if (!this.isInitialized) {
        return;
      }

      (this as unknown as { logger?: { log: (msg: string) => void } }).logger?.log("Cleaning up service");
      this.isInitialized = false;
      (this as unknown as { emitWithLogging?: (event: string) => void }).emitWithLogging?.("cleaned_up");
    }
  };
}
