import { HealthCheckResult } from "../monitoring";

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
 * Base interface for all services, providing common health and performance monitoring.
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
