import { Injectable } from "@nestjs/common";
import { StandardService } from "@/common/base/composed.service";
import { ConfigUtils } from "@/common/utils/config.utils";
import type { ConfigValidationResult, EnvironmentConfiguration } from "@/common/types";

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
      logLevel: process.env.LOG_LEVEL || "log",
      port: ConfigUtils.parsePort(process.env.VALUE_PROVIDER_CLIENT_PORT, 3101, "VALUE_PROVIDER_CLIENT_PORT"),
      basePath: process.env.VALUE_PROVIDER_CLIENT_BASE_PATH || "",
      nodeEnv: process.env.NODE_ENV || "development",

      // Provider implementation settings (production only)
      useProductionIntegration: true, // Always use production integration

      // Data processing settings
      medianDecay: ConfigUtils.parseFloatWithDefault(process.env.MEDIAN_DECAY, 0.00005, {
        min: 0,
        max: 1,
        fieldName: "MEDIAN_DECAY",
      }),
      tradesHistorySize: ConfigUtils.parseIntWithDefault(process.env.TRADES_HISTORY_SIZE, 1000, {
        min: 1,
        max: 10000,
        fieldName: "TRADES_HISTORY_SIZE",
      }),

      // Alerting configuration
      alerting: {
        email: {
          enabled: ConfigUtils.parseBooleanWithDefault(process.env.ALERT_EMAIL_ENABLED, false, {
            fieldName: "ALERT_EMAIL_ENABLED",
          }),
          smtpHost: process.env.ALERT_SMTP_HOST || "localhost",
          smtpPort: ConfigUtils.parsePort(process.env.ALERT_SMTP_PORT, 587, "ALERT_SMTP_PORT"),
          username: process.env.ALERT_SMTP_USERNAME || "",
          password: process.env.ALERT_SMTP_PASSWORD || "",
          from: process.env.ALERT_EMAIL_FROM || "alerts@ftso-provider.com",
          to: ConfigUtils.parseListWithDefault(process.env.ALERT_EMAIL_TO, [], { fieldName: "ALERT_EMAIL_TO" }),
        },
        webhook: {
          enabled: ConfigUtils.parseBooleanWithDefault(process.env.ALERT_WEBHOOK_ENABLED, false, {
            fieldName: "ALERT_WEBHOOK_ENABLED",
          }),
          url: process.env.ALERT_WEBHOOK_URL || "",
          headers: ConfigUtils.parseJsonWithDefault(
            process.env.ALERT_WEBHOOK_HEADERS,
            {},
            { fieldName: "ALERT_WEBHOOK_HEADERS" }
          ),
          timeout: ConfigUtils.parseTimeoutMs(process.env.ALERT_WEBHOOK_TIMEOUT, 5000, "ALERT_WEBHOOK_TIMEOUT"),
        },
        maxAlertsPerHour: ConfigUtils.parseIntWithDefault(process.env.ALERT_MAX_PER_HOUR, 20, {
          min: 1,
          max: 1000,
          fieldName: "ALERT_MAX_PER_HOUR",
        }),
        alertRetentionDays: ConfigUtils.parseIntWithDefault(process.env.ALERT_RETENTION_DAYS, 30, {
          min: 1,
          max: 365,
          fieldName: "ALERT_RETENTION_DAYS",
        }),
      },

      // Exchange API configuration
      exchangeApiKeys: ConfigUtils.loadExchangeApiKeys(["binance", "coinbase", "cryptocom", "kraken", "okx"]),

      // Cache configuration
      cache: {
        ttlMs: ConfigUtils.parseIntWithDefault(process.env.CACHE_TTL_MS, 1000, {
          min: 100,
          max: 10000,
          fieldName: "CACHE_TTL_MS",
        }),
        maxEntries: ConfigUtils.parseIntWithDefault(process.env.CACHE_MAX_ENTRIES, 10000, {
          min: 100,
          max: 1000000,
          fieldName: "CACHE_MAX_ENTRIES",
        }),
        warmupInterval: ConfigUtils.parseTimeoutMs(
          process.env.CACHE_WARMUP_INTERVAL_MS,
          30000,
          "CACHE_WARMUP_INTERVAL_MS"
        ),
      },

      // Monitoring configuration
      monitoring: {
        enabled: ConfigUtils.parseBooleanWithDefault(process.env.MONITORING_ENABLED, true, {
          fieldName: "MONITORING_ENABLED",
        }),
        metricsPort: ConfigUtils.parsePort(process.env.MONITORING_METRICS_PORT, 9090, "MONITORING_METRICS_PORT"),
        healthCheckInterval: ConfigUtils.parseTimeoutMs(
          process.env.MONITORING_HEALTH_CHECK_INTERVAL_MS,
          5000,
          "MONITORING_HEALTH_CHECK_INTERVAL_MS"
        ),
      },

      // Error handling configuration
      errorHandling: {
        maxRetries: ConfigUtils.parseIntWithDefault(process.env.ERROR_HANDLING_MAX_RETRIES, 3, {
          min: 0,
          max: 10,
          fieldName: "ERROR_HANDLING_MAX_RETRIES",
        }),
        retryDelayMs: ConfigUtils.parseTimeoutMs(
          process.env.ERROR_HANDLING_RETRY_DELAY_MS,
          1000,
          "ERROR_HANDLING_RETRY_DELAY_MS"
        ),
        circuitBreakerThreshold: ConfigUtils.parseIntWithDefault(
          process.env.ERROR_HANDLING_CIRCUIT_BREAKER_THRESHOLD,
          5,
          { min: 1, max: 100, fieldName: "ERROR_HANDLING_CIRCUIT_BREAKER_THRESHOLD" }
        ),
        circuitBreakerTimeout: ConfigUtils.parseTimeoutMs(
          process.env.ERROR_HANDLING_CIRCUIT_BREAKER_TIMEOUT_MS,
          60000,
          "ERROR_HANDLING_CIRCUIT_BREAKER_TIMEOUT_MS"
        ),
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
