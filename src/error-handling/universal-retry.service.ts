import { Injectable } from "@nestjs/common";
import { EventDrivenService } from "@/common/base/composed.service";
import { CircuitBreakerService } from "./circuit-breaker.service";
import { retryWithBackoff, isRetryableError } from "@/common/utils/error.utils";
import type { RetryConfig } from "@/common/types/error-handling";
import { DEFAULT_RETRY_CONFIG } from "@/common/types/error-handling";

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
      const result = await retryWithBackoff(
        async () => {
          attemptCount++;

          // Execute through circuit breaker
          return await this.circuitBreaker.execute(serviceId, async () => {
            this.enhancedLogger?.debug(`Executing ${operationName} (attempt ${attemptCount})`, {
              component: "UniversalRetryService",
              operation: "execute_with_retry",
              serviceId,
              operationName,
              attempt: attemptCount,
            });

            return await operation();
          });
        },
        {
          maxRetries: config.maxRetries,
          initialDelayMs: config.initialDelayMs,
          maxDelayMs: config.maxDelayMs,
          backoffMultiplier: config.backoffMultiplier,
          jitter: config.jitter,
          logger: this.logger,
        }
      );

      // Record successful execution
      this.recordRetrySuccess(serviceId, operationName, attemptCount, Date.now() - startTime);

      return result;
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
        recoveryTimeout: 30000, // 30 seconds
        timeout: 10000, // 10 second timeout
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
        recoveryTimeout: 60000, // 1 minute
        timeout: 30000, // 30 second timeout
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
    const currentConfig = this.retryConfigs.get(serviceId) || { ...DEFAULT_RETRY_CONFIG };
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
        maxRetries: 3,
        initialDelayMs: 1000,
        maxDelayMs: 15000,
      },
      database: {
        maxRetries: 2,
        initialDelayMs: 500,
        maxDelayMs: 5000,
      },
      cache: {
        maxRetries: 1,
        initialDelayMs: 100,
        maxDelayMs: 1000,
      },
      "external-api": {
        maxRetries: 3,
        initialDelayMs: 2000,
        maxDelayMs: 30000,
      },
      websocket: {
        maxRetries: 5,
        initialDelayMs: 1000,
        maxDelayMs: 60000,
      },
    };

    for (const [serviceType, config] of Object.entries(defaultConfigs)) {
      this.retryConfigs.set(serviceType, { ...DEFAULT_RETRY_CONFIG, ...config });
    }
  }

  private getRetryConfig(serviceId: string, override?: Partial<RetryConfig>): RetryConfig {
    const baseConfig = this.retryConfigs.get(serviceId) || { ...DEFAULT_RETRY_CONFIG };
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
}
