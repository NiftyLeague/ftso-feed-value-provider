import { Controller, Post, Get, HttpException, HttpStatus } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { BaseService } from "@/common/base/base.service";

import { ApiErrorHandlerService } from "../error-handling/api-error-handler.service";
import { ApiMonitorService } from "../monitoring/api-monitor.service";

@ApiTags("API Metrics and Monitoring")
@Controller()
export class MetricsController extends BaseService {
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
    const startTime = performance.now();
    const requestId = this.generateRequestId();

    try {
      // Log API request
      this.logApiRequest("POST", "/metrics", null, requestId);

      // Get comprehensive API metrics
      const healthMetrics = this.apiMonitor.getApiHealthMetrics();
      const endpointStats = this.apiMonitor.getAllEndpointStats();
      const performanceMetrics = this.apiMonitor.getPerformanceMetrics(5); // Last 5 minutes
      const errorAnalysis = this.apiMonitor.getErrorAnalysis();

      const response = {
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
        requestId,
      };

      const responseTime = performance.now() - startTime;

      // Log API response
      this.logApiResponse("POST", "/metrics", 200, responseTime, this.calculateResponseSize(response), requestId);

      this.logger.log(`API metrics retrieved in ${responseTime.toFixed(2)}ms`, {
        requestId,
        responseTime,
        endpointCount: endpointStats.length,
        metricsCount: this.apiMonitor.getMetricsCount(),
      });

      return response;
    } catch (error) {
      const responseTime = performance.now() - startTime;

      const errorResponse = {
        error: "METRICS_ERROR",
        code: 5004,
        message: "Failed to retrieve API metrics",
        timestamp: Date.now(),
        requestId,
      };

      // Log error response
      this.logApiResponse(
        "POST",
        "/metrics",
        500,
        responseTime,
        this.calculateResponseSize(errorResponse),
        requestId,
        error.message
      );

      this.logger.error(`Error retrieving API metrics (${responseTime.toFixed(2)}ms):`, error, {
        requestId,
        responseTime,
      });

      throw new HttpException(errorResponse, HttpStatus.INTERNAL_SERVER_ERROR);
    }
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
    const startTime = performance.now();
    const requestId = this.generateRequestId();

    try {
      const performanceMetrics = this.apiMonitor.getPerformanceMetrics(10); // Last 10 minutes
      const systemMetrics = {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        loadAverage: process.platform !== "win32" ? require("os").loadavg() : [0, 0, 0],
      };

      const response = {
        performance: performanceMetrics,
        system: systemMetrics,
        timestamp: Date.now(),
        responseTime: performance.now() - startTime,
        requestId,
      };

      this.logger.log(`Performance metrics retrieved in ${response.responseTime.toFixed(2)}ms`, {
        requestId,
        responseTime: response.responseTime,
      });

      return response;
    } catch (error) {
      const responseTime = performance.now() - startTime;
      this.logger.error(`Error retrieving performance metrics (${responseTime.toFixed(2)}ms):`, error, {
        requestId,
        responseTime,
      });

      throw new HttpException(
        {
          error: "PERFORMANCE_METRICS_ERROR",
          code: 5005,
          message: "Failed to retrieve performance metrics",
          timestamp: Date.now(),
          requestId,
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
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
    const startTime = performance.now();
    const requestId = this.generateRequestId();

    try {
      const endpointStats = this.apiMonitor.getAllEndpointStats();
      const healthMetrics = this.apiMonitor.getApiHealthMetrics();

      const response = {
        endpoints: endpointStats,
        summary: {
          totalEndpoints: endpointStats.length,
          totalRequests: endpointStats.reduce((sum, ep) => sum + (ep.totalRequests || 0), 0),
          averageResponseTime: healthMetrics.averageResponseTime || 0,
          errorRate: healthMetrics.errorRate || 0,
        },
        timestamp: Date.now(),
        responseTime: performance.now() - startTime,
        requestId,
      };

      this.logger.log(`Endpoint statistics retrieved in ${response.responseTime.toFixed(2)}ms`, {
        requestId,
        responseTime: response.responseTime,
        endpointCount: endpointStats.length,
      });

      return response;
    } catch (error) {
      const responseTime = performance.now() - startTime;
      this.logger.error(`Error retrieving endpoint statistics (${responseTime.toFixed(2)}ms):`, error, {
        requestId,
        responseTime,
      });

      throw new HttpException(
        {
          error: "ENDPOINT_STATS_ERROR",
          code: 5006,
          message: "Failed to retrieve endpoint statistics",
          timestamp: Date.now(),
          requestId,
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
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
    const startTime = performance.now();
    const requestId = this.generateRequestId();

    try {
      const errorAnalysis = this.apiMonitor.getErrorAnalysis();

      const response = {
        errors: errorAnalysis,
        timestamp: Date.now(),
        responseTime: performance.now() - startTime,
        requestId,
      };

      this.logger.log(`Error analysis retrieved in ${response.responseTime.toFixed(2)}ms`, {
        requestId,
        responseTime: response.responseTime,
      });

      return response;
    } catch (error) {
      const responseTime = performance.now() - startTime;
      this.logger.error(`Error retrieving error analysis (${responseTime.toFixed(2)}ms):`, error, {
        requestId,
        responseTime,
      });

      throw new HttpException(
        {
          error: "ERROR_ANALYSIS_ERROR",
          code: 5007,
          message: "Failed to retrieve error analysis",
          timestamp: Date.now(),
          requestId,
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  // Private helper methods

  private generateRequestId(): string {
    return this.errorHandler.generateRequestId();
  }

  private logApiRequest(method: string, url: string, body?: unknown, requestId?: string): void {
    const sanitizedBody = this.sanitizeRequestBody(body);
    this.logger.log(`API Request: ${method} ${url}`, {
      requestId,
      method,
      url,
      bodySize: JSON.stringify(sanitizedBody).length,
      timestamp: Date.now(),
    });
  }

  private logApiResponse(
    method: string,
    url: string,
    statusCode: number,
    responseTime: number,
    responseSize: number,
    requestId?: string,
    errorMessage?: string
  ): void {
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

    this.logger.log(`API Response: ${method} ${url} - ${statusCode}`, {
      requestId,
      method,
      url,
      statusCode,
      responseTime: Math.round(responseTime),
      responseSize,
      timestamp: Date.now(),
      error: errorMessage,
    });
  }

  private sanitizeRequestBody(body: unknown): unknown {
    if (!body) return body;

    // Create a copy and limit the size for logging
    const sanitized = JSON.parse(JSON.stringify(body));

    // Limit feeds array for logging (show first 3 feeds)
    if (sanitized.feeds && Array.isArray(sanitized.feeds) && sanitized.feeds.length > 3) {
      sanitized.feeds = [
        ...sanitized.feeds.slice(0, 3),
        { truncated: `... and ${sanitized.feeds.length - 3} more feeds` },
      ];
    }

    return sanitized;
  }

  private calculateResponseSize(response: unknown): number {
    try {
      return JSON.stringify(response).length;
    } catch {
      return 0;
    }
  }
}
