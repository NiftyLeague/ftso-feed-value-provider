/**
 * Data manager validation type definitions
 */

import { EnhancedFeedId, PriceUpdate } from "../core";
import { DataValidationError, ValidationErrorType } from "../error-handling";
import { IBaseService } from "../services/base.types";
import { ValidationResult } from "../utils";

/**
 * Defines the context for a validation operation.
 */
export interface ValidationContext {
  feedId: EnhancedFeedId;
  timestamp: number;
  source: string;
  metadata?: Record<string, unknown>;
  historicalPrices?: PriceUpdate[];
  crossSourcePrices?: PriceUpdate[];
  consensusMedian?: number;
}

/**
 * Provides detailed statistics about the validation process.
 */
export interface ValidationStats {
  totalValidations: number;
  successfulValidations: number;
  failedValidations: number;
  errorRate: number;
  averageValidationTime: number;
  validationsByType: Record<string, number>;
  recentErrors: DataValidationError[];
}

/**
 * Configuration for the validation service.
 */
export interface DataValidatorConfig {
  consensusWeight: number;
  crossSourceWindow: number;
  enableBatchValidation: boolean;
  enableRealTimeValidation: boolean;
  historicalDataWindow: number;
  maxAge: number;
  maxBatchSize: number;
  outlierThreshold: number;
  priceRange: { min: number; max: number };
  validationCacheSize: number;
  validationCacheTTL: number;
  validationTimeout: number;
}

/**
 * The result of a validation operation.
 */
export interface DataValidatorResult {
  isValid: boolean;
  errors: ExtendedDataValidationError[];
  warnings: string[];
  timestamp: number;
  feedId?: EnhancedFeedId;
  confidence?: number;
  adjustedUpdate?: PriceUpdate;
}

/**
 * Extended validation error shape used in tests with optional classification fields.
 */
export type ExtendedDataValidationError = DataValidationError & {
  type?: ValidationErrorType;
  field?: string;
  value?: unknown;
  path?: string;
  rule?: string;
};

/**
 * Data validation service interface
 */
export interface IDataValidatorService extends IBaseService {
  /**
   * Validate a price update
   * @param update Price update to validate
   * @param feedId Feed identifier
   * @returns Promise resolving to validation result
   */
  validate(update: PriceUpdate, feedId?: EnhancedFeedId): Promise<ValidationResult>;

  /** Proxy to real-time validation used by services/tests */
  validatePriceUpdate(
    update: PriceUpdate,
    feedId: EnhancedFeedId,
    DataValidatorConfig?: Partial<DataValidatorConfig>
  ): Promise<DataValidatorResult>;

  /** Real-time validation entry */
  validateRealTime(
    update: PriceUpdate,
    feedId: EnhancedFeedId,
    DataValidatorConfig?: Partial<DataValidatorConfig>
  ): Promise<DataValidatorResult>;

  /** Batch validation for multiple updates */
  validateBatch(
    updates: PriceUpdate[],
    feedId: EnhancedFeedId,
    DataValidatorConfig?: Partial<DataValidatorConfig>
  ): Promise<Map<string, DataValidatorResult>>;

  /** Filters valid updates from a batch using validation results */
  filterValidUpdates(updates: PriceUpdate[], DataValidatorResults: Map<string, DataValidatorResult>): PriceUpdate[];

  /** Validation statistics */
  getValidationStats(): {
    totalValidations: number;
    validUpdates: number;
    invalidUpdates: number;
    validationRate: number;
    averageValidationTime: number;
    cacheSize: number;
    historicalDataSize: number;
  };

  /** Maintenance helpers */
  clearCache(): void;
  clearHistoricalData(): void;

  /**
   * Get validation configuration
   * @returns Current validation configuration
   */
  getDataValidatorConfig(): DataValidatorConfig;
}
