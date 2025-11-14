/**
 * Environment Constants - Centralized Environment Variable Management
 */

import { EnvironmentUtils } from "@/common/utils/environment.utils";
import type { LogLevel } from "@/common/types/logging";

// Environment Helpers
export const ENV_HELPERS = {
  isTest: (): boolean => ENV.APPLICATION.NODE_ENV === "test",
  isDevelopment: (): boolean => ENV.APPLICATION.NODE_ENV === "development",
  isProduction: (): boolean => ENV.APPLICATION.NODE_ENV === "production",
};

export const ENV = {
  // Application Settings
  APPLICATION: {
    NODE_ENV: EnvironmentUtils.parseString("NODE_ENV", "production"),
    PORT: EnvironmentUtils.parseInt("APP_PORT", 3101, {
      min: 1,
      max: 65535,
      fieldName: "APP_PORT",
    }),
    BASE_PATH: EnvironmentUtils.parseString("APP_BASE_PATH", ""),
    CORS_MAX_AGE: EnvironmentUtils.parseInt("APP_CORS_MAX_AGE", 3600, { min: 300, max: 86400 }),
  },

  // Logging Configuration
  LOGGING: {
    LOG_LEVEL: EnvironmentUtils.parseString("LOG_LEVEL", "log") as LogLevel,
    LOG_DIRECTORY: EnvironmentUtils.parseString("LOG_DIRECTORY", "logs"),
    ENABLE_FILE_LOGGING: EnvironmentUtils.parseBoolean("ENABLE_FILE_LOGGING", false),
    ENABLE_PERFORMANCE_LOGGING: EnvironmentUtils.parseBoolean("ENABLE_PERFORMANCE_LOGGING", false),
    ENABLE_DEBUG_LOGGING: EnvironmentUtils.parseBoolean("ENABLE_DEBUG_LOGGING", false),
  },

  // Data Freshness
  DATA_FRESHNESS: {
    FRESH_DATA_MS: EnvironmentUtils.parseInt("DATA_FRESH_THRESHOLD_MS", 2000, { min: 500, max: 10000 }),
    MAX_DATA_AGE_MS: EnvironmentUtils.parseInt("DATA_MAX_AGE_MS", 300000, { min: 5000, max: 600000 }), // 5 minutes
    STALE_WARNING_MS: EnvironmentUtils.parseInt("DATA_STALE_WARNING_MS", 120000, { min: 500, max: 300000 }), // 2 minutes
  },

  // Rate Limiting
  RATE_LIMITING: {
    MAX_REQUESTS: EnvironmentUtils.parseInt("RATE_LIMIT_MAX_REQUESTS", 2000, { min: 1, max: 10000 }),
    WINDOW_MS: EnvironmentUtils.parseInt("RATE_LIMIT_WINDOW_MS", 60000, { min: 1000, max: 3600000 }),
  },

  // Timeouts - Consolidated all timeout configurations
  TIMEOUTS: {
    // Application lifecycle
    GRACEFUL_SHUTDOWN_MS: EnvironmentUtils.parseInt("GRACEFUL_SHUTDOWN_TIMEOUT_MS", 30000, { min: 1000, max: 300000 }),

    INTEGRATION_MS: EnvironmentUtils.parseInt("INTEGRATION_SERVICE_TIMEOUT_MS", 120000, { min: 1000, max: 300000 }),

    // Network operations
    HTTP_MS: EnvironmentUtils.parseInt("HTTP_TIMEOUT_MS", 10000, { min: 1000, max: 60000 }),
    HTTP_RECOVERY_MS: EnvironmentUtils.parseInt("HTTP_RECOVERY_TIMEOUT_MS", 30000, { min: 1000, max: 300000 }),
    DB_MS: EnvironmentUtils.parseInt("DB_TIMEOUT_MS", 30000, { min: 1000, max: 120000 }),
    DB_RECOVERY_MS: EnvironmentUtils.parseInt("DB_RECOVERY_TIMEOUT_MS", 60000, { min: 1000, max: 600000 }),

    // Processing operations
    VALIDATION_MS: EnvironmentUtils.parseInt("VALIDATION_TIMEOUT_MS", 5000, { min: 1000, max: 30000 }),
    WEBHOOK_MS: EnvironmentUtils.parseInt("WEBHOOK_TIMEOUT_MS", 5000, { min: 1000, max: 30000 }),
    CIRCUIT_BREAKER_MS: EnvironmentUtils.parseInt("CIRCUIT_BREAKER_TIMEOUT_MS", 3000, { min: 1000, max: 30000 }),
    DATA_VALIDATOR_MS: EnvironmentUtils.parseInt("DATA_VALIDATOR_TIMEOUT_MS", 5000, { min: 1000, max: 30000 }),
    CCXT_MS: EnvironmentUtils.parseInt("CCXT_TIMEOUT_MS", 15000, { min: 5000, max: 30000 }),

    // Bootstrap and monitoring
    READINESS_REQUEST_TIMEOUT_MS: EnvironmentUtils.parseInt("READINESS_REQUEST_TIMEOUT_MS", 5000, {
      min: 1000,
      max: 30000,
    }),
    CLEANUP_DELAY_MS: EnvironmentUtils.parseInt("CLEANUP_DELAY_MS", 100, { min: 50, max: 1000 }),
    FORCE_EXIT_DELAY_MS: EnvironmentUtils.parseInt("FORCE_EXIT_DELAY_MS", 1000, { min: 500, max: 5000 }),
  },

  // Error Handling - Consolidated configurations
  ERROR_HANDLING: {
    WARNING_COOLDOWN_MS: EnvironmentUtils.parseInt("ERROR_HANDLING_WARNING_COOLDOWN_MS", 30000, {
      min: 5000,
      max: 300000,
    }),
  },

  // Retry Configuration
  RETRY: {
    // Default retry configuration
    DEFAULT_MAX_RETRIES: EnvironmentUtils.parseInt("RETRY_DEFAULT_MAX_RETRIES", 5, { min: 1, max: 10 }),
    DEFAULT_INITIAL_DELAY_MS: EnvironmentUtils.parseInt("RETRY_DEFAULT_INITIAL_DELAY_MS", 2000, {
      min: 100,
      max: 10000,
    }),

    DEFAULT_BACKOFF_MULTIPLIER: EnvironmentUtils.parseFloat("RETRY_DEFAULT_BACKOFF_MULTIPLIER", 2.0, {
      min: 1.1,
      max: 5.0,
    }),

    // Service-specific overrides
    HTTP_MAX_DELAY_MS: EnvironmentUtils.parseInt("RETRY_HTTP_MAX_DELAY_MS", 15000, { min: 1000, max: 60000 }),
    DATABASE_MAX_RETRIES: EnvironmentUtils.parseInt("RETRY_DATABASE_MAX_RETRIES", 2, { min: 1, max: 10 }),
    DATABASE_INITIAL_DELAY_MS: EnvironmentUtils.parseInt("RETRY_DATABASE_INITIAL_DELAY_MS", 500, {
      min: 100,
      max: 5000,
    }),
    DATABASE_MAX_DELAY_MS: EnvironmentUtils.parseInt("RETRY_DATABASE_MAX_DELAY_MS", 5000, { min: 1000, max: 30000 }),
    CACHE_MAX_RETRIES: EnvironmentUtils.parseInt("RETRY_CACHE_MAX_RETRIES", 1, { min: 1, max: 5 }),
    CACHE_INITIAL_DELAY_MS: EnvironmentUtils.parseInt("RETRY_CACHE_INITIAL_DELAY_MS", 100, { min: 50, max: 1000 }),
    CACHE_MAX_DELAY_MS: EnvironmentUtils.parseInt("RETRY_CACHE_MAX_DELAY_MS", 1000, { min: 100, max: 5000 }),
    EXTERNAL_API_INITIAL_DELAY_MS: EnvironmentUtils.parseInt("RETRY_EXTERNAL_API_INITIAL_DELAY_MS", 5000, {
      min: 500,
      max: 10000,
    }),
    EXTERNAL_API_MAX_DELAY_MS: EnvironmentUtils.parseInt("RETRY_EXTERNAL_API_MAX_DELAY_MS", 120000, {
      min: 5000,
      max: 120000,
    }),
    WEBSOCKET_MAX_RETRIES: EnvironmentUtils.parseInt("RETRY_WEBSOCKET_MAX_RETRIES", 5, { min: 1, max: 15 }),
    WEBSOCKET_INITIAL_DELAY_MS: EnvironmentUtils.parseInt("RETRY_WEBSOCKET_INITIAL_DELAY_MS", 1000, {
      min: 500,
      max: 5000,
    }),
    WEBSOCKET_MAX_DELAY_MS: EnvironmentUtils.parseInt("RETRY_WEBSOCKET_MAX_DELAY_MS", 60000, {
      min: 10000,
      max: 300000,
    }),
  },

  // Circuit Breaker Configuration
  CIRCUIT_BREAKER: {
    SUCCESS_THRESHOLD: EnvironmentUtils.parseInt("CIRCUIT_BREAKER_SUCCESS_THRESHOLD", 3, { min: 1, max: 10 }),
    MONITORING_WINDOW_MS: EnvironmentUtils.parseInt("CIRCUIT_BREAKER_MONITORING_WINDOW_MS", 300000, {
      min: 60000,
      max: 1800000,
    }),
  },

  // Connection Recovery Configuration
  CONNECTION_RECOVERY: {
    MAX_FAILOVER_TIME_MS: EnvironmentUtils.parseInt("CONNECTION_RECOVERY_MAX_FAILOVER_TIME_MS", 100, {
      min: 50,
      max: 1000,
    }),
    RECONNECT_DELAY_MS: EnvironmentUtils.parseInt("CONNECTION_RECOVERY_RECONNECT_DELAY_MS", 5000, {
      min: 1000,
      max: 30000,
    }),
    MAX_RECONNECT_DELAY_MS: EnvironmentUtils.parseInt("CONNECTION_RECOVERY_MAX_RECONNECT_DELAY_MS", 60000, {
      min: 10000,
      max: 300000,
    }),
    MAX_RECONNECT_ATTEMPTS: EnvironmentUtils.parseInt("CONNECTION_RECOVERY_MAX_RECONNECT_ATTEMPTS", 3, {
      min: 1,
      max: 10,
    }),
    GRACEFUL_DEGRADATION_THRESHOLD: EnvironmentUtils.parseInt("CONNECTION_RECOVERY_GRACEFUL_DEGRADATION_THRESHOLD", 2, {
      min: 1,
      max: 10,
    }),
    RECONNECT_COOLDOWN_MS: EnvironmentUtils.parseInt("CONNECTION_RECOVERY_RECONNECT_COOLDOWN_MS", 30000, {
      min: 5000,
      max: 300000,
    }),
  },

  // Data Quality & Validation - Unified Configuration
  DATA_QUALITY: {
    // Validation thresholds
    OUTLIER_THRESHOLD: EnvironmentUtils.parseFloat("VALIDATION_OUTLIER_THRESHOLD", 0.05, { min: 0.01, max: 0.5 }),
    CONSENSUS_THRESHOLD: EnvironmentUtils.parseFloat("VALIDATION_CONSENSUS_THRESHOLD", 0.005, { min: 0.001, max: 0.1 }),
    Z_SCORE_THRESHOLD: EnvironmentUtils.parseFloat("VALIDATION_Z_SCORE_THRESHOLD", 2.5, { min: 1.0, max: 5.0 }),
    CONFIDENCE_SMALL_PENALTY: EnvironmentUtils.parseFloat("VALIDATION_CONFIDENCE_SMALL_PENALTY", 0.95, {
      min: 0.8,
      max: 1.0,
    }),

    // Cross-source validation
    CROSS_SOURCE_THRESHOLD: EnvironmentUtils.parseFloat("DATA_VALIDATOR_CROSS_SOURCE_THRESHOLD", 0.02, {
      min: 0.005,
      max: 0.1,
    }),
    CROSS_SOURCE_WARNING_MULTIPLIER: EnvironmentUtils.parseFloat(
      "DATA_VALIDATOR_CROSS_SOURCE_WARNING_MULTIPLIER",
      2.0,
      {
        min: 1.5,
        max: 5.0,
      }
    ),
    CONSENSUS_WARNING_MULTIPLIER: EnvironmentUtils.parseFloat("DATA_VALIDATOR_CONSENSUS_WARNING_MULTIPLIER", 2.0, {
      min: 1.5,
      max: 5.0,
    }),

    // Data validation settings
    MIN_HISTORICAL_DATA_POINTS: EnvironmentUtils.parseInt("DATA_VALIDATOR_MIN_HISTORICAL_POINTS", 3, {
      min: 2,
      max: 10,
    }),
    RECENT_PRICES_WINDOW: EnvironmentUtils.parseInt("DATA_VALIDATOR_RECENT_PRICES_WINDOW", 5, { min: 3, max: 20 }),
    MAX_HIGH_ERRORS: EnvironmentUtils.parseInt("DATA_VALIDATOR_MAX_HIGH_ERRORS", 1, { min: 0, max: 5 }),

    // Data processing settings
    CROSS_SOURCE_WINDOW_MS: EnvironmentUtils.parseInt("DATA_QUALITY_CROSS_SOURCE_WINDOW_MS", 10000, {
      min: 1000,
      max: 60000,
    }),
    MAX_BATCH_SIZE: EnvironmentUtils.parseInt("DATA_QUALITY_MAX_BATCH_SIZE", 100, { min: 10, max: 1000 }),
    HISTORICAL_DATA_WINDOW: EnvironmentUtils.parseInt("DATA_QUALITY_HISTORICAL_WINDOW", 50, { min: 10, max: 500 }),
    CONSENSUS_WEIGHT: EnvironmentUtils.parseFloat("DATA_QUALITY_CONSENSUS_WEIGHT", 0.8, { min: 0.1, max: 1.0 }),
    PRICE_RANGE_MIN: EnvironmentUtils.parseFloat("DATA_QUALITY_PRICE_RANGE_MIN", 0.01, { min: 0.001, max: 1.0 }),
    PRICE_RANGE_MAX: EnvironmentUtils.parseFloat("DATA_QUALITY_PRICE_RANGE_MAX", 1000000, {
      min: 1000,
      max: 10000000,
    }),
    CACHE_SIZE: EnvironmentUtils.parseInt("DATA_QUALITY_CACHE_SIZE", 100, { min: 100, max: 10000 }),
    CACHE_TTL_MS: EnvironmentUtils.parseInt("DATA_QUALITY_CACHE_TTL_MS", 5000, { min: 1000, max: 60000 }),

    // Confidence penalties - unified
    CONFIDENCE_PENALTY_CRITICAL: EnvironmentUtils.parseFloat("DATA_QUALITY_CONFIDENCE_PENALTY_CRITICAL", 0.1, {
      min: 0.05,
      max: 0.5,
    }),
    CONFIDENCE_PENALTY_HIGH: EnvironmentUtils.parseFloat("DATA_QUALITY_CONFIDENCE_PENALTY_HIGH", 0.3, {
      min: 0.1,
      max: 0.7,
    }),
    CONFIDENCE_PENALTY_MEDIUM: EnvironmentUtils.parseFloat("DATA_QUALITY_CONFIDENCE_PENALTY_MEDIUM", 0.6, {
      min: 0.3,
      max: 0.9,
    }),
  },

  // Alert Thresholds
  ALERTS: {
    CONSENSUS_DEVIATION_CRITICAL: EnvironmentUtils.parseFloat("ALERT_CONSENSUS_DEVIATION_CRITICAL", 1.0, {
      min: 0.1,
      max: 10.0,
    }),
    CONSENSUS_DEVIATION_ERROR: EnvironmentUtils.parseFloat("ALERT_CONSENSUS_DEVIATION_ERROR", 0.5, {
      min: 0.1,
      max: 5.0,
    }),
    ACCURACY_RATE_LOW: EnvironmentUtils.parseInt("ALERT_ACCURACY_RATE_LOW", 80, { min: 50, max: 100 }),
    CONNECTION_RATE_LOW: EnvironmentUtils.parseInt("ALERT_CONNECTION_RATE_LOW", 90, { min: 50, max: 100 }),
    ERROR_RATE_HIGH: EnvironmentUtils.parseInt("ALERT_ERROR_RATE_HIGH", 5, { min: 1, max: 100 }),
    QUALITY_SCORE_LOW: EnvironmentUtils.parseInt("ALERT_QUALITY_SCORE_LOW", 70, { min: 50, max: 100 }),
  },

  // System Resources and Performance
  SYSTEM: {
    // Memory thresholds - production-safe values with adequate headroom for GC and memory spikes
    MEMORY_CRITICAL_THRESHOLD: EnvironmentUtils.parseFloat("SYSTEM_MEMORY_CRITICAL_THRESHOLD", 0.85, {
      min: 0.7,
      max: 1.0,
    }),
    MEMORY_WARNING_THRESHOLD: EnvironmentUtils.parseFloat("SYSTEM_MEMORY_WARNING_THRESHOLD", 0.75, {
      min: 0.5,
      max: 0.95,
    }),
    FREE_MEMORY_CRITICAL_THRESHOLD: EnvironmentUtils.parseFloat("SYSTEM_FREE_MEMORY_CRITICAL_THRESHOLD", 0.1, {
      min: 0.05,
      max: 0.5,
    }),

    // Node.js version requirements
    MIN_NODE_VERSION: EnvironmentUtils.parseInt("SYSTEM_MIN_NODE_VERSION", 16, { min: 14, max: 20 }),
    RECOMMENDED_NODE_VERSION: EnvironmentUtils.parseInt("SYSTEM_RECOMMENDED_NODE_VERSION", 18, { min: 16, max: 20 }),
  },

  // Cache System - Unified Configuration
  CACHE: {
    // Core cache settings
    TTL_MS: EnvironmentUtils.parseInt("CACHE_TTL_MS", 3000, { min: 100, max: 10000 }),
    MAX_ENTRIES: EnvironmentUtils.parseInt("CACHE_MAX_ENTRIES", 1500, { min: 100, max: 1000000 }),
    ACCESS_UPDATE_THRESHOLD_MS: EnvironmentUtils.parseInt("CACHE_ACCESS_UPDATE_THRESHOLD_MS", 100, {
      min: 50,
      max: 1000,
    }),
    EVICTION_PERCENTAGE: EnvironmentUtils.parseFloat("CACHE_EVICTION_PERCENTAGE", 0.1, { min: 0.05, max: 0.5 }),
    MAX_EVICTION_COUNT: EnvironmentUtils.parseInt("CACHE_MAX_EVICTION_COUNT", 150, { min: 10, max: 1000 }),
    FRESHNESS_CHECK_MS: EnvironmentUtils.parseInt("CACHE_FRESHNESS_CHECK_MS", 200, { min: 50, max: 1000 }),

    // Buffer and warmup settings
    MAX_BUFFER_SIZE: EnvironmentUtils.parseInt("CACHE_MAX_BUFFER_SIZE", 25, { min: 10, max: 1000 }),
    STALE_PATTERN_THRESHOLD_MS: EnvironmentUtils.parseInt("CACHE_STALE_PATTERN_THRESHOLD_MS", 86400000, {
      min: 3600000,
      max: 604800000,
    }),
    ACTIVE_PATTERN_THRESHOLD_MS: EnvironmentUtils.parseInt("CACHE_ACTIVE_PATTERN_THRESHOLD_MS", 3600000, {
      min: 300000,
      max: 86400000,
    }),

    // Performance targets
    HIT_RATE_TARGET: EnvironmentUtils.parseFloat("CACHE_HIT_RATE_TARGET", 0.9, { min: 0.5, max: 1.0 }),
    RESPONSE_TIME_P95_TARGET_MS: EnvironmentUtils.parseInt("CACHE_RESPONSE_TIME_P95_TARGET_MS", 300, {
      min: 10,
      max: 5000,
    }),
    MEMORY_LIMIT_MB: EnvironmentUtils.parseInt("CACHE_MEMORY_LIMIT_MB", 100, { min: 50, max: 2000 }),
    MIN_REQUESTS_FOR_HIT_RATE: EnvironmentUtils.parseInt("CACHE_MIN_REQUESTS_FOR_HIT_RATE", 50, { min: 10, max: 200 }),
    MIN_REQUESTS_FOR_RESPONSE_TIME: EnvironmentUtils.parseInt("CACHE_MIN_REQUESTS_FOR_RESPONSE_TIME", 25, {
      min: 5,
      max: 100,
    }),

    // Cache Warmer settings
    WARMER: {
      AGGRESSIVE_INTERVAL_MS: EnvironmentUtils.parseInt("CACHE_WARMER_AGGRESSIVE_INTERVAL_MS", 2000, {
        min: 1000,
        max: 10000,
      }),
      PREDICTIVE_INTERVAL_MS: EnvironmentUtils.parseInt("CACHE_WARMER_PREDICTIVE_INTERVAL_MS", 5000, {
        min: 2000,
        max: 30000,
      }),
      MAINTENANCE_INTERVAL_MS: EnvironmentUtils.parseInt("CACHE_WARMER_MAINTENANCE_INTERVAL_MS", 15000, {
        min: 5000,
        max: 60000,
      }),
      CRITICAL_TARGET_FEEDS: EnvironmentUtils.parseInt("CACHE_WARMER_CRITICAL_TARGET_FEEDS", 30, { min: 5, max: 100 }),
      CRITICAL_CONCURRENCY: EnvironmentUtils.parseInt("CACHE_WARMER_CRITICAL_CONCURRENCY", 20, { min: 1, max: 50 }),
      CRITICAL_INTERVAL_MS: EnvironmentUtils.parseInt("CACHE_WARMER_CRITICAL_INTERVAL_MS", 1500, {
        min: 500,
        max: 10000,
      }),
      PREDICTIVE_TARGET_FEEDS: EnvironmentUtils.parseInt("CACHE_WARMER_PREDICTIVE_TARGET_FEEDS", 50, {
        min: 10,
        max: 200,
      }),
      PREDICTIVE_CONCURRENCY: EnvironmentUtils.parseInt("CACHE_WARMER_PREDICTIVE_CONCURRENCY", 16, {
        min: 1,
        max: 30,
      }),
      MAINTENANCE_TARGET_FEEDS: EnvironmentUtils.parseInt("CACHE_WARMER_MAINTENANCE_TARGET_FEEDS", 100, {
        min: 20,
        max: 500,
      }),
      MAINTENANCE_CONCURRENCY: EnvironmentUtils.parseInt("CACHE_WARMER_MAINTENANCE_CONCURRENCY", 8, {
        min: 1,
        max: 20,
      }),
      DEFAULT_ACCESS_INTERVAL_MS: EnvironmentUtils.parseInt("CACHE_WARMER_DEFAULT_ACCESS_INTERVAL_MS", 10000, {
        min: 1000,
        max: 60000,
      }),
      IMMEDIATE_THRESHOLD: EnvironmentUtils.parseInt("CACHE_WARMER_IMMEDIATE_THRESHOLD", 3, { min: 1, max: 10 }),
      FREQUENT_ACCESS_THRESHOLD_MS: EnvironmentUtils.parseInt("CACHE_WARMER_FREQUENT_ACCESS_THRESHOLD_MS", 30000, {
        min: 5000,
        max: 120000,
      }),

      PRIORITY_BASE_MULTIPLIER: EnvironmentUtils.parseFloat("CACHE_WARMER_PRIORITY_BASE_MULTIPLIER", 2.5, {
        min: 1.0,
        max: 5.0,
      }),
      RECENCY_BOOST_30MIN: EnvironmentUtils.parseFloat("CACHE_WARMER_RECENCY_BOOST_30MIN", 3.0, {
        min: 1.5,
        max: 5.0,
      }),
      RECENCY_BOOST_2HOUR: EnvironmentUtils.parseFloat("CACHE_WARMER_RECENCY_BOOST_2HOUR", 2.2, {
        min: 1.2,
        max: 3.0,
      }),
      RECENCY_BOOST_8HOUR: EnvironmentUtils.parseFloat("CACHE_WARMER_RECENCY_BOOST_8HOUR", 1.6, {
        min: 1.1,
        max: 2.0,
      }),
      FREQUENCY_BOOST_15SEC: EnvironmentUtils.parseFloat("CACHE_WARMER_FREQUENCY_BOOST_15SEC", 2.2, {
        min: 1.5,
        max: 3.0,
      }),
      FREQUENCY_BOOST_1MIN: EnvironmentUtils.parseFloat("CACHE_WARMER_FREQUENCY_BOOST_1MIN", 1.8, {
        min: 1.2,
        max: 2.5,
      }),
      CONFIDENCE_MULTIPLIER_MIN: EnvironmentUtils.parseFloat("CACHE_WARMER_CONFIDENCE_MULTIPLIER_MIN", 0.3, {
        min: 0.1,
        max: 0.5,
      }),
      CONFIDENCE_MULTIPLIER_MAX: EnvironmentUtils.parseFloat("CACHE_WARMER_CONFIDENCE_MULTIPLIER_MAX", 1.7, {
        min: 1.0,
        max: 2.0,
      }),
      DECAY_RATE_MIN_HOURS: EnvironmentUtils.parseInt("CACHE_WARMER_DECAY_RATE_MIN_HOURS", 12, { min: 6, max: 24 }),
      DECAY_RATE_MAX_HOURS: EnvironmentUtils.parseInt("CACHE_WARMER_DECAY_RATE_MAX_HOURS", 48, { min: 24, max: 72 }),
      VOLUME_BOOST_MAX: EnvironmentUtils.parseFloat("CACHE_WARMER_VOLUME_BOOST_MAX", 1.5, { min: 1.0, max: 2.0 }),
      PRIORITY_MIN: EnvironmentUtils.parseFloat("CACHE_WARMER_PRIORITY_MIN", 0.05, { min: 0.01, max: 0.1 }),
      PRIORITY_MAX: EnvironmentUtils.parseFloat("CACHE_WARMER_PRIORITY_MAX", 100, { min: 50, max: 200 }),
    },
  },

  // System Intervals - Optimized for performance
  INTERVALS: {
    MONITORING_MS: EnvironmentUtils.parseInt("INTERVALS_MONITORING_MS", 10000, { min: 1000, max: 60000 }), // Increased from 5s to 10s to reduce overhead
    PERFORMANCE_MONITORING_MS: EnvironmentUtils.parseInt("INTERVALS_PERFORMANCE_MONITORING_MS", 15000, {
      min: 1000,
      max: 30000,
    }), // Increased from 5s to 15s to reduce frequent cache optimization cycles
    SYSTEM_CHECK_MS: EnvironmentUtils.parseInt("INTERVALS_SYSTEM_CHECK_MS", 30000, {
      min: 10000,
      max: 300000,
    }),
    AGGREGATION_MS: EnvironmentUtils.parseInt("INTERVALS_AGGREGATION_MS", 100, { min: 10, max: 1000 }), // Increased from 50ms to 100ms to reduce aggregation frequency and system load
    CACHE_CLEANUP_MS: EnvironmentUtils.parseInt("INTERVALS_CACHE_CLEANUP_MS", 5000, { min: 500, max: 10000 }), // Increased from 2.5s to 5s to reduce cleanup overhead
  },

  // Monitoring and Performance - Consolidated
  MONITORING: {
    ENABLED: EnvironmentUtils.parseBoolean("MONITORING_ENABLED", true),
    METRICS_PORT: EnvironmentUtils.parseInt("MONITORING_METRICS_PORT", 9090, { min: 1, max: 65535 }),

    // Data retention and cleanup
    BUCKET_SIZE_MS: EnvironmentUtils.parseInt("MONITORING_BUCKET_SIZE_MS", 300000, { min: 60000, max: 1800000 }),
    DATA_RETENTION_MS: EnvironmentUtils.parseInt("MONITORING_DATA_RETENTION_MS", 86400000, {
      min: 3600000,
      max: 604800000,
    }),

    // Performance thresholds
    MAX_RESPONSE_LATENCY_MS: EnvironmentUtils.parseInt("MONITORING_MAX_RESPONSE_LATENCY_MS", 500, {
      min: 1,
      max: 10000,
    }), // Increased from 100ms to 500ms for more realistic response time expectations during startup
    MIN_THROUGHPUT: EnvironmentUtils.parseInt("MONITORING_MIN_THROUGHPUT", 150, { min: 1, max: 10000 }),
    MIN_CACHE_HIT_RATE: EnvironmentUtils.parseInt("MONITORING_MIN_CACHE_HIT_RATE", 90, { min: 0, max: 100 }),

    // Health thresholds
    MAX_ERROR_RATE: EnvironmentUtils.parseInt("MONITORING_MAX_ERROR_RATE", 3, { min: 0, max: 1000 }),
    MAX_CPU_USAGE: EnvironmentUtils.parseInt("MONITORING_MAX_CPU_USAGE", 70, { min: 0, max: 100 }),
    MAX_MEMORY_USAGE: EnvironmentUtils.parseInt("MONITORING_MAX_MEMORY_USAGE", 80, { min: 0, max: 100 }),
    MIN_CONNECTION_RATE: EnvironmentUtils.parseInt("MONITORING_MIN_CONNECTION_RATE", 95, { min: 0, max: 100 }),

    // Accuracy thresholds
    MAX_CONSENSUS_DEVIATION: EnvironmentUtils.parseFloat("MONITORING_MAX_CONSENSUS_DEVIATION", 0.3, {
      min: 0,
      max: 10,
    }),
    MIN_ACCURACY_RATE: EnvironmentUtils.parseInt("MONITORING_MIN_ACCURACY_RATE", 80, { min: 0, max: 100 }),
    MIN_QUALITY_SCORE: EnvironmentUtils.parseInt("MONITORING_MIN_QUALITY_SCORE", 70, { min: 0, max: 100 }),

    // Alerting
    ALERT_COOLDOWN_MS: EnvironmentUtils.parseInt("MONITORING_ALERT_COOLDOWN_MS", 300000, { min: 60000, max: 3600000 }),
    ALERT_DURATION_MS: EnvironmentUtils.parseInt("MONITORING_ALERT_DURATION_MS", 30000, { min: 5000, max: 300000 }),
    ALERT_RETENTION_DAYS: EnvironmentUtils.parseInt("MONITORING_ALERT_RETENTION_DAYS", 7, { min: 1, max: 30 }),
    MAX_ALERTS_LIMIT: EnvironmentUtils.parseInt("MONITORING_MAX_ALERTS_LIMIT", 100, { min: 10, max: 1000 }),
    MAX_ALERTS_PER_HOUR: EnvironmentUtils.parseInt("MONITORING_MAX_ALERTS_PER_HOUR", 20, { min: 1, max: 1000 }),

    // Warning cooldowns
    QUALITY_WARNING_COOLDOWN_MS: EnvironmentUtils.parseInt("MONITORING_QUALITY_WARNING_COOLDOWN_MS", 300000, {
      min: 60000,
      max: 1800000,
    }),

    // Performance monitoring
    SLOW_RESPONSE_THRESHOLD_MS: EnvironmentUtils.parseInt("MONITORING_SLOW_RESPONSE_THRESHOLD_MS", 1000, {
      min: 100,
      max: 10000,
    }),
    HIGH_ERROR_RATE_THRESHOLD: EnvironmentUtils.parseInt("MONITORING_HIGH_ERROR_RATE_THRESHOLD", 5, {
      min: 1,
      max: 100,
    }),
    ERROR_RATE_TIME_WINDOW_MS: EnvironmentUtils.parseInt("MONITORING_ERROR_RATE_TIME_WINDOW_MS", 300000, {
      min: 60000,
      max: 1800000,
    }),

    // Additional monitoring constants
    WARNING_THRESHOLD: EnvironmentUtils.parseFloat("MONITORING_WARNING_THRESHOLD", 0.3, { min: 0.1, max: 1.0 }),
    CRITICAL_THRESHOLD: EnvironmentUtils.parseFloat("MONITORING_CRITICAL_THRESHOLD", 1.0, { min: 0.5, max: 5.0 }),
    MAX_DEVIATION: EnvironmentUtils.parseFloat("MONITORING_MAX_DEVIATION", 2.0, { min: 0.5, max: 10.0 }),
    MIN_PARTICIPANTS: EnvironmentUtils.parseInt("MONITORING_MIN_PARTICIPANTS", 2, { min: 1, max: 20 }),
    BUFFER_SIZE: EnvironmentUtils.parseInt("MONITORING_BUFFER_SIZE", 500, { min: 100, max: 10000 }),
  },

  // Performance Configuration - Consolidated
  PERFORMANCE: {
    // Connection health ratios
    HEALTHY_CONNECTION_RATIO: EnvironmentUtils.parseFloat("PERFORMANCE_HEALTHY_CONNECTION_RATIO", 0.8, {
      min: 0.5,
      max: 1.0,
    }),
    DEGRADED_CONNECTION_RATIO: EnvironmentUtils.parseFloat("PERFORMANCE_DEGRADED_CONNECTION_RATIO", 0.5, {
      min: 0.2,
      max: 0.8,
    }),

    // Confidence and thresholds
    DEFAULT_CONFIDENCE_FALLBACK: EnvironmentUtils.parseFloat("PERFORMANCE_DEFAULT_CONFIDENCE_FALLBACK", 0.5, {
      min: 0.1,
      max: 0.9,
    }),
    MIN_CONFIDENCE_THRESHOLD: EnvironmentUtils.parseFloat("PERFORMANCE_MIN_CONFIDENCE_THRESHOLD", 0.5, {
      min: 0.1,
      max: 1.0,
    }),
    WARN_CONFIDENCE_THRESHOLD: EnvironmentUtils.parseFloat("PERFORMANCE_WARN_CONFIDENCE_THRESHOLD", 0.7, {
      min: 0.3,
      max: 1.0,
    }),
    PRICE_CHANGE_THRESHOLD: EnvironmentUtils.parseFloat("PERFORMANCE_PRICE_CHANGE_THRESHOLD", 0.05, {
      min: 0.01,
      max: 0.2,
    }),
    STABILITY_THRESHOLD: EnvironmentUtils.parseFloat("PERFORMANCE_STABILITY_THRESHOLD", 0.05, { min: 0.01, max: 0.2 }),

    // Retry and backoff settings
    COMMON_BACKOFF_MULTIPLIER: EnvironmentUtils.parseFloat("PERFORMANCE_COMMON_BACKOFF_MULTIPLIER", 2.0, {
      min: 1.1,
      max: 5.0,
    }),
    JITTER_MIN_FACTOR: EnvironmentUtils.parseFloat("PERFORMANCE_JITTER_MIN_FACTOR", 0.5, { min: 0.1, max: 0.8 }),
    JITTER_MAX_FACTOR: EnvironmentUtils.parseFloat("PERFORMANCE_JITTER_MAX_FACTOR", 0.5, { min: 0.2, max: 1.0 }),

    // Exchange adapter penalties
    MAX_LATENCY_PENALTY: EnvironmentUtils.parseFloat("PERFORMANCE_MAX_LATENCY_PENALTY", 0.5, { min: 0.1, max: 0.8 }),
    MAX_SPREAD_PENALTY: EnvironmentUtils.parseFloat("PERFORMANCE_MAX_SPREAD_PENALTY", 0.3, { min: 0.1, max: 0.5 }),

    // Optimization settings
    OPTIMIZATION_INTERVAL_MS: EnvironmentUtils.parseInt("PERFORMANCE_OPTIMIZATION_INTERVAL_MS", 30000, {
      min: 5000,
      max: 60000,
    }),
    AUTO_OPTIMIZATION: EnvironmentUtils.parseBoolean("PERFORMANCE_AUTO_OPTIMIZATION", true),
    RESPONSE_TIME_TARGET_MS: EnvironmentUtils.parseInt("PERFORMANCE_RESPONSE_TIME_TARGET_MS", 100, {
      min: 10,
      max: 1000,
    }), // Optimized to 100ms for better performance while maintaining realistic targets
    CRITICAL_RESPONSE_TIME_MS: EnvironmentUtils.parseInt("PERFORMANCE_CRITICAL_RESPONSE_TIME_MS", 150, {
      min: 50,
      max: 500,
    }),
    MEMORY_USAGE_THRESHOLD: EnvironmentUtils.parseInt("PERFORMANCE_MEMORY_USAGE_THRESHOLD", 70, {
      min: 30,
      max: 90,
    }),
    CPU_USAGE_THRESHOLD: EnvironmentUtils.parseInt("PERFORMANCE_CPU_USAGE_THRESHOLD", 65, { min: 20, max: 80 }),

    // Calculation helpers
    SMOOTHING_ALPHA: EnvironmentUtils.parseFloat("PERFORMANCE_SMOOTHING_ALPHA", 0.1, { min: 0.01, max: 0.5 }),

    // Cache optimization settings
    CLEANUP_TRIGGER_PROBABILITY: EnvironmentUtils.parseFloat("PERFORMANCE_CLEANUP_TRIGGER_PROBABILITY", 0.1, {
      min: 0.01,
      max: 0.5,
    }),
    MAX_ADAPTIVE_MULTIPLIER: EnvironmentUtils.parseFloat("PERFORMANCE_MAX_ADAPTIVE_MULTIPLIER", 2.0, {
      min: 1.0,
      max: 5.0,
    }),
    FREQUENCY_MULTIPLIER: EnvironmentUtils.parseFloat("PERFORMANCE_FREQUENCY_MULTIPLIER", 0.1, { min: 0.01, max: 1.0 }),
  },

  // WebSocket Configuration - Optimized for performance and stability
  WEBSOCKET: {
    PING_INTERVAL_MS: EnvironmentUtils.parseInt("WEBSOCKET_PING_INTERVAL_MS", 45000, { min: 5000, max: 300000 }), // Increased to 45s for better stability with exchange servers
    PONG_TIMEOUT_MS: EnvironmentUtils.parseInt("WEBSOCKET_PONG_TIMEOUT_MS", 60000, { min: 2000, max: 60000 }), // Increased to 60s to reduce false timeouts
    RECONNECT_DELAY_MS: EnvironmentUtils.parseInt("WEBSOCKET_RECONNECT_DELAY_MS", 8000, { min: 1000, max: 60000 }), // Increased from 5s to 8s for better stability
    MAX_RECONNECT_ATTEMPTS: EnvironmentUtils.parseInt("WEBSOCKET_MAX_RECONNECT_ATTEMPTS", 10, { min: 1, max: 50 }), // Reduced from 15 to 10 for more reasonable retry limits

    CONNECTION_TIMEOUT_MS: EnvironmentUtils.parseInt("WEBSOCKET_CONNECTION_TIMEOUT_MS", 45000, {
      min: 5000,
      max: 120000,
    }), // Reduced from 45s to 30s for faster connection timeout detection
  },

  // CCXT Exchange Adapter - Specialized Configuration
  CCXT: {
    // Core settings
    RETRY_BACKOFF_MS: EnvironmentUtils.parseInt("CCXT_RETRY_BACKOFF_MS", 10000, { min: 1000, max: 30000 }),
    TRADES_LIMIT: EnvironmentUtils.parseInt("CCXT_TRADES_LIMIT", 1000, { min: 100, max: 5000 }),
    LAMBDA_DECAY: EnvironmentUtils.parseFloat("CCXT_LAMBDA_DECAY", 0.00005, { min: 0.00001, max: 0.001 }),

    // Circuit breaker configuration - Improved for connection stability
    CIRCUIT_BREAKER: {
      FAILURE_THRESHOLD: EnvironmentUtils.parseInt("CCXT_CIRCUIT_BREAKER_FAILURE_THRESHOLD", 5, { min: 2, max: 10 }), // Increased from 3 to 5 for better tolerance
      RESET_TIMEOUT_MS: EnvironmentUtils.parseInt("CCXT_CIRCUIT_BREAKER_RESET_TIMEOUT_MS", 180000, {
        min: 60000,
        max: 1800000,
      }), // Reduced from 5 minutes to 3 minutes for faster recovery
    },

    // CCXT-specific confidence settings
    INITIAL_CONFIDENCE: EnvironmentUtils.parseFloat("CCXT_INITIAL_CONFIDENCE", 0.8, { min: 0.1, max: 1.0 }),
    BASE_CONFIDENCE: EnvironmentUtils.parseFloat("CCXT_BASE_CONFIDENCE", 0.7, { min: 0.1, max: 1.0 }),

    MAX_CONFIDENCE: EnvironmentUtils.parseFloat("CCXT_MAX_CONFIDENCE", 1.0, { min: 0.5, max: 1.0 }),
    MIN_CONFIDENCE_VARIANCE: EnvironmentUtils.parseFloat("CCXT_MIN_CONFIDENCE_VARIANCE", 0.1, { min: 0.01, max: 0.5 }),
    PRICE_CONFIDENCE_BOOST: EnvironmentUtils.parseFloat("CCXT_PRICE_CONFIDENCE_BOOST", 0.1, { min: 0.01, max: 0.5 }),
    TIMESTAMP_CONFIDENCE_BOOST: EnvironmentUtils.parseFloat("CCXT_TIMESTAMP_CONFIDENCE_BOOST", 0.05, {
      min: 0.01,
      max: 0.2,
    }),

    TIMESTAMP_FRESH_THRESHOLD_MS: EnvironmentUtils.parseInt("CCXT_TIMESTAMP_FRESH_THRESHOLD_MS", 5000, {
      min: 1000,
      max: 30000,
    }),

    // WebSocket and polling delays - Improved for connection stability
    WEBSOCKET_WAIT_DELAY_MS: EnvironmentUtils.parseInt("CCXT_WEBSOCKET_WAIT_DELAY_MS", 3000, { min: 500, max: 5000 }), // Increased from 2s to 3s for better stability
    WEBSOCKET_ERROR_DELAY_MS: EnvironmentUtils.parseInt("CCXT_WEBSOCKET_ERROR_DELAY_MS", 10000, {
      min: 1000,
      max: 15000,
    }), // Increased from 5s to 10s for better error recovery
    WEBSOCKET_SYMBOL_ERROR_DELAY_MS: EnvironmentUtils.parseInt("CCXT_WEBSOCKET_SYMBOL_ERROR_DELAY_MS", 15000, {
      min: 2000,
      max: 30000,
    }), // Increased from 10s to 15s for better symbol-specific error handling
    REST_POLLING_DELAY_MS: EnvironmentUtils.parseInt("CCXT_REST_POLLING_DELAY_MS", 5000, { min: 2000, max: 30000 }),
  },

  // Aggregation Configuration
  AGGREGATION: {
    WEIGHT_UPDATE_INTERVAL_MS: EnvironmentUtils.parseInt("AGGREGATION_WEIGHT_UPDATE_INTERVAL_MS", 45000, {
      min: 10000,
      max: 300000,
    }),
    CACHE_TTL_MS: EnvironmentUtils.parseInt("AGGREGATION_CACHE_TTL_MS", 300, { min: 100, max: 2000 }),
    MAX_CACHE_SIZE: EnvironmentUtils.parseInt("AGGREGATION_MAX_CACHE_SIZE", 250, { min: 100, max: 10000 }),
    FRESH_DATA_THRESHOLD_MS: EnvironmentUtils.parseInt("AGGREGATION_FRESH_DATA_THRESHOLD_MS", 2000, {
      min: 500,
      max: 10000,
    }),
    BATCH_PROCESSING_INTERVAL_MS: EnvironmentUtils.parseInt("AGGREGATION_BATCH_PROCESSING_INTERVAL_MS", 150, {
      min: 10,
      max: 1000,
    }), // Optimized to 150ms for better balance between performance and system load
    PERFORMANCE_BUFFER_SIZE: EnvironmentUtils.parseInt("AGGREGATION_PERFORMANCE_BUFFER_SIZE", 50, {
      min: 10,
      max: 1000,
    }),

    LAMBDA_DECAY: EnvironmentUtils.parseFloat("AGGREGATION_LAMBDA_DECAY", 0.00003, { min: 0.00001, max: 0.001 }),
    OUTLIER_THRESHOLD: EnvironmentUtils.parseFloat("AGGREGATION_OUTLIER_THRESHOLD", 0.08, { min: 0.01, max: 0.5 }),
    PERFORMANCE_TARGET_MS: EnvironmentUtils.parseInt("AGGREGATION_PERFORMANCE_TARGET_MS", 5000, {
      min: 10,
      max: 15000,
    }), // Increased from 1s to 5s for more realistic startup performance
    BATCH_SIZE: EnvironmentUtils.parseInt("AGGREGATION_BATCH_SIZE", 50, { min: 10, max: 200 }),

    INITIAL_DELAY_MS: EnvironmentUtils.parseInt("AGGREGATION_INITIAL_DELAY_MS", 1000, { min: 100, max: 10000 }),
    MAX_DELAY_MS: EnvironmentUtils.parseInt("AGGREGATION_MAX_DELAY_MS", 30000, { min: 5000, max: 120000 }),
    MAX_ATTEMPTS: EnvironmentUtils.parseInt("AGGREGATION_MAX_ATTEMPTS", 10, { min: 1, max: 50 }),

    // Performance optimization settings
    FAILURE_COOLDOWN_MS: EnvironmentUtils.parseInt("AGGREGATION_FAILURE_COOLDOWN_MS", 120000, {
      min: 30000,
      max: 600000,
    }),
    HEAVY_LOAD_PROCESSING_TIME_THRESHOLD_MS: EnvironmentUtils.parseInt(
      "AGGREGATION_HEAVY_LOAD_PROCESSING_TIME_THRESHOLD_MS",
      100,
      { min: 20, max: 500 }
    ), // Increased from 50ms to 100ms for more realistic heavy load detection
    HEAVY_LOAD_FEED_COUNT_THRESHOLD: EnvironmentUtils.parseInt("AGGREGATION_HEAVY_LOAD_FEED_COUNT_THRESHOLD", 10, {
      min: 5,
      max: 50,
    }),
    HEAVY_LOAD_INTERVAL_MS: EnvironmentUtils.parseInt("AGGREGATION_HEAVY_LOAD_INTERVAL_MS", 250, {
      min: 100,
      max: 500,
    }), // Increased from 150ms to 250ms to reduce processing frequency under heavy load
    LIGHT_LOAD_PROCESSING_TIME_THRESHOLD_MS: EnvironmentUtils.parseInt(
      "AGGREGATION_LIGHT_LOAD_PROCESSING_TIME_THRESHOLD_MS",
      20,
      { min: 5, max: 100 }
    ),
    LIGHT_LOAD_FEED_COUNT_THRESHOLD: EnvironmentUtils.parseInt("AGGREGATION_LIGHT_LOAD_FEED_COUNT_THRESHOLD", 5, {
      min: 1,
      max: 20,
    }),
    LIGHT_LOAD_INTERVAL_MS: EnvironmentUtils.parseInt("AGGREGATION_LIGHT_LOAD_INTERVAL_MS", 75, { min: 25, max: 200 }),
  },

  // Failover Manager Configuration
  FAILOVER: {
    MAX_FAILOVER_TIME_MS: EnvironmentUtils.parseInt("FAILOVER_MAX_FAILOVER_TIME_MS", 100, { min: 50, max: 500 }),
    FAILURE_THRESHOLD: EnvironmentUtils.parseInt("FAILOVER_FAILURE_THRESHOLD", 3, { min: 1, max: 10 }),
    RECOVERY_THRESHOLD: EnvironmentUtils.parseInt("FAILOVER_RECOVERY_THRESHOLD", 5, { min: 2, max: 20 }),
    MIN_FAILURE_INTERVAL_MS: EnvironmentUtils.parseInt("FAILOVER_MIN_FAILURE_INTERVAL_MS", 10000, {
      min: 5000,
      max: 60000,
    }),
    FAILOVER_COOLDOWN_MS: EnvironmentUtils.parseInt("FAILOVER_COOLDOWN_MS", 5000, { min: 1000, max: 30000 }),
    SUBSCRIPTION_TIMEOUT_MS: EnvironmentUtils.parseInt("FAILOVER_SUBSCRIPTION_TIMEOUT_MS", 10000, {
      min: 5000,
      max: 60000,
    }),

    RETRY_ATTEMPTS: EnvironmentUtils.parseInt("FAILOVER_RETRY_ATTEMPTS", 1, { min: 0, max: 5 }),
  },

  // Alerting Configuration
  ALERTING: {
    EMAIL: {
      ENABLED: EnvironmentUtils.parseBoolean("ALERT_EMAIL_ENABLED", false),
      SMTP_HOST: EnvironmentUtils.parseString("ALERT_SMTP_HOST", "localhost"),
      SMTP_PORT: EnvironmentUtils.parseInt("ALERT_SMTP_PORT", 587, { min: 1, max: 65535 }),
      USERNAME: EnvironmentUtils.parseString("ALERT_SMTP_USERNAME", ""),
      PASSWORD: EnvironmentUtils.parseString("ALERT_SMTP_PASSWORD", ""),
      FROM: EnvironmentUtils.parseString("ALERT_EMAIL_FROM", '"Alerting Service" <alerts@ftso-provider.com>'),
      TO: EnvironmentUtils.parseList("ALERT_EMAIL_TO", []),
    },
    WEBHOOK: {
      ENABLED: EnvironmentUtils.parseBoolean("ALERT_WEBHOOK_ENABLED", false),
      URL: EnvironmentUtils.parseString("ALERT_WEBHOOK_URL", ""),
      HEADERS: EnvironmentUtils.parseJSON("ALERT_WEBHOOK_HEADERS", {}),
    },
  },
};
