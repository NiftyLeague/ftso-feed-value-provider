import { ApiProperty } from "@nestjs/swagger";
import { HealthStatusType } from "@/common/types/monitoring/health.types";

export class LivenessChecksDto {
  @ApiProperty({ example: true })
  integration!: boolean;
  @ApiProperty({ example: true })
  provider!: boolean;
  @ApiProperty({ example: true })
  memory!: boolean;
  @ApiProperty({ example: 2 })
  responseTime!: number;
}

export class ReadinessCheckDetailDto {
  @ApiProperty({ example: true })
  ready!: boolean;
  @ApiProperty({ example: "healthy", enum: ["healthy", "degraded", "unhealthy", "initializing"] })
  status!: HealthStatusType | "initializing";
  @ApiProperty({ example: null, nullable: true })
  error!: string | null;
}

export class ReadinessChecksDto {
  @ApiProperty()
  integration!: ReadinessCheckDetailDto;
  @ApiProperty()
  provider!: ReadinessCheckDetailDto;
  @ApiProperty()
  startup!: { ready: boolean };
}

export class ProbesDto {
  @ApiProperty()
  liveness!: LivenessChecksDto;
  @ApiProperty()
  readiness!: ReadinessChecksDto;
}

export class StartupDto {
  @ApiProperty({ example: true })
  initialized!: boolean;
  @ApiProperty({ example: 1678879200000 })
  startTime!: number;
  @ApiProperty({ example: 1678879230000, nullable: true })
  readyTime?: number | null;
}

export class ReadinessDiagnosticsDto {
  @ApiProperty({ example: 3, required: false })
  healthySources?: number;
  @ApiProperty({ example: 5, required: false })
  totalSources?: number;
  @ApiProperty({ example: 99.5, required: false })
  aggregationSuccessRate?: number;
  @ApiProperty({ example: true, required: false })
  canServeFeedData?: boolean;
  @ApiProperty({ example: "ready", enum: ["not_ready", "warming_up", "ready"], required: false })
  state?: "not_ready" | "warming_up" | "ready";
  @ApiProperty({ example: 4, required: false })
  validFeedCount?: number;
  @ApiProperty({ example: 4, required: false })
  totalTestFeeds?: number;
}

// Component details DTOs
export class SourceHealthStatusDto {
  @ApiProperty({ example: "uniswap" })
  sourceId!: string;
  @ApiProperty({ example: "healthy", enum: ["healthy", "unhealthy", "recovered"] })
  status!: "healthy" | "unhealthy" | "recovered";
  @ApiProperty({ example: 1703123456789 })
  lastUpdate!: number;
  @ApiProperty({ example: 0 })
  errorCount!: number;
  @ApiProperty({ example: 0 })
  recoveryCount!: number;
}

export class AggregationMetricsDetailsDto {
  @ApiProperty({ example: 99.5 })
  successRate!: number;
  @ApiProperty({ example: 5 })
  errorCount!: number;
  @ApiProperty({ example: "Data source X down", required: false })
  lastError?: string;
}

export class PerformanceHealthMetricsDetailsDto {
  @ApiProperty({ example: 150.5 })
  averageResponseTime!: number;
  @ApiProperty({ example: 2.5 })
  errorRate!: number;
}

export class AccuracyMetricsDetailsDto {
  @ApiProperty({ example: 0.98 })
  averageConfidence!: number;
  @ApiProperty({ example: 0.01 })
  outlierRate!: number;
}

export class DetailedSystemHealthMetricsDto {
  @ApiProperty({ example: "healthy", enum: ["healthy", "degraded", "unhealthy"] })
  status!: HealthStatusType;
  @ApiProperty({ example: 1703123456789 })
  timestamp!: number;
  @ApiProperty({ type: [SourceHealthStatusDto] })
  sources!: SourceHealthStatusDto[];
  @ApiProperty()
  aggregation!: AggregationMetricsDetailsDto;
  @ApiProperty()
  performance!: PerformanceHealthMetricsDetailsDto;
  @ApiProperty()
  accuracy!: AccuracyMetricsDetailsDto;
}

