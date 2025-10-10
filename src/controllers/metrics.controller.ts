import { Controller, Post, Get, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { RateLimitGuard } from "@/common/rate-limiting/rate-limit.guard";
import { BaseController } from "@/common/base/base.controller";
import { StandardizedErrorHandlerService } from "@/error-handling/standardized-error-handler.service";
import { UniversalRetryService } from "@/error-handling/universal-retry.service";
import { ApiMonitorService } from "@/monitoring/api-monitor.service";
import type {
  ApiMetricsResponse,
  PerformanceMetricsResponse,
  EndpointStatsResponse,
  ErrorAnalysisResponse,
} from "@/common/types/monitoring";
import {
  ApiMetricsResponseDto,
  PerformanceMetricsResponseDto,
  EndpointStatsResponseDto,
  ErrorAnalysisResponseDto,
} from "./dto/health-metrics.dto";

@ApiTags("API Metrics and Monitoring")
@Controller()
@UseGuards(RateLimitGuard)
export class MetricsController extends BaseController {
  constructor(
    standardizedErrorHandler: StandardizedErrorHandlerService,
    universalRetryService: UniversalRetryService,
    private readonly apiMonitor: ApiMonitorService
  ) {
    super();
    // Inject standardized error handling services
    this.standardizedErrorHandler = standardizedErrorHandler;
    this.universalRetryService = universalRetryService;
  }

  @Post("metrics")
  @ApiOperation({
    summary: "API metrics and monitoring data",
    description: "Returns comprehensive API performance metrics, endpoint statistics, and health information",
  })
  @ApiResponse({
    status: 200,
    description: "API metrics retrieved successfully",
    type: ApiMetricsResponseDto,
  })
  async getApiMetrics(): Promise<ApiMetricsResponse> {
    try {
      // Gather metrics
      const health = this.apiMonitor.getApiHealthMetrics();
      const endpoints = this.apiMonitor.getAllEndpointStats();
      const performance = this.apiMonitor.getPerformanceMetrics(10);
      const errors = this.apiMonitor.getErrorAnalysis();
      const metricsCount = this.apiMonitor.getMetricsCount();

      this.logger.log(`API metrics retrieved`, {
        endpointCount: endpoints.length,
        metricsCount,
      });

      // Match expected test shape
      return {
        health,
        endpoints,
        performance,
        errors,
        system: { metricsCount },
        timestamp: Date.now(),
        requestId: this.generateRequestId(),
      } as unknown as ApiMetricsResponse;
    } catch (error) {
      this.logger.error("Error retrieving API metrics:", error);
      throw error;
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
    type: ApiMetricsResponseDto,
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
    type: PerformanceMetricsResponseDto,
  })
  async getPerformanceMetrics(): Promise<PerformanceMetricsResponse> {
    try {
      const performance = this.apiMonitor.getPerformanceMetrics(10);
      const system = {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
      };

      return {
        performance,
        system,
        timestamp: Date.now(),
      } as unknown as PerformanceMetricsResponse;
    } catch (error) {
      this.logger.error("Error retrieving performance metrics:", error);
      throw error;
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
    type: EndpointStatsResponseDto,
  })
  async getEndpointStats(): Promise<EndpointStatsResponse> {
    try {
      const endpoints = this.apiMonitor.getAllEndpointStats();
      const health = this.apiMonitor.getApiHealthMetrics();

      this.logger.log(`Endpoint statistics retrieved`, {
        endpointCount: endpoints.length,
      });

      return {
        endpoints,
        summary: {
          totalEndpoints: endpoints.length,
          totalRequests: health.totalRequests,
          averageResponseTime: health.averageResponseTime,
          errorRate: health.errorRate,
        },
        timestamp: Date.now(),
      } as unknown as EndpointStatsResponse;
    } catch (error) {
      this.logger.error("Error retrieving endpoint stats:", error);
      throw error;
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
    type: ErrorAnalysisResponseDto,
  })
  async getErrorAnalysis(): Promise<ErrorAnalysisResponse> {
    try {
      const errors = this.apiMonitor.getErrorAnalysis();
      return {
        errors,
        timestamp: Date.now(),
        requestId: this.generateRequestId(),
      } as unknown as ErrorAnalysisResponse;
    } catch (error) {
      this.logger.error("Error retrieving error analysis:", error);
      throw error;
    }
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
