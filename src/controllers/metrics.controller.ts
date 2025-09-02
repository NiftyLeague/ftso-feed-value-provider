import { Controller, Post, Get } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { BaseController } from "@/common/base/base.controller";

import { ApiErrorHandlerService } from "../error-handling/api-error-handler.service";
import { ApiMonitorService } from "../monitoring/api-monitor.service";

@ApiTags("API Metrics and Monitoring")
@Controller()
export class MetricsController extends BaseController {
  constructor(
    private readonly errorHandler: ApiErrorHandlerService,
    private readonly apiMonitor: ApiMonitorService
  ) {
    super("MetricsController");
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
  async getApiMetrics(): Promise<Record<string, unknown>> {
    return this.handleControllerOperation(
      async () => {
        // Get comprehensive API metrics
        const healthMetrics = this.apiMonitor.getApiHealthMetrics();
        const endpointStats = this.apiMonitor.getAllEndpointStats();
        const performanceMetrics = this.apiMonitor.getPerformanceMetrics(5); // Last 5 minutes
        const errorAnalysis = this.apiMonitor.getErrorAnalysis();

        this.logger.log(`API metrics retrieved`, {
          endpointCount: endpointStats.length,
          metricsCount: this.apiMonitor.getMetricsCount(),
        });

        return {
          health: healthMetrics,
          endpoints: endpointStats.slice(0, 20), // Top 20 endpoints
          performance: performanceMetrics,
          errors: errorAnalysis,
          system: {
            uptime: process.uptime(),
            memory: {
              used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024), // MB
              total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024), // MB
            },
            metricsCount: this.apiMonitor.getMetricsCount(),
          },
          timestamp: Date.now(),
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
  async getApiMetricsGet(): Promise<Record<string, unknown>> {
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
  async getPerformanceMetrics(): Promise<Record<string, unknown>> {
    const result = await this.executeOperation(async () => {
      const performanceMetrics = this.apiMonitor.getPerformanceMetrics(10); // Last 10 minutes
      const systemMetrics = {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        loadAverage: process.platform !== "win32" ? require("os").loadavg() : [0, 0, 0],
      };

      return {
        performance: performanceMetrics,
        system: systemMetrics,
        timestamp: Date.now(),
      };
    }, "getPerformanceMetrics");
    return result.data as Record<string, unknown>;
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
  async getEndpointStats(): Promise<Record<string, unknown>> {
    const result = await this.executeOperation(async () => {
      const endpointStats = this.apiMonitor.getAllEndpointStats();
      const healthMetrics = this.apiMonitor.getApiHealthMetrics();

      this.logger.log(`Endpoint statistics retrieved`, {
        endpointCount: endpointStats.length,
      });

      return {
        endpoints: endpointStats,
        summary: {
          totalEndpoints: endpointStats.length,
          totalRequests: endpointStats.reduce((sum, ep) => sum + (ep.totalRequests || 0), 0),
          averageResponseTime: healthMetrics.averageResponseTime || 0,
          errorRate: healthMetrics.errorRate || 0,
        },
        timestamp: Date.now(),
      };
    }, "getEndpointStats");
    return result.data as Record<string, unknown>;
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
  async getErrorAnalysis(): Promise<Record<string, unknown>> {
    const result = await this.executeOperation(async () => {
      const errorAnalysis = this.apiMonitor.getErrorAnalysis();

      return {
        errors: errorAnalysis,
        timestamp: Date.now(),
      };
    }, "getErrorAnalysis");
    return result.data as Record<string, unknown>;
  }

  // Override logApiResponse to include API monitoring
  protected logApiResponse(
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
    });

    // Call parent implementation
    super.logApiResponse(method, url, statusCode, responseTime, responseSize, requestId, errorMessage);
  }
}