export class CacheStatsDto {
  @ApiProperty({ example: 100 })
  hits!: number;
  @ApiProperty({ example: 10 })
  misses!: number;
  @ApiProperty({ example: 0.9 })
  hitRate!: number;
  @ApiProperty({ example: 1000 })
  size!: number;
  @ApiProperty({ example: 5 })
  evictions!: number;
  @ApiProperty({ example: 0.5 })
  averageGetTime!: number;
  @ApiProperty({ example: 1.2 })
  averageSetTime!: number;
  @ApiProperty({ example: 0.6 })
  averageResponseTime!: number;
  @ApiProperty({ example: 102400 })
  memoryUsage!: number;
  @ApiProperty({ example: 110 })
  totalRequests!: number;
  @ApiProperty({ example: 0.1 })
  missRate!: number;
  @ApiProperty({ example: 1000 })
  totalEntries!: number;
}

export class AggregationCacheStatsDto {
  @ApiProperty({ example: 500 })
  totalEntries!: number;
  @ApiProperty({ example: 0.95 })
  hitRate!: number;
  @ApiProperty({ example: 0.05 })
  missRate!: number;
  @ApiProperty({ example: 10 })
  evictionCount!: number;
  @ApiProperty({ example: 1500 })
  averageAge!: number;
}

export class AdapterStatsDto {
  @ApiProperty({ example: 5 })
  total!: number;
  @ApiProperty({ example: 4 })
  active!: number;
  @ApiProperty({ example: { crypto: 3, forex: 2 } })
  byCategory!: Record<string, number>;
  @ApiProperty({ example: { healthy: 4, unhealthy: 1 } })
  byHealth!: Record<string, number>;
}

export class ServiceResponseTimeMetricsDto {
  @ApiProperty({ example: 150.5 })
  average!: number;
  @ApiProperty({ example: 200.0 })
  p95!: number;
  @ApiProperty({ example: 500.0 })
  max!: number;
}

export class ServicePerformanceMetricsDto {
  @ApiProperty({ example: 3600 })
  uptime!: number;
  @ApiProperty()
  responseTime!: ServiceResponseTimeMetricsDto;
  @ApiProperty({ example: 100 })
  requestsPerSecond!: number;
  @ApiProperty({ example: 0.01 })
  errorRate!: number;
}

// Combined DTO for Provider Component Details
export class ProviderComponentDetailsDto extends DetailedSystemHealthMetricsDto {
  @ApiProperty({ example: 3600, description: "Provider service uptime" })
  providerUptime!: number;
  @ApiProperty({ description: "Provider service response time metrics" })
  providerResponseTime!: ServiceResponseTimeMetricsDto;
  @ApiProperty({ example: 100, description: "Provider service requests per second" })
  providerRequestsPerSecond!: number;
  @ApiProperty({ example: 0.01, description: "Provider service error rate" })
  providerErrorRate!: number;
  @ApiProperty({ description: "Provider service cache statistics" })
  providerCacheStats!: CacheStatsDto;
  @ApiProperty({ description: "Provider service aggregation statistics" })
  providerAggregationStats!: AggregationCacheStatsDto;
  @ApiProperty({ example: 64, description: "Number of active feeds" })
  activeFeedCount!: number;
}

// Component DTOs for HealthCheckResponseDto
export class CacheComponentDto {
  @ApiProperty({ example: "healthy", enum: ["healthy", "degraded", "unhealthy"] })
  status!: HealthStatusType;
  @ApiProperty({ type: CacheStatsDto })
  details!: CacheStatsDto;
}

export class AggregationComponentDto {
  @ApiProperty({ example: "healthy", enum: ["healthy", "degraded", "unhealthy"] })
  status!: HealthStatusType;
  @ApiProperty({ type: AggregationCacheStatsDto })
  details!: AggregationCacheStatsDto;
}

export class IntegrationComponentDto {
  @ApiProperty({ example: "healthy", enum: ["healthy", "degraded", "unhealthy"] })
  status!: HealthStatusType;
  @ApiProperty({ type: AdapterStatsDto })
  details!: AdapterStatsDto;
}

export class PerformanceComponentDto {
  @ApiProperty({ example: "healthy", enum: ["healthy", "degraded", "unhealthy"] })
  status!: HealthStatusType;
  @ApiProperty({ type: ServicePerformanceMetricsDto })
  details!: ServicePerformanceMetricsDto;
}

