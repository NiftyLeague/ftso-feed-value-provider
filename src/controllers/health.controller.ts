import { Controller, Get, HttpException, HttpStatus, Inject } from "@nestjs/common";
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
import { RateLimiterService } from "@/common/rate-limiting/rate-limiter.service";
import { ApiMonitorService } from "@/monitoring/api-monitor.service";

import type {
  DetailedHealthResponse,
  ReadinessResponse,
  LivenessResponse,
  ReadinessChecks,
  LivenessChecks,
  ReadinessDiagnostics,
  HealthStatusType,
} from "@/common/types/monitoring";
import type { CoreFeedId } from "@/common/types/core";
import {
  HealthCheckResponseDto,
  ReadinessResponseDto,
  LivenessResponseDto,
  HttpErrorResponseDto,
  healthApiModels,
} from "./dto";

// Create a composed base class with event and lifecycle capabilities
const EventDrivenController = WithLifecycle(WithEvents(BaseController));

@ApiTags("System Health")
@Controller()
@ApiExtraModels(...healthApiModels)
// Note: Health endpoints should NOT be rate limited - they're used by orchestration systems
export class HealthController extends EventDrivenController {
  private readyTime: number | null = null;
  private integrationServiceReady = false;
  private isInitializingStartup = true;

  constructor(
    @Inject("FTSO_PROVIDER_SERVICE") private readonly providerService: FtsoProviderService,
    private readonly integrationService: IntegrationService,
    private readonly cacheService: RealTimeCacheService,
    private readonly aggregationService: RealTimeAggregationService,
    private readonly rateLimiterService: RateLimiterService,
    private readonly apiMonitorService: ApiMonitorService,
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

  @Get("health")
  @ApiOperation({
    summary: "System health check",
    description: "Returns a health status summary of the full system.",
  })
  @ApiResponse({
    status: 200,
    description: "System status retrieved.",
    schema: {
      properties: {
        status: { type: "string", example: "healthy" },
        timestamp: { type: "number", example: 1678886400000 },
      },
    },
  })
  @ApiResponse({
    status: 503,
    description: "System is unhealthy",
    type: HttpErrorResponseDto,
  })
  async getHealth(): Promise<{ status: HealthStatusType; timestamp: number }> {
    const detailedHealth = await this.getDetailedHealth();

    if (detailedHealth.status === "unhealthy") {
      throw new HttpException(
        { status: detailedHealth.status, timestamp: detailedHealth.timestamp },
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }

    return {
      status: detailedHealth.status,
      timestamp: detailedHealth.timestamp,
    };
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
      // Get comprehensive system health and performance metrics
      const [
        systemHealth,
        performanceMetrics,
        { checks: readinessChecks, diagnostics: readinessDiagnostics },
        livenessChecks,
      ] = await Promise.all([
        this.integrationService.getSystemHealth(),
        this.providerService.getPerformanceMetrics(),
        this.performReadinessChecks(),
        this.performLivenessChecks(),
      ]);

      const apiHealthMetrics = this.apiMonitorService.getApiHealthMetrics();
      const apiErrorAnalysis = this.apiMonitorService.getErrorAnalysis();
      const rateLimitStats = this.rateLimiterService.getStats();
      const rateLimitConfig = this.rateLimiterService.getRateLimitConfig();
      const retryStats = this.universalRetryService!.getRetryStatistics();
      const errorStats = this.standardizedErrorHandler!.getErrorStatistics();

      // Get adapter stats
      const adapterStats = this.integrationService.getAdapterStats();

      // Get cache statistics
      const realTimeCacheStats = this.cacheService.getStats();
      const aggregationCacheStats = this.aggregationService.getCacheStats();

      // Build components health status
      // Adjusted thresholds to be more realistic for production:
      // - API unhealthy: >30% error rate or >10% critical requests (was 20% / 5%)
      // - API degraded: >10% error rate or >30% slow requests (was 5% / 20%)
      const apiStatus: HealthStatusType =
        apiHealthMetrics.errorRate > 30 || apiHealthMetrics.criticalRequestRate > 10
          ? "unhealthy"
          : apiHealthMetrics.errorRate > 10 || apiHealthMetrics.slowRequestRate > 30
            ? "degraded"
            : "healthy";

      const rateLimiterStatus: HealthStatusType = rateLimitStats.hitRate < 0.8 ? "degraded" : "healthy";

      const retryStatsValues = Object.values(retryStats);
      // Adjusted: allows some retry failures, only unhealthy if >20 total failures
      const totalFailedRetries = retryStatsValues.reduce((sum, stat) => sum + stat.failedRetries, 0);
      const retryStatus: HealthStatusType =
        totalFailedRetries > 20 ? "unhealthy" : totalFailedRetries > 5 ? "degraded" : "healthy";

      const errorStatsValues = Object.values(errorStats);
      const errorHandlingStatus: HealthStatusType = errorStatsValues.some(stat => stat.consecutiveFailures > 10)
        ? "unhealthy"
        : errorStatsValues.some(stat => stat.consecutiveFailures > 0)
          ? "degraded"
          : "healthy";

      const components = {
        provider: {
          status: systemHealth.status,
          details: {
            ...systemHealth, // DetailedSystemHealthMetrics
            providerUptime: performanceMetrics.uptime,
            providerResponseTime: performanceMetrics.responseTime,
            providerRequestsPerSecond: performanceMetrics.requestsPerSecond,
            providerErrorRate: performanceMetrics.errorRate,
            providerCacheStats: performanceMetrics.cacheStats,
            providerAggregationStats: performanceMetrics.aggregationStats,
            activeFeedCount: performanceMetrics.activeFeedCount,
          },
        },
        cache: (() => {
          const cacheHealth = this.cacheService.getCacheHealthStatus();
          return {
            status: cacheHealth.status,
            details: {
              ...realTimeCacheStats,
              ...cacheHealth.metrics,
              healthReason: cacheHealth.reason,
            },
          };
        })(),
        aggregation: {
          status: aggregationCacheStats.totalEntries > 0 ? "healthy" : "degraded",
          details: aggregationCacheStats,
        },
        integration: {
          // Adjusted: allows up to 10% inactive adapters to be healthy (was requiring 100%)
          status: (() => {
            const activeRatio = adapterStats.total > 0 ? adapterStats.active / adapterStats.total : 0;
            return activeRatio >= 0.9 ? "healthy" : activeRatio >= 0.7 ? "degraded" : "unhealthy";
          })(),
          details: {
            ...adapterStats,
            activeRatio: `${adapterStats.total > 0 ? ((adapterStats.active / adapterStats.total) * 100).toFixed(1) : 0}%`,
          },
        },
        performance: {
          status: "healthy",
          details: {
            system: {
              cpu: 0, // Placeholder, actual CPU usage would need OS-level monitoring
              memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
              uptime: process.uptime(),
            },
            application: {
              responseTime: performanceMetrics.responseTime.average,
              throughput: performanceMetrics.requestsPerSecond,
              errorRate: performanceMetrics.errorRate,
              cacheHitRate: realTimeCacheStats.hitRate,
            },
            feeds: {
              active: performanceMetrics.activeFeedCount,
              total: performanceMetrics.activeFeedCount, // Assuming all active are total for now
              aggregations: aggregationCacheStats.totalEntries, // Approximation
            },
          },
        },
        api: {
          status: apiStatus,
          details: {
            ...apiHealthMetrics,
            errorAnalysis: apiErrorAnalysis,
          },
        },
        rateLimiter: {
          status: rateLimiterStatus,
          details: {
            stats: rateLimitStats,
            config: rateLimitConfig,
          },
        },
        retries: {
          status: retryStatus,
          details: retryStats,
        },
        errorHandling: {
          status: errorHandlingStatus,
          details: errorStats,
        },
      };

      // Determine overall health
      const componentStatuses = Object.values(components).map(c => c.status);
      const unhealthyCount = componentStatuses.filter(s => s === "unhealthy").length;
      const degradedCount = componentStatuses.filter(s => s === "degraded").length;

      let overallStatus: HealthStatusType;
      if (unhealthyCount > 0) {
        overallStatus = "unhealthy";
      } else if (degradedCount > 0) {
        overallStatus = "degraded";
      } else {
        overallStatus = "healthy";
      }

      // Build the final detailed response
      return {
        status: overallStatus,
        timestamp: Date.now(),
        uptime: process.uptime(),
        version: ENV.APPLICATION.VERSION,
        memory: {
          used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024), // MB
          total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024), // MB
          external: Math.round(process.memoryUsage().external / 1024 / 1024), // MB
          rss: Math.round(process.memoryUsage().rss / 1024 / 1024), // MB
        },
        details: {
          environment: ENV.APPLICATION.NODE_ENV,
          nodeVersion: process.version,
          platform: process.platform,
          pid: process.pid,
        },
        components: components,
        startup: {
          initialized: !this.isInitializingStartup,
          startTime: this.startupTime,
          readyTime: this.readyTime ?? null,
        },
        probes: {
          liveness: livenessChecks,
          readiness: readinessChecks,
        },
        readinessDiagnostics: readinessDiagnostics,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack : undefined;
      this.logger.error("Detailed health check failed:", errMsg);

      // Fall back to an unhealthy response instead of propagating a 500 to callers
      // so that health endpoints remain debuggable even when dependencies error.
      const fallback: DetailedHealthResponse = {
        status: "unhealthy",
        timestamp: Date.now(),
        uptime: process.uptime(),
        version: ENV.APPLICATION.VERSION,
        memory: {
          used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
          external: Math.round(process.memoryUsage().external / 1024 / 1024),
          rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
        },
        details: {
          environment: ENV.APPLICATION.NODE_ENV,
          nodeVersion: process.version,
          platform: process.platform,
          pid: process.pid,
          error: errMsg,
          stack: ENV_HELPERS.isDevelopment() || ENV_HELPERS.isTest() ? errStack : undefined,
        },
        components: {
          provider: { status: "unhealthy", details: { error: errMsg } },
          cache: { status: "unhealthy", details: { error: errMsg } },
          aggregation: { status: "unhealthy", details: { error: errMsg } },
          integration: { status: "unhealthy", details: { error: errMsg } },
          performance: { status: "unhealthy", details: { error: errMsg } },
          api: { status: "unhealthy", details: { error: errMsg } },
          rateLimiter: { status: "unhealthy", details: { error: errMsg } },
          retries: { status: "unhealthy", details: { error: errMsg } },
          errorHandling: { status: "unhealthy", details: { error: errMsg } },
        },
        startup: {
          initialized: !this.isInitializingStartup,
          startTime: this.startupTime,
          readyTime: this.readyTime ?? null,
        },
        probes: {
          liveness: {
            integration: false,
            provider: false,
            memory: false,
            responseTime: 0,
          },
          readiness: {
            integration: { ready: false, status: "unhealthy", error: errMsg },
            provider: { ready: false, status: "unhealthy", error: errMsg },
            startup: { ready: false },
          },
        },
        readinessDiagnostics: {
          healthySources: 0,
          totalSources: 0,
          aggregationSuccessRate: 0,
          canServeFeedData: false,
          state: "not_ready",
          validFeedCount: 0,
          totalTestFeeds: 0,
        },
      };

      return fallback;
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
      const { checks, diagnostics } = await this.performReadinessChecks();
      // System is ready if all critical checks pass
      const isReady = checks.integration.ready && checks.provider.ready && checks.startup.ready;

      // Determine overall status
      const overallStatus = isReady
        ? checks.integration.status === "healthy" && checks.provider.status === "healthy"
          ? "healthy"
          : "degraded"
        : "unhealthy";

      const response: ReadinessResponse = {
        ready: isReady,
        status: overallStatus,
        timestamp: Date.now(),
        responseTime: Date.now() - startTime,
        uptime: process.uptime(), // Added uptime
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
        throw new HttpException(
          {
            ready: false,
            status: overallStatus,
            statusCode: HttpStatus.SERVICE_UNAVAILABLE,
            error: "Service Unavailable",
            message: errorMessage,
            timestamp: Date.now(),
            path: "/health/ready",
            details: {
              integration: checks.integration.status,
              provider: checks.provider.status,
              startup: checks.startup.ready ? "ready" : "not ready",
              diagnostics: diagnostics,
            },
          },
          HttpStatus.SERVICE_UNAVAILABLE
        );
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
      const errStack = error instanceof Error ? error.stack : undefined;
      const errorContext = {
        error: errMsg,
        stack: errStack,
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

      // Fallback error response
      throw new HttpException(
        {
          ready: false,
          status: "unhealthy",
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          error: "Service Unavailable",
          message: `Readiness check failed: ${errMsg}`,
          timestamp: Date.now(),
          path: "/health/ready",
          details: {
            ready: false,
            // Include relevant context from errorContext or default values
            startupTime: errorContext.startupTime,
            readyTime: errorContext.readyTime,
            isInitializing: errorContext.isInitializing,
            reason: errMsg,
            stack: ENV_HELPERS.isDevelopment() ? errStack : undefined,
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
        status: isAlive ? "alive" : "dead",
        timestamp: Date.now(),
        uptime: process.uptime(),
        checks: livenessChecks,
      };

      if (!isAlive) {
        const errorMessage = `Liveness check failed - System is not alive`;
        const errorResponse = {
          ...response,
          status: "dead",
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
        status: "dead",
        timestamp: Date.now(),
        uptime: process.uptime(),
        checks: {
          integration: false,
          provider: false,
          memory: false,
          responseTime: 0,
        },
      };

      const enhancedErrorResponse = {
        ...resp,
        status: "dead",
        message: `Liveness check failed: ${errMsg}`,
        error: errMsg,
      };

      throw new HttpException(enhancedErrorResponse, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  // Helper methods

  private async performReadinessChecks(): Promise<{ checks: ReadinessChecks; diagnostics: ReadinessDiagnostics }> {
    const checks: ReadinessChecks = {
      integration: { ready: false, status: "unhealthy", error: null },
      provider: { ready: false, status: "unhealthy", error: null },
      startup: { ready: false },
    };

    let diagnostics: ReadinessDiagnostics = {
      healthySources: 0,
      totalSources: 0,
      aggregationSuccessRate: 0,
      canServeFeedData: false,
      state: "not_ready",
      validFeedCount: 0,
      totalTestFeeds: 4, // BTC, ETH, SOL, FLR
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

        // Populate diagnostics
        diagnostics.healthySources = healthySources;
        diagnostics.totalSources = totalSources;
        diagnostics.aggregationSuccessRate = systemHealth.aggregation.successRate;

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

        diagnostics.totalTestFeeds = 4; // Always 4 for BTC, ETH, SOL, FLR

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
            diagnostics.canServeFeedData = canServeFeedData;
            diagnostics.validFeedCount = validFeedCount;

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
        diagnostics.state = readinessState;

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

    return { checks, diagnostics };
  }

  private async performLivenessChecks(): Promise<LivenessChecks> {
    const checks: LivenessChecks = {
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
