import { Injectable } from "@nestjs/common";
import { EventDrivenService } from "@/common/base/composed.service";
import { UniversalRetryService } from "@/error-handling/universal-retry.service";
import { ENV } from "@/config";
import { FeedCategory } from "@/common/types/core";
import type { PriceUpdate, CoreFeedId } from "@/common/types/core";
import { ErrorSeverity, ErrorCode } from "@/common/types/error-handling";
import type { ValidationResult } from "@/common/types/utils";
import type { ServicePerformanceMetrics } from "@/common/types/services";
import type {
  DataValidatorConfig,
  DataValidatorResult,
  ExtendedDataValidationError,
  IDataValidatorService,
  ValidationContext,
} from "@/common/types/data-manager";

import { DataValidator } from "./data-validator";

@Injectable()
export class ValidationService extends EventDrivenService implements IDataValidatorService {
  private readonly validator: DataValidator;
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

  // Cleanup is now managed by the lifecycle mixin

  constructor(
    validator: DataValidator,
    private readonly universalRetryService: UniversalRetryService,
    config?: Partial<DataValidatorConfig>
  ) {
    super({
      // Required by DataValidatorConfig
      consensusWeight: ENV.DATA_QUALITY.CONSENSUS_WEIGHT,
      crossSourceWindow: ENV.DATA_QUALITY.CROSS_SOURCE_WINDOW_MS,
      enableBatchValidation: true,
      enableRealTimeValidation: true,
      historicalDataWindow: ENV.DATA_QUALITY.HISTORICAL_DATA_WINDOW, // Keep last 50 prices
      maxAge: ENV.DATA_FRESHNESS.MAX_DATA_AGE_MS,
      maxBatchSize: ENV.DATA_QUALITY.MAX_BATCH_SIZE,
      outlierThreshold: ENV.DATA_QUALITY.OUTLIER_THRESHOLD,
      priceRange: { min: ENV.DATA_QUALITY.PRICE_RANGE_MIN, max: ENV.DATA_QUALITY.PRICE_RANGE_MAX },
      validationCacheSize: ENV.DATA_QUALITY.CACHE_SIZE,
      validationCacheTTL: ENV.DATA_QUALITY.CACHE_TTL_MS,
      validationTimeout: ENV.TIMEOUTS.VALIDATION_MS,
      ...config,
    });

    this.validator = validator;

    this.setupCleanupInterval();
  }

  /**
   * Get the typed configuration for this service
   */
  private get validationConfig(): DataValidatorConfig {
    return this.config as DataValidatorConfig;
  }

