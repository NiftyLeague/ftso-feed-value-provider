import { Injectable } from "@nestjs/common";
import { EventDrivenService } from "@/common/base/composed.service";
import { CircuitBreakerService } from "./circuit-breaker.service";
import { isRetryableError } from "@/common/utils/error.utils";
import type { RetryConfig } from "@/common/types/error-handling";
import { DEFAULT_RETRY_CONFIG, getRetryConfig } from "@/common/types/error-handling";
import { ENV } from "@/config/environment.constants";

type RetryStatistics = {
  totalAttempts: number;
  successfulRetries: number;
  failedRetries: number;
  successRate?: number;
  averageRetryTime: number;
  lastRetryTime?: Date;
};

/**
 * Universal retry service that provides standardized retry mechanisms
 * with exponential backoff for all external calls
 */
@Injectable()
export class UniversalRetryService extends EventDrivenService {
  private readonly retryConfigs = new Map<string, RetryConfig>();
  private readonly retryStats = new Map<string, RetryStatistics>();
  private isShuttingDown = false;

  // Rate limiting for warnings
  private warningLastLogged = new Map<string, number>();
  private readonly WARNING_COOLDOWN_MS = ENV.ERROR_HANDLING.WARNING_COOLDOWN_MS;

  constructor(private readonly circuitBreaker: CircuitBreakerService) {
    super();
    this.initializeDefaultConfigs();
  }

  /**
   * Execute operation with retry logic and circuit breaker protection
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    context: {
      serviceId: string;
      operationName: string;
      retryConfig?: Partial<RetryConfig>;
      circuitBreakerConfig?: {
        failureThreshold?: number;
        recoveryTimeout?: number;
        successThreshold?: number;
        timeout?: number;
      };
    }
  ): Promise<T> {
    const { serviceId, operationName, retryConfig, circuitBreakerConfig } = context;

    // Get retry configuration
    const config = this.getRetryConfig(serviceId, retryConfig);

    // Ensure circuit breaker is registered
    this.ensureCircuitBreakerRegistered(serviceId, circuitBreakerConfig);

    const startTime = Date.now();
    let attemptCount = 0;
    let lastError: Error | undefined;

    try {
      // Implement retry logic directly
      let delayMs = config.initialDelayMs;
      let result: T | undefined;

      for (let attempt = 1; attempt <= config.maxRetries + 1; attempt++) {
        try {
          attemptCount = attempt;

          // Check if service is shutting down
          if (this.isShuttingDown) {
            throw new Error(`Service is shutting down, aborting retry for ${serviceId}`);
          }

          // Execute through circuit breaker
          result = await this.circuitBreaker.execute(serviceId, async () => {
            this.enhancedLogger?.debug(`Executing ${operationName} (attempt ${attempt})`, {
              component: "UniversalRetryService",
              operation: "execute_with_retry",
              serviceId,
              operationName,
              attempt,
            });

            return await operation();
          });

          // Success - break out of retry loop
          break;
        } catch (error) {
          lastError = error as Error;

          if (attempt === config.maxRetries + 1 || this.isShuttingDown) {
            // Final attempt failed or service is shutting down
            throw lastError;
          }

          // Log retry attempt with rate limiting
          const now = Date.now();
          const warningKey = `${serviceId}_retry_warning`;
          const lastLogged = this.warningLastLogged.get(warningKey) || 0;

          if (now - lastLogged > this.WARNING_COOLDOWN_MS) {
            this.logger?.warn(
              `Attempt ${attempt}/${config.maxRetries + 1} failed: ${lastError.message}. Retrying in ${delayMs}ms...`
            );
            this.warningLastLogged.set(warningKey, now);
          }

          // Apply jitter if enabled
          const actualDelay = config.jitter
            ? delayMs * (ENV.PERFORMANCE.JITTER_MIN_FACTOR + Math.random() * ENV.PERFORMANCE.JITTER_MAX_FACTOR)
            : delayMs;
          await new Promise(resolve => setTimeout(resolve, actualDelay));

          // Calculate next delay with backoff
          delayMs = Math.min(delayMs * config.backoffMultiplier, config.maxDelayMs);
        }
      }

      // Record successful execution
      this.recordRetrySuccess(serviceId, operationName, attemptCount, Date.now() - startTime);

      return result!;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Record failed execution
      this.recordRetryFailure(serviceId, operationName, attemptCount, Date.now() - startTime, lastError);

      throw lastError;
    }
  }

  /**
   * Execute HTTP request with retry logic
   */
  async executeHttpWithRetry<T>(
    httpOperation: () => Promise<T>,
    context: {
      serviceId: string;
      endpoint: string;
      method: string;
      retryConfig?: Partial<RetryConfig>;
    }
  ): Promise<T> {
    return this.executeWithRetry(httpOperation, {
      serviceId: context.serviceId,
      operationName: `${context.method} ${context.endpoint}`,
      retryConfig: {
        ...context.retryConfig,
        // HTTP-specific retry configuration
        retryableErrors: [
          ...DEFAULT_RETRY_CONFIG.retryableErrors,
          "fetch failed",
          "request timeout",
          "socket hang up",
          "connect econnrefused",
          "getaddrinfo enotfound",
        ],
      },
      circuitBreakerConfig: {
        failureThreshold: 3, // Lower threshold for HTTP calls
        recoveryTimeout: ENV.TIMEOUTS.HTTP_RECOVERY_MS,
        timeout: ENV.TIMEOUTS.HTTP_MS,
      },
    });
  }

