import { EnvironmentUtils } from "@/common/utils/environment.utils";

export interface LoggingConfig {
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
}

export const getLoggingConfig = (): LoggingConfig => {
  return {
    // File logging
    enableFileLogging: process.env.ENABLE_FILE_LOGGING === "true",
    logDirectory: process.env.LOG_DIRECTORY || "./logs",
    maxLogFileSize: process.env.MAX_LOG_FILE_SIZE || "10MB",
    maxLogFiles: EnvironmentUtils.parseInt("MAX_LOG_FILES", 5, { min: 1, max: 100 }),

    // Performance logging
    enablePerformanceLogging: EnvironmentUtils.parseBoolean("ENABLE_PERFORMANCE_LOGGING", true),
    performanceLogThreshold: EnvironmentUtils.parseInt("PERFORMANCE_LOG_THRESHOLD", 100, { min: 1, max: 10000 }),

    // Debug logging
    enableDebugLogging: process.env.ENABLE_DEBUG_LOGGING === "true",
    debugLogLevel: (process.env.DEBUG_LOG_LEVEL as "verbose" | "debug" | "log") || "debug",

    // Error logging
    errorLogRetention: EnvironmentUtils.parseInt("ERROR_LOG_RETENTION_DAYS", 30, { min: 1, max: 365 }),
    maxErrorHistorySize: EnvironmentUtils.parseInt("MAX_ERROR_HISTORY_SIZE", 1000, { min: 100, max: 10000 }),

    // Audit logging
    enableAuditLogging: process.env.ENABLE_AUDIT_LOGGING !== "false", // Default true
    auditLogCriticalOperations: process.env.AUDIT_LOG_CRITICAL_OPERATIONS !== "false", // Default true

    // Log formatting
    logFormat: (process.env.LOG_FORMAT as "json" | "text") || "json",
    includeTimestamp: process.env.INCLUDE_TIMESTAMP !== "false", // Default true
    includeContext: process.env.INCLUDE_CONTEXT !== "false", // Default true
    includeStackTrace: process.env.INCLUDE_STACK_TRACE !== "false", // Default true

    // Component-specific log levels
    componentLogLevels: {
      ProductionIntegration: process.env.LOG_LEVEL_PRODUCTION_INTEGRATION || "log",
      ProductionDataManager: process.env.LOG_LEVEL_DATA_MANAGER || "log",
      RealTimeAggregation: process.env.LOG_LEVEL_AGGREGATION || "log",
      HybridErrorHandler: process.env.LOG_LEVEL_ERROR_HANDLER || "log",
      PerformanceMonitor: process.env.LOG_LEVEL_PERFORMANCE_MONITOR || "log",
      AlertingService: process.env.LOG_LEVEL_ALERTING || "log",
      Bootstrap: process.env.LOG_LEVEL_BOOTSTRAP || "log",
    },
  };
};

export const LOGGING_ENVIRONMENT_VARIABLES = [
  "ENABLE_FILE_LOGGING",
  "LOG_DIRECTORY",
  "MAX_LOG_FILE_SIZE",
  "MAX_LOG_FILES",
  "ENABLE_PERFORMANCE_LOGGING",
  "PERFORMANCE_LOG_THRESHOLD",
  "ENABLE_DEBUG_LOGGING",
  "DEBUG_LOG_LEVEL",
  "ERROR_LOG_RETENTION_DAYS",
  "MAX_ERROR_HISTORY_SIZE",
  "ENABLE_AUDIT_LOGGING",
  "AUDIT_LOG_CRITICAL_OPERATIONS",
  "LOG_FORMAT",
  "INCLUDE_TIMESTAMP",
  "INCLUDE_CONTEXT",
  "INCLUDE_STACK_TRACE",
  "LOG_LEVEL_PRODUCTION_INTEGRATION",
  "LOG_LEVEL_DATA_MANAGER",
  "LOG_LEVEL_AGGREGATION",
  "LOG_LEVEL_ERROR_HANDLER",
  "LOG_LEVEL_PERFORMANCE_MONITOR",
  "LOG_LEVEL_ALERTING",
  "LOG_LEVEL_BOOTSTRAP",
];

export const DEFAULT_LOGGING_CONFIG: Partial<LoggingConfig> = {
  enableFileLogging: false,
  logDirectory: "./logs",
  maxLogFileSize: "10MB",
  maxLogFiles: 5,
  enablePerformanceLogging: true,
  performanceLogThreshold: 100,
  enableDebugLogging: false,
  debugLogLevel: "debug",
  errorLogRetention: 30,
  maxErrorHistorySize: 1000,
  enableAuditLogging: true,
  auditLogCriticalOperations: true,
  logFormat: "json",
  includeTimestamp: true,
  includeContext: true,
  includeStackTrace: true,
};
