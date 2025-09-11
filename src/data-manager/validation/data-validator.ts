import { Injectable } from "@nestjs/common";
import { StandardService } from "@/common/base/composed.service";

import { ErrorSeverity, ValidationErrorType } from "@/common/types/error-handling";
import { ErrorCode } from "@/common/types/error-handling/error.types";
import type { DataValidationError as BaseDataValidationError } from "@/common/types/error-handling";
import type { PriceUpdate } from "@/common/types/core";
import type { DataValidatorConfig, DataValidatorResult, ValidationContext } from "@/common/types/data-manager";
export type { ValidationContext } from "@/common/types/data-manager";

// Extended validation error type with optional fields used across methods
// Keeps strict typing while removing inline import() usages.
export type ExtendedDataValidationError = BaseDataValidationError & {
  type?: ValidationErrorType;
  field?: string;
  value?: unknown;
  path?: string;
  rule?: string;
};

@Injectable()
export class DataValidator extends StandardService {
  constructor() {
    super({
      maxAge: 2000, // 2 seconds (Requirement 2.5)
      priceRange: { min: 0.01, max: 1000000 },
      outlierThreshold: 0.05, // 5% deviation
      consensusWeight: 0.8,
      enableRealTimeValidation: true,
      enableBatchValidation: true,
      maxBatchSize: 100,
      validationTimeout: 5000,
      // Additional required fields for DataValidatorConfig
      crossSourceWindow: 10_000,
      historicalDataWindow: 50,
      validationCacheSize: 1000,
      validationCacheTTL: 5000,
    });
  }

  /**
   * Get the typed configuration for this service
   */
  private get validatorConfig(): DataValidatorConfig {
    return this.config as DataValidatorConfig;
  }

  // Multi-tier validation (Requirement 2.1)
  async validateUpdate(
    update: PriceUpdate,
    context: ValidationContext,
    config?: Partial<DataValidatorConfig>
  ): Promise<DataValidatorResult> {
    const DataValidatorConfig = { ...this.validatorConfig, ...config };
    const errors: ExtendedDataValidationError[] = [];
    let confidence = update?.confidence || 0;

    // Use mixin's error handling for validation process
    const result = await this.executeWithErrorHandling(
      async () => {
        // Early null check
        if (!update) {
          return {
            isValid: false,
            errors: [
              this.makeValidationError(
                "Update is null or undefined",
                "validateUpdate",
                ["update is null or undefined"],
                ErrorSeverity.CRITICAL,
                { type: ValidationErrorType.FORMAT_ERROR }
              ),
            ],
            warnings: [],
            timestamp: Date.now(),
            confidence: 0,
          };
        }

        // Tier 1: Format validation
        const formatErrors = this.validateFormat(update);
        errors.push(...formatErrors);

        // Tier 2: Range validation
        const rangeErrors = this.validateRange(update, DataValidatorConfig);
        errors.push(...rangeErrors);

        // Tier 3: Staleness validation (Requirement 2.5)
        const stalenessErrors = this.validateStaleness(update, DataValidatorConfig);
        errors.push(...stalenessErrors);

        // Tier 4: Statistical outlier detection (Requirement 2.2)
        const outlierErrors = await this.validateOutliers(update, context, DataValidatorConfig);
        errors.push(...outlierErrors);

        // Tier 5: Cross-source validation (Requirement 2.1)
        const crossSourceErrors = this.validateCrossSource(update, context);
        errors.push(...crossSourceErrors);

        // Tier 6: Consensus awareness validation (Requirement 2.6)
        const consensusErrors = this.validateConsensusAlignment(update, context, DataValidatorConfig);
        errors.push(...consensusErrors);

        // Calculate overall confidence adjustment
        confidence = this.adjustConfidence(update.confidence, errors);

        // Determine if update is valid
        const criticalErrors = errors.filter(e => e.severity === ErrorSeverity.CRITICAL);
        const highErrors = errors.filter(e => e.severity === ErrorSeverity.HIGH);

        const isValid = criticalErrors.length === 0 && highErrors.length <= 1;

        // Create adjusted update if needed
        const adjustedUpdate = this.createAdjustedUpdate(update, errors, confidence);

        return {
          isValid,
          errors,
          warnings: [],
          timestamp: Date.now(),
          confidence,
          adjustedUpdate,
        };
      },
      `validate_update_${update?.source || "unknown"}_${update?.symbol || "unknown"}`,
      {
        retries: 1,
        shouldThrow: false,
        fallback: async () => ({
          isValid: false,
          errors: [
            this.makeValidationError(
              `Validation process failed: Operation failed after retry`,
              "validateUpdate",
              ["unexpected error"],
              ErrorSeverity.CRITICAL,
              { type: ValidationErrorType.FORMAT_ERROR }
            ),
          ],
          warnings: [],
          timestamp: Date.now(),
          confidence: 0,
        }),
      }
    );

    return (
      result || {
        isValid: false,
        errors: [
          this.makeValidationError(
            `Validation process failed: Unexpected failure`,
            "validateUpdate",
            ["unexpected error"],
            ErrorSeverity.CRITICAL,
            { type: ValidationErrorType.FORMAT_ERROR }
          ),
        ],
        warnings: [],
        timestamp: Date.now(),
        confidence: 0,
      }
    );
  }