  /**
   * Execute database operation with retry logic
   */
  async executeDatabaseWithRetry<T>(
    dbOperation: () => Promise<T>,
    context: {
      serviceId: string;
      operation: string;
      retryConfig?: Partial<RetryConfig>;
    }
  ): Promise<T> {
    return this.executeWithRetry(dbOperation, {
      serviceId: context.serviceId,
      operationName: `DB:${context.operation}`,
      retryConfig: {
        ...context.retryConfig,
        // Database-specific retry configuration
        maxRetries: 2, // Fewer retries for DB operations
        initialDelayMs: 500,
        retryableErrors: [
          ...DEFAULT_RETRY_CONFIG.retryableErrors,
          "connection lost",
          "deadlock",
          "lock timeout",
          "connection refused",
        ],
      },
      circuitBreakerConfig: {
        failureThreshold: 5,
        recoveryTimeout: ENV.TIMEOUTS.DB_RECOVERY_MS,
        timeout: ENV.TIMEOUTS.DB_MS,
      },
    });
  }

  /**
   * Execute cache operation with retry logic
   */
  async executeCacheWithRetry<T>(
    cacheOperation: () => Promise<T>,
    context: {
      serviceId: string;
      operation: string;
      retryConfig?: Partial<RetryConfig>;
    }
  ): Promise<T> {
    return this.executeWithRetry(cacheOperation, {
      serviceId: context.serviceId,
      operationName: `Cache:${context.operation}`,
      retryConfig: {
        ...context.retryConfig,
        // Cache-specific retry configuration
        maxRetries: 1, // Minimal retries for cache operations
        initialDelayMs: 100,
        maxDelayMs: 1000,
      },
      circuitBreakerConfig: {
        failureThreshold: 10, // Higher threshold for cache
        recoveryTimeout: 15000, // 15 seconds
        timeout: 5000, // 5 second timeout
      },
    });
  }

  /**
   * Execute external API call with retry logic
   */
  async executeExternalApiWithRetry<T>(
    apiOperation: () => Promise<T>,
    context: {
      serviceId: string;
      apiName: string;
      endpoint: string;
      retryConfig?: Partial<RetryConfig>;
    }
  ): Promise<T> {
    return this.executeWithRetry(apiOperation, {
      serviceId: context.serviceId,
      operationName: `API:${context.apiName}:${context.endpoint}`,
      retryConfig: {
        ...context.retryConfig,
        // External API specific configuration
        retryableErrors: [
          ...DEFAULT_RETRY_CONFIG.retryableErrors,
          "rate limited",
          "quota exceeded",
          "api unavailable",
          "maintenance mode",
        ],
      },
      circuitBreakerConfig: {
        failureThreshold: 3,
        recoveryTimeout: 120000, // 2 minutes for external APIs
        timeout: 15000, // 15 second timeout
      },
    });
  }

