/**
 * Common Base Interfaces
 * Shared interfaces used across multiple services
 */

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
