import type { EventEmitter } from "events";
import type { ProviderRateLimitConfig } from "../rate-limiting";

export interface ConfigurableCapabilities<TConfig extends Record<string, unknown>> {
  updateConfig(newConfig: Partial<TConfig>): void;
  getConfig(): Readonly<TConfig>;
  resetConfig(): void;
  validateConfig(): void;
  onConfigUpdated?(oldConfig: TConfig, newConfig: TConfig): void;
}

export interface LoggingCapabilities {
  initializeEnhancedLogging(useEnhancedLogging: boolean): void;
  logInitialization(message?: string): void;
  logShutdown(message?: string): void;
  logPerformance(operation: string, duration: number, threshold?: number): void;
  logError(error: Error, context?: string, additionalData?: Record<string, unknown>): void;
  logWarning(message: string, context?: string, additionalData?: Record<string, unknown>): void;
  logDebug(message: string, context?: string, additionalData?: unknown): void;
  logFatal(message: string, context?: string, additionalData?: Record<string, unknown>): void;
  logCriticalOperation(operation: string, details: Record<string, unknown>, success?: boolean): void;
  startPerformanceTimer(operationId: string, operation: string, metadata?: Record<string, unknown>): void;
  endPerformanceTimer(operationId: string, success?: boolean, additionalMetadata?: Record<string, unknown>): void;
}

export enum ServiceStatus {
  Unknown = "unknown",
  Connected = "connected",
  Disconnected = "disconnected",
  Error = "error",
  RateLimited = "rate_limited",
}

export interface DataProviderCapabilities {
  getConnectionStatus(): ServiceStatus;
  setConnectionStatus(status: ServiceStatus): void;
  getRateLimitConfig(): ProviderRateLimitConfig;
  updateRateLimitConfig(config: Partial<ProviderRateLimitConfig>): void;
  getCurrentRequestCount(): number;
  isRateLimited(): boolean;
  getTimeToRateLimitReset(): number;
  getErrorRate(): number;
  getSuccessRate(): number;
  resetRateLimitCounters(): void;
  recordSuccessfulRequest(): void;
  recordFailedRequest(): void;
}

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
      retryLogLevel?: "warn" | "debug" | "silent";
    }
  ): Promise<T | undefined>;
  getErrorCount(context: string): number;
  resetErrorTracking(context?: string): void;
}

export interface EventCapabilities {
  eventEmitter: EventEmitter;
  emit(event: string | symbol, ...args: unknown[]): boolean;
  on<T extends unknown[]>(event: string | symbol, listener: (...args: T) => void): this;
  once<T extends unknown[]>(event: string | symbol, listener: (...args: T) => void): this;
  off<T extends unknown[]>(event: string | symbol, listener: (...args: T) => void): this;
  removeAllListeners(event?: string | symbol): this;
  listenerCount(event: string | symbol): number;
  listeners(event: string | symbol): Function[];
  setMaxListeners(n: number): this;
  getMaxListeners(): number;
  emitWithLogging(event: string, ...args: unknown[]): boolean;
  getEventStats(): Record<string, number>;
  logEventStats(): void;
}

export interface LifecycleCapabilities {
  isInitialized: boolean;
  isDestroyed: boolean;
  initializationPromise?: Promise<void>;
  cleanupPromise?: Promise<void>;
  isServiceInitialized(): boolean;
  isServiceDestroyed(): boolean;
  ensureInitialized(): void;
  onModuleInit(): Promise<void>;
  onModuleDestroy(): Promise<void>;
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
  performInitialization(): Promise<void>;
  performCleanup(): Promise<void>;
}

export interface MonitoringCapabilities {
  recordMetric(name: string, value: number): void;
  incrementCounter(name: string, increment?: number): void;
  startTimer(operationName: string): void;
  endTimer(operationName: string): number;
  setHealthStatus(status: "healthy" | "unhealthy" | "degraded"): void;
  getHealthStatus(): {
    status: "healthy" | "unhealthy" | "degraded";
    lastCheck: number;
    uptime: number;
  };
  getMetrics(): Record<string, number>;
  getCounters(): Record<string, number>;
}

export interface ValidationRule<T = unknown> {
  name: string;
  validate: (value: T) => boolean;
  message?: string;
}

export interface ValidationCapabilities {
  addValidationRule<T>(rule: ValidationRule<T>, silent?: boolean): void;
  removeValidationRule(name: string): void;
  getValidationRules(): ReadonlyArray<ValidationRule>;
  validate<T>(value: T): boolean;
  getFailedRules(): ReadonlySet<string>;
  clearValidationRules(): void;
}
