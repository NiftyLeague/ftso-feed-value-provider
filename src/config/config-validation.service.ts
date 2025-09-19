import { Injectable } from "@nestjs/common";
import { StandardService } from "@/common/base/composed.service";
import { ENV } from "@/common/constants";
import { ConfigUtils } from "@/common/utils/config.utils";
import type { ConfigValidationResult, EnvironmentConfiguration } from "@/common/types";

// Supported exchanges for API key validation
const SUPPORTED_EXCHANGES = ["binance", "coinbase", "cryptocom", "kraken", "okx"];

@Injectable()
export class ConfigValidationService extends StandardService {
  constructor() {
    super();
  }

  /**
   * Load and validate environment configuration
   */
  loadAndValidateEnvironmentConfig(): EnvironmentConfiguration {
    const config: EnvironmentConfiguration = {
      // Core application settings
      logLevel: ENV.LOGGING.LOG_LEVEL,
      port: ENV.APPLICATION.PORT,
      basePath: ENV.APPLICATION.BASE_PATH,
      nodeEnv: ENV.APPLICATION.NODE_ENV,

      // Provider implementation settings (production only)
      useProductionIntegration: true, // Always use production integration

      // Data processing settings

      // Alerting configuration
      alerting: {
        email: {
          enabled: ENV.ALERTING.EMAIL.ENABLED,
          smtpHost: ENV.ALERTING.EMAIL.SMTP_HOST,
          smtpPort: ENV.ALERTING.EMAIL.SMTP_PORT,
          username: ENV.ALERTING.EMAIL.USERNAME,
          password: ENV.ALERTING.EMAIL.PASSWORD,
          from: ENV.ALERTING.EMAIL.FROM,
          to: ENV.ALERTING.EMAIL.TO,
        },
        webhook: {
          enabled: ENV.ALERTING.WEBHOOK.ENABLED,
          url: ENV.ALERTING.WEBHOOK.URL,
          headers: ENV.ALERTING.WEBHOOK.HEADERS,
          timeout: ENV.TIMEOUTS.WEBHOOK_MS,
        },
        maxAlertsPerHour: ENV.MONITORING.MAX_ALERTS_PER_HOUR,
        alertRetentionDays: ENV.MONITORING.ALERT_RETENTION_DAYS,
      },

      // Exchange API configuration
      exchangeApiKeys: ConfigUtils.loadExchangeApiKeys(SUPPORTED_EXCHANGES),

      // Cache configuration
      cache: {
        ttlMs: ENV.CACHE.TTL_MS,
        maxEntries: ENV.CACHE.MAX_ENTRIES,
        warmupInterval: ENV.CACHE.WARMUP_INTERVAL_MS,
      },

      // Monitoring configuration
      monitoring: {
        enabled: ENV.MONITORING.ENABLED,
        metricsPort: ENV.MONITORING.METRICS_PORT,
        healthCheckInterval: ENV.HEALTH_CHECKS.MONITORING_INTERVAL_MS,
      },

      // Error handling configuration
      errorHandling: {
        maxRetries: ENV.RETRY.DEFAULT_MAX_RETRIES,
        retryDelayMs: ENV.RETRY.DEFAULT_INITIAL_DELAY_MS,
        circuitBreakerThreshold: ENV.CIRCUIT_BREAKER.SUCCESS_THRESHOLD,
        circuitBreakerTimeout: ENV.TIMEOUTS.CIRCUIT_BREAKER_MS,
      },

      // Logging configuration
      logging: {
        // File logging configuration
        enableFileLogging: ENV.LOGGING.ENABLE_FILE_LOGGING,
        logDirectory: ENV.LOGGING.LOG_DIRECTORY,
        maxLogFileSize: ENV.LOGGING.MAX_LOG_FILE_SIZE,
        maxLogFiles: ENV.LOGGING.MAX_LOG_FILES,

        // Performance logging configuration
        enablePerformanceLogging: ENV.LOGGING.ENABLE_PERFORMANCE_LOGGING,
        performanceLogThreshold: ENV.LOGGING.PERFORMANCE_LOG_THRESHOLD,

        // Debug logging configuration
        enableDebugLogging: ENV.LOGGING.ENABLE_DEBUG_LOGGING,
        debugLogLevel: (ENV.LOGGING.DEBUG_LOG_LEVEL as "verbose" | "debug" | "log") || "debug",

        // Error logging configuration
        errorLogRetention: ENV.LOGGING.ERROR_LOG_RETENTION_DAYS,
        maxErrorHistorySize: ENV.LOGGING.MAX_ERROR_HISTORY_SIZE,

        // Audit logging configuration
        enableAuditLogging: ENV.LOGGING.ENABLE_AUDIT_LOGGING,
        auditLogCriticalOperations: ENV.LOGGING.ENABLE_AUDIT_LOGGING,

        // Log formatting
        logFormat: (ENV.LOGGING.LOG_FORMAT as "json" | "text") || "json",
        includeTimestamp: ENV.LOGGING.INCLUDE_TIMESTAMP,
        includeContext: ENV.LOGGING.INCLUDE_CONTEXT,
        includeStackTrace: ENV.LOGGING.INCLUDE_STACK_TRACE,

        // Component-specific log levels (using default log level for all components)
        componentLogLevels: {
          ProductionIntegration: "log",
          ProductionDataManager: "log",
          RealTimeAggregation: "log",
          HybridErrorHandler: "log",
          PerformanceMonitor: "log",
          AlertingService: "log",
          Bootstrap: "log",
        },
      },
    };

    // Validate the configuration
    const validation = this.validateEnvironmentConfig(config);
    if (!validation.isValid) {
      this.logger.error("Environment configuration validation failed:");
      validation.errors.forEach(error => this.logger.error(`  - ${error}`));
      validation.missingRequired.forEach(missing => this.logger.error(`  - Missing required: ${missing}`));
      validation.invalidValues.forEach(invalid => this.logger.error(`  - Invalid value: ${invalid}`));

      if (validation.errors.length > 0 || validation.missingRequired.length > 0) {
        throw new Error("Critical configuration errors detected. Please fix the configuration and restart.");
      }
    }

    if (validation.warnings.length > 0) {
      this.logger.warn("Environment configuration warnings:");
      validation.warnings.forEach(warning => this.logger.warn(`  - ${warning}`));
    }

    this.logger.log("Environment configuration loaded and validated successfully");
    return config;
  }