  /**
   * Configure retry settings for a specific service
   */
  configureRetrySettings(serviceId: string, config: Partial<RetryConfig>): void {
    const currentConfig =
      this.retryConfigs.get(serviceId) ||
      getRetryConfig({
        maxRetries: ENV.RETRY.DEFAULT_MAX_RETRIES,
        initialDelayMs: ENV.RETRY.DEFAULT_INITIAL_DELAY_MS,
      });
    const newConfig = { ...currentConfig, ...config };

    this.retryConfigs.set(serviceId, newConfig);

    this.enhancedLogger?.log(`Updated retry configuration for service: ${serviceId}`, {
      component: "UniversalRetryService",
      operation: "configure_retry_settings",
      serviceId,
      config: newConfig,
    });
  }

  /**
   * Get retry statistics for monitoring
   */
  getRetryStatistics(): Record<string, RetryStatistics> {
    const stats: Record<string, RetryStatistics> = {};

    for (const [serviceId, serviceStats] of this.retryStats.entries()) {
      const successRate =
        serviceStats.totalAttempts > 0 ? (serviceStats.successfulRetries / serviceStats.totalAttempts) * 100 : 0;

      stats[serviceId] = {
        totalAttempts: serviceStats.totalAttempts,
        successfulRetries: serviceStats.successfulRetries,
        failedRetries: serviceStats.failedRetries,
        successRate: Math.round(successRate * 100) / 100,
        averageRetryTime: Math.round(serviceStats.averageRetryTime * 100) / 100,
        lastRetryTime: serviceStats.lastRetryTime,
      };
    }

    return stats;
  }

  /**
   * Reset retry statistics for a service
   */
  resetRetryStatistics(serviceId: string): void {
    this.retryStats.delete(serviceId);
    this.enhancedLogger?.log(`Reset retry statistics for service: ${serviceId}`, {
      component: "UniversalRetryService",
      operation: "reset_retry_statistics",
      serviceId,
    });
  }

  /**
   * Get current retry configuration for a service
   */
  getRetryConfiguration(serviceId: string): RetryConfig | undefined {
    return this.retryConfigs.get(serviceId);
  }

  /**
   * Check if an error is retryable based on configuration
   */
  isRetryableError(error: Error, serviceId?: string): boolean {
    const config = serviceId ? this.retryConfigs.get(serviceId) : undefined;

    if (config?.retryableErrors) {
      const message = error.message.toLowerCase();
      return config.retryableErrors.some(pattern => message.includes(pattern.toLowerCase()));
    }

    return isRetryableError(error);
  }

  // Private helper methods

  private initializeDefaultConfigs(): void {
    // Initialize default configurations for common service types
    const defaultConfigs: Record<string, Partial<RetryConfig>> = {
      http: {
        maxRetries: ENV.RETRY.DEFAULT_MAX_RETRIES,
        initialDelayMs: ENV.RETRY.DEFAULT_INITIAL_DELAY_MS,
        maxDelayMs: ENV.RETRY.HTTP_MAX_DELAY_MS,
      },
      database: {
        maxRetries: ENV.RETRY.DATABASE_MAX_RETRIES,
        initialDelayMs: ENV.RETRY.DATABASE_INITIAL_DELAY_MS,
        maxDelayMs: ENV.RETRY.DATABASE_MAX_DELAY_MS,
      },
      cache: {
        maxRetries: ENV.RETRY.CACHE_MAX_RETRIES,
        initialDelayMs: ENV.RETRY.CACHE_INITIAL_DELAY_MS,
        maxDelayMs: ENV.RETRY.CACHE_MAX_DELAY_MS,
      },
      "external-api": {
        maxRetries: ENV.RETRY.DEFAULT_MAX_RETRIES,
        initialDelayMs: ENV.RETRY.EXTERNAL_API_INITIAL_DELAY_MS,
        maxDelayMs: ENV.RETRY.EXTERNAL_API_MAX_DELAY_MS,
      },
      websocket: {
        maxRetries: ENV.RETRY.WEBSOCKET_MAX_RETRIES,
        initialDelayMs: ENV.RETRY.WEBSOCKET_INITIAL_DELAY_MS,
        maxDelayMs: ENV.RETRY.WEBSOCKET_MAX_DELAY_MS,
      },
    };

    for (const [serviceType, config] of Object.entries(defaultConfigs)) {
      this.retryConfigs.set(serviceType, {
        ...getRetryConfig({
          maxRetries: ENV.RETRY.DEFAULT_MAX_RETRIES,
          initialDelayMs: ENV.RETRY.DEFAULT_INITIAL_DELAY_MS,
        }),
        ...config,
      });
    }
  }

