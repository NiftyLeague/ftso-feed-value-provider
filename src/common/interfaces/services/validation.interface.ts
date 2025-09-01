import { ValidationResult } from "@/data-manager/validation/data-validator";
import { EnhancedFeedId } from "../../types/feed.types";
import { PriceUpdate } from "../core/data-source.interface";
import { IBaseService } from "../common.interface";

/**
 * Interface for Data Validation Service
 * Defines methods for validating price data and updates
 * Requirements: 3.3, 3.4, 4.1, 4.2
 */
export interface IDataValidationService extends IBaseService {
  /**
   * Validate a single price update in real-time
   * @param update - Price update to validate
   * @param feedId - Enhanced feed identifier
   * @param validationConfig - Optional validation configuration
   * @returns Promise resolving to validation result
   */
  validatePriceUpdate(update: PriceUpdate, feedId: EnhancedFeedId, validationConfig?: any): Promise<ValidationResult>;

  /**
   * Validate multiple price updates in batch
   * @param updates - Array of price updates to validate
   * @param feedId - Enhanced feed identifier
   * @param validationConfig - Optional validation configuration
   * @returns Promise resolving to map of validation results
   */
  validateBatch(
    updates: PriceUpdate[],
    feedId: EnhancedFeedId,
    validationConfig?: any
  ): Promise<Map<string, ValidationResult>>;

  /**
   * Filter valid updates from a batch based on validation results
   * @param updates - Array of price updates
   * @param validationResults - Map of validation results
   * @returns Array of valid price updates
   */
  filterValidUpdates(updates: PriceUpdate[], validationResults: Map<string, ValidationResult>): PriceUpdate[];

  /**
   * Get validation statistics
   * @returns Validation statistics object
   */
  getValidationStatistics(): {
    totalValidations: number;
    validUpdates: number;
    invalidUpdates: number;
    validationRate: number;
    averageValidationTime: number;
    cacheSize: number;
    historicalDataSize: number;
  };

  /**
   * Clear validation cache
   */
  clearCache(): void;

  /**
   * Clear historical validation data
   */
  clearHistoricalData(): void;

  /**
   * Validate real-time price update (alias for validatePriceUpdate)
   * @param update - Price update to validate
   * @param feedId - Enhanced feed identifier
   * @param validationConfig - Optional validation configuration
   * @returns Promise resolving to validation result
   */
  validateRealTime(update: PriceUpdate, feedId: EnhancedFeedId, validationConfig?: any): Promise<ValidationResult>;

  /**
   * Get service name/identifier
   * @returns Service name
   */
  getServiceName(): string;
}
