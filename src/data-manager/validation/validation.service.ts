import { Injectable } from "@nestjs/common";
import { DataValidator, ValidationResult, ValidationContext } from "./data-validator";
import { PriceUpdate } from "@/common/interfaces/core/data-source.interface";
import { EnhancedFeedId } from "@/common/types/feed.types";
import { ValidationConfig } from "@/aggregators/base/aggregation.interfaces";
import { IDataValidationService } from "@/common/interfaces/services/validation.interface";
import { ServiceHealthStatus, ServicePerformanceMetrics } from "@/common/interfaces/common.interface";
import { BaseEventService } from "@/common/base/base-event.service";

export interface ValidationServiceConfig {
  enableRealTimeValidation: boolean;
  enableBatchValidation: boolean;
  validationCacheSize: number;
  validationCacheTTL: number;
  historicalDataWindow: number; // Number of historical prices to keep
  crossSourceWindow: number; // Time window for cross-source validation (ms)
}

@Injectable()
export class ValidationService extends BaseEventService implements IDataValidationService {
  private readonly validator: DataValidator;
  private readonly config: ValidationServiceConfig;

  // Cache for validation results
  private validationCache = new Map<string, { result: ValidationResult; timestamp: number }>();

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

  constructor(validator: DataValidator, config?: Partial<ValidationServiceConfig>) {
    super(ValidationService.name);

    this.validator = validator;
    this.config = {
      enableRealTimeValidation: true,
      enableBatchValidation: true,
      validationCacheSize: 1000,
      validationCacheTTL: 5000, // 5 seconds
      historicalDataWindow: 50, // Keep last 50 prices
      crossSourceWindow: 10000, // 10 seconds
      ...config,
    };

    this.setupCleanupInterval();
  }

  // Cleanup method for tests
  cleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }

  // Real-time validation for individual price updates
  async validateRealTime(
    update: PriceUpdate,
    feedId: EnhancedFeedId,
    validationConfig?: Partial<ValidationConfig>
  ): Promise<ValidationResult> {
    if (!this.config.enableRealTimeValidation) {
      return {
        isValid: true,
        errors: [],
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
      const result = await this.validator.validateUpdate(update, context, validationConfig);

      // Cache result
      this.cacheValidationResult(cacheKey, result);

      // Update historical data
      this.updateHistoricalData(update, feedId);

      // Update statistics
      this.updateValidationStats(result, Date.now() - startTime);

      // Emit validation events
      this.emitValidationEvents(update, feedId, result);

      return result;
    } catch (error) {
      this.logger.error(`Real-time validation failed for ${update.source}:`, error);

      return {
        isValid: false,
        errors: [
          {
            type: "format_error" as any,
            message: `Validation service error: ${error.message}`,
            severity: "critical",
          },
        ],
        confidence: 0,
      };
    }
  }

  // Batch validation for multiple updates
  async validateBatch(
    updates: PriceUpdate[],
    feedId: EnhancedFeedId,
    validationConfig?: Partial<ValidationConfig>
  ): Promise<Map<string, ValidationResult>> {
    if (!this.config.enableBatchValidation) {
      const results = new Map<string, ValidationResult>();
      for (const update of updates) {
        const key = `${update.source}-${update.timestamp}`;
        results.set(key, {
          isValid: true,
          errors: [],
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
      const results = await this.validator.validateBatch(updates, context, validationConfig);

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
  filterValidUpdates(updates: PriceUpdate[], validationResults: Map<string, ValidationResult>): PriceUpdate[] {
    const validUpdates: PriceUpdate[] = [];

    for (const update of updates) {
      const key = `${update.source}-${update.symbol}-${update.timestamp}`;
      const result = validationResults.get(key);

      if (result?.isValid && result.adjustedUpdate) {
        validUpdates.push(result.adjustedUpdate);
      }
    }

    return validUpdates;
  }

  // Get validation statistics
  getValidationStatistics(): ValidationStatistics {
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

  private cacheValidationResult(key: string, result: ValidationResult): void {
    // Remove oldest entries if cache is full
    if (this.validationCache.size >= this.config.validationCacheSize) {
      const oldestKey = this.validationCache.keys().next().value;
      this.validationCache.delete(oldestKey);
    }

    this.validationCache.set(key, {
      result,
      timestamp: Date.now(),
    });
  }

  private updateValidationStats(result: ValidationResult, validationTime: number): void {
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

  private emitValidationEvents(update: PriceUpdate, feedId: EnhancedFeedId, result: ValidationResult): void {
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
        if (error.severity === "critical") {
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
  async validatePriceUpdate(
    update: PriceUpdate,
    feedId: EnhancedFeedId,
    validationConfig?: any
  ): Promise<ValidationResult> {
    return this.validateRealTime(update, feedId, validationConfig);
  }

  getServiceName(): string {
    return "ValidationService";
  }

  // IBaseService interface methods
  async getPerformanceMetrics(): Promise<{
    responseTime: { average: number; min: number; max: number };
    throughput: { requestsPerSecond: number; totalRequests: number };
    errorRate: number;
    uptime: number;
  }> {
    const uptime = process.uptime();
    const stats = this.getValidationStatistics();

    return {
      responseTime: {
        average: stats.averageValidationTime,
        min: 1, // Mock value
        max: 50, // Mock value
      },
      throughput: {
        requestsPerSecond: stats.totalValidations / uptime,
        totalRequests: stats.totalValidations,
      },
      errorRate: 1 - stats.validationRate,
      uptime,
    };
  }

  async getHealthStatus(): Promise<{
    status: "healthy" | "degraded" | "unhealthy";
    timestamp: number;
    details?: any;
  }> {
    const stats = this.getValidationStatistics();

    let status: "healthy" | "degraded" | "unhealthy" = "healthy";

    if (stats.validationRate < 0.5) {
      status = "unhealthy";
    } else if (stats.validationRate < 0.8) {
      status = "degraded";
    }

    return {
      status,
      timestamp: Date.now(),
      details: {
        validationStatistics: stats,
      },
    };
  }
}

export interface ValidationStatistics {
  totalValidations: number;
  validUpdates: number;
  invalidUpdates: number;
  validationRate: number;
  averageValidationTime: number;
  cacheSize: number;
  historicalDataSize: number;
}