  // Format validation - ensures data structure integrity
  private validateFormat(update: PriceUpdate): ExtendedDataValidationError[] {
    const errors: ExtendedDataValidationError[] = [];

    // Check required fields
    if (!update.symbol || typeof update.symbol !== "string") {
      errors.push(
        this.makeValidationError("Invalid or missing symbol", "validateUpdate", ["symbol"], ErrorSeverity.CRITICAL, {
          type: ValidationErrorType.FORMAT_ERROR,
          field: "symbol",
          value: update.symbol,
        })
      );
    }

    if (typeof update.price !== "number" || isNaN(update.price)) {
      errors.push(
        this.makeValidationError("Invalid or missing price", "validateUpdate", ["price"], ErrorSeverity.CRITICAL, {
          type: ValidationErrorType.FORMAT_ERROR,
          field: "price",
          value: update.price,
        })
      );
    }

    if (typeof update.timestamp !== "number" || update.timestamp <= 0) {
      errors.push(
        this.makeValidationError(
          "Invalid or missing timestamp",
          "validateUpdate",
          ["timestamp"],
          ErrorSeverity.CRITICAL,
          {
            type: ValidationErrorType.FORMAT_ERROR,
            field: "timestamp",
            value: update.timestamp,
          }
        )
      );
    }

    if (!update.source || typeof update.source !== "string") {
      errors.push(
        this.makeValidationError("Invalid or missing source", "validateUpdate", ["source"], ErrorSeverity.CRITICAL, {
          type: ValidationErrorType.FORMAT_ERROR,
          field: "source",
          value: update.source,
        })
      );
    }

    if (typeof update.confidence !== "number" || update.confidence < 0 || update.confidence > 1) {
      errors.push(
        this.makeValidationError(
          "Invalid confidence value (must be between 0 and 1)",
          "validateUpdate",
          ["confidence"],
          ErrorSeverity.MEDIUM,
          { type: ValidationErrorType.FORMAT_ERROR, field: "confidence", value: update.confidence }
        )
      );
    }

    return errors;
  }

  // Range validation - ensures price is within reasonable bounds
  private validateRange(update: PriceUpdate, config: DataValidatorConfig): ExtendedDataValidationError[] {
    const errors: ExtendedDataValidationError[] = [];

    if (update.price <= 0) {
      errors.push(
        this.makeValidationError("Price must be positive", "validateUpdate", ["price"], ErrorSeverity.CRITICAL, {
          type: ValidationErrorType.PRICE_OUT_OF_RANGE,
          field: "price",
          value: update.price,
        })
      );
    }

    if (update.price < config.priceRange.min) {
      errors.push(
        this.makeValidationError(
          `Price ${update.price} below minimum ${config.priceRange.min}`,
          "validateUpdate",
          ["price"],
          ErrorSeverity.HIGH,
          { type: ValidationErrorType.PRICE_OUT_OF_RANGE, field: "price", value: update.price }
        )
      );
    }

    if (update.price > config.priceRange.max) {
      errors.push(
        this.makeValidationError(
          `Price ${update.price} above maximum ${config.priceRange.max}`,
          "validateUpdate",
          ["price"],
          ErrorSeverity.HIGH,
          { type: ValidationErrorType.PRICE_OUT_OF_RANGE, field: "price", value: update.price }
        )
      );
    }

    return errors;
  }