export class ProviderComponentDto {
  @ApiProperty({ example: "healthy", enum: ["healthy", "degraded", "unhealthy"] })
  status!: HealthStatusType;
  @ApiProperty({ type: ProviderComponentDetailsDto })
  details!: ProviderComponentDetailsDto;
}

export class ApiComponentDto {
  @ApiProperty({ example: "healthy", enum: ["healthy", "degraded", "unhealthy"] })
  status!: HealthStatusType;

  @ApiProperty({
    description: "API health metrics and error analysis",
    example: {
      totalRequests: 1000,
      requestsPerMinute: 120,
      averageResponseTime: 85,
      errorRate: 1.5,
      slowRequestRate: 8,
      criticalRequestRate: 0.5,
      topEndpoints: [{ endpoint: "GET /feeds", requests: 400, avgResponseTime: 70 }],
      recentErrors: [{ endpoint: "GET /feeds", error: "500", timestamp: 1703123456789, count: 2 }],
      errorAnalysis: {
        totalErrors: 10,
        errorsByStatusCode: { "500": 6 },
        errorsByEndpoint: { "/feeds": 4 },
        recentErrorTrends: [{ timestamp: 1703123400000, errorCount: 3 }],
      },
    },
  })
  details!: ApiHealthMetricsDto & { errorAnalysis: ErrorAnalysisDto };
}

export class RateLimiterStatsDto {
  @ApiProperty({ example: 1000 })
  totalRequests!: number;
  @ApiProperty({ example: 980 })
  allowedRequests!: number;
  @ApiProperty({ example: 20 })
  blockedRequests!: number;
  @ApiProperty({ example: 0.98 })
  hitRate!: number;
  @ApiProperty({ example: 2 })
  averageResponseTime!: number;
}

export class RateLimiterConfigDto {
  @ApiProperty({ example: 60000 })
  windowMs!: number;
  @ApiProperty({ example: 1000 })
  maxRequests!: number;
  @ApiProperty({ example: false, required: false })
  skipSuccessfulRequests?: boolean;
  @ApiProperty({ example: false, required: false })
  skipFailedRequests?: boolean;
}

export class RateLimiterComponentDto {
  @ApiProperty({ example: "healthy", enum: ["healthy", "degraded", "unhealthy"] })
  status!: HealthStatusType;
  @ApiProperty({
    description: "Rate limiter statistics and configuration",
  })
  details!: {
    stats: RateLimiterStatsDto;
    config: RateLimiterConfigDto;
  };
}

export class RetryServiceStatsDto {
  @ApiProperty({ example: 12 })
  totalAttempts!: number;
  @ApiProperty({ example: 10 })
  successfulRetries!: number;
  @ApiProperty({ example: 2 })
  failedRetries!: number;
  @ApiProperty({ example: 83.33 })
  successRate!: number;
  @ApiProperty({ example: 120 })
  averageRetryTime!: number;
  @ApiProperty({ example: "2024-02-22T10:00:00.000Z", required: false })
  lastRetryTime?: Date;
}

export class RetryComponentDto {
  @ApiProperty({ example: "healthy", enum: ["healthy", "degraded", "unhealthy"] })
  status!: HealthStatusType;

  @ApiProperty({
    description: "Retry statistics by service",
    additionalProperties: {
      type: "object",
      properties: {
        totalAttempts: { type: "number", example: 12 },
        successfulRetries: { type: "number", example: 10 },
        failedRetries: { type: "number", example: 2 },
        successRate: { type: "number", example: 83.33 },
        averageRetryTime: { type: "number", example: 120 },
        lastRetryTime: { type: "string", example: "2024-02-22T10:00:00.000Z" },
      },
    },
  })
  details!: Record<string, RetryServiceStatsDto>;
}

export class ErrorHandlingServiceStatsDto {
  @ApiProperty({ example: 25 })
  totalErrors!: number;
  @ApiProperty({ example: { TIMEOUT_ERROR: 5, CONNECTION_ERROR: 3 } })
  errorsByType!: Record<string, number>;
  @ApiProperty({ example: "2024-02-22T10:00:00.000Z", required: false })
  lastError?: string;
  @ApiProperty({ example: 2 })
  consecutiveFailures!: number;
}

