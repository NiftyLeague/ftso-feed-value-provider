import { FeedId, FeedValueData, FeedVolumeData } from "@/dto/provider-requests.dto";
import { AggregatedPrice, QualityMetrics } from "@/aggregators/base/aggregation.interfaces";
import { ValidationResult } from "@/data-manager/validation/data-validator";
import { EnhancedFeedId, FeedCategory } from "@/types";
import { PriceUpdate } from "./data-source.interface";

/**
 * Interface for the main FTSO Provider Service
 * Defines the core business logic for feed value provision
 * Requirements: 3.3, 3.4, 4.1, 4.2
 */
export interface IFtsoProviderService {
  /**
   * Get current value for a single feed
   * @param feed - Feed identifier
   * @returns Promise resolving to feed value data
   */
  getValue(feed: FeedId): Promise<FeedValueData>;

  /**
   * Get current values for multiple feeds
   * @param feeds - Array of feed identifiers
   * @returns Promise resolving to array of feed value data
   */
  getValues(feeds: FeedId[]): Promise<FeedValueData[]>;

  /**
   * Get volume data for feeds within a time window
   * @param feeds - Array of feed identifiers
   * @param volumeWindow - Time window in seconds
   * @returns Promise resolving to array of feed volume data
   */
  getVolumes(feeds: FeedId[], volumeWindow: number): Promise<FeedVolumeData[]>;

  /**
   * Perform health check on the service
   * @returns Promise resolving to health status
   */
  healthCheck(): Promise<{
    status: "healthy" | "degraded" | "unhealthy";
    details: any;
  }>;

  /**
   * Get performance metrics for the service
   * @returns Promise resolving to performance metrics
   */
  getPerformanceMetrics(): Promise<{
    cacheStats: any;
    aggregationStats: any;
    activeFeedCount: number;
  }>;

  /**
   * Set the integration service (for dependency injection)
   * @param integrationService - Integration service instance
   */
  setIntegrationService(integrationService: any): void;

  /**
   * Get service name/identifier
   * @returns Service name
   */
  getServiceName(): string;
}

/**
 * Interface for Price Aggregation Service
 * Defines methods for real-time price aggregation and caching
 * Requirements: 3.3, 3.4, 4.1, 4.2
 */
export interface IAggregationService {
  /**
   * Get aggregated price for a feed with real-time caching
   * @param feedId - Enhanced feed identifier
   * @returns Promise resolving to aggregated price or null if unavailable
   */
  getAggregatedPrice(feedId: EnhancedFeedId): Promise<AggregatedPrice | null>;

  /**
   * Add new price update and trigger real-time recalculation
   * @param feedId - Enhanced feed identifier
   * @param update - Price update data
   */
  addPriceUpdate(feedId: EnhancedFeedId, update: PriceUpdate): void;

  /**
   * Subscribe to real-time price updates for a feed
   * @param feedId - Enhanced feed identifier
   * @param callback - Callback function for price updates
   * @returns Unsubscribe function
   */
  subscribe(feedId: EnhancedFeedId, callback: (price: AggregatedPrice) => void): () => void;

  /**
   * Get quality metrics for aggregated price
   * @param feedId - Enhanced feed identifier
   * @returns Promise resolving to quality metrics
   */
  getQualityMetrics(feedId: EnhancedFeedId): Promise<QualityMetrics>;

  /**
   * Get cache statistics
   * @returns Cache statistics object
   */
  getCacheStats(): {
    totalEntries: number;
    hitRate: number;
    missRate: number;
    evictionCount: number;
    averageAge: number;
  };

  /**
   * Get active feed count
   * @returns Number of active feeds
   */
  getActiveFeedCount(): number;

  /**
   * Process price update and trigger aggregation
   * @param update - Price update to process
   * @returns Promise that resolves when processing is complete
   */
  processPriceUpdate(update: PriceUpdate): Promise<void>;

  /**
   * Clear all cached data
   */
  clearCache(): void;

  /**
   * Get service name/identifier
   * @returns Service name
   */
  getServiceName(): string;
}

