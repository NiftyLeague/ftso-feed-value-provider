import { ApiProperty } from "@nestjs/swagger";

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
  status!: string;

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
    description: "Memory usage information",
    required: false,
    additionalProperties: true,
    example: {
      used: 512,
      total: 2048,
      percentage: 25.0,
    },
  })
  memory?: {
    used: number;
    total: number;
    percentage: number;
  };

  @ApiProperty({
    description: "Performance metrics",
    required: false,
    additionalProperties: true,
    example: {
      averageResponseTime: 150.5,
      errorRate: 2.5,
      throughput: 100,
    },
  })
  performance?: {
    averageResponseTime: number;
    errorRate: number;
    throughput: number;
  };

  @ApiProperty({
    description: "Component health status",
    required: false,
    additionalProperties: true,
  })
  components?: {
    provider: HealthCheckDetailsDto;
    cache: HealthCheckDetailsDto;
    aggregation: HealthCheckDetailsDto;
    integration: HealthCheckDetailsDto;
  };

  @ApiProperty({
    description: "Additional health details",
    required: false,
    additionalProperties: true,
  })
  details?: Record<string, unknown>;
}

export class ReadinessResponseDto {
  @ApiProperty({
    description: "Whether the system is ready to serve requests",
    example: true,
  })
  ready!: boolean;

  @ApiProperty({
    description: "Readiness status message",
    example: "System is ready",
  })
  status!: string;

  @ApiProperty({
    description: "Readiness check timestamp",
    example: 1703123456789,
  })
  timestamp!: number;

  @ApiProperty({
    description: "System uptime in seconds",
    example: 3600,
  })
  uptime!: number;

  @ApiProperty({
    description: "Additional readiness details",
    required: false,
    additionalProperties: true,
  })
  details?: Record<string, unknown>;
}

export class LivenessResponseDto {
  @ApiProperty({
    description: "Whether the system is alive",
    example: true,
  })
  alive!: boolean;

  @ApiProperty({
    description: "Liveness status message",
    example: "System is alive",
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