export class ErrorHandlingComponentDto {
  @ApiProperty({ example: "healthy", enum: ["healthy", "degraded", "unhealthy"] })
  status!: HealthStatusType;

  @ApiProperty({
    description: "Error handling statistics by service",
    additionalProperties: {
      type: "object",
      properties: {
        totalErrors: { type: "number", example: 25 },
        errorsByType: { type: "object", additionalProperties: { type: "number" } },
        lastError: { type: "string", example: "2024-02-22T10:00:00.000Z" },
        consecutiveFailures: { type: "number", example: 2 },
      },
    },
  })
  details!: Record<string, ErrorHandlingServiceStatsDto>;
}

// Health DTOs
export class HealthCheckDetailsDto {
  @ApiProperty({
    description: "Component name",
    example: "cache",
  })
  component!: string;

  @ApiProperty({
    description: "Component health status",
    enum: ["healthy", "degraded", "unhealthy"],
    example: "healthy",
  })
  status!: string;

  @ApiProperty({
    description: "Health check timestamp",
    example: 1703123456789,
  })
  timestamp!: number;

  @ApiProperty({
    description: "Number of active connections",
    example: 5,
    required: false,
  })
  connections?: number;

  @ApiProperty({
    description: "Number of active adapters",
    example: 3,
    required: false,
  })
  adapters?: number;

  @ApiProperty({
    description: "Component metrics",
    required: false,
    additionalProperties: true,
    example: {
      uptime: 3600,
      memoryUsage: 512,
      cpuUsage: 25.5,
      connectionCount: 10,
    },
  })
  metrics?: {
    uptime: number;
    memoryUsage: number;
    cpuUsage: number;
    connectionCount: number;
  };
}

export class HealthCheckResponseDto {
  @ApiProperty({
    description: "Overall system health status",
    enum: ["healthy", "degraded", "unhealthy"],
    example: "healthy",
  })
  status!: HealthStatusType;

  @ApiProperty({
    description: "Health check timestamp",
    example: 1703123456789,
  })
  timestamp!: number;

  @ApiProperty({
    description: "System uptime in seconds",
    example: 3600,
  })
  uptime!: number;

  @ApiProperty({
    description: "Application version",
    example: "1.0.0",
    required: false,
  })
  version?: string;

  @ApiProperty({
    description: "Memory usage information in MB",
    required: false,
    example: {
      used: 512,
      total: 2048,
      rss: 1024,
      external: 256,
    },
  })
  memory?: Record<string, number>;

  @ApiProperty({
    description: "Component health status",
  })
  components!: {
    provider: ProviderComponentDto;
    cache: CacheComponentDto;
    aggregation: AggregationComponentDto;
    integration: IntegrationComponentDto;
    performance: PerformanceComponentDto;
    api: ApiComponentDto;
    rateLimiter: RateLimiterComponentDto;
    retries: RetryComponentDto;
    errorHandling: ErrorHandlingComponentDto;
  };

  @ApiProperty({
    description: "Additional system details",
    required: false,
    example: {
      environment: "development",
      nodeVersion: "v18.12.0",
      platform: "darwin",
    },
  })
  details?: Record<string, unknown>;

  @ApiProperty({ required: false })
  startup?: StartupDto;

  @ApiProperty({ required: false })
  probes?: ProbesDto;

  @ApiProperty({ required: false })
  readinessDiagnostics?: ReadinessDiagnosticsDto;
}

export class ReadinessResponseDto {
  @ApiProperty({
    description: "Whether the system is ready to serve requests",
    example: true,
  })
  ready!: boolean;

  @ApiProperty({
    description: "Overall readiness status (healthy | degraded | unhealthy)",
    example: "healthy",
  })
  status!: string;

  @ApiProperty({
    description: "Readiness check timestamp",
    example: 1703123456789,
  })
  timestamp!: number;

  @ApiProperty({
    description: "Readiness check duration in milliseconds",
    example: 42,
  })
  responseTime!: number;

  @ApiProperty({
    description: "System uptime in seconds",
    example: 3600,
  })
  uptime?: number; // Made optional to match the interface

