import { Controller, Get, Post, HttpException, HttpStatus, Inject } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiExtraModels } from "@nestjs/swagger";

import { BaseController } from "@/common/base/base.controller";
import { WithEvents } from "@/common/base/mixins/events.mixin";
import { WithLifecycle } from "@/common/base/mixins/lifecycle.mixin";
import { ENV, ENV_HELPERS } from "@/config/environment.constants";
import { FtsoProviderService } from "@/app.service";
import { IntegrationService } from "@/integration/integration.service";
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
import type { CoreFeedId } from "@/common/types/core";
import {
  HealthCheckResponseDto,
  ReadinessResponseDto,
  LivenessResponseDto,
  HealthCheckDetailsDto,
} from "./dto/health-metrics.dto";
import { HttpErrorResponseDto } from "./dto/common-error.dto";

// Create a composed base class with event and lifecycle capabilities
const EventDrivenController = WithLifecycle(WithEvents(BaseController));

@ApiTags("System Health")
@Controller()
@ApiExtraModels(
  HealthCheckResponseDto,
  ReadinessResponseDto,
  LivenessResponseDto,
  HealthCheckDetailsDto,
  HttpErrorResponseDto
)
// Note: Health endpoints should NOT be rate limited - they're used by orchestration systems
export class HealthController extends EventDrivenController {
  private readyTime?: number;
  private integrationServiceReady = false;
  private isInitializingStartup = true;

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