  /**
   * Validate environment configuration
   */
  validateEnvironmentConfig(config: EnvironmentConfiguration): ConfigValidationResult {
    const result = ConfigUtils.createValidationResult();

    // Validate log level
    const validLogLevels = ["error", "warn", "log", "debug", "verbose"];
    if (!validLogLevels.includes(config.logLevel)) {
      result.invalidValues.push(
        `LOG_LEVEL: "${config.logLevel}" is not valid. Must be one of: ${validLogLevels.join(", ")}`
      );
    }

    // Validate node environment
    const validNodeEnvs = ["development", "production", "test"];
    if (!validNodeEnvs.includes(config.nodeEnv)) {
      result.warnings.push(
        `NODE_ENV: "${config.nodeEnv}" is not a standard value. Expected: ${validNodeEnvs.join(", ")}`
      );
    }

    // Validate alerting configuration
    if (config.alerting.email.enabled) {
      if (!config.alerting.email.smtpHost) {
        result.missingRequired.push("ALERT_SMTP_HOST is required when email alerting is enabled");
      }
      if (config.alerting.email.to.length === 0) {
        result.missingRequired.push("ALERT_EMAIL_TO is required when email alerting is enabled");
      }
    }

    if (config.alerting.webhook.enabled) {
      if (!config.alerting.webhook.url) {
        result.missingRequired.push("ALERT_WEBHOOK_URL is required when webhook alerting is enabled");
      }
    }

    // Validate cache configuration
    if (config.cache.ttlMs < 100 || config.cache.ttlMs > 10000) {
      result.warnings.push(`CACHE_TTL_MS: ${config.cache.ttlMs}ms may not be optimal. Recommended range: 100-10000ms`);
    }

    if (config.cache.maxEntries < 100) {
      result.warnings.push(`CACHE_MAX_ENTRIES: ${config.cache.maxEntries} may be too low for production use`);
    }

    // Validate monitoring configuration
    if (config.monitoring.metricsPort === config.port) {
      result.errors.push("MONITORING_METRICS_PORT cannot be the same as VALUE_PROVIDER_CLIENT_PORT");
    }

    // Set overall validity
    result.isValid = result.errors.length === 0 && result.missingRequired.length === 0;

    return result;
  }

