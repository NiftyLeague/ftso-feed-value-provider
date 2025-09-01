import { EnhancedFeedId, FeedCategory } from "../../types/feed.types";
import { IBaseService } from "../common.interface";

/**
 * Interface for Configuration Service
 * Defines methods for configuration management and validation
 * Requirements: 3.3, 3.4, 4.1, 4.2
 */
export interface IConfigurationService extends IBaseService {
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
}
