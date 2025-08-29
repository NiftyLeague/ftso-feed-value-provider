import { Injectable, Logger } from "@nestjs/common";
import { PriceUpdate } from "@/interfaces";
import { EnhancedFeedId } from "@/types";
import { ValidationConfig } from "@/aggregators/base/aggregation.interfaces";

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  confidence: number;
  adjustedUpdate?: PriceUpdate;
}

export interface ValidationError {
  type: ValidationErrorType;
  message: string;
  severity: "low" | "medium" | "high" | "critical";
  field?: string;
  value?: any;
}

export enum ValidationErrorType {
  FORMAT_ERROR = "format_error",
  RANGE_ERROR = "range_error",
  STALENESS_ERROR = "staleness_error",
  OUTLIER_ERROR = "outlier_error",
  CONSENSUS_ERROR = "consensus_error",
  CROSS_SOURCE_ERROR = "cross_source_error",
}

export interface ValidationContext {
  feedId: EnhancedFeedId;
  historicalPrices: PriceUpdate[];
  crossSourcePrices: PriceUpdate[];
  consensusMedian?: number;
  marketConditions?: MarketConditions;
}

export interface MarketConditions {
  volatility: number;
  volume: number;
  spread: number;
  isMarketOpen: boolean;
}

@Injectable()
export class DataValidator {
  private readonly logger = new Logger(DataValidator.name);

  // Default validation configuration
  private readonly defaultConfig: ValidationConfig = {
    maxAge: 2000, // 2 seconds (Requirement 2.5)
    priceRange: { min: 0.01, max: 1000000 },
    outlierThreshold: 0.05, // 5% deviation
    consensusWeight: 0.8,
  };

  // Multi-tier validation (Requirement 2.1)
  async validateUpdate(
    update: PriceUpdate,
    context: ValidationContext,
    config?: Partial<ValidationConfig>
  ): Promise<ValidationResult> {
    const validationConfig = { ...this.defaultConfig, ...config };
    const errors: ValidationError[] = [];
    let confidence = update?.confidence || 0;

    try {
      // Early null check
      if (!update) {
        return {
          isValid: false,
          errors: [
            {
              type: ValidationErrorType.FORMAT_ERROR,
              message: "Update is null or undefined",
              severity: "critical",
            },
          ],
          confidence: 0,
        };
      }

      // Tier 1: Format validation
      const formatErrors = this.validateFormat(update);
      errors.push(...formatErrors);

      // Tier 2: Range validation
      const rangeErrors = this.validateRange(update, validationConfig);
      errors.push(...rangeErrors);

      // Tier 3: Staleness validation (Requirement 2.5)
      const stalenessErrors = this.validateStaleness(update, validationConfig);
      errors.push(...stalenessErrors);

      // Tier 4: Statistical outlier detection (Requirement 2.2)
      const outlierErrors = await this.validateOutliers(update, context, validationConfig);
      errors.push(...outlierErrors);

      // Tier 5: Cross-source validation (Requirement 2.1)
      const crossSourceErrors = this.validateCrossSource(update, context);
      errors.push(...crossSourceErrors);

      // Tier 6: Consensus awareness validation (Requirement 2.6)
      const consensusErrors = this.validateConsensusAlignment(update, context, validationConfig);
      errors.push(...consensusErrors);

      // Calculate overall confidence adjustment
      confidence = this.adjustConfidence(update.confidence, errors);

      // Determine if update is valid
      const criticalErrors = errors.filter(e => e.severity === "critical");
      const highErrors = errors.filter(e => e.severity === "high");

      const isValid = criticalErrors.length === 0 && highErrors.length <= 1;

      // Create adjusted update if needed
      const adjustedUpdate = this.createAdjustedUpdate(update, errors, confidence);

      return {
        isValid,
        errors,
        confidence,
        adjustedUpdate,
      };
    } catch (error) {
      this.logger.error(`Validation failed for ${update.source}:`, error);

      return {
        isValid: false,
        errors: [
          {
            type: ValidationErrorType.FORMAT_ERROR,
            message: `Validation process failed: ${error.message}`,
            severity: "critical",
          },
        ],
        confidence: 0,
      };
    }
  }

