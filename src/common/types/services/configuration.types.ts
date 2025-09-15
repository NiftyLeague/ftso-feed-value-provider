/**
 * Configuration service type definitions
 */

import { CoreFeedId, FeedCategory } from "../core/feed.types";
import { IBaseService } from "./base.types";

/**
 * Shared environment configuration type that mirrors the validated configuration
 * produced by the ConfigValidationService. Kept in common types to avoid
 * cross-layer imports from service implementation files.
 */
export interface EnvironmentConfiguration {
  logLevel: string;
  port: number;
  basePath: string;
  nodeEnv: string;

  // Provider implementation settings (production only)
  useProductionIntegration: boolean;

  // Data processing settings
  medianDecay: number;
  tradesHistorySize: number;

  // Alerting configuration
  alerting: {
    email: {
      enabled: boolean;
      smtpHost: string;
      smtpPort: number;
      username: string;
      password: string;
      from: string;
      to: string[];
    };
    webhook: {
      enabled: boolean;
      url: string;
      headers: Record<string, string>;
      timeout: number;
    };
    maxAlertsPerHour: number;
    alertRetentionDays: number;
  };

  // Exchange API configuration (from environment variables)
  exchangeApiKeys: Record<string, ExchangeApiKeyConfig>;

  // Cache configuration (lightweight service-level cache parameters)
  cache: {
    ttlMs: number;
    maxEntries: number;
    warmupInterval: number;
  };

  // Monitoring configuration
  monitoring: {
    enabled: boolean;
    metricsPort: number;
    healthCheckInterval: number;
  };

  // Error handling configuration
  errorHandling: {
    maxRetries: number;
    retryDelayMs: number;
    circuitBreakerThreshold: number;
    circuitBreakerTimeout: number;
  };

  // Logging configuration
  logging: {
    // File logging configuration
    enableFileLogging: boolean;
    logDirectory: string;
    maxLogFileSize: string;
    maxLogFiles: number;

    // Performance logging configuration
    enablePerformanceLogging: boolean;
    performanceLogThreshold: number; // ms

    // Debug logging configuration
    enableDebugLogging: boolean;
    debugLogLevel: "verbose" | "debug" | "log";

    // Error logging configuration
    errorLogRetention: number; // days
    maxErrorHistorySize: number;

    // Audit logging configuration
    enableAuditLogging: boolean;
    auditLogCriticalOperations: boolean;

    // Log formatting
    logFormat: "json" | "text";
    includeTimestamp: boolean;
    includeContext: boolean;
    includeStackTrace: boolean;

    // Log levels by component
    componentLogLevels: Record<string, string>;
  };
}

/**
 * API key configuration per exchange (environment-driven)
 */
export interface ExchangeApiKeyConfig {
  apiKey?: string;
  secret?: string;
  passphrase?: string;
  sandbox?: boolean;
}

/**
 * Result structure for validating configuration
 */
export interface ConfigValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  missingRequired: string[];
  invalidValues: string[];
}

/**
 * Interface for Configuration Service
 * Defines methods for configuration management and validation
 
 */
export interface IConfigurationService extends IBaseService {
  /**
   * Get all feed configurations
   * @returns Array of feed configurations
   */
  getFeedConfigurations(): Array<{
    feed: CoreFeedId;
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
  getFeedConfiguration(feedId: CoreFeedId):
    | {
        feed: CoreFeedId;
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
    feed: CoreFeedId;
    sources: Array<{
      exchange: string;
      symbol: string;
    }>;
  }>;

  /**
   * Get environment configuration
   * Matches the validated environment configuration produced by ConfigValidationService
   */
  getEnvironmentConfig(): EnvironmentConfiguration;

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
  getExchangeApiKey(exchange: string): ExchangeApiKeyConfig | undefined;
}