/**
 * Interface for Configuration Service
 * Defines methods for configuration management and validation
 * Requirements: 3.3, 3.4, 4.1, 4.2
 */
export interface IConfigurationService {
  /**
   * Get all feed configurations
   * @returns Array of feed configurations
   */
  getFeedConfigurations(): Array<{
    feed: EnhancedFeedId;
    sources: Array<{
      exchange: string;
      symbol: string;
    }>;
  }>;

  /**
   * Get feed configuration by feed ID
   * @param feedId - Enhanced feed identifier
   * @returns Feed configuration or undefined if not found
   */
  getFeedConfiguration(feedId: EnhancedFeedId):
    | {
        feed: EnhancedFeedId;
        sources: Array<{
          exchange: string;
          symbol: string;
        }>;
      }
    | undefined;

  /**
   * Get feed configurations by category
   * @param category - Feed category
   * @returns Array of feed configurations for the category
   */
  getFeedConfigurationsByCategory(category: FeedCategory): Array<{
    feed: EnhancedFeedId;
    sources: Array<{
      exchange: string;
      symbol: string;
    }>;
  }>;

  /**
   * Get environment configuration
   * @returns Environment configuration object
   */
  getEnvironmentConfig(): {
    logLevel: string;
    port: number;
    basePath: string;
    nodeEnv: string;
    useProductionIntegration: boolean;
    medianDecay: number;
    tradesHistorySize: number;
    alerting: any;
    exchangeApiKeys: Record<string, any>;
    cache: any;
    monitoring: any;
    errorHandling: any;
  };

  /**
   * Validate current configuration
   * @returns Validation result with errors and warnings
   */
  validateConfiguration(): {
    isValid: boolean;
    errors: string[];
    warnings: string[];
    missingRequired: string[];
    invalidValues: string[];
  };

  /**
   * Reload configuration from files
   */
  reloadConfiguration(): void;

  /**
   * Check if exchange has a custom adapter
   * @param exchange - Exchange name
   * @returns True if exchange has custom adapter
   */
  hasCustomAdapter(exchange: string): boolean;

  /**
   * Get adapter class name for custom adapter exchanges
   * @param exchange - Exchange name
   * @returns Adapter class name or undefined
   */
  getAdapterClass(exchange: string): string | undefined;

  /**
   * Get CCXT ID for CCXT exchanges
   * @param exchange - Exchange name
   * @returns CCXT ID or undefined
   */
  getCcxtId(exchange: string): string | undefined;

  /**
   * Get API key for specific exchange
   * @param exchange - Exchange name
   * @returns API key configuration or undefined
   */
  getExchangeApiKey(exchange: string):
    | {
        apiKey?: string;
        secret?: string;
        passphrase?: string;
        sandbox?: boolean;
      }
    | undefined;

  /**
   * Get service name/identifier
   * @returns Service name
   */
  getServiceName(): string;
}

/**
 * Interface for Data Validation Service
 * Defines methods for validating price data and updates
 * Requirements: 3.3, 3.4, 4.1, 4.2
 */
export interface IDataValidationService {
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

/**
 * Health status interface for services
 */
export interface ServiceHealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: number;
  details?: any;
}

/**
 * Performance metrics interface for services
 */
export interface ServicePerformanceMetrics {
  responseTime: {
    average: number;
    min: number;
    max: number;
  };
  throughput: {
    requestsPerSecond: number;
    totalRequests: number;
  };
  errorRate: number;
  uptime: number;
}

/**
 * Base interface that all services should implement
 * Provides common functionality for health checks and metrics
 */
export interface IBaseService {
  /**
   * Get service health status
   * @returns Promise resolving to health status
   */
  getHealthStatus(): Promise<ServiceHealthStatus>;

  /**
   * Get service performance metrics
   * @returns Promise resolving to performance metrics
   */
  getPerformanceMetrics(): Promise<ServicePerformanceMetrics>;

  /**
   * Get service name/identifier
   * @returns Service name
   */
  getServiceName(): string;
}
