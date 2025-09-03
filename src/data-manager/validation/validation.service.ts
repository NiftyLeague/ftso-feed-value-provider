import { Injectable } from "@nestjs/common";
import { BaseEventService } from "@/common/base/base-event.service";
import type { PriceUpdate, EnhancedFeedId } from "@/common/types/core";
import { ErrorSeverity, ErrorCode } from "@/common/types/error-handling";
import type { ValidationResult } from "@/common/types/utils";
import type { ServicePerformanceMetrics, ServiceHealthStatus } from "@/common/types/services";
import type { HealthCheckResult } from "@/common/types/monitoring";
import type {
  DataValidatorConfig,
  DataValidatorResult,
  IDataValidatorService,
  ValidationContext,
} from "@/common/types/data-manager";

import { DataValidator } from "./data-validator";

@Injectable()
export class ValidationService extends BaseEventService implements IDataValidatorService {
  private readonly validator: DataValidator;
  private readonly config: DataValidatorConfig;

  // Cache for validation results
  private validationCache = new Map<string, { result: DataValidatorResult; timestamp: number }>();

  // Historical data storage for validation context
  private historicalPrices = new Map<string, PriceUpdate[]>();
  private crossSourcePrices = new Map<string, PriceUpdate[]>();

  // Validation statistics
  private validationStats = {
    totalValidations: 0,
    validUpdates: 0,
    invalidUpdates: 0,
    averageValidationTime: 0,
  };

  // Cleanup interval
  private cleanupInterval?: NodeJS.Timeout;

  constructor(validator: DataValidator, config?: Partial<DataValidatorConfig>) {
    super(ValidationService.name);

    this.validator = validator;
    this.config = {
      // Required by DataValidatorConfig
      consensusWeight: 0.8,
      crossSourceWindow: 10000, // 10 seconds
      enableBatchValidation: true,
      enableRealTimeValidation: true,
      historicalDataWindow: 50, // Keep last 50 prices
      maxAge: 2000,
      maxBatchSize: 100,
      outlierThreshold: 0.05,
      priceRange: { min: 0.01, max: 1_000_000 },
      validationCacheSize: 1000,
      validationCacheTTL: 5000, // 5 seconds
      validationTimeout: 5000,
      ...config,
    };

    this.setupCleanupInterval();
  }

  /**
   * Typed event overloads for emit() — must be declared immediately before the implementation
   */
  override emit(
    event: "validationPassed",
    payload: { update: PriceUpdate; feedId: EnhancedFeedId; result: DataValidatorResult }
  ): boolean;
  override emit(
    event: "validationFailed",
    payload: {
      update: PriceUpdate;
      feedId: EnhancedFeedId;
      result: DataValidatorResult;
      errors: DataValidatorResult["errors"];
    }
  ): boolean;
  override emit(
    event: "criticalValidationError",
    payload: { update: PriceUpdate; feedId: EnhancedFeedId; error: DataValidatorResult["errors"][number] }
  ): boolean;
  override emit(
    event: "batchValidationCompleted",
    payload: {
      feedId: EnhancedFeedId;
      totalUpdates: number;
      validUpdates: number;
      results: Map<string, DataValidatorResult>;
    }
  ): boolean;
  // Base signature overload to ensure compatibility with implementation
  override emit(event: string | symbol, ...args: unknown[]): boolean;
  override emit(event: string | symbol, ...args: unknown[]): boolean {
    return super.emit(event, ...args);
  }

  /**
   * Typed event overloads for on()
   */
  override on(
    event: "validationPassed",
    callback: (payload: { update: PriceUpdate; feedId: EnhancedFeedId; result: DataValidatorResult }) => void
  ): this;
  override on(
    event: "validationFailed",
    callback: (payload: {
      update: PriceUpdate;
      feedId: EnhancedFeedId;
      result: DataValidatorResult;
      errors: DataValidatorResult["errors"];
    }) => void
  ): this;
  override on(
    event: "criticalValidationError",
    callback: (payload: {
      update: PriceUpdate;
      feedId: EnhancedFeedId;
      error: DataValidatorResult["errors"][number];
    }) => void
  ): this;
  override on(
    event: "batchValidationCompleted",
    callback: (payload: {
      feedId: EnhancedFeedId;
      totalUpdates: number;
      validUpdates: number;
      results: Map<string, DataValidatorResult>;
    }) => void
  ): this;
  // Base signature overload to ensure compatibility with implementation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override on(event: string | symbol, listener: (...args: any[]) => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  // Cleanup method exposed for tests (wrapper)
  cleanupForTests(): void {
    this.cleanup();
  }