  private getRetryConfig(serviceId: string, override?: Partial<RetryConfig>): RetryConfig {
    const baseConfig =
      this.retryConfigs.get(serviceId) ||
      getRetryConfig({
        maxRetries: ENV.RETRY.DEFAULT_MAX_RETRIES,
        initialDelayMs: ENV.RETRY.DEFAULT_INITIAL_DELAY_MS,
      });
    return override ? { ...baseConfig, ...override } : baseConfig;
  }

  private ensureCircuitBreakerRegistered(
    serviceId: string,
    config?: {
      failureThreshold?: number;
      recoveryTimeout?: number;
      successThreshold?: number;
      timeout?: number;
    }
  ): void {
    if (!this.circuitBreaker.getState(serviceId)) {
      this.circuitBreaker.registerCircuit(serviceId, {
        failureThreshold: config?.failureThreshold || 5,
        recoveryTimeout: config?.recoveryTimeout || 60000,
        successThreshold: config?.successThreshold || 3,
        timeout: config?.timeout || 10000,
        monitoringWindow: 300000, // 5 minutes
      });
    }
  }

  private recordRetrySuccess(serviceId: string, operationName: string, attemptCount: number, totalTime: number): void {
    let stats = this.retryStats.get(serviceId);
    if (!stats) {
      stats = {
        totalAttempts: 0,
        successfulRetries: 0,
        failedRetries: 0,
        averageRetryTime: 0,
      };
      this.retryStats.set(serviceId, stats);
    }

    stats.totalAttempts += attemptCount;
    stats.successfulRetries++;
    stats.lastRetryTime = new Date();

    // Update average retry time
    const totalRetryTime = stats.averageRetryTime * (stats.successfulRetries - 1) + totalTime;
    stats.averageRetryTime = totalRetryTime / stats.successfulRetries;

    this.enhancedLogger?.log(`Retry operation succeeded: ${operationName}`, {
      component: "UniversalRetryService",
      operation: "record_retry_success",
      serviceId,
      operationName,
      attemptCount,
      totalTime,
      successRate: (stats.successfulRetries / (stats.successfulRetries + stats.failedRetries)) * 100,
    });

    // Emit success event
    this.emit("retrySuccess", {
      serviceId,
      operationName,
      attemptCount,
      totalTime,
      timestamp: Date.now(),
    });
  }

  private recordRetryFailure(
    serviceId: string,
    operationName: string,
    attemptCount: number,
    totalTime: number,
    error: Error
  ): void {
    let stats = this.retryStats.get(serviceId);
    if (!stats) {
      stats = {
        totalAttempts: 0,
        successfulRetries: 0,
        failedRetries: 0,
        averageRetryTime: 0,
      };
      this.retryStats.set(serviceId, stats);
    }

    stats.totalAttempts += attemptCount;
    stats.failedRetries++;
    stats.lastRetryTime = new Date();

    this.enhancedLogger?.error(error, {
      component: "UniversalRetryService",
      operation: "record_retry_failure",
      serviceId,
      operationName,
      attemptCount,
      totalTime,
      severity: "high",
      metadata: {
        failureRate: (stats.failedRetries / (stats.successfulRetries + stats.failedRetries)) * 100,
        consecutiveFailures: stats.failedRetries,
      },
    });

    // Emit failure event
    this.emit("retryFailure", {
      serviceId,
      operationName,
      attemptCount,
      totalTime,
      error: error.message,
      timestamp: Date.now(),
    });
  }

  /**
   * Cleanup method to stop all retry operations during shutdown
   */
  override async cleanup(): Promise<void> {
    // Set shutdown flag to prevent new retry operations
    this.isShuttingDown = true;

    // Clear all retry configurations and stats
    this.retryConfigs.clear();
    this.retryStats.clear();

    // Stop all active retry operations
    this.logger.debug("UniversalRetryService cleanup completed");
  }
}
