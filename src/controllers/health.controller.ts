import { Controller, Get, Post, HttpException, HttpStatus, Inject, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";

import { BaseController } from "@/common/base/base.controller";
import { ENV, ENV_HELPERS } from "@/config/environment.constants";
import { FtsoProviderService } from "@/app.service";
import { IntegrationService } from "@/integration/integration.service";
import { RateLimitGuard } from "@/common/rate-limiting/rate-limit.guard";
import { RealTimeAggregationService } from "@/aggregators/real-time-aggregation.service";
import { RealTimeCacheService } from "@/cache/real-time-cache.service";
import { StandardizedErrorHandlerService } from "@/error-handling/standardized-error-handler.service";
import { UniversalRetryService } from "@/error-handling/universal-retry.service";

import type {
  HealthCheckResponse,
  DetailedHealthResponse,
  ReadinessResponse,
  LivenessResponse,
} from "@/common/types/monitoring";
import type { HealthStatus } from "@/common/types/monitoring";

@ApiTags("System Health")
@Controller()
@UseGuards(RateLimitGuard)
export class HealthController extends BaseController {
  private readyTime?: number;

  constructor(
    @Inject("FTSO_PROVIDER_SERVICE") private readonly providerService: FtsoProviderService,
    private readonly integrationService: IntegrationService,
    private readonly cacheService: RealTimeCacheService,
    private readonly aggregationService: RealTimeAggregationService,
    standardizedErrorHandler: StandardizedErrorHandlerService,
    universalRetryService: UniversalRetryService
  ) {
    super();
    // Inject standardized error handling services
    this.standardizedErrorHandler = standardizedErrorHandler;
    this.universalRetryService = universalRetryService;
  }

  @Post("health")
  @ApiOperation({
    summary: "Health check endpoint",
    description: "Returns comprehensive system health status and performance metrics with detailed component status",
  })
  @ApiResponse({
    status: 200,
    description: "System is healthy",
    schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["healthy", "degraded", "unhealthy"] },
        timestamp: { type: "number" },
        version: { type: "string" },
        uptime: { type: "number" },
        memory: { type: "object" },
        performance: { type: "object" },
        components: { type: "object" },
        details: { type: "object" },
      },
    },
  })
  @ApiResponse({
    status: 503,
    description: "System is unhealthy",
    schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["unhealthy"] },
        timestamp: { type: "number" },
        error: { type: "string" },
        details: { type: "object" },
      },
    },
  })
  async healthCheck(): Promise<HealthCheckResponse> {
    const result = await this.executeOperation(
      async () => {
        // Get comprehensive health information
        const [health, performanceMetrics] = await Promise.allSettled([
          this.providerService.healthCheck(),
          this.providerService.getPerformanceMetrics(),
        ]);

        // Get additional component health
        const cacheStats = this.cacheService.getStats();
        const aggregationStats = this.aggregationService.getCacheStats();

        // Determine component health status
        const components = {
          provider: {
            status: health.status === "fulfilled" ? health.value.status : "unhealthy",
            details: health.status === "fulfilled" ? health.value.details : { error: health.reason?.message },
          },
          cache: {
            status: cacheStats.hitRate > ENV.CACHE.HIT_RATE_TARGET ? "healthy" : "degraded",
            hitRate: cacheStats.hitRate,
            totalEntries: cacheStats.totalEntries,
            memoryUsage: cacheStats.memoryUsage,
          },
          aggregation: {
            status: aggregationStats.totalEntries > 0 ? "healthy" : "degraded",
            totalEntries: aggregationStats.totalEntries,
            hitRate: aggregationStats.hitRate,
            averageAge: aggregationStats.averageAge,
          },
          performance: {
            status: performanceMetrics.status === "fulfilled" ? "healthy" : "degraded",
            metrics: performanceMetrics.status === "fulfilled" ? performanceMetrics.value : null,
          },
        };

        // Determine overall health
        const componentStatuses = Object.values(components).map(c => c.status);
        const unhealthyCount = componentStatuses.filter(s => s === "unhealthy").length;
        const degradedCount = componentStatuses.filter(s => s === "degraded").length;

        let overallStatus: "healthy" | "degraded" | "unhealthy";
        if (unhealthyCount > 0) {
          overallStatus = "unhealthy";
        } else if (degradedCount > 0) {
          overallStatus = "degraded";
        } else {
          overallStatus = "healthy";
        }

        const response = {
          status: overallStatus,
          timestamp: Date.now(),
          version: "1.0.0",
          uptime: process.uptime(),
          memory: {
            used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024), // MB
            total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024), // MB
            external: Math.round(process.memoryUsage().external / 1024 / 1024), // MB
            rss: Math.round(process.memoryUsage().rss / 1024 / 1024), // MB
          },
          components,
          details: {
            environment: ENV.APPLICATION.NODE_ENV,
            nodeVersion: process.version,
            platform: process.platform,
            pid: process.pid,
          },
        };

        if (overallStatus === "unhealthy") {
          throw new HttpException(response, HttpStatus.SERVICE_UNAVAILABLE);
        }

        return response;
      },
      "healthCheck",
      { performanceThreshold: 1000 }
    );
    return result.data as HealthCheckResponse;
  }

  @Get("health")
  @ApiOperation({
    summary: "System health check",
    description: "Returns comprehensive system health status including all integrated components",
  })
  @ApiResponse({
    status: 200,
    description: "System is healthy",
    schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["healthy", "degraded", "unhealthy"] },
        timestamp: { type: "number" },
        version: { type: "string" },
        uptime: { type: "number" },
        memory: { type: "object" },
        cpu: { type: "object" },
        environment: { type: "string" },
        services: { type: "object" },
        startup: { type: "object" },
      },
    },
  })
  @ApiResponse({ status: 503, description: "System is unhealthy" })
  async getHealth(): Promise<HealthStatus> {
    try {
      const startTime = Date.now();

      // Get integration service health (aggregate system metrics)
      const systemHealth = await this.integrationService.getSystemHealth();

      // Build response aligned to HealthStatus
      const response: HealthStatus = {
        status: systemHealth.status,
        timestamp: Date.now(),
        version: "1.0.0",
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        connections: 0,
        adapters: systemHealth.sources.length,
        cache: { hitRate: 0, entries: 0 },
        startup: {
          initialized: true,
          startTime: this.startupTime,
          startupTime: this.startupTime,
          readyTime: this.readyTime,
          timeSinceStartup: Date.now() - this.startupTime,
        },
      };

      // Log health check performance
      const totalResponseTime = Date.now() - startTime;
      if (totalResponseTime > 1000) {
        this.logger.warn(`Health check took ${totalResponseTime}ms (exceeds 1s threshold)`);
      }

      if (response.status === "unhealthy") {
        throw new HttpException(response, HttpStatus.SERVICE_UNAVAILABLE);
      }

      return response;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error("Health check failed:", errMsg);

      if (error instanceof HttpException) {
        throw error;
      }

      const errorResponse: HealthStatus = {
        status: "unhealthy",
        timestamp: Date.now(),
        version: "1.0.0",
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        connections: 0,
        adapters: 0,
        cache: { hitRate: 0, entries: 0 },
        startup: {
          initialized: false,
          startTime: this.startupTime,
          startupTime: this.startupTime,
          readyTime: this.readyTime,
          timeSinceStartup: Date.now() - this.startupTime,
        },
      };

      throw new HttpException(errorResponse, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  @Get("health/detailed")
  @ApiOperation({
    summary: "Detailed system health check",
    description: "Returns detailed health information for all system components including performance metrics",
  })
  @ApiResponse({
    status: 200,
    description: "Detailed health information retrieved",
    schema: {
      type: "object",
      properties: {
        timestamp: { type: "number" },
        overall: { type: "string" },
        components: { type: "object" },
        system: { type: "object" },
        performance: { type: "object" },
        configuration: { type: "object" },
      },
    },
  })
  async getDetailedHealth(): Promise<DetailedHealthResponse> {
    try {
      // Get comprehensive system health
      const systemHealth = await this.integrationService.getSystemHealth();

      // Intentionally omit system/config blocks to conform to DetailedHealthResponse type

      return {
        status: systemHealth.status,
        timestamp: Date.now(),
        uptime: process.uptime(),
        version: "1.0.0",
        components: {
          database: {
            component: "database",
            status: systemHealth.status,
            timestamp: Date.now(),
          },
          cache: {
            component: "cache",
            status: systemHealth.status,
            timestamp: Date.now(),
          },
          adapters: {
            component: "adapters",
            status: systemHealth.status,
            timestamp: Date.now(),
          },
          integration: {
            component: "integration",
            status: systemHealth.status,
            timestamp: Date.now(),
          },
        },
        startup: {
          initialized: true,
          startTime: this.startupTime,
          startupTime: this.startupTime,
          readyTime: this.readyTime,
        },
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack : undefined;
      this.logger.error("Detailed health check failed:", errMsg);
      throw new HttpException(
        {
          error: "Detailed health check failed",
          message: errMsg,
          timestamp: Date.now(),
          stack: ENV_HELPERS.isDevelopment() ? errStack : undefined,
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get("health/ready")
  @ApiOperation({
    summary: "Readiness probe",
    description:
      "Returns readiness status for load balancer and orchestration integration. System is ready when it can serve requests.",
  })
  @ApiResponse({
    status: 200,
    description: "System is ready to serve requests",
    schema: {
      type: "object",
      properties: {
        ready: { type: "boolean" },
        status: { type: "string" },
        timestamp: { type: "number" },
        checks: { type: "object" },
        startupTime: { type: "number" },
      },
    },
  })
  @ApiResponse({ status: 503, description: "System is not ready" })
  async getReadiness(): Promise<ReadinessResponse> {
    try {
      const startTime = Date.now();
      // Perform readiness checks
      const checks = await this.performReadinessChecks();
      // System is ready if all critical checks pass
      const isReady = checks.integration.ready && checks.provider.ready && checks.startup.ready;

      // Determine overall status
      const overallStatus = isReady
        ? checks.integration.status === "healthy" && checks.provider.status === "healthy"
          ? "healthy"
          : "degraded"
        : "unhealthy";

      const response = {
        ready: isReady,
        status: overallStatus,
        timestamp: Date.now(),
        responseTime: Date.now() - startTime,
        checks,
        startup: {
          startupTime: this.startupTime,
          readyTime: this.readyTime ?? null,
          timeSinceStartup: Date.now() - this.startupTime,
        },
      };

      if (!isReady) {
        this.logger.warn("System not ready:", { checks });
        throw new HttpException(response, HttpStatus.SERVICE_UNAVAILABLE);
      }

      // Mark as ready if this is the first successful readiness check
      if (!this.readyTime) {
        this.readyTime = Date.now();
        this.logger.log(`System marked as ready after ${this.readyTime - this.startupTime}ms`);
      }

      return response;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error("Readiness check failed:", errMsg);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          ready: false,
          status: "unhealthy",
          timestamp: Date.now(),
          error: errMsg,
          startup: {
            startupTime: this.startupTime,
            timeSinceStartup: Date.now() - this.startupTime,
          },
        },
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }

  @Get("health/live")
  @ApiOperation({
    summary: "Liveness probe",
    description:
      "Returns liveness status for container orchestration. System is alive if the process is running and responsive.",
  })
  @ApiResponse({
    status: 200,
    description: "System is alive and responsive",
    schema: {
      type: "object",
      properties: {
        alive: { type: "boolean" },
        responseTime: { type: "number" },
        timestamp: { type: "number" },
        uptime: { type: "number" },
        memory: { type: "object" },
      },
    },
  })
  @ApiResponse({ status: 503, description: "System is not alive" })
  async getLiveness(): Promise<LivenessResponse> {
    try {
      // Basic liveness checks - verify core services are responsive
      const livenessChecks = await this.performLivenessChecks();
      const isAlive = livenessChecks.integration && livenessChecks.provider;

      const response: LivenessResponse = {
        alive: isAlive,
        timestamp: Date.now(),
        uptime: process.uptime(),
        // Include checks for testing/observability (not strictly required by type)
        ...(livenessChecks && { checks: livenessChecks as unknown as never }),
      };

      if (!isAlive) {
        throw new HttpException(response, HttpStatus.SERVICE_UNAVAILABLE);
      }

      return response;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error("Liveness check failed:", errMsg);

      if (error instanceof HttpException) {
        throw error;
      }

      const resp: LivenessResponse = {
        alive: false,
        timestamp: Date.now(),
        uptime: process.uptime(),
      };
      throw new HttpException(resp, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  // Helper methods

  private async performReadinessChecks(): Promise<{
    integration: { ready: boolean; status: string; error: null | string };
    provider: { ready: boolean; status: string; error: null | string };
    startup: { ready: boolean; timeSinceStartup: number };
  }> {
    const checks: {
      integration: { ready: boolean; status: string; error: string | null };
      provider: { ready: boolean; status: string; error: string | null };
      startup: { ready: boolean; timeSinceStartup: number };
    } = {
      integration: { ready: false, status: "unhealthy", error: null },
      provider: { ready: false, status: "unhealthy", error: null },
      startup: { ready: false, timeSinceStartup: Date.now() - this.startupTime },
    };

    try {
      // Check if integration service is initialized first
      if (!this.integrationService.isServiceInitialized()) {
        // Integration service not initialized yet, be lenient during startup
        const timeSinceStartup = Date.now() - this.startupTime;
        if (timeSinceStartup < 90000) {
          // First 90 seconds - consider integration ready during startup
          checks.integration.ready = true;
          checks.integration.status = "degraded";
          checks.integration.error = null;
        } else {
          // After 90 seconds, mark as not ready
          checks.integration.ready = false;
          checks.integration.status = "unhealthy";
          checks.integration.error = "Integration service not initialized";
        }
      } else {
        // Integration service is initialized, check its health
        const integrationPromise = this.integrationService.getSystemHealth();
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Integration health check timeout")), ENV.TIMEOUTS.HEALTH_CHECK_MS)
        );

        const integrationHealth = await Promise.race([integrationPromise, timeoutPromise]);
        checks.integration.ready = integrationHealth.status !== "unhealthy";
        checks.integration.status = integrationHealth.status;
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      checks.integration.error = errMsg;

      // During startup, be more lenient - if integration service is not ready yet,
      // consider it ready if we're still in startup phase
      const timeSinceStartup = Date.now() - this.startupTime;
      if (timeSinceStartup < 90000) {
        // First 90 seconds - be lenient during startup
        checks.integration.ready = true;
        checks.integration.status = "degraded";
        checks.integration.error = null;
      }
    }

    // For now, use integration health as proxy for provider health
    checks.provider.ready = checks.integration.ready;
    checks.provider.status = checks.integration.status;

    // Check if enough time has passed since startup (minimum 3 seconds, reduced from 5)
    checks.startup.ready = Date.now() - this.startupTime > 3000;

    return checks;
  }

  private async performLivenessChecks(): Promise<{
    integration: boolean;
    provider: boolean;
    memory: boolean;
    responseTime: number;
  }> {
    const checks = {
      integration: false,
      provider: false,
      memory: false,
      responseTime: 0,
    };

    const startTime = Date.now();

    try {
      // Quick integration service check (with timeout)
      const integrationPromise = this.integrationService.getSystemHealth();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Integration check timeout")), ENV.TIMEOUTS.LIVENESS_CHECK_MS)
      );

      await Promise.race([integrationPromise, timeoutPromise]);
      checks.integration = true;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.debug("Integration liveness check failed:", errMsg);

      // During startup, be more lenient for liveness checks
      const timeSinceStartup = Date.now() - this.startupTime;
      if (timeSinceStartup < 15000) {
        // First 15 seconds
        checks.integration = true; // Consider alive during startup
      }
    }

    // For now, use integration health as proxy for provider health
    checks.provider = checks.integration;

    // Check memory usage (fail if using more than 90% of heap)
    const memUsage = process.memoryUsage();
    checks.memory = memUsage.heapUsed / memUsage.heapTotal < 0.9;

    checks.responseTime = Date.now() - startTime;

    return checks;
  }
}
