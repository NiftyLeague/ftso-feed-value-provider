import { Controller, Get, Post, HttpException, HttpStatus, Inject } from "@nestjs/common";
import { BaseController } from "@/common/base/base.controller";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { FtsoProviderService } from "@/app.service";
import { RealTimeCacheService } from "@/cache/real-time-cache.service";
import { RealTimeAggregationService } from "@/aggregators/real-time-aggregation.service";
import { IntegrationService } from "../integration/integration.service";

import { ApiErrorHandlerService } from "../error-handling/api-error-handler.service";

interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: number;
  version: string;
  uptime: number;
  memory: NodeJS.MemoryUsage;
  cpu: NodeJS.CpuUsage;
  environment: string;
  services: {
    integration: Record<string, unknown>;
    provider: Record<string, unknown>;
  };
  startup: {
    initialized: boolean;
    startupTime: number;
    readyTime?: number;
  };
}

@ApiTags("System Health")
@Controller()
export class HealthController extends BaseController {
  private readyTime?: number;

  constructor(
    @Inject("FTSO_PROVIDER_SERVICE") private readonly providerService: FtsoProviderService,
    private readonly integrationService: IntegrationService,
    private readonly cacheService: RealTimeCacheService,
    private readonly aggregationService: RealTimeAggregationService,
    private readonly errorHandler: ApiErrorHandlerService
  ) {
    super("HealthController");
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
  async healthCheck(): Promise<Record<string, unknown>> {
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
            status: cacheStats.hitRate > 0.3 ? "healthy" : "degraded",
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
            environment: process.env.NODE_ENV || "development",
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
    return result.data as Record<string, unknown>;
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

      // Get integration service health
      const integrationHealth = await this.integrationService.getSystemHealth();

      // For now, use integration health as the primary health indicator
      // The integration service includes all the necessary health checks
      const overallStatus = integrationHealth.status;

      // Mark as ready if this is the first successful health check
      if (!this.readyTime && overallStatus !== "unhealthy") {
        this.readyTime = Date.now();
      }

      const response: HealthStatus = {
        status: overallStatus,
        timestamp: Date.now(),
        version: "1.0.0",
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        environment: process.env.NODE_ENV || "development",
        services: {
          integration: {
            status: integrationHealth.status,
            connections: integrationHealth.connections,
            adapters: integrationHealth.adapters,
            cache: integrationHealth.cache,
            responseTime: Date.now() - startTime,
          },
          provider: {
            status: integrationHealth.status, // Use integration status as proxy
            mode: "production", // Always production mode
          },
        },
        startup: {
          initialized: true,
          startupTime: this.startupTime,
          readyTime: this.readyTime,
        },
      };

      // Log health check performance
      const totalResponseTime = Date.now() - startTime;
      if (totalResponseTime > 1000) {
        this.logger.warn(`Health check took ${totalResponseTime}ms (exceeds 1s threshold)`);
      }

      if (overallStatus === "unhealthy") {
        throw new HttpException(response, HttpStatus.SERVICE_UNAVAILABLE);
      }

      return response;
    } catch (error) {
      this.logger.error("Health check failed:", error);

      if (error instanceof HttpException) {
        throw error;
      }

      const errorResponse: HealthStatus = {
        status: "unhealthy",
        timestamp: Date.now(),
        version: "1.0.0",
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        environment: process.env.NODE_ENV || "development",
        services: {
          integration: { status: "unhealthy", error: error.message },
          provider: { status: "unhealthy", error: error.message },
        },
        startup: {
          initialized: false,
          startupTime: this.startupTime,
          readyTime: this.readyTime,
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
  async getDetailedHealth(): Promise<Record<string, unknown>> {
    try {
      const startTime = Date.now();

      // Get comprehensive system health
      const systemHealth = await this.integrationService.getSystemHealth();

      // Get system resource information
      const systemInfo = {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        version: "1.0.0",
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
        loadAverage: process.platform !== "win32" ? require("os").loadavg() : [0, 0, 0],
        freeMemory: require("os").freemem(),
        totalMemory: require("os").totalmem(),
      };

      // Get configuration status
      const configStatus = {
        environment: process.env.NODE_ENV || "development",
        productionMode: true, // Always production mode
        logLevel: process.env.LOG_LEVEL || "log",
        port: process.env.VALUE_PROVIDER_CLIENT_PORT || "3101",
        monitoringEnabled: process.env.MONITORING_ENABLED === "true",
        alertingEnabled: process.env.ALERT_EMAIL_ENABLED === "true" || process.env.ALERT_WEBHOOK_ENABLED === "true",
      };

      const responseTime = Date.now() - startTime;

      return {
        timestamp: Date.now(),
        responseTime,
        overall: systemHealth.status,
        components: {
          integration: {
            status: systemHealth.status,
            connections: systemHealth.connections,
            adapters: systemHealth.adapters,
            cache: systemHealth.cache,
          },
          provider: {
            status: systemHealth.status, // Use integration status as proxy
            mode: "production", // Always production mode
          },
        },
        system: systemInfo,
        performance: {
          healthCheckResponseTime: responseTime,
        },
        configuration: configStatus,
        startup: {
          startupTime: this.startupTime,
          readyTime: this.readyTime,
          timeSinceStartup: Date.now() - this.startupTime,
          timeSinceReady: this.readyTime ? Date.now() - this.readyTime : null,
        },
      };
    } catch (error) {
      this.logger.error("Detailed health check failed:", error);
      throw new HttpException(
        {
          error: "Detailed health check failed",
          message: error.message,
          timestamp: Date.now(),
          stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
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
  async getReadiness(): Promise<Record<string, unknown>> {
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
          readyTime: this.readyTime,
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
      this.logger.error("Readiness check failed:", error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          ready: false,
          status: "unhealthy",
          timestamp: Date.now(),
          error: error.message,
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
  async getLiveness(): Promise<Record<string, unknown>> {
    try {
      // Basic liveness checks - verify core services are responsive
      const livenessChecks = await this.performLivenessChecks();
      const isAlive = livenessChecks.integration && livenessChecks.provider;
      const responseTime = livenessChecks.responseTime;

      const response = {
        alive: isAlive,
        responseTime,
        timestamp: Date.now(),
        uptime: process.uptime(),
        memory: {
          used: process.memoryUsage().heapUsed,
          total: process.memoryUsage().heapTotal,
          external: process.memoryUsage().external,
        },
        checks: livenessChecks,
      };

      if (!isAlive) {
        throw new HttpException(response, HttpStatus.SERVICE_UNAVAILABLE);
      }

      return response;
    } catch (error) {
      this.logger.error("Liveness check failed:", error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          alive: false,
          timestamp: Date.now(),
          uptime: process.uptime(),
          error: error.message,
          responseTime: Date.now() - Date.now(), // Will be 0 but maintains structure
        },
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }

  // Helper methods

  private async performReadinessChecks(): Promise<{
    integration: { ready: boolean; status: string; error: null | string };
    provider: { ready: boolean; status: string; error: null | string };
    startup: { ready: boolean; timeSinceStartup: number };
  }> {
    const checks = {
      integration: { ready: false, status: "unhealthy", error: null },
      provider: { ready: false, status: "unhealthy", error: null },
      startup: { ready: false, timeSinceStartup: Date.now() - this.startupTime },
    };

    try {
      // Check integration service
      const integrationHealth = await this.integrationService.getSystemHealth();
      checks.integration.ready = integrationHealth.status !== "unhealthy";
      checks.integration.status = integrationHealth.status;
    } catch (error) {
      checks.integration.error = error.message;
    }

    // For now, use integration health as proxy for provider health
    checks.provider.ready = checks.integration.ready;
    checks.provider.status = checks.integration.status;

    // Check if enough time has passed since startup (minimum 5 seconds)
    checks.startup.ready = Date.now() - this.startupTime > 5000;

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
        setTimeout(() => reject(new Error("Integration check timeout")), 2000)
      );

      await Promise.race([integrationPromise, timeoutPromise]);
      checks.integration = true;
    } catch (error) {
      this.logger.debug("Integration liveness check failed:", (error as Error).message);
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