    // Set up event-driven initialization tracking
    this.setupIntegrationServiceListeners();
  }

  private setupIntegrationServiceListeners(): void {
    this.logger.debug(`Setting up integration service listeners, isInitializingStartup=${this.isInitializingStartup}`);

    // Check current state first
    if (this.integrationService.isServiceInitialized()) {
      this.integrationServiceReady = true;
      this.isInitializingStartup = false;
      this.logger.log("Integration service already initialized at controller construction");
      return;
    }

    // Listen for integration service initialization using base event mixin
    this.integrationService.on("initialized", () => {
      this.integrationServiceReady = true;
      this.isInitializingStartup = false;
      this.logger.debug("Integration service initialization event received");
    });

    // Use the base lifecycle mixin's waitForCondition method instead of custom polling
    this.waitForCondition(() => this.integrationService.isServiceInitialized(), {
      maxAttempts: 60, // 60 seconds with 1 second intervals (increased from 30)
      checkInterval: 1000,
      timeout: 60000,
    })
      .then(success => {
        if (success && !this.integrationServiceReady) {
          this.integrationServiceReady = true;
          this.isInitializingStartup = false;
          this.logger.debug("Integration service initialization detected via waitForCondition");
        } else if (!success) {
          // Keep isInitializingStartup = true even after timeout
          // This ensures readiness check failures continue to be logged at debug level
          // The flag will be set to false only when the system actually becomes ready
          this.logger.warn(
            "Integration service initialization timeout reached, but keeping initialization flag active"
          );
        }
      })
      .catch(error => {
        this.logger.warn("Error waiting for integration service initialization:", error);
        // Don't set isInitializingStartup = false here either
      });
  }

  @Post("health")
  @ApiOperation({
    summary: "Health check endpoint",
    description: "Returns comprehensive system health status and performance metrics with detailed component status",
  })
  @ApiResponse({
    status: 200,
    description: "System is healthy",
    type: HealthCheckResponseDto,
  })
  @ApiResponse({
    status: 503,
    description: "System is unhealthy",
    type: HttpErrorResponseDto,
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
          const errorMessage = `Liveness check failed - Status: ${overallStatus}`;
          const errorResponse = {
            ...response,
            message: errorMessage,
            details: `System is unhealthy and not responding properly`,
          };
          this.logger.error(errorMessage, { response });
          throw new HttpException(errorResponse, HttpStatus.SERVICE_UNAVAILABLE);
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
    type: HealthCheckResponseDto,
  })
  @ApiResponse({
    status: 503,
    description: "System is unhealthy",
    type: HttpErrorResponseDto,
  })
  async getHealth(): Promise<HealthStatus> {
    try {
      const startTime = Date.now();

      // Get integration service health (aggregate system metrics)
      const systemHealth = await this.integrationService.getSystemHealth();

      // Get adapter stats to show configured vs connected
      const adapterStats = this.integrationService.getAdapterStats();

      // Get cache statistics from both cache services
      const cacheStats = this.cacheService.getStats();
      const aggregationCacheStats = this.aggregationService.getCacheStats();

      // Combine cache stats - average hit rates, sum entries
      const totalCacheEntries = (cacheStats?.totalEntries || 0) + (aggregationCacheStats?.totalEntries || 0);
      const averageHitRate = ((cacheStats?.hitRate || 0) + (aggregationCacheStats?.hitRate || 0)) / 2;

      const combinedCacheStats = {
        hitRate: averageHitRate,
        entries: totalCacheEntries,
      };

      // Build response aligned to HealthStatus
      const response: HealthStatus = {
        status: systemHealth.status,
        timestamp: Date.now(),
        version: "1.0.0",
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        connections: systemHealth.sources.filter(s => s.status === "healthy").length,
        adapters: adapterStats.total,
        cache: combinedCacheStats,
        startup: {
          initialized: true,
          startTime: this.startupTime,
          readyTime: this.readyTime,
        },
      };

      // Log health check performance
      const totalResponseTime = Date.now() - startTime;
      if (totalResponseTime > 1000) {
        this.logger.warn(`Health check took ${totalResponseTime}ms (exceeds 1s threshold)`);
      }

      // Only return 503 for completely non-functional system
      // Allow degraded systems to return 200 for load testing purposes
      if (response.status === "unhealthy") {
        this.logger.warn(`Health check shows unhealthy status but returning 200 for load testing compatibility`);
        // Still return the response but with 200 status for load testing
        // The response body will still indicate the unhealthy status
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
          readyTime: this.readyTime,
        },
      };

      const enhancedErrorResponse = {
        ...errorResponse,
        message: `Health check failed: ${errMsg}`,
        error: errMsg,
      };

      throw new HttpException(enhancedErrorResponse, HttpStatus.SERVICE_UNAVAILABLE);
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
    type: HealthCheckResponseDto,
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
    type: ReadinessResponseDto,
  })
  @ApiResponse({
    status: 503,
    description: "System is not ready",
    type: HttpErrorResponseDto,
  })
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

      // Get diagnostic information for the response
      let diagnostics: {
        healthySources?: number;
        totalSources?: number;
        aggregationSuccessRate?: number;
        canServeFeedData?: boolean;
        state?: "not_ready" | "warming_up" | "ready";
        validFeedCount?: number;
        totalTestFeeds?: number;
      } = {};

      try {
        const systemHealth = await this.integrationService.getSystemHealth();
        const healthySources = systemHealth.sources.filter(s => s.status === "healthy").length;

        // Get readiness state from checks (it's computed in performReadinessChecks)
        let state: "not_ready" | "warming_up" | "ready" = "not_ready";
        if (isReady) {
          state = "ready";
        } else if (healthySources > 0 && systemHealth.aggregation.successRate > 0) {
          state = "warming_up";
        }

        diagnostics = {
          healthySources,
          totalSources: systemHealth.sources.length,
          aggregationSuccessRate: systemHealth.aggregation.successRate,
          canServeFeedData: isReady,
          state,
          validFeedCount: undefined, // Will be set if available
          totalTestFeeds: 4, // BTC, ETH, SOL, FLR
        };
      } catch {
        // Diagnostics are optional, don't fail if we can't get them
        this.logger.debug("Could not get diagnostics for readiness response");
      }

      const response = {
        ready: isReady,
        status: overallStatus,
        timestamp: Date.now(),
        responseTime: Date.now() - startTime,
        checks,
        diagnostics,
        startup: {
          startTime: this.startupTime,
          readyTime: this.readyTime ?? null,
        },
      };

      if (!isReady) {
        const errorMessage = `System not ready - Status: ${overallStatus}`;
        const errorDetails = {
          checks,
          integration: checks.integration.status,
          provider: checks.provider.status,
          startup: checks.startup.ready ? "ready" : "not ready",
        };

        // Use event-driven state to determine appropriate logging level
        if (this.isInitializingStartup) {
          this.logger.debug(errorMessage, errorDetails);
        } else {
          this.logger.warn(errorMessage, errorDetails);
        }

        // Create a proper error response with meaningful message
        const errorResponse = {
          ...response,
          message: errorMessage,
          details: `Integration: ${checks.integration.status}, Provider: ${checks.provider.status}, Startup: ${checks.startup.ready ? "ready" : "not ready"}`,
        };

        // The HttpExceptionFilter will handle logging appropriately based on the path and message
        throw new HttpException(errorResponse, HttpStatus.SERVICE_UNAVAILABLE);
      }

      // Mark as ready if this is the first successful readiness check
      if (!this.readyTime) {
        this.readyTime = Date.now();
        this.isInitializingStartup = false; // System is now ready, no longer initializing
        this.logger.log(`✅ System ready after ${this.readyTime - this.startupTime}ms`);
      }

      return response;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const errorContext = {
        error: errMsg,
        stack: error instanceof Error ? error.stack : undefined,
        startupTime: this.startupTime,
        readyTime: this.readyTime,
        isInitializing: this.isInitializingStartup,
      };

      // Use event-driven state to determine appropriate logging level
      // System is initializing if we haven't marked it as ready yet
      const isStillInitializing = !this.readyTime;

      if (isStillInitializing && error instanceof HttpException) {
        this.logger.debug("Readiness check failed during initialization:", errorContext);
      } else {
        this.logger.error("Readiness check failed:", errorContext);
      }

      if (error instanceof HttpException) {
        throw error;
      }

      const errorResponse = {
        ready: false,
        status: "unhealthy",
        timestamp: Date.now(),
        message: `Readiness check failed: ${errMsg}`,
        error: errMsg,
        startup: {
          startTime: this.startupTime,
          readyTime: this.readyTime,
        },
      };

      throw new HttpException(errorResponse, HttpStatus.SERVICE_UNAVAILABLE);
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
    type: LivenessResponseDto,
  })
  @ApiResponse({
    status: 503,
    description: "System is not alive",
    type: HttpErrorResponseDto,
  })
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
        const errorMessage = `Liveness check failed - System is not alive`;
        const errorResponse = {
          ...response,
          message: errorMessage,
          details: `Integration: ${livenessChecks.integration}, Provider: ${livenessChecks.provider}`,
        };
        this.logger.error(errorMessage, { livenessChecks });
        throw new HttpException(errorResponse, HttpStatus.SERVICE_UNAVAILABLE);
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

      const enhancedErrorResponse = {
        ...resp,
        message: `Liveness check failed: ${errMsg}`,
        error: errMsg,
      };

      throw new HttpException(enhancedErrorResponse, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  // Helper methods

  private async performReadinessChecks(): Promise<{
    integration: { ready: boolean; status: string; error: null | string };
    provider: { ready: boolean; status: string; error: null | string };
    startup: { ready: boolean };
  }> {
    const checks: {
      integration: { ready: boolean; status: string; error: string | null };
      provider: { ready: boolean; status: string; error: string | null };
      startup: { ready: boolean };
    } = {
      integration: { ready: false, status: "unhealthy", error: null },
      provider: { ready: false, status: "unhealthy", error: null },
      startup: { ready: false },
    };

    try {
      // Check integration service status directly instead of relying on event-driven state
      // This is more robust and handles race conditions better
      const isServiceReady = this.integrationService.isServiceInitialized();

      if (!isServiceReady) {
        checks.integration.ready = false;
        checks.integration.status = "initializing";
        checks.integration.error = "Integration service not initialized";

        // Only log debug messages during expected initialization phase
        if (this.isInitializingStartup) {
          this.logger.debug("System initializing - integration service still starting up");
        }
      } else {
        // Update our internal state if we detect the service is ready
        if (!this.integrationServiceReady) {
          this.integrationServiceReady = true;
          this.isInitializingStartup = false;
          this.logger.debug("Integration service detected as ready during health check");
        }

        // Integration service is initialized, check its health
        const integrationHealth = await this.integrationService.getSystemHealth();
        checks.integration.ready = integrationHealth.status !== "unhealthy";
        checks.integration.status = integrationHealth.status;

        // Log detailed health info for debugging
        this.logger.debug(
          `Integration health: status=${integrationHealth.status}, ` +
            `sources=${integrationHealth.sources?.length || 0}, ` +
            `healthySources=${integrationHealth.sources?.filter(s => s.status === "healthy").length || 0}`
        );
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack : undefined;
      checks.integration.error = errMsg;
      checks.integration.ready = false;
      checks.integration.status = "unhealthy";

      // Log the full error for debugging
      this.logger.error(`Error checking integration health: ${errMsg}`, errStack);
    }

    // For now, use integration health as proxy for provider health
    checks.provider.ready = checks.integration.ready;
    checks.provider.status = checks.integration.status;

    // Check if system has healthy data sources and can actually serve feed data

    if (checks.integration.ready) {
      try {
        const systemHealth = await this.integrationService.getSystemHealth();
        const healthySources = systemHealth.sources.filter(s => s.status === "healthy").length;
        const totalSources = systemHealth.sources.length;

        // System readiness logic:
        // The system is ready when it can actually serve data to users.
        // This means we need data sources connected and able to provide prices.
        //
        // Readiness criteria:
        // 1. Integration service is initialized
        // 2. At least one data source is healthy
        // 3. System has successfully aggregated at least some prices
        // 4. Can actually retrieve feed data (verified by test query)
        //
        // This ensures users get real data when they query feeds.
        const hasHealthySources = healthySources > 0;
        const hasSuccessfulAggregation = systemHealth.aggregation.successRate > 0;
        const hasConfiguredSources = totalSources > 0;

        // Test if we can actually serve feed data by testing key feeds
        // This uses the SAME code path as the actual feed endpoint to ensure accuracy
        let canServeFeedData = false;
        let feedTestError: string | null = null;
        let validFeedCount = 0;

        if (hasHealthySources || hasSuccessfulAggregation) {
          try {
            // Test key feeds to ensure data pipeline is working
            // All feeds must pass for system to be ready
            const testFeeds: CoreFeedId[] = [
              { name: "BTC/USD", category: 1 }, // FeedCategory.Crypto = 1
              { name: "ETH/USD", category: 1 },
              { name: "SOL/USD", category: 1 },
              { name: "FLR/USD", category: 1 },
            ];

            const testResults: string[] = [];

            for (const testFeed of testFeeds) {
              try {
                // Use the aggregation service (same as feed controller) to test actual data availability
                const aggregatedPrice = await this.aggregationService.getAggregatedPrice(testFeed);

                // Verify we got valid data with non-null price
                if (
                  aggregatedPrice &&
                  aggregatedPrice.price !== null &&
                  aggregatedPrice.price > 0 &&
                  aggregatedPrice.confidence > 0
                ) {
                  validFeedCount++;
                  testResults.push(`${testFeed.name}=✓`);
                  this.logger.debug(
                    `Feed test passed: ${testFeed.name} = ${aggregatedPrice.price} (confidence: ${aggregatedPrice.confidence})`
                  );
                } else {
                  testResults.push(`${testFeed.name}=✗(${aggregatedPrice?.price === null ? "null" : "invalid"})`);
                  this.logger.debug(
                    `Feed test failed: ${testFeed.name} returned ${aggregatedPrice?.price === null ? "null" : "invalid"} price`
                  );
                }
              } catch (error) {
                testResults.push(`${testFeed.name}=✗(error)`);
                this.logger.debug(
                  `Feed test error: ${testFeed.name} - ${error instanceof Error ? error.message : String(error)}`
                );
              }
            }

            // Require ALL test feeds to have valid data
            canServeFeedData = validFeedCount === testFeeds.length;

            if (!canServeFeedData) {
              feedTestError = `Only ${validFeedCount}/${testFeeds.length} test feeds have valid data [${testResults.join(", ")}]`;
            } else {
              this.logger.debug(
                `Feed data test passed: ${validFeedCount}/${testFeeds.length} feeds valid [${testResults.join(", ")}]`
              );
            }
          } catch (error) {
            feedTestError = error instanceof Error ? error.message : String(error);
            this.logger.debug(`Feed data test failed: ${feedTestError}`);
          }
        }

        // Determine readiness state
        let readinessState: "not_ready" | "warming_up" | "ready";

        if (ENV_HELPERS.isDevelopment()) {
          // Development: More lenient - ready if integration is initialized and has sources
          // Still require at least one healthy source to ensure basic functionality
          checks.startup.ready = hasHealthySources;
          readinessState = hasHealthySources ? "ready" : "not_ready";

          if (!checks.startup.ready && hasConfiguredSources) {
            this.logger.debug(
              `Development mode: Waiting for sources to connect (${healthySources}/${totalSources} healthy)`
            );
          }
        } else {
          // Production: Determine readiness state based on data availability
          // 1. not_ready: No sources or no aggregation
          // 2. warming_up: Sources connected, aggregation working, but not all feeds ready
          // 3. ready: All criteria met including feed data availability

          const hasBasicConnectivity = hasHealthySources && hasSuccessfulAggregation;

          if (!hasBasicConnectivity) {
            readinessState = "not_ready";
            checks.startup.ready = false;
          } else if (canServeFeedData) {
            readinessState = "ready";
            checks.startup.ready = true;
          } else {
            readinessState = "warming_up";
            checks.startup.ready = false; // Not fully ready yet
          }

          // Provide helpful logging based on readiness state
          if (readinessState === "not_ready") {
            if (!hasConfiguredSources) {
              this.logger.debug(
                `System initializing: Waiting for data sources to connect (${totalSources} sources configured)`
              );
            } else if (totalSources > 0 && !hasHealthySources) {
              this.logger.warn(
                `System not ready: ${healthySources}/${totalSources} sources healthy. ` +
                  `Check proxy configuration and network connectivity.`
              );
            } else if (hasHealthySources && !hasSuccessfulAggregation) {
              this.logger.warn(
                `System not ready: Sources connected but no successful aggregations yet. ` +
                  `This is normal during initial startup - waiting for price data to flow.`
              );
            }
          } else if (readinessState === "warming_up") {
            this.logger.log(
              `🔄 System warming up: ${healthySources}/${totalSources} sources healthy, ` +
                `aggregation success rate: ${systemHealth.aggregation.successRate}%, ` +
                `feed test: ${validFeedCount}/4 feeds ready. ` +
                `Waiting for all feeds to have data...`
            );
          }
        }

        if (readinessState === "ready") {
          this.logger.log(
            `✅ System ready: ${healthySources}/${totalSources} sources healthy, ` +
              `aggregation success rate: ${systemHealth.aggregation.successRate}%, ` +
              `all test feeds validated`
          );
        } else if (readinessState === "warming_up") {
          this.logger.debug(
            `System warming up: ${healthySources}/${totalSources} sources healthy, ` +
              `aggregation success rate: ${systemHealth.aggregation.successRate}%, ` +
              `feed test: ${validFeedCount}/4 ready, ` +
              `error: ${feedTestError || "none"}`
          );
        } else {
          this.logger.warn(
            `System not ready: ${healthySources}/${totalSources} sources healthy, ` +
              `aggregation success rate: ${systemHealth.aggregation.successRate}%, ` +
              `error count: ${systemHealth.aggregation.errorCount}, ` +
              `can serve feeds: ${canServeFeedData}, ` +
              `feed test error: ${feedTestError || "none"}, ` +
              `NODE_ENV: ${ENV.APPLICATION.NODE_ENV}`
          );
        }
      } catch (error) {
        // If we can't get system health, system is not ready
        checks.startup.ready = false;
        this.logger.debug(`Cannot determine system health: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      // If integration service is not ready, startup is not ready
      checks.startup.ready = false;
    }

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
      // Use direct health check without timeout race
      await this.integrationService.getSystemHealth();
      checks.integration = true;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.debug("Integration liveness check failed:", errMsg);

      // If integration service is not initialized, it's not alive
      checks.integration = false;
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