  @ApiProperty({
    description: "Detailed readiness checks",
  })
  checks!: ReadinessChecksDto;

  @ApiProperty({
    description: "Readiness diagnostics information",
    required: false,
    type: ReadinessDiagnosticsDto,
  })
  diagnostics?: ReadinessDiagnosticsDto;

  @ApiProperty({
    description: "Startup information",
    type: StartupDto,
  })
  startup!: StartupDto;
}

export class LivenessResponseDto {
  @ApiProperty({
    description: "Whether the system is alive",
    example: true,
  })
  alive!: boolean;

  @ApiProperty({
    description: "Liveness status (alive | dead)",
    example: "alive",
  })
  status!: string;

  @ApiProperty({
    description: "Liveness check timestamp",
    example: 1703123456789,
  })
  timestamp!: number;

  @ApiProperty({
    description: "System uptime in seconds",
    example: 3600,
  })
  uptime!: number;

  @ApiProperty({
    description: "Detailed liveness checks",
    required: false,
  })
  checks?: LivenessChecksDto;
}

// Metrics DTOs
export class ApiHealthMetricsDto {
  @ApiProperty({
    description: "Total number of requests",
    example: 1000,
  })
  totalRequests!: number;

  @ApiProperty({
    description: "Requests per minute",
    example: 50,
  })
  requestsPerMinute!: number;

  @ApiProperty({
    description: "Average response time in milliseconds",
    example: 150.5,
  })
  averageResponseTime!: number;

  @ApiProperty({
    description: "Error rate as percentage",
    example: 2.5,
  })
  errorRate!: number;

  @ApiProperty({
    description: "Slow request rate (requests > 100ms)",
    example: 10.0,
  })
  slowRequestRate!: number;

  @ApiProperty({
    description: "Critical request rate (requests > 1000ms)",
    example: 1.0,
  })
  criticalRequestRate!: number;

  @ApiProperty({
    description: "Top endpoints by request count",
    type: "array",
    items: {
      type: "object",
      properties: {
        endpoint: { type: "string", example: "/feed-values" },
        requests: { type: "number", example: 500 },
        avgResponseTime: { type: "number", example: 120.5 },
      },
    },
  })
  topEndpoints!: Array<{
    endpoint: string;
    requests: number;
    avgResponseTime: number;
  }>;

  @ApiProperty({
    description: "Recent errors",
    type: "array",
    items: {
      type: "object",
      properties: {
        endpoint: { type: "string", example: "/feed-values" },
        error: { type: "string", example: "Internal Server Error" },
        timestamp: { type: "number", example: 1703123456789 },
        count: { type: "number", example: 5 },
      },
    },
  })
  recentErrors!: Array<{
    endpoint: string;
    error: string;
    timestamp: number;
    count: number;
  }>;
}

export class EndpointStatsDto {
  @ApiProperty({
    description: "Endpoint path",
    example: "/feed-values",
  })
  endpoint!: string;

  @ApiProperty({
    description: "HTTP method",
    example: "POST",
    required: false,
  })
  method?: string;

  @ApiProperty({
    description: "Total number of requests",
    example: 1000,
  })
  totalRequests!: number;

  @ApiProperty({
    description: "Number of successful requests",
    example: 950,
  })
  successfulRequests!: number;

  @ApiProperty({
    description: "Number of failed requests",
    example: 50,
  })
  failedRequests!: number;

  @ApiProperty({
    description: "Average response time in milliseconds",
    example: 150.5,
  })
  averageResponseTime!: number;

  @ApiProperty({
    description: "Maximum response time in milliseconds",
    example: 2000.0,
  })
  maxResponseTime!: number;

  @ApiProperty({
    description: "Minimum response time in milliseconds",
    example: 50.0,
  })
  minResponseTime!: number;

  @ApiProperty({
    description: "95th percentile response time",
    example: 300.0,
  })
  p95ResponseTime!: number;

  @ApiProperty({
    description: "99th percentile response time",
    example: 500.0,
  })
  p99ResponseTime!: number;

  @ApiProperty({
    description: "Average response size in bytes",
    example: 1024,
  })
  averageResponseSize!: number;

  @ApiProperty({
    description: "Error rate as percentage",
    example: 5.0,
  })
  errorRate!: number;