  // Format validation - ensures data structure integrity
  private validateFormat(update: PriceUpdate): ValidationError[] {
    const errors: ValidationError[] = [];

    // Check required fields
    if (!update.symbol || typeof update.symbol !== "string") {
      errors.push({
        type: ValidationErrorType.FORMAT_ERROR,
        message: "Invalid or missing symbol",
        severity: "critical",
        field: "symbol",
        value: update.symbol,
      });
    }

    if (typeof update.price !== "number" || isNaN(update.price)) {
      errors.push({
        type: ValidationErrorType.FORMAT_ERROR,
        message: "Invalid or missing price",
        severity: "critical",
        field: "price",
        value: update.price,
      });
    }

    if (typeof update.timestamp !== "number" || update.timestamp <= 0) {
      errors.push({
        type: ValidationErrorType.FORMAT_ERROR,
        message: "Invalid or missing timestamp",
        severity: "critical",
        field: "timestamp",
        value: update.timestamp,
      });
    }

    if (!update.source || typeof update.source !== "string") {
      errors.push({
        type: ValidationErrorType.FORMAT_ERROR,
        message: "Invalid or missing source",
        severity: "critical",
        field: "source",
        value: update.source,
      });
    }

    if (typeof update.confidence !== "number" || update.confidence < 0 || update.confidence > 1) {
      errors.push({
        type: ValidationErrorType.FORMAT_ERROR,
        message: "Invalid confidence value (must be between 0 and 1)",
        severity: "medium",
        field: "confidence",
        value: update.confidence,
      });
    }

    return errors;
  }

  // Range validation - ensures price is within reasonable bounds
  private validateRange(update: PriceUpdate, config: ValidationConfig): ValidationError[] {
    const errors: ValidationError[] = [];

    if (update.price <= 0) {
      errors.push({
        type: ValidationErrorType.RANGE_ERROR,
        message: "Price must be positive",
        severity: "critical",
        field: "price",
        value: update.price,
      });
    }

    if (update.price < config.priceRange.min) {
      errors.push({
        type: ValidationErrorType.RANGE_ERROR,
        message: `Price ${update.price} below minimum ${config.priceRange.min}`,
        severity: "high",
        field: "price",
        value: update.price,
      });
    }

    if (update.price > config.priceRange.max) {
      errors.push({
        type: ValidationErrorType.RANGE_ERROR,
        message: `Price ${update.price} above maximum ${config.priceRange.max}`,
        severity: "high",
        field: "price",
        value: update.price,
      });
    }

    return errors;
  }

  // Staleness validation - ensures data is fresh (Requirement 2.5)
  private validateStaleness(update: PriceUpdate, config: ValidationConfig): ValidationError[] {
    const errors: ValidationError[] = [];
    const now = Date.now();
    const age = now - update.timestamp;

    if (age > config.maxAge) {
      errors.push({
        type: ValidationErrorType.STALENESS_ERROR,
        message: `Data is stale: ${age}ms old (max: ${config.maxAge}ms)`,
        severity: "critical",
        field: "timestamp",
        value: age,
      });
    }

    // Warning for data approaching staleness threshold
    if (age > config.maxAge * 0.8) {
      errors.push({
        type: ValidationErrorType.STALENESS_ERROR,
        message: `Data approaching staleness: ${age}ms old`,
        severity: "low",
        field: "timestamp",
        value: age,
      });
    }

    return errors;
  }

  // Statistical outlier detection with consensus awareness (Requirement 2.2)
  private async validateOutliers(
    update: PriceUpdate,
    context: ValidationContext,
    config: ValidationConfig
  ): Promise<ValidationError[]> {
    const errors: ValidationError[] = [];

    if (context.historicalPrices.length < 3) {
      // Not enough data for outlier detection
      return errors;
    }

    // Calculate statistical measures
    const prices = context.historicalPrices.map(p => p.price);
    const mean = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    const variance = prices.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) / prices.length;
    const stdDev = Math.sqrt(variance);

    // Z-score outlier detection
    const zScore = Math.abs((update.price - mean) / stdDev);
    const zScoreThreshold = 2.5; // 2.5 standard deviations

    if (zScore > zScoreThreshold) {
      errors.push({
        type: ValidationErrorType.OUTLIER_ERROR,
        message: `Price is statistical outlier: z-score ${zScore.toFixed(2)}`,
        severity: "medium",
        field: "price",
        value: { price: update.price, zScore, mean, stdDev },
      });
    }

    // Percentage deviation from recent average
    const recentPrices = context.historicalPrices.slice(-5).map(p => p.price);
    const recentMean = recentPrices.reduce((sum, price) => sum + price, 0) / recentPrices.length;
    const percentageDeviation = Math.abs((update.price - recentMean) / recentMean);

