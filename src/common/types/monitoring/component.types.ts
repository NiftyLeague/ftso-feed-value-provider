/**
 * Types related to monitorable components and their configuration
 */

/**
 * Represents a component that can be monitored
 */
export interface MonitorableComponent {
  /** The name of the component */
  name: string;
  /** The type of the component */
  type: "service" | "adapter" | "aggregator" | "cache" | "database";
  /** The current status of the component */
  status: "active" | "inactive" | "error";
  /** The current metrics of the component */
  metrics: ComponentMetrics;
  /** Method to check the health of the component */
  healthCheck: () => Promise<boolean>;
  /** Method to get the current metrics of the component */
  getMetrics: () => ComponentMetrics;
}

/**
 * Metrics collected for a component
 */
export interface ComponentMetrics {
  /** Uptime in seconds */
  uptime: number;
  /** Total number of requests processed */
  requestCount: number;
  /** Number of errors encountered */
  errorCount: number;
  /** Average response time in milliseconds */
  averageResponseTime: number;
  /** Current memory usage in bytes */
  memoryUsage: number;
  /** Current CPU usage (0-1) */
  cpuUsage: number;
  /** Timestamp of last activity */
  lastActivity: number;
}

/**
 * Configuration for monitoring a component
 */
export interface MonitoringConfiguration {
  /** Whether monitoring is enabled */
  enabled: boolean;
  /** Interval between metric collections in milliseconds */
  interval: number;
  /** List of metrics to collect */
  metrics: MetricConfig[];
  /** Data retention configuration */
  retention: RetentionConfig;
}

/**
 * Configuration for a specific metric
 */
export interface MetricConfig {
  /** Name of the metric */
  name: string;
  /** Type of the metric */
  type: "counter" | "gauge" | "histogram" | "summary";
  /** Labels to apply to the metric */
  labels: string[];
  /** Buckets for histogram metrics */
  buckets?: number[];
}

/**
 * Configuration for data retention
 */
export interface RetentionConfig {
  /** Retention period for raw data in seconds */
  raw: number;
  /** Retention period for aggregated data in seconds */
  aggregated: number;
  /** Retention period for compressed data in seconds */
  compressed: number;
}

/**
 * Fallback strategy configuration
 */
export interface FallbackConfig {
  /** Whether fallback is enabled */
  enabled: boolean;
  /** Fallback strategy to use */
  strategy: "cache" | "default" | "previous";
  /** Timeout in milliseconds before falling back */
  timeout: number;
}
