import type { Constructor, AbstractConstructor, IBaseService } from "../../types/services";

/**
 * Error handling capabilities
 */
export interface ErrorHandlingCapabilities {
  handleError(
    error: Error,
    context: string,
    options?: {
      shouldThrow?: boolean;
      shouldLog?: boolean;
      threshold?: number;
      additionalData?: Record<string, unknown>;
    }
  ): void;
  executeWithErrorHandling<T>(
    operation: () => Promise<T>,
    context: string,
    options?: {
      retries?: number;
      retryDelay?: number;
      shouldThrow?: boolean;
      fallback?: () => Promise<T>;
      onError?: (error: Error, attempt: number) => void;
    }
  ): Promise<T | undefined>;
  getErrorCount(context: string): number;
  resetErrorTracking(context?: string): void;
}

/**
 * Mixin that adds error handling to a service
 */
export function WithErrorHandling<TBase extends Constructor | AbstractConstructor>(Base: TBase) {
  return class ErrorHandlingMixin extends Base implements ErrorHandlingCapabilities {
    public errorCounts = new Map<string, number>();
    public lastErrors = new Map<string, { error: Error; timestamp: number }>();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args);
    }

    handleError(
      error: Error,
      context: string,
      options: {
        shouldThrow?: boolean;
        shouldLog?: boolean;
        threshold?: number;
        additionalData?: Record<string, unknown>;
      } = {}
    ): void {
      const { shouldThrow = true, shouldLog = true, threshold, additionalData } = options;

      // Track error occurrence
      const count = this.errorCounts.get(context) || 0;
      this.errorCounts.set(context, count + 1);
      this.lastErrors.set(context, { error, timestamp: Date.now() });

      // Log error if requested
      if (shouldLog) {
        (this as unknown as IBaseService).logError(error, context, additionalData);
      }

      // Check threshold if specified
      if (threshold && count + 1 >= threshold) {
        (this as unknown as IBaseService).logger.error(`Error threshold exceeded for ${context}: ${threshold} errors`);
      }

      // Throw error if requested
      if (shouldThrow) {
        throw error;
      }
    }

    async executeWithErrorHandling<T>(
      operation: () => Promise<T>,
      context: string,
      options: {
        retries?: number;
        retryDelay?: number;
        shouldThrow?: boolean;
        fallback?: () => Promise<T>;
        onError?: (error: Error, attempt: number) => void;
      } = {}
    ): Promise<T | undefined> {
      const { retries = 0, retryDelay = 1000, shouldThrow = true, fallback, onError } = options;

      let lastError: Error | undefined;

      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          return await operation();
        } catch (error) {
          lastError = error as Error;

          if (onError) {
            onError(lastError, attempt);
          }

          if (attempt < retries) {
            (this as unknown as IBaseService).logWarning(
              `Operation failed, retrying in ${retryDelay}ms (attempt ${attempt + 1}/${retries + 1})`,
              context,
              {
                error: lastError.message,
              }
            );
            // Use sleep for retry delay (this mixin doesn't have waitForCondition)
            await this.sleep(retryDelay);
          }
        }
      }

      // All retries failed
      if (lastError) {
        this.handleError(lastError, context, { shouldThrow: false });

        // Try fallback if available
        if (fallback) {
          try {
            (this as unknown as IBaseService).logger.log(`Executing fallback for ${context}`);
            return await fallback();
          } catch (fallbackError) {
            this.handleError(fallbackError as Error, `${context}_fallback`, { shouldThrow: false });
          }
        }

        if (shouldThrow) {
          throw lastError;
        }
      }

      return undefined;
    }

    getErrorCount(context: string): number {
      return this.errorCounts.get(context) || 0;
    }

    resetErrorTracking(context?: string): void {
      if (context) {
        this.errorCounts.delete(context);
        this.lastErrors.delete(context);
      } else {
        this.errorCounts.clear();
        this.lastErrors.clear();
      }
    }

    public sleep(ms: number): Promise<void> {
      return new Promise(resolve => setTimeout(resolve, ms));
    }
  };
}