    if (percentageDeviation > config.outlierThreshold) {
      const severity = percentageDeviation > config.outlierThreshold * 2 ? "high" : "medium";
      errors.push({
        type: ValidationErrorType.OUTLIER_ERROR,
        message: `Price deviates ${(percentageDeviation * 100).toFixed(2)}% from recent average`,
        severity,
        field: "price",
        value: { price: update.price, recentMean, deviation: percentageDeviation },
      });
    }

    return errors;
  }

  // Cross-source validation to identify anomalous data (Requirement 2.1)
  private validateCrossSource(update: PriceUpdate, context: ValidationContext): ValidationError[] {
    const errors: ValidationError[] = [];

    if (context.crossSourcePrices.length < 2) {
      // Not enough cross-source data for validation
      return errors;
    }

    // Filter out prices from the same source
    const otherSourcePrices = context.crossSourcePrices.filter(p => p.source !== update.source).map(p => p.price);

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
      const severity = deviation > crossSourceThreshold * 2 ? "high" : "medium";
      errors.push({
        type: ValidationErrorType.CROSS_SOURCE_ERROR,
        message: `Price deviates ${(deviation * 100).toFixed(2)}% from cross-source median`,
        severity,
        field: "price",
        value: { price: update.price, crossSourceMedian: median, deviation },
      });
    }

    return errors;
  }

  // Consensus alignment validation (Requirement 2.6)
  private validateConsensusAlignment(
    update: PriceUpdate,
    context: ValidationContext,
    _config: ValidationConfig
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    if (!context.consensusMedian) {
      // No consensus data available
      return errors;
    }

    const deviation = Math.abs((update.price - context.consensusMedian) / context.consensusMedian);
    const consensusThreshold = 0.005; // 0.5% for FTSO requirement

    if (deviation > consensusThreshold) {
      const severity = deviation > consensusThreshold * 2 ? "high" : "medium";
      errors.push({
        type: ValidationErrorType.CONSENSUS_ERROR,
        message: `Price deviates ${(deviation * 100).toFixed(3)}% from consensus median`,
        severity,
        field: "price",
        value: { price: update.price, consensusMedian: context.consensusMedian, deviation },
      });
    }

    return errors;
  }

  // Adjust confidence based on validation errors
  private adjustConfidence(originalConfidence: number, errors: ValidationError[]): number {
    let adjustedConfidence = originalConfidence;

    for (const error of errors) {
      switch (error.severity) {
        case "critical":
          adjustedConfidence *= 0.1; // Severe penalty
          break;
        case "high":
          adjustedConfidence *= 0.5; // High penalty
          break;
        case "medium":
          adjustedConfidence *= 0.8; // Medium penalty
          break;
        case "low":
          adjustedConfidence *= 0.95; // Small penalty
          break;
      }
    }

    return Math.max(0, Math.min(1, adjustedConfidence));
  }

  // Create adjusted update with corrected confidence
  private createAdjustedUpdate(
    original: PriceUpdate,
    errors: ValidationError[],
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
    config?: Partial<ValidationConfig>
  ): Promise<Map<string, ValidationResult>> {
    const results = new Map<string, ValidationResult>();

    for (const update of updates) {
      const key = `${update.source}-${update.symbol}-${update.timestamp}`;
      const result = await this.validateUpdate(update, context, config);
      results.set(key, result);
    }

    return results;
  }

  // Get validation statistics
  getValidationStats(results: ValidationResult[]): ValidationStats {
    const total = results.length;
    const valid = results.filter(r => r.isValid).length;
    const invalid = total - valid;

    const errorCounts = new Map<ValidationErrorType, number>();
    const severityCounts = new Map<string, number>();

    for (const result of results) {
      for (const error of result.errors) {
        errorCounts.set(error.type, (errorCounts.get(error.type) || 0) + 1);
        severityCounts.set(error.severity, (severityCounts.get(error.severity) || 0) + 1);
      }
    }

    const avgConfidence = results.reduce((sum, r) => sum + r.confidence, 0) / total;

    return {
      total,
      valid,
      invalid,
      validationRate: valid / total,
      averageConfidence: avgConfidence,
      errorCounts,
      severityCounts,
    };
  }
}

export interface ValidationStats {
  total: number;
  valid: number;
  invalid: number;
  validationRate: number;
  averageConfidence: number;
  errorCounts: Map<ValidationErrorType, number>;
  severityCounts: Map<string, number>;
}