  @ApiProperty({
    description: "Last request timestamp",
    example: 1703123456789,
  })
  lastRequest!: number;

  @ApiProperty({
    description: "Status code distribution",
    additionalProperties: true,
  })
  statusCodeDistribution!: Record<number, number>;
}

export class SystemPerformanceDto {
  @ApiProperty({ description: "CPU usage percentage", example: 25.5 })
  cpu!: number;

  @ApiProperty({ description: "Memory usage in MB", example: 512 })
  memory!: number;

  @ApiProperty({ description: "System uptime in seconds", example: 3600 })
  uptime!: number;
}

export class ApplicationPerformanceDto {
  @ApiProperty({ description: "Average response time in ms", example: 150.5 })
  responseTime!: number;

  @ApiProperty({ description: "Requests per second", example: 100 })
  throughput!: number;

  @ApiProperty({ description: "Error rate percentage", example: 2.5 })
  errorRate!: number;

  @ApiProperty({ description: "Cache hit rate percentage", example: 90.0 })
  cacheHitRate!: number;
}

export class FeedPerformanceDto {
  @ApiProperty({ description: "Number of active feeds", example: 64 })
  active!: number;

  @ApiProperty({ description: "Total number of feeds", example: 64 })
  total!: number;

  @ApiProperty({ description: "Number of aggregations", example: 1000 })
  aggregations!: number;
}

export class PerformanceMetricsDto {
  @ApiProperty({
    description: "System performance metrics",
    type: SystemPerformanceDto,
  })
  system!: SystemPerformanceDto;

  @ApiProperty({
    description: "Application performance metrics",
    type: ApplicationPerformanceDto,
  })
  application!: ApplicationPerformanceDto;

  @ApiProperty({
    description: "Feed-related metrics",
    type: FeedPerformanceDto,
  })
  feeds!: FeedPerformanceDto;
}

export class ErrorSummaryDto {
  @ApiProperty({
    description: "Error message",
    example: "Internal Server Error",
  })
  message!: string;

  @ApiProperty({
    description: "Number of occurrences",
    example: 25,
  })
  count!: number;

  @ApiProperty({
    description: "Percentage of total errors",
    example: 50.0,
  })
  percentage!: number;
}

export class EndpointErrorStatsDto {
  @ApiProperty({
    description: "Number of errors",
    example: 50,
  })
  errors!: number;

  @ApiProperty({
    description: "Error rate as percentage",
    example: 5.0,
  })
  rate!: number;

  @ApiProperty({
    description: "Top error messages",
    type: "array",
    items: { type: "string" },
    example: ["Internal Server Error", "Bad Request"],
  })
  topErrors!: string[];
}

export class TimeWindowDto {
  @ApiProperty({ description: "Window start timestamp", example: 1703123456789 })
  start!: number;

  @ApiProperty({ description: "Window end timestamp", example: 1703123556789 })
  end!: number;
}

export class ErrorSummaryStatsDto {
  @ApiProperty({ description: "Total number of errors", example: 50 })
  totalErrors!: number;

  @ApiProperty({ description: "Error rate percentage", example: 5.0 })
  errorRate!: number;

  @ApiProperty({
    description: "Top errors by frequency",
    type: [ErrorSummaryDto],
  })
  topErrors!: ErrorSummaryDto[];
}

export class ErrorAnalysisDto {
  @ApiProperty({
    description: "Time window for error analysis",
    type: TimeWindowDto,
  })
  timeWindow!: TimeWindowDto;

  @ApiProperty({
    description: "Error summary statistics",
    type: ErrorSummaryStatsDto,
  })
  summary!: ErrorSummaryStatsDto;

  @ApiProperty({
    description: "Errors grouped by endpoint",
    type: "object",
    additionalProperties: { $ref: "#/components/schemas/EndpointErrorStatsDto" },
  })
  byEndpoint!: Record<string, EndpointErrorStatsDto>;
}

export class SystemInfoDto {
  @ApiProperty({ description: "Total metrics count", example: 1000 })
  metricsCount!: number;
}

export class ApiMetricsResponseDto {
  @ApiProperty({
    description: "API health metrics",
    type: ApiHealthMetricsDto,
  })
  health!: ApiHealthMetricsDto;