  // Staleness validation - ensures data is fresh (Requirement 2.5)
  private validateStaleness(update: PriceUpdate, config: DataValidatorConfig): ExtendedDataValidationError[] {
    const errors: ExtendedDataValidationError[] = [];
    const now = Date.now();
    const age = now - update.timestamp;

    if (age > config.maxAge) {
      errors.push(
        this.makeValidationError(
          `Data is stale: ${age}ms old (max: ${config.maxAge}ms)`,
          "validateUpdate",
          ["timestamp"],
          ErrorSeverity.CRITICAL,
          { type: ValidationErrorType.STALE_DATA, field: "timestamp", value: age }
        )
      );
    }

    // Warning for data approaching staleness threshold
    if (age > config.maxAge * 0.8) {
      errors.push(
        this.makeValidationError(
          `Data approaching staleness: ${age}ms old`,
          "validateUpdate",
          ["timestamp"],
          ErrorSeverity.LOW,
          { type: ValidationErrorType.STALE_DATA, field: "timestamp", value: age }
        )
      );
    }

    return errors;
  }

  // Statistical outlier detection with consensus awareness (Requirement 2.2)
  private async validateOutliers(
    update: PriceUpdate,
    context: ValidationContext,
    config: DataValidatorConfig
  ): Promise<ExtendedDataValidationError[]> {
    const errors: ExtendedDataValidationError[] = [];

    const historicalPrices = context.historicalPrices ?? [];
    if (historicalPrices.length < 3) {
      // Not enough data for outlier detection
      return errors;
    }

    // Calculate statistical measures
    const prices = historicalPrices.map(p => (p as PriceUpdate).price);
    const mean = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    const variance = prices.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) / prices.length;
    const stdDev = Math.sqrt(variance);

    // Z-score outlier detection
    const zScore = Math.abs((update.price - mean) / stdDev);
    const zScoreThreshold = 2.5; // 2.5 standard deviations

    if (zScore > zScoreThreshold) {
      errors.push(
        this.makeValidationError(
          `Price is statistical outlier: z-score ${zScore.toFixed(2)}`,
          "validateUpdate",
          ["price"],
          ErrorSeverity.MEDIUM,
          {
            type: ValidationErrorType.OUTLIER_ERROR,
            field: "price",
            value: { price: update.price, zScore, mean, stdDev },
          }
        )
      );
    }

    // Percentage deviation from recent average
    const recentPrices = historicalPrices.slice(-5).map(p => (p as PriceUpdate).price);
    const recentMean = recentPrices.reduce((sum, price) => sum + price, 0) / recentPrices.length;
    const percentageDeviation = Math.abs((update.price - recentMean) / recentMean);

    if (percentageDeviation > config.outlierThreshold) {
      const severity = percentageDeviation > config.outlierThreshold * 2 ? ErrorSeverity.HIGH : ErrorSeverity.MEDIUM;
      errors.push(
        this.makeValidationError(
          `Price deviates ${(percentageDeviation * 100).toFixed(2)}% from recent average`,
          "validateUpdate",
          ["price"],
          severity,
          {
            type: ValidationErrorType.OUTLIER_ERROR,
            field: "price",
            value: { price: update.price, recentMean, deviation: percentageDeviation },
          }
        )
      );
    }

