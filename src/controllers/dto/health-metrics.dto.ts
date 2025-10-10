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

export class PerformanceMetricsDto {
  @ApiProperty({
    description: "System performance metrics",
    additionalProperties: true,
  })
  system!: {
    cpu: number;
    memory: number;
    uptime: number;
  };

  @ApiProperty({
    description: "Application performance metrics",
    additionalProperties: true,
  })
  application!: {
    responseTime: number;
    throughput: number;
    errorRate: number;
    cacheHitRate: number;
  };

  @ApiProperty({
    description: "Feed-related metrics",
    additionalProperties: true,
  })
  feeds!: {
    active: number;
    total: number;
    aggregations: number;
  };
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

export class ApiMetricsResponseDto {
  @ApiProperty({
    description: "API health metrics",
    additionalProperties: true,
  })
  health!: ApiHealthMetricsDto;

  @ApiProperty({
    description: "Endpoint statistics",
    type: "array",
    items: { $ref: "#/components/schemas/EndpointStatsDto" },
  })
  endpoints!: EndpointStatsDto[];

  @ApiProperty({
    description: "Performance metrics",
    additionalProperties: true,
  })
  performance!: PerformanceMetricsDto;

  @ApiProperty({
    description: "Error analysis",
    additionalProperties: true,
  })
  errors!: {
    timeWindow: {
      start: number;
      end: number;
    };
    summary: {
      totalErrors: number;
      errorRate: number;
      topErrors: ErrorSummaryDto[];
    };
    byEndpoint: Record<string, EndpointErrorStatsDto>;
  };

  @ApiProperty({
    description: "System information",
    additionalProperties: true,
  })
  system!: {
    metricsCount: number;
  };

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

export class PerformanceMetricsResponseDto {
  @ApiProperty({
    description: "Performance metrics",
    additionalProperties: true,
  })
  performance!: PerformanceMetricsDto;

  @ApiProperty({
    description: "System metrics",
    additionalProperties: true,
  })
  system!: {
    uptime: number;
    memory: Record<string, unknown>;
  };

  @ApiProperty({
    description: "Response timestamp",
    example: 1703123456789,
  })
  timestamp!: number;
}

export class EndpointStatsResponseDto {
  @ApiProperty({
    description: "Endpoint statistics",
    type: "array",
    items: { $ref: "#/components/schemas/EndpointStatsDto" },
  })
  endpoints!: EndpointStatsDto[];

  @ApiProperty({
    description: "Summary statistics",
    additionalProperties: true,
  })
  summary!: {
    totalEndpoints: number;
    totalRequests: number;
    averageResponseTime: number;
    errorRate: number;
  };

  @ApiProperty({
    description: "Response timestamp",
    example: 1703123456789,
  })
  timestamp!: number;
}

export class ErrorAnalysisResponseDto {
  @ApiProperty({
    description: "Error analysis data",
    additionalProperties: true,
  })
  errors!: {
    timeWindow: {
      start: number;
      end: number;
    };
    summary: {
      totalErrors: number;
      errorRate: number;
      topErrors: ErrorSummaryDto[];
    };
    byEndpoint: Record<string, EndpointErrorStatsDto>;
  };

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
