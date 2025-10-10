/**
 * Performance monitoring type definitions
 */

export interface PerformanceTimer {
  start(): void;
  end(): number;
  elapsed(): number;
  reset(): void;
}

export interface PerformanceMetric {
  operation: string;
  duration: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface PerformanceThresholds {
  maxResponseLatency: number;
  maxDataAge: number;
  minThroughput: number;
  minCacheHitRate: number;
}

export interface MetricMetadata {
  component?: string;
  operation?: string;
  [key: string]: unknown;
}