  /**
   * Validate feed configuration JSON structure
   */
  validateFeedConfigurationStructure(feedsJson: unknown[]): ConfigValidationResult {
    const result = ConfigUtils.createValidationResult();

    // Check if it's an array (the expected format)
    if (!Array.isArray(feedsJson)) {
      result.errors.push("feeds.json must contain an array of feed configurations");
      result.isValid = false;
      return result;
    }

    // Type guards
    const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

    const isFeed = (v: unknown): v is { category: number; name: string } =>
      isRecord(v) && typeof v.category === "number" && typeof v.name === "string" && v.name.trim().length > 0;

    const isSource = (v: unknown): v is { exchange: string; symbol: string } =>
      isRecord(v) &&
      typeof v.exchange === "string" &&
      v.exchange.trim().length > 0 &&
      typeof v.symbol === "string" &&
      v.symbol.trim().length > 0;

    // Validate each feed configuration
    feedsJson.forEach((feedConfig, index) => {
      const feedPrefix = `Feed ${index + 1}`;

      if (!isRecord(feedConfig)) {
        result.errors.push(`${feedPrefix}: Each feed config must be an object`);
        return;
      }

      // Check required fields
      const feed = feedConfig["feed"];
      if (!isFeed(feed)) {
        // Provide granular messages where possible
        if (!isRecord(feed)) {
          result.errors.push(`${feedPrefix}: Missing 'feed' object`);
        } else {
          if (typeof feed.category !== "number") {
            result.errors.push(`${feedPrefix}: feed.category must be a number`);
          }
          if (typeof feed.name !== "string" || !feed.name.trim()) {
            result.errors.push(`${feedPrefix}: feed.name must be a non-empty string`);
          }
        }
      }

      const sources = feedConfig["sources"] as unknown;
      if (!Array.isArray(sources)) {
        result.errors.push(`${feedPrefix}: 'sources' must be an array`);
      } else if (sources.length === 0) {
        const feedName = isFeed(feed) ? feed.name : "unknown";
        result.warnings.push(`${feedPrefix}: No sources defined for feed ${feedName}`);
      } else {
        // Validate each source
        sources.forEach((source: unknown, sourceIndex: number) => {
          const sourcePrefix = `${feedPrefix}, Source ${sourceIndex + 1}`;

          if (!isSource(source)) {
            if (!isRecord(source)) {
              result.errors.push(`${sourcePrefix}: source must be an object with 'exchange' and 'symbol'`);
            } else {
              if (typeof source.exchange !== "string" || !source.exchange?.trim()) {
                result.errors.push(`${sourcePrefix}: exchange must be a non-empty string`);
              }
              if (typeof source.symbol !== "string" || !source.symbol?.trim()) {
                result.errors.push(`${sourcePrefix}: symbol must be a non-empty string`);
              }
            }
          }
        });
      }
    });

    result.isValid = result.errors.length === 0;
    return result;
  }

  /**
   * Validate sources configuration
   */
  validateSources(
    sources: { exchange: string; symbol: string }[],
    adapterMappings: Record<string, { ccxtId?: string; adapter?: string }>
  ): ConfigValidationResult {
    const result = ConfigUtils.createValidationResult();

    for (const source of sources) {
      const mapping = adapterMappings[source.exchange];

      if (!mapping) {
        // Unknown exchange - will be treated as CCXT by default
        result.warnings.push(
          `Exchange '${source.exchange}' not in known mappings, will use CCXT with ID '${source.exchange}'`
        );
      }
    }

    return result;
  }
}