    return errors;
  }

  // Cross-source validation to identify anomalous data (Requirement 2.1)
  private validateCrossSource(update: PriceUpdate, context: ValidationContext): ExtendedDataValidationError[] {
    const errors: ExtendedDataValidationError[] = [];

    const crossSourcePrices = context.crossSourcePrices ?? [];
    if (crossSourcePrices.length < 2) {
      // Not enough cross-source data for validation
      return errors;
    }

    // Filter out prices from the same source
    const otherSourcePrices = crossSourcePrices
      .filter(p => (p as PriceUpdate).source !== update.source)
      .map(p => (p as PriceUpdate).price);

    if (otherSourcePrices.length === 0) {
      return errors;
    }

    // Calculate median of other sources
    const sortedPrices = otherSourcePrices.sort((a, b) => a - b);
    const median =
      sortedPrices.length % 2 === 0
        ? (sortedPrices[sortedPrices.length / 2 - 1] + sortedPrices[sortedPrices.length / 2]) / 2
        : sortedPrices[Math.floor(sortedPrices.length / 2)];

    // Check deviation from cross-source median
    const deviation = Math.abs((update.price - median) / median);
    const crossSourceThreshold = 0.02; // 2% deviation threshold

    if (deviation > crossSourceThreshold) {
      const severity = deviation > crossSourceThreshold * 2 ? ErrorSeverity.HIGH : ErrorSeverity.MEDIUM;
      errors.push(
        this.makeValidationError(
          `Price deviates ${(deviation * 100).toFixed(2)}% from cross-source median`,
          "validateUpdate",
          ["price"],
          severity,
          {
            type: ValidationErrorType.CROSS_SOURCE_ERROR,
            field: "price",
            value: { price: update.price, crossSourceMedian: median, deviation },
          }
        )
      );
    }

    return errors;
  }

  // Consensus alignment validation (Requirement 2.6)
  private validateConsensusAlignment(
    update: PriceUpdate,
    context: ValidationContext,
    _config: DataValidatorConfig
  ): ExtendedDataValidationError[] {
    const errors: ExtendedDataValidationError[] = [];

    if (!context.consensusMedian) {
      // No consensus data available
      return errors;
    }

    const deviation = Math.abs((update.price - context.consensusMedian) / context.consensusMedian);
    const consensusThreshold = 0.005; // 0.5% for FTSO requirement

    if (deviation > consensusThreshold) {
      const severity = deviation > consensusThreshold * 2 ? ErrorSeverity.HIGH : ErrorSeverity.MEDIUM;
      errors.push(
        this.makeValidationError(
          `Price deviates ${(deviation * 100).toFixed(3)}% from consensus median`,
          "validateUpdate",
          ["price"],
          severity,
          {
            type: ValidationErrorType.CONSENSUS_ERROR,
            field: "price",
            value: { price: update.price, consensusMedian: context.consensusMedian, deviation },
          }
        )
      );
    }

    return errors;
  }

  // Adjust confidence based on validation errors
  private adjustConfidence(originalConfidence: number, errors: ExtendedDataValidationError[]): number {
    let adjustedConfidence = originalConfidence;

    for (const error of errors) {
      switch (error.severity) {
        case ErrorSeverity.CRITICAL:
          adjustedConfidence *= 0.1; // Severe penalty
          break;
        case ErrorSeverity.HIGH:
          adjustedConfidence *= 0.5; // High penalty
          break;
        case ErrorSeverity.MEDIUM:
          adjustedConfidence *= 0.8; // Medium penalty
          break;
        case ErrorSeverity.LOW:
          adjustedConfidence *= 0.95; // Small penalty
          break;
      }
    }

    return Math.max(0, Math.min(1, adjustedConfidence));
  }

  // Create adjusted update with corrected confidence
  private createAdjustedUpdate(
    original: PriceUpdate,
    _errors: ExtendedDataValidationError[],
    adjustedConfidence: number
  ): PriceUpdate {
    return {
      ...original,
      confidence: adjustedConfidence,
    };
  }

  // Batch validation for multiple updates
  async validateBatch(
    updates: PriceUpdate[],
    context: ValidationContext,
    config?: Partial<DataValidatorConfig>
  ): Promise<Map<string, DataValidatorResult>> {
    const results = new Map<string, DataValidatorResult>();

    for (const update of updates) {
      const key = `${update.source}-${update.symbol}-${update.timestamp}`;
      const result = await this.validateUpdate(update, context, config);
      results.set(key, result);
    }

    return results;
  }

  // Get validation statistics
  getValidationStats(results: DataValidatorResult[]): {
    total: number;
    valid: number;
    invalid: number;
    validationRate: number;
    averageConfidence: number;
  };
  // Overload to support tests that pass a minimal result shape
  getValidationStats(
    results: Array<
      Pick<DataValidatorResult, "isValid" | "timestamp"> & {
        confidence?: number;
        warnings?: unknown[];
        errors: Array<{
          code: string;
          message: string;
          severity: unknown;
          type?: unknown;
        }>;
      }
    >
  ): {
    total: number;
    valid: number;
    invalid: number;
    validationRate: number;
    averageConfidence: number;
  };
  getValidationStats(results: Array<{ isValid: boolean; confidence?: number }>): {
    total: number;
    valid: number;
    invalid: number;
    validationRate: number;
    averageConfidence: number;
  } {
    const total = results.length;
    const valid = results.filter(r => r.isValid).length;
    const invalid = total - valid;
    const validationRate = total > 0 ? valid / total : 0;
    const averageConfidence = total > 0 ? results.reduce((sum: number, r) => sum + (r.confidence || 0), 0) / total : 0;

    return {
      total,
      valid,
      invalid,
      validationRate,
      averageConfidence,
    };
  }

  // Helper to construct a DataValidationError with extra test-friendly fields
  private makeValidationError(
    message: string,
    operation: string,
    validationErrors: string[],
    severity: ErrorSeverity,
    extras?: {
      type?: ValidationErrorType;
      field?: string;
      value?: unknown;
      path?: string;
      rule?: string;
    }
  ): ExtendedDataValidationError {
    const base: BaseDataValidationError = {
      code: ErrorCode.DATA_VALIDATION_FAILED,
      message,
      severity,
      module: "data",
      operation,
      timestamp: Date.now(),
      validationErrors,
    };

    return { ...base, ...(extras || {}) } as ExtendedDataValidationError;
  }
}