  /**
   * Typed event overloads for emit() — must be declared immediately before the implementation
   */
  override emit(
    event: "validationPassed",
    payload: { update: PriceUpdate; feedId: CoreFeedId; result: DataValidatorResult }
  ): boolean;
  override emit(
    event: "validationFailed",
    payload: {
      update: PriceUpdate;
      feedId: CoreFeedId;
      result: DataValidatorResult;
      errors: DataValidatorResult["errors"];
    }
  ): boolean;
  override emit(
    event: "criticalValidationError",
    payload: { update: PriceUpdate; feedId: CoreFeedId; error: DataValidatorResult["errors"][number] }
  ): boolean;
  override emit(
    event: "batchValidationCompleted",
    payload: {
      feedId: CoreFeedId;
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
    callback: (payload: { update: PriceUpdate; feedId: CoreFeedId; result: DataValidatorResult }) => void
  ): this;
  override on(
    event: "validationFailed",
    callback: (payload: {
      update: PriceUpdate;
      feedId: CoreFeedId;
      result: DataValidatorResult;
      errors: DataValidatorResult["errors"];
    }) => void
  ): this;
  override on(
    event: "criticalValidationError",
    callback: (payload: {
      update: PriceUpdate;
      feedId: CoreFeedId;
      error: DataValidatorResult["errors"][number];
    }) => void
  ): this;
  override on(
    event: "batchValidationCompleted",
    callback: (payload: {
      feedId: CoreFeedId;
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

  public override async cleanup(): Promise<void> {
    // The lifecycle mixin will automatically clean up managed intervals
    await super.cleanup?.();
  }

  // Real-time validation for individual price updates
  async validateRealTime(
    update: PriceUpdate,
    feedId: CoreFeedId,
    DataValidatorConfig?: Partial<DataValidatorConfig>
  ): Promise<DataValidatorResult> {
    if (!this.validationConfig.enableRealTimeValidation) {
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

    // Use UniversalRetryService for standardized retry logic
    const result = await this.universalRetryService.executeWithRetry(
      async () => {
        // Check cache first
        const cacheKey = this.getCacheKey(update, feedId);
        const cached = this.validationCache.get(cacheKey);

        if (cached && Date.now() - cached.timestamp < this.validationConfig.validationCacheTTL) {
          return cached.result;
        }

        // Build validation context
        const context = this.buildValidationContext(update, feedId);

        // Perform validation
        // Map provided partial config to validator config with sensible defaults
        const mappedConfig = DataValidatorConfig
          ? {
              maxAge: ENV.DATA_FRESHNESS.MAX_DATA_AGE_MS,
              priceRange: { min: ENV.DATA_QUALITY.PRICE_RANGE_MIN, max: ENV.DATA_QUALITY.PRICE_RANGE_MAX },
              outlierThreshold: ENV.DATA_QUALITY.OUTLIER_THRESHOLD,
              consensusWeight: ENV.DATA_QUALITY.CONSENSUS_WEIGHT,
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
      },
      {
        serviceId: "ValidationService",
        operationName: `validate_realtime_${update.source}_${feedId.name}`,
        retryConfig: {
          maxRetries: 2,
          initialDelayMs: 100,
          maxDelayMs: 1000,
          backoffMultiplier: 2,
        },
      }
    );

    // Handle retry failure with fallback
    if (!result) {
      return {
        isValid: false,
        errors: [
          {
            code: ErrorCode.DATA_VALIDATION_FAILED,
            message: `Validation service error: Operation failed after retry`,
            severity: ErrorSeverity.CRITICAL,
            operation: "validateRealTime",
            validationErrors: ["Validation operation failed after retry"],
          } as ExtendedDataValidationError,
        ],
        warnings: [],
        timestamp: Date.now(),
        confidence: 0,
      };
    }

    return result;
  }

  // Batch validation for multiple updates
  async validateBatch(
    updates: PriceUpdate[],
    feedId: CoreFeedId,
    DataValidatorConfig?: Partial<DataValidatorConfig>
  ): Promise<Map<string, DataValidatorResult>> {
    if (!this.validationConfig.enableBatchValidation) {
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

    // Use UniversalRetryService for batch validation
    const result = await this.universalRetryService.executeWithRetry(
      async () => {
        // Build validation context for batch
        const context = this.buildBatchValidationContext(updates, feedId);

        // Perform batch validation
        // Convert DataValidatorConfiguration to DataValidatorConfig
        const mappedConfig = DataValidatorConfig
          ? {
              maxAge: ENV.DATA_FRESHNESS.MAX_DATA_AGE_MS, // Default from environment
              priceRange: { min: ENV.DATA_QUALITY.PRICE_RANGE_MIN, max: ENV.DATA_QUALITY.PRICE_RANGE_MAX }, // Default from environment
              outlierThreshold: ENV.DATA_QUALITY.OUTLIER_THRESHOLD, // Default from environment
              consensusWeight: ENV.DATA_QUALITY.CONSENSUS_WEIGHT, // Default from environment
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
      },
      {
        serviceId: "ValidationService",
        operationName: `validate_batch_${feedId.name}_${updates.length}`,
        retryConfig: {
          maxRetries: 1,
          initialDelayMs: 200,
          maxDelayMs: 2000,
          backoffMultiplier: 2,
        },
      }
    );

    // This should never be undefined due to shouldThrow: true, but TypeScript needs assurance
    if (!result) {
      throw new Error("Batch validation failed unexpectedly");
    }

    return result;
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
  private buildValidationContext(update: PriceUpdate, feedId: CoreFeedId): ValidationContext {
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

  private buildBatchValidationContext(updates: PriceUpdate[], feedId: CoreFeedId): ValidationContext {
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

  private getCrossSourcePrices(update: PriceUpdate, feedId: CoreFeedId): PriceUpdate[] {
    const feedKey = this.getFeedKey(feedId);
    const allPrices = this.crossSourcePrices.get(feedKey) || [];

    // Filter prices within the cross-source window and from different sources
    const cutoffTime = Date.now() - this.validationConfig.crossSourceWindow;

    return allPrices.filter(
      price => price.timestamp > cutoffTime && price.source !== update.source && price.symbol === update.symbol
    );
  }

  private getConsensusMedian(feedId: CoreFeedId): number | undefined {
    const feedKey = this.getFeedKey(feedId);
    const historicalPrices = this.historicalPrices.get(feedKey) || [];

    if (historicalPrices.length === 0) {
      return undefined;
    }

    // Get recent prices (last 10 updates) for consensus calculation
    const recentPrices = historicalPrices
      .slice(-10)
      .map(update => update.price)
      .filter(price => price > 0);

    if (recentPrices.length === 0) {
      return undefined;
    }

    // Sort prices for median calculation
    const sortedPrices = [...recentPrices].sort((a, b) => a - b);
    const mid = Math.floor(sortedPrices.length / 2);

    if (sortedPrices.length % 2 === 0) {
      // Even number of prices - average the two middle values
      return (sortedPrices[mid - 1] + sortedPrices[mid]) / 2;
    } else {
      // Odd number of prices - return the middle value
      return sortedPrices[mid];
    }
  }

  private updateHistoricalData(update: PriceUpdate, feedId: CoreFeedId): void {
    const feedKey = this.getFeedKey(feedId);

    // Update historical prices
    const historical = this.historicalPrices.get(feedKey) || [];
    historical.push(update);

    // Keep only the most recent prices within the window
    if (historical.length > this.validationConfig.historicalDataWindow) {
      historical.splice(0, historical.length - this.validationConfig.historicalDataWindow);
    }

    this.historicalPrices.set(feedKey, historical);

    // Update cross-source prices
    const crossSource = this.crossSourcePrices.get(feedKey) || [];
    crossSource.push(update);

    // Remove old cross-source prices
    const cutoffTime = Date.now() - this.validationConfig.crossSourceWindow;
    const filteredCrossSource = crossSource.filter(price => price.timestamp > cutoffTime);

    this.crossSourcePrices.set(feedKey, filteredCrossSource);
  }

  private cacheDataValidatorResult(key: string, result: DataValidatorResult): void {
    // Remove oldest entries if cache is full
    if (this.validationCache.size >= this.validationConfig.validationCacheSize) {
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
    const alpha = ENV.PERFORMANCE.SMOOTHING_ALPHA;
    this.validationStats.averageValidationTime =
      alpha * validationTime + (1 - alpha) * this.validationStats.averageValidationTime;
  }

  private emitValidationEvents(update: PriceUpdate, feedId: CoreFeedId, result: DataValidatorResult): void {
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

  private getCacheKey(update: PriceUpdate, feedId: CoreFeedId): string {
    return `${feedId.category}-${feedId.name}-${update.source}-${update.timestamp}`;
  }

  private getFeedKey(feedId: CoreFeedId): string {
    return `${feedId.category}-${feedId.name}`;
  }

  private setupCleanupInterval(): void {
    // Clean up cache and historical data every 5 minutes using managed interval
    this.createInterval(
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
      if (now - cached.timestamp > this.validationConfig.validationCacheTTL) {
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
    const cutoffTime = Date.now() - this.validationConfig.crossSourceWindow;
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
  async validate(update: PriceUpdate, feedId?: CoreFeedId): Promise<ValidationResult> {
    // Fallback feedId if not provided to satisfy internal usage
    const effectiveFeedId: CoreFeedId = feedId ?? {
      category: 0 as FeedCategory, // Default to unknown category
      name: update.symbol,
    };

    const result = await this.validateRealTime(update, effectiveFeedId);

    return {
      isValid: result.isValid,
      errors: result.errors.map(e => e.message),
      warnings: result.warnings,
    };
  }

  async validatePriceUpdate(
    update: PriceUpdate,
    feedId: CoreFeedId,
    DataValidatorConfig?: Partial<DataValidatorConfig>
  ): Promise<DataValidatorResult> {
    return this.validateRealTime(update, feedId, DataValidatorConfig);
  }

  getServiceName(): string {
    return "ValidationService";
  }

  getDataValidatorConfig(): DataValidatorConfig {
    return this.validationConfig;
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
}