  @ApiProperty({
    description: "Endpoint statistics",
    type: [EndpointStatsDto],
  })
  endpoints!: EndpointStatsDto[];

  @ApiProperty({
    description: "Performance metrics",
    type: PerformanceMetricsDto,
  })
  performance!: PerformanceMetricsDto;

  @ApiProperty({
    description: "Error analysis",
    type: ErrorAnalysisDto,
  })
  errors!: ErrorAnalysisDto;

  @ApiProperty({
    description: "System information",
    type: SystemInfoDto,
  })
  system!: SystemInfoDto;

  @ApiProperty({
    description: "Response timestamp",
    example: 1703123456789,
  })
  timestamp!: number;

  @ApiProperty({
    description: "Request ID",
    example: "req_1703123456789_abc123",
    required: false,
  })
  requestId?: string;
}

export class SystemMetricsDto {
  @ApiProperty({ description: "System uptime in seconds", example: 3600 })
  uptime!: number;

  @ApiProperty({
    description: "Memory usage information",
    type: "object",
    additionalProperties: true,
    example: { heapUsed: 512, heapTotal: 2048, rss: 1024 },
  })
  memory!: Record<string, unknown>;
}

export class PerformanceMetricsResponseDto {
  @ApiProperty({
    description: "Performance metrics",
    type: PerformanceMetricsDto,
  })
  performance!: PerformanceMetricsDto;

  @ApiProperty({
    description: "System metrics",
    type: SystemMetricsDto,
  })
  system!: SystemMetricsDto;

  @ApiProperty({
    description: "Response timestamp",
    example: 1703123456789,
  })
  timestamp!: number;
}

export class EndpointSummaryDto {
  @ApiProperty({ description: "Total number of endpoints", example: 10 })
  totalEndpoints!: number;

  @ApiProperty({ description: "Total number of requests", example: 1000 })
  totalRequests!: number;

  @ApiProperty({ description: "Average response time in ms", example: 150.5 })
  averageResponseTime!: number;

  @ApiProperty({ description: "Error rate percentage", example: 2.5 })
  errorRate!: number;
}

export class EndpointStatsResponseDto {
  @ApiProperty({
    description: "Endpoint statistics",
    type: [EndpointStatsDto],
  })
  endpoints!: EndpointStatsDto[];

  @ApiProperty({
    description: "Summary statistics",
    type: EndpointSummaryDto,
  })
  summary!: EndpointSummaryDto;

  @ApiProperty({
    description: "Response timestamp",
    example: 1703123456789,
  })
  timestamp!: number;
}

export class ErrorAnalysisResponseDto {
  @ApiProperty({
    description: "Error analysis data",
    type: ErrorAnalysisDto,
  })
  errors!: ErrorAnalysisDto;

  @ApiProperty({
    description: "Response timestamp",
    example: 1703123456789,
  })
  timestamp!: number;

  @ApiProperty({
    description: "Request ID",
    example: "req_1703123456789_abc123",
    required: false,
  })
  requestId?: string;
}

// Consolidated list of health-related DTOs for Swagger registration
export const healthMetricModels = [
  HealthCheckResponseDto,
  ReadinessResponseDto,
  LivenessResponseDto,
  HealthCheckDetailsDto,
  SourceHealthStatusDto,
  AggregationMetricsDetailsDto,
  PerformanceHealthMetricsDetailsDto,
  AccuracyMetricsDetailsDto,
  DetailedSystemHealthMetricsDto,
  CacheStatsDto,
  AggregationCacheStatsDto,
  AdapterStatsDto,
  ServiceResponseTimeMetricsDto,
  ServicePerformanceMetricsDto,
  ProviderComponentDetailsDto,
  CacheComponentDto,
  AggregationComponentDto,
  IntegrationComponentDto,
  PerformanceComponentDto,
  ProviderComponentDto,
  ApiComponentDto,
  RateLimiterStatsDto,
  RateLimiterConfigDto,
  RateLimiterComponentDto,
  RetryServiceStatsDto,
  RetryComponentDto,
  ErrorHandlingServiceStatsDto,
  ErrorHandlingComponentDto,
  ReadinessDiagnosticsDto,
] as const;
