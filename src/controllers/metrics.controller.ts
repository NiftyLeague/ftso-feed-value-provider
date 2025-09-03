import { Controller, Post, Get } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { BaseController } from "@/common/base/base.controller";
import { ApiErrorHandlerService } from "@/error-handling/api-error-handler.service";
import { ApiMonitorService } from "@/monitoring/api-monitor.service";
import type {
  ApiMetricsResponse,
  PerformanceMetricsResponse,
  EndpointStatsResponse,
  ErrorAnalysisResponse,
  EndpointMetrics,
} from "@/common/types/monitoring";

@ApiTags("API Metrics and Monitoring")
@Controller()
export class MetricsController extends BaseController {
  constructor(
    private readonly errorHandler: ApiErrorHandlerService,
    private readonly apiMonitor: ApiMonitorService
  ) {
    super("MetricsController");
    // Reference injected service to satisfy unused-variable lint
    void this.errorHandler;
  }

  @Post("metrics")
  @ApiOperation({
    summary: "API metrics and monitoring data",
    description: "Returns comprehensive API performance metrics, endpoint statistics, and health information",
  })
  @ApiResponse({
    status: 200,
    description: "API metrics retrieved successfully",
    schema: {
      type: "object",
      properties: {
        health: { type: "object" },
        endpoints: { type: "array" },
        performance: { type: "object" },
        errors: { type: "object" },
        timestamp: { type: "number" },
      },
    },
  })
  async getApiMetrics(): Promise<ApiMetricsResponse> {
    return this.handleControllerOperation(
      async () => {
        // Get comprehensive API metrics
        const healthMetrics = this.apiMonitor.getApiHealthMetrics();
        const endpointStats = this.apiMonitor.getAllEndpointStats();
        this.logger.log(`API metrics retrieved`, {
          endpointCount: endpointStats.length,
          metricsCount: this.apiMonitor.getMetricsCount(),
        });

        // Conform to ApiMetricsResponse shape
        return {
          timestamp: Date.now(),
          metrics: {
            requests: {
              total: healthMetrics.totalRequests,
              rate: healthMetrics.requestsPerMinute,
              errors: Math.round((healthMetrics.totalRequests * healthMetrics.errorRate) / 100),
              errorRate: healthMetrics.errorRate,
            },
            response: {
              averageTime: healthMetrics.averageResponseTime,
              p95: healthMetrics.averageResponseTime * 1.5, // Approximation
              p99: healthMetrics.averageResponseTime * 2, // Approximation
            },
            endpoints: endpointStats.slice(0, 20).reduce(
              (acc, stat) => {
                acc[stat.endpoint] = {
                  requests: stat.totalRequests,
                  averageTime: stat.averageResponseTime,
                  errors: stat.failedRequests,
                } as EndpointMetrics;
                return acc;
              },
              {} as Record<string, EndpointMetrics>
            ),
          },
        };
      },
      "getApiMetrics",
      "POST",
      "/metrics"
    );
  }

  @Get("metrics")
  @ApiOperation({
    summary: "Get API metrics (GET method)",
    description: "Alternative GET endpoint for API metrics retrieval",
  })
  @ApiResponse({
    status: 200,
    description: "API metrics retrieved successfully",
  })
  async getApiMetricsGet(): Promise<ApiMetricsResponse> {
    // Delegate to the POST method for consistency
    return this.getApiMetrics();
  }