  protected override cleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    super.cleanup();
  }

  // Real-time validation for individual price updates
  async validateRealTime(
    update: PriceUpdate,
    feedId: EnhancedFeedId,
    DataValidatorConfig?: Partial<DataValidatorConfig>
  ): Promise<DataValidatorResult> {
    if (!this.config.enableRealTimeValidation) {
      return {
        isValid: true,
        errors: [],
        warnings: [],
        timestamp: Date.now(),
        confidence: update.confidence,
        adjustedUpdate: update,
      };
    }

    const startTime = Date.now();

    try {
      // Check cache first
      const cacheKey = this.getCacheKey(update, feedId);
      const cached = this.validationCache.get(cacheKey);

      if (cached && Date.now() - cached.timestamp < this.config.validationCacheTTL) {
        return cached.result;
      }

      // Build validation context
      const context = this.buildValidationContext(update, feedId);

      // Perform validation
      // Map provided partial config to validator config with sensible defaults
      const mappedConfig = DataValidatorConfig
        ? {
            maxAge: 2000,
            priceRange: { min: 0.01, max: 1_000_000 },
            outlierThreshold: 0.05,
            consensusWeight: 0.8,
            ...DataValidatorConfig,
          }
        : undefined;

      const result = await this.validator.validateUpdate(update, context, mappedConfig);

      // Cache result
      this.cacheDataValidatorResult(cacheKey, result);

      // Update historical data
      this.updateHistoricalData(update, feedId);

      // Update statistics
      this.updateValidationStats(result, Date.now() - startTime);

      // Emit validation events
      this.emitValidationEvents(update, feedId, result);

      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Real-time validation failed for ${update.source}:`, error);

      return {
        isValid: false,
        errors: [
          {
            code: ErrorCode.DATA_VALIDATION_FAILED,
            message: `Validation service error: ${message}`,
            severity: ErrorSeverity.CRITICAL,
            operation: "validateRealTime",
            validationErrors: [message],
          },
        ],
        warnings: [],
        timestamp: Date.now(),
        confidence: 0,
      };
    }
  }

  // Batch validation for multiple updates
  async validateBatch(
    updates: PriceUpdate[],
    feedId: EnhancedFeedId,
    DataValidatorConfig?: Partial<DataValidatorConfig>
  ): Promise<Map<string, DataValidatorResult>> {
    if (!this.config.enableBatchValidation) {
      const results = new Map<string, DataValidatorResult>();
      for (const update of updates) {
        const key = `${update.source}-${update.timestamp}`;
        results.set(key, {
          isValid: true,
          errors: [],
          warnings: [],
          timestamp: Date.now(),
          confidence: update.confidence,
          adjustedUpdate: update,
        });
      }
      return results;
    }

    const startTime = Date.now();

    try {
      // Build validation context for batch
      const context = this.buildBatchValidationContext(updates, feedId);

      // Perform batch validation
      // Convert DataValidatorConfiguration to DataValidatorConfig
      const mappedConfig = DataValidatorConfig
        ? {
            maxAge: 2000, // Default from validator
            priceRange: { min: 0.01, max: 1000000 }, // Default from validator
            outlierThreshold: 0.05, // Default from validator
            consensusWeight: 0.8, // Default from validator
          }
        : undefined;

      const results = await this.validator.validateBatch(updates, context, mappedConfig);

      // Update historical data for all updates
      for (const update of updates) {
        this.updateHistoricalData(update, feedId);
      }

      // Update statistics
      const validResults = Array.from(results.values());
      for (const result of validResults) {
        this.updateValidationStats(result, (Date.now() - startTime) / validResults.length);
      }

      // Emit batch validation event
      this.emit("batchValidationCompleted", {
        feedId,
        totalUpdates: updates.length,
        validUpdates: validResults.filter(r => r.isValid).length,
        results,
      });

      return results;
    } catch (error) {
      this.logger.error(`Batch validation failed:`, error);
      throw error;
    }
  }

  // Filter valid updates from a batch
  filterValidUpdates(updates: PriceUpdate[], DataValidatorResults: Map<string, DataValidatorResult>): PriceUpdate[] {
    const validUpdates: PriceUpdate[] = [];

    for (const update of updates) {
      const key = `${update.source}-${update.symbol}-${update.timestamp}`;
      const result = DataValidatorResults.get(key);

      if (
        result?.isValid &&
        result.adjustedUpdate &&
        typeof result.adjustedUpdate === "object" &&
        "symbol" in result.adjustedUpdate
      ) {
        validUpdates.push(result.adjustedUpdate as PriceUpdate);
      }
    }

    return validUpdates;
  }

  // Get validation statistics
  getValidationStats(): {
    totalValidations: number;
    validUpdates: number;
    invalidUpdates: number;
    validationRate: number;
    averageValidationTime: number;
    cacheSize: number;
    historicalDataSize: number;
  } {
    const validationRate =
      this.validationStats.totalValidations > 0
        ? this.validationStats.validUpdates / this.validationStats.totalValidations
        : 0;

    return {
      totalValidations: this.validationStats.totalValidations,
      validUpdates: this.validationStats.validUpdates,
      invalidUpdates: this.validationStats.invalidUpdates,
      validationRate,
      averageValidationTime: this.validationStats.averageValidationTime,
      cacheSize: this.validationCache.size,
      historicalDataSize: this.historicalPrices.size,
    };
  }

  // Clear validation cache
  clearCache(): void {
    this.validationCache.clear();
    this.logger.log("Validation cache cleared");
  }

  // Clear historical data
  clearHistoricalData(): void {
    this.historicalPrices.clear();
    this.crossSourcePrices.clear();
    this.logger.log("Historical validation data cleared");
  }

  // Private helper methods
  private buildValidationContext(update: PriceUpdate, feedId: EnhancedFeedId): ValidationContext {
    const feedKey = this.getFeedKey(feedId);

    return {
      feedId,
      timestamp: Date.now(),
      source: update.source,
      historicalPrices: this.historicalPrices.get(feedKey) || [],
      crossSourcePrices: this.getCrossSourcePrices(update, feedId),
      consensusMedian: this.getConsensusMedian(feedId),
    };
  }

  private buildBatchValidationContext(updates: PriceUpdate[], feedId: EnhancedFeedId): ValidationContext {
    const feedKey = this.getFeedKey(feedId);

    // Combine all updates for cross-source validation
    const allCrossSourcePrices = [...(this.crossSourcePrices.get(feedKey) || []), ...updates];

    return {
      feedId,
      timestamp: Date.now(),
      source: updates[0]?.source || "batch",
      historicalPrices: this.historicalPrices.get(feedKey) || [],
      crossSourcePrices: allCrossSourcePrices,
      consensusMedian: this.getConsensusMedian(feedId),
    };
  }

  private getCrossSourcePrices(update: PriceUpdate, feedId: EnhancedFeedId): PriceUpdate[] {
    const feedKey = this.getFeedKey(feedId);
    const allPrices = this.crossSourcePrices.get(feedKey) || [];

    // Filter prices within the cross-source window and from different sources
    const cutoffTime = Date.now() - this.config.crossSourceWindow;

    return allPrices.filter(
      price => price.timestamp > cutoffTime && price.source !== update.source && price.symbol === update.symbol
    );
  }

  private getConsensusMedian(_feedId: EnhancedFeedId): number | undefined {
    // This would be implemented when consensus data is available
    // For now, return undefined
    return undefined;
  }

  private updateHistoricalData(update: PriceUpdate, feedId: EnhancedFeedId): void {
    const feedKey = this.getFeedKey(feedId);

    // Update historical prices
    const historical = this.historicalPrices.get(feedKey) || [];
    historical.push(update);

    // Keep only the most recent prices within the window
    if (historical.length > this.config.historicalDataWindow) {
      historical.splice(0, historical.length - this.config.historicalDataWindow);
    }

    this.historicalPrices.set(feedKey, historical);

    // Update cross-source prices
    const crossSource = this.crossSourcePrices.get(feedKey) || [];
    crossSource.push(update);

    // Remove old cross-source prices
    const cutoffTime = Date.now() - this.config.crossSourceWindow;
    const filteredCrossSource = crossSource.filter(price => price.timestamp > cutoffTime);

    this.crossSourcePrices.set(feedKey, filteredCrossSource);
  }

  private cacheDataValidatorResult(key: string, result: DataValidatorResult): void {
    // Remove oldest entries if cache is full
    if (this.validationCache.size >= this.config.validationCacheSize) {
      const oldestKey = this.validationCache.keys().next().value as string | undefined;
      if (oldestKey !== undefined) {
        this.validationCache.delete(oldestKey);
      }
    }

    this.validationCache.set(key, {
      result,
      timestamp: Date.now(),
    });
  }

  private updateValidationStats(result: DataValidatorResult, validationTime: number): void {
    this.validationStats.totalValidations++;

    if (result.isValid) {
      this.validationStats.validUpdates++;
    } else {
      this.validationStats.invalidUpdates++;
    }

    // Update average validation time using exponential moving average
    const alpha = 0.1;
    this.validationStats.averageValidationTime =
      alpha * validationTime + (1 - alpha) * this.validationStats.averageValidationTime;
  }

  private emitValidationEvents(update: PriceUpdate, feedId: EnhancedFeedId, result: DataValidatorResult): void {
    if (result.isValid) {
      this.emit("validationPassed", {
        update,
        feedId,
        result,
      });
    } else {
      this.emit("validationFailed", {
        update,
        feedId,
        result,
        errors: result.errors,
      });

      // Emit specific error events
      for (const error of result.errors) {
        if (error.severity === ErrorSeverity.CRITICAL) {
          this.emit("criticalValidationError", {
            update,
            feedId,
            error,
          });
        }
      }
    }
  }

  private getCacheKey(update: PriceUpdate, feedId: EnhancedFeedId): string {
    return `${feedId.category}-${feedId.name}-${update.source}-${update.timestamp}`;
  }

  private getFeedKey(feedId: EnhancedFeedId): string {
    return `${feedId.category}-${feedId.name}`;
  }

  private setupCleanupInterval(): void {
    // Clean up cache and historical data every 5 minutes
    this.cleanupInterval = setInterval(
      () => {
        this.cleanupCache();
        this.cleanupHistoricalData();
      },
      5 * 60 * 1000
    );
  }

  private cleanupCache(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, cached] of this.validationCache.entries()) {
      if (now - cached.timestamp > this.config.validationCacheTTL) {
        expiredKeys.push(key);
      }
    }

    for (const key of expiredKeys) {
      this.validationCache.delete(key);
    }

    if (expiredKeys.length > 0) {
      this.logger.debug(`Cleaned up ${expiredKeys.length} expired cache entries`);
    }
  }

  private cleanupHistoricalData(): void {
    const cutoffTime = Date.now() - this.config.crossSourceWindow;
    let cleanedFeeds = 0;

    for (const [feedKey, prices] of this.crossSourcePrices.entries()) {
      const filteredPrices = prices.filter(price => price.timestamp > cutoffTime);

      if (filteredPrices.length !== prices.length) {
        this.crossSourcePrices.set(feedKey, filteredPrices);
        cleanedFeeds++;
      }
    }

    if (cleanedFeeds > 0) {
      this.logger.debug(`Cleaned up historical data for ${cleanedFeeds} feeds`);
    }
  }

  // IDataValidationService interface methods
  async validate(update: PriceUpdate, feedId?: EnhancedFeedId): Promise<ValidationResult> {
    // Fallback feedId if not provided to satisfy internal usage
    const effectiveFeedId: EnhancedFeedId =
      feedId ?? ({ category: "unknown", name: update.symbol } as unknown as EnhancedFeedId);

    const result = await this.validateRealTime(update, effectiveFeedId);

    return {
      isValid: result.isValid,
      errors: result.errors.map(e => e.message),
      warnings: result.warnings,
    };
  }

  async validatePriceUpdate(
    update: PriceUpdate,
    feedId: EnhancedFeedId,
    DataValidatorConfig?: Partial<DataValidatorConfig>
  ): Promise<DataValidatorResult> {
    return this.validateRealTime(update, feedId, DataValidatorConfig);
  }

  getServiceName(): string {
    return "ValidationService";
  }

  getDataValidatorConfig(): DataValidatorConfig {
    return this.config;
  }

  // IBaseService interface methods
  async getPerformanceMetrics(): Promise<ServicePerformanceMetrics> {
    const uptime = process.uptime();
    const stats = this.getValidationStats();

    const requestsPerSecond = uptime > 0 ? stats.totalValidations / uptime : 0;

    return {
      uptime,
      responseTime: {
        average: stats.averageValidationTime,
        p95: stats.averageValidationTime, // Approximation until distribution tracking is added
        max: stats.averageValidationTime, // Approximation placeholder
      },
      requestsPerSecond,
      errorRate: 1 - stats.validationRate,
    };
  }

  async getHealthStatus(): Promise<ServiceHealthStatus> {
    const stats = this.getValidationStats();

    let status: "healthy" | "degraded" | "unhealthy" = "healthy";

    if (stats.validationRate < 0.5) {
      status = "unhealthy";
    } else if (stats.validationRate < 0.8) {
      status = "degraded";
    }

    const details: HealthCheckResult[] = [
      {
        isHealthy: status !== "unhealthy",
        details: {
          component: "validation",
          status,
          timestamp: Date.now(),
          metrics: {
            uptime: process.uptime(),
            memoryUsage: process.memoryUsage().heapUsed,
            cpuUsage: 0,
            connectionCount: 0,
          },
        },
        timestamp: Date.now(),
      },
    ];

    return {
      status,
      timestamp: Date.now(),
      details,
    };
  }
}
