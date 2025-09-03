/**
 * Metrics type definitions
 */

import { ITimestamped } from "../core/common.types";

export interface BaseMetrics extends ITimestamped {}

export interface MetricsData extends BaseMetrics {
  metrics: Record<string, number | string>;
}

export interface ApiMetrics extends BaseMetrics {
  requestCount: number;
  responseTime: number;
  errorRate: number;
  throughput: number;
  // Additional properties used by api-monitor service
  statusCode: number;
  method: string;
  endpoint: string;
  error?: string;
  responseSize: number;
  requestId?: string;
}

export interface ApiHealthMetrics extends BaseMetrics {
  totalRequests: number;
  requestsPerMinute: number;
  averageResponseTime: number;
  errorRate: number;
  slowRequestRate: number; // Requests > 100ms
  criticalRequestRate: number; // Requests > 1000ms
  topEndpoints: Array<{ endpoint: string; requests: number; avgResponseTime: number }>;
  recentErrors: Array<{ endpoint: string; error: string; timestamp: number; count: number }>;
}

export interface SlowResponseData {
  endpoint: string;
  responseTime: number;
  threshold: number;
  timestamp: number;
  requestId: string;
  method: string;
  statusCode: number;
}

export interface ServerErrorData {
  endpoint: string;
  statusCode: number;
  error: string;
  timestamp: number;
  requestId: string;
  method: string;
}

export interface HighErrorRateData {
  endpoint: string;
  errorRate: number;
  threshold: number;
  timeWindow: number;
  timestamp: number;
  errorCount: number;
  totalRequests: number;
}

export interface SystemMetrics extends BaseMetrics {
  cpu: number;
  memory: number;
  connections: number;
  uptime: number;
}

export interface AdapterMetrics extends BaseMetrics {
  totalAdapters: number;
  activeAdapters: number;
  errorCount: number;
  averageLatency: number;
}

export interface ApiMetricsResponse extends BaseMetrics {
  metrics: {
    requests: {
      total: number;
      rate: number;
      errors: number;
      errorRate: number;
    };
    response: {
      averageTime: number;
      p95: number;
      p99: number;
    };
    endpoints: Record<string, EndpointMetrics>;
  };
}

export interface EndpointMetrics {
  requests: number;
  averageTime: number;
  errors: number;
}

export interface PerformanceMetricsResponse extends BaseMetrics {
  system: {
    cpu: number;
    memory: number;
    uptime: number;
  };
  application: {
    responseTime: number;
    throughput: number;
    errorRate: number;
    cacheHitRate: number;
  };
  feeds: {
    active: number;
    total: number;
    aggregations: number;
  };
}

export interface EndpointStatsResponse extends BaseMetrics {
  endpoints: EndpointStats[];
}

export interface EndpointStats {
  endpoint: string;
  path?: string;
  method?: string;
  requests?: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageTime?: number;
  averageResponseTime: number;
  maxResponseTime: number;
  minResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  averageResponseSize: number;
  errors?: number;
  errorRate: number;
  lastAccess?: number;
  lastRequest: number;
  statusCodeDistribution: Record<number, number>;
}

export interface ErrorAnalysisResponse extends BaseMetrics {
  timeWindow: {
    start: number;
    end: number;
  };
  summary: {
    totalErrors: number;
    errorRate: number;
    topErrors: ErrorSummary[];
  };
  byEndpoint: Record<string, EndpointErrorStats>;
}

export interface ErrorSummary {
  message: string;
  count: number;
  percentage: number;
}

export interface EndpointErrorStats {
  errors: number;
  rate: number;
  topErrors: string[];
}
