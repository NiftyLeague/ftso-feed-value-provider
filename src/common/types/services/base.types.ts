import type { HealthCheckResult } from "../monitoring";
import type { LoggingCapabilities } from "../../base/mixins/logging.mixin";
import type { ConfigurableCapabilities } from "../../base/mixins/configurable.mixin";
import type { EnhancedLoggerService } from "../../logging/enhanced-logger.service";

/**
 * Defines the health status of a service.
 */
export interface ServiceHealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: number;
  details?: HealthCheckResult[];
}

/**
 * Defines the performance metrics for a service.
 */
export interface ServicePerformanceMetrics {
  uptime: number;
  responseTime: {
    average: number;
    p95: number;
    max: number;
  };
  requestsPerSecond: number;
  errorRate: number;
}

/**
 * Base configuration interface that all services extend
 */
export interface BaseServiceConfig extends Record<string, unknown> {
  useEnhancedLogging?: boolean;
}

/**
 * Base interface that all services should implement (minimal public interface)
 * Note: logger is now protected in the new mixin system for better encapsulation
 */
export interface IBaseService extends LoggingCapabilities, ConfigurableCapabilities<BaseServiceConfig> {
  // Logger is now protected - services should use internal logging methods
  readonly logger: import("@nestjs/common").Logger;
  enhancedLogger?: EnhancedLoggerService;
}