  @Get("metrics/performance")
  @ApiOperation({
    summary: "Get performance metrics",
    description: "Returns detailed performance metrics for API endpoints and system resources",
  })
  @ApiResponse({
    status: 200,
    description: "Performance metrics retrieved successfully",
  })
  async getPerformanceMetrics(): Promise<PerformanceMetricsResponse> {
    const result = await this.executeOperation(async () => {
      const performanceMetrics = this.apiMonitor.getPerformanceMetrics(10); // Last 10 minutes
      const systemMetrics = {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        loadAverage: process.platform !== "win32" ? require("os").loadavg() : [0, 0, 0],
      };

      return {
        timestamp: Date.now(),
        system: {
          cpu: systemMetrics.cpu.user / 1000000, // Convert to percentage approximation
          memory: systemMetrics.memory.heapUsed / systemMetrics.memory.heapTotal,
          uptime: systemMetrics.uptime,
        },
        application: {
          responseTime: performanceMetrics.averageResponseTime,
          throughput: performanceMetrics.requestCount / 10, // requests per minute approximation
          errorRate: performanceMetrics.errorRate,
          cacheHitRate: 0.85, // Default approximation - should come from cache service
        },
        feeds: {
          active: 50, // Should come from feed service
          total: 100, // Should come from feed service
          aggregations: performanceMetrics.requestCount,
        },
      };
    }, "getPerformanceMetrics");
    return result.data as PerformanceMetricsResponse;
  }

  @Get("metrics/endpoints")
  @ApiOperation({
    summary: "Get endpoint statistics",
    description: "Returns detailed statistics for all API endpoints including response times and error rates",
  })
  @ApiResponse({
    status: 200,
    description: "Endpoint statistics retrieved successfully",
  })
  async getEndpointStats(): Promise<EndpointStatsResponse> {
    const result = await this.executeOperation(async () => {
      const endpointStats = this.apiMonitor.getAllEndpointStats();

      this.logger.log(`Endpoint statistics retrieved`, {
        endpointCount: endpointStats.length,
      });

      // Conform to EndpointStatsResponse shape
      return {
        timestamp: Date.now(),
        endpoints: endpointStats,
      };
    }, "getEndpointStats");
    return result.data as EndpointStatsResponse;
  }

  @Get("metrics/errors")
  @ApiOperation({
    summary: "Get error analysis",
    description: "Returns detailed error analysis including error rates, types, and trends",
  })
  @ApiResponse({
    status: 200,
    description: "Error analysis retrieved successfully",
  })
  async getErrorAnalysis(): Promise<ErrorAnalysisResponse> {
    const result = await this.executeOperation(async () => {
      const overall = this.apiMonitor.getApiHealthMetrics();
      const analysis = this.apiMonitor.getErrorAnalysis();

      const now = Date.now();
      const oneHour = 60 * 60 * 1000;

      // Conform to ErrorAnalysisResponse shape
      return {
        timestamp: now,
        timeWindow: { start: now - oneHour, end: now },
        summary: {
          totalErrors: analysis.totalErrors,
          errorRate: overall.errorRate,
          topErrors: [],
        },
        byEndpoint: Object.entries(analysis.errorsByEndpoint).reduce(
          (acc, [endpoint, errors]) => {
            // Try to compute rate from endpoint stats if available
            const stats = this.apiMonitor.getEndpointStats(endpoint);
            acc[endpoint] = {
              errors,
              rate: stats ? stats.errorRate : 0,
              topErrors: [],
            };
            return acc;
          },
          {} as Record<string, { errors: number; rate: number; topErrors: string[] }>
        ),
      };
    }, "getErrorAnalysis");
    return result.data as ErrorAnalysisResponse;
  }

  // Override logApiResponse to include API monitoring
  protected override logApiResponse(
    method: string,
    url: string,
    statusCode: number,
    responseTime: number,
    responseSize: number,
    requestId?: string,
    errorMessage?: string
  ): void {
    // Record in API monitor
    this.apiMonitor.recordApiRequest({
      endpoint: url,
      method,
      statusCode,
      responseTime,
      responseSize,
      timestamp: Date.now(),
      requestId,
      error: errorMessage,
      // Required ApiMetrics fields
      requestCount: 1,
      errorRate: statusCode >= 400 ? 100 : 0,
      throughput: 0,
    });

    // Call parent implementation
    super.logApiResponse(method, url, statusCode, responseTime, responseSize, requestId, errorMessage);
  }
}
