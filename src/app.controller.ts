import {
  Body,
  Controller,
  Param,
  DefaultValuePipe,
  ParseIntPipe,
  Post,
  Inject,
  Logger,
  Query,
  HttpException,
  HttpStatus,
  UseInterceptors,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { FtsoProviderService } from "@/app.service";
import {
  FeedValuesRequest,
  FeedValuesResponse,
  FeedVolumesResponse,
  RoundFeedValuesResponse,
  VolumesRequest,
} from "@/dto/provider-requests.dto";
import { RealTimeCacheService } from "@/cache/real-time-cache.service";
import { RealTimeAggregationService } from "@/aggregators/real-time-aggregation.service";
import { isValidFeedId } from "@/types/enhanced-feed-id.types";
import { ResponseTimeInterceptor } from "./interceptors/response-time.interceptor";
import { RateLimitGuard } from "./guards/rate-limit.guard";
import { ApiErrorHandlerService } from "./error-handling/api-error-handler.service";
import { ApiMonitorService } from "./monitoring/api-monitor.service";

@ApiTags("Production FTSO Feed Value Provider API")
@Controller()
@UseInterceptors(ResponseTimeInterceptor)
@UseGuards(RateLimitGuard)
export class FtsoProviderController {
  private logger = new Logger(FtsoProviderController.name);

  constructor(
    @Inject("FTSO_PROVIDER_SERVICE") private readonly providerService: FtsoProviderService,
    private readonly errorHandler: ApiErrorHandlerService,
    private readonly cacheService: RealTimeCacheService,
    private readonly aggregationService: RealTimeAggregationService,
    private readonly apiMonitor: ApiMonitorService
  ) {}

  @Post("feed-values/:votingRoundId")
  @ApiOperation({
    summary: "Get feed values for specific voting round",
    description: "Returns historical feed values for the specified voting round with enhanced caching and validation",
  })
  @ApiResponse({ status: 200, description: "Feed values retrieved successfully" })
  @ApiResponse({ status: 400, description: "Invalid voting round ID or feed request" })
  @ApiResponse({ status: 404, description: "Voting round not found" })
  @ApiResponse({ status: 500, description: "Internal server error" })
  async getFeedValues(
    @Param("votingRoundId", ParseIntPipe) votingRoundId: number,
    @Body() body: FeedValuesRequest
  ): Promise<RoundFeedValuesResponse> {
    const startTime = performance.now();
    const requestId = this.generateRequestId();

    // Log API request
    this.logApiRequest("POST", `/feed-values/${votingRoundId}`, body, requestId);

    try {
      // Validate voting round ID
      if (votingRoundId < 0) {
        const errorResponse = {
          error: "INVALID_VOTING_ROUND",
          code: 4003,
          message: "Voting round ID must be non-negative",
          timestamp: Date.now(),
          requestId,
        };

        // Log error response
        const responseTime = performance.now() - startTime;
        this.logApiResponse(
          "POST",
          `/feed-values/${votingRoundId}`,
          400,
          responseTime,
          this.calculateResponseSize(errorResponse),
          requestId
        );

        throw new HttpException(errorResponse, HttpStatus.BAD_REQUEST);
      }

      // Validate feed requests
      this.validateFeedRequest(body, requestId);

      // Try to get cached historical data first
      const cachedResults = await this.getCachedHistoricalData(body.feeds, votingRoundId);

      // Get fresh data for any missing feeds
      const missingFeeds = body.feeds.filter((_, index) => !cachedResults[index]);
      let freshData: any[] = [];

      if (missingFeeds.length > 0) {
        freshData = await this.providerService.getValues(missingFeeds);

        // Cache the fresh data for this voting round
        await this.cacheHistoricalData(missingFeeds, freshData, votingRoundId);
      }

      // Combine cached and fresh data
      const values = this.combineHistoricalResults(body.feeds, cachedResults, missingFeeds, freshData);

      const responseTime = performance.now() - startTime;
      const response = {
        votingRoundId,
        data: values,
      };

      // Log API response
      this.logApiResponse(
        "POST",
        `/feed-values/${votingRoundId}`,
        200,
        responseTime,
        this.calculateResponseSize(response),
        requestId
      );

      this.logger.log(
        `Feed values for voting round ${votingRoundId}: ${values.length} feeds, ${responseTime.toFixed(2)}ms`,
        { requestId, votingRoundId, feedCount: values.length, responseTime }
      );

      return response;
    } catch (error) {
      const responseTime = performance.now() - startTime;

      if (error instanceof HttpException) {
        // Already logged above
        throw error;
      }

      const errorResponse = {
        error: "INTERNAL_ERROR",
        code: 5001,
        message: "Failed to retrieve feed values for voting round",
        timestamp: Date.now(),
        requestId,
      };

      // Log error response
      this.logApiResponse(
        "POST",
        `/feed-values/${votingRoundId}`,
        500,
        responseTime,
        this.calculateResponseSize(errorResponse),
        requestId
      );

      this.logger.error(
        `Error getting feed values for voting round ${votingRoundId} (${responseTime.toFixed(2)}ms):`,
        error,
        { requestId, votingRoundId, responseTime }
      );

      throw new HttpException(errorResponse, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post("feed-values/")
  @ApiOperation({
    summary: "Get current feed values",
    description: "Returns real-time feed values with sub-100ms response time and 1-second cache TTL",
  })
  @ApiResponse({ status: 200, description: "Current feed values retrieved successfully" })
  @ApiResponse({ status: 400, description: "Invalid feed request" })
  @ApiResponse({ status: 500, description: "Internal server error" })
  async getCurrentFeedValues(@Body() body: FeedValuesRequest): Promise<FeedValuesResponse> {
    const startTime = performance.now();
    const requestId = this.generateRequestId();

    // Log API request
    this.logApiRequest("POST", "/feed-values/", body, requestId);

    try {
      // Validate feed requests
      this.validateFeedRequest(body, requestId);

      // Get real-time data with caching
      const values = await this.getRealTimeFeedValues(body.feeds);

      const responseTime = performance.now() - startTime;
      const response = {
        data: values,
      };

      // Log API response
      this.logApiResponse("POST", "/feed-values/", 200, responseTime, this.calculateResponseSize(response), requestId);

      this.logger.log(`Current feed values: ${values.length} feeds, ${responseTime.toFixed(2)}ms`, {
        requestId,
        feedCount: values.length,
        responseTime,
      });

      return response;
    } catch (error) {
      const responseTime = performance.now() - startTime;

      if (error instanceof HttpException) {
        // Already logged in validation methods
        throw error;
      }

      const errorResponse = {
        error: "INTERNAL_ERROR",
        code: 5001,
        message: "Failed to retrieve current feed values",
        timestamp: Date.now(),
        requestId,
      };

      // Log error response
      this.logApiResponse(
        "POST",
        "/feed-values/",
        500,
        responseTime,
        this.calculateResponseSize(errorResponse),
        requestId
      );

      this.logger.error(`Error getting current feed values (${responseTime.toFixed(2)}ms):`, error, {
        requestId,
        responseTime,
        feedCount: body?.feeds?.length || 0,
      });

      throw new HttpException(errorResponse, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post("volumes/")
  @ApiOperation({
    summary: "Get feed volumes",
    description: "Returns volume data with USDT to USD conversion and optimized CCXT volume processing",
  })
  @ApiResponse({ status: 200, description: "Feed volumes retrieved successfully" })
  @ApiResponse({ status: 400, description: "Invalid volume request or time window" })
  @ApiResponse({ status: 500, description: "Internal server error" })
  async getFeedVolumes(
    @Body() body: VolumesRequest,
    @Query("window", new DefaultValuePipe("60"), ParseIntPipe) windowSec: number
  ): Promise<FeedVolumesResponse> {
    const startTime = performance.now();
    const requestId = this.generateRequestId();

    // Log API request
    this.logApiRequest("POST", `/volumes/?window=${windowSec}`, body, requestId);

    try {
      // Validate volume request
      this.validateVolumeRequest(body, windowSec, requestId);

      // Get volumes with USDT conversion using existing CCXT processing
      const values = await this.getOptimizedVolumes(body.feeds, windowSec);

      const responseTime = performance.now() - startTime;
      const response = {
        data: values,
      };

      // Log API response
      this.logApiResponse(
        "POST",
        `/volumes/?window=${windowSec}`,
        200,
        responseTime,
        this.calculateResponseSize(response),
        requestId
      );

      this.logger.log(
        `Feed volumes for last ${windowSec} seconds: ${values.length} feeds, ${responseTime.toFixed(2)}ms`,
        {
          requestId,
          windowSec,
          feedCount: values.length,
          responseTime,
        }
      );

      return response;
    } catch (error) {
      const responseTime = performance.now() - startTime;

      if (error instanceof HttpException) {
        // Already logged in validation methods
        throw error;
      }

      const errorResponse = {
        error: "INTERNAL_ERROR",
        code: 5001,
        message: "Failed to retrieve feed volumes",
        timestamp: Date.now(),
        requestId,
      };

      // Log error response
      this.logApiResponse(
        "POST",
        `/volumes/?window=${windowSec}`,
        500,
        responseTime,
        this.calculateResponseSize(errorResponse),
        requestId
      );

      this.logger.error(`Error getting feed volumes (${responseTime.toFixed(2)}ms):`, error, {
        requestId,
        windowSec,
        feedCount: body?.feeds?.length || 0,
        responseTime,
      });

      throw new HttpException(errorResponse, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // Private helper methods

  private validateFeedRequest(body: FeedValuesRequest, requestId?: string): void {
    const reqId = requestId || this.generateRequestId();

    if (!body || !Array.isArray(body.feeds) || body.feeds.length === 0) {
      const errorResponse = {
        error: "INVALID_FEED_REQUEST",
        code: 4000,
        message: "Request must contain a non-empty feeds array",
        timestamp: Date.now(),
        requestId: reqId,
      };

      this.logger.warn("Invalid feed request: missing or empty feeds array", {
        requestId: reqId,
        body: this.sanitizeRequestBody(body),
      });

      throw new HttpException(errorResponse, HttpStatus.BAD_REQUEST);
    }

    // Check feed count limits
    if (body.feeds.length > 100) {
      const errorResponse = {
        error: "TOO_MANY_FEEDS",
        code: 4002,
        message: `Too many feeds requested: ${body.feeds.length}. Maximum allowed: 100`,
        timestamp: Date.now(),
        requestId: reqId,
      };

      this.logger.warn(`Too many feeds requested: ${body.feeds.length}`, {
        requestId: reqId,
        feedCount: body.feeds.length,
      });

      throw new HttpException(errorResponse, HttpStatus.BAD_REQUEST);
    }

    // Validate each feed ID
    const invalidFeeds = [];
    for (let i = 0; i < body.feeds.length; i++) {
      const feed = body.feeds[i];
      if (!isValidFeedId(feed)) {
        invalidFeeds.push({ index: i, feed });
      }
    }

    if (invalidFeeds.length > 0) {
      const errorResponse = {
        error: "INVALID_FEED_ID",
        code: 4001,
        message: `Invalid feed IDs found: ${invalidFeeds.length} out of ${body.feeds.length}`,
        timestamp: Date.now(),
        requestId: reqId,
        invalidFeeds: invalidFeeds.slice(0, 5), // Limit to first 5 for response size
      };

      this.logger.warn(`Invalid feed IDs in request`, {
        requestId: reqId,
        invalidCount: invalidFeeds.length,
        totalCount: body.feeds.length,
        invalidFeeds: invalidFeeds.slice(0, 10), // Log up to 10 for debugging
      });

      throw new HttpException(errorResponse, HttpStatus.BAD_REQUEST);
    }
  }

  private validateVolumeRequest(body: VolumesRequest, windowSec: number, requestId?: string): void {
    const reqId = requestId || this.generateRequestId();

    // First validate the feed request
    this.validateFeedRequest(body, reqId);

    // Validate time window
    if (windowSec <= 0 || windowSec > 3600) {
      const errorResponse = {
        error: "INVALID_TIME_WINDOW",
        code: 4004,
        message: "Time window must be between 1 and 3600 seconds",
        timestamp: Date.now(),
        requestId: reqId,
        providedWindow: windowSec,
        allowedRange: { min: 1, max: 3600 },
      };

      this.logger.warn(`Invalid time window: ${windowSec}`, {
        requestId: reqId,
        windowSec,
        allowedRange: { min: 1, max: 3600 },
      });

      throw new HttpException(errorResponse, HttpStatus.BAD_REQUEST);
    }

    // Log valid volume request
    this.logger.debug(`Volume request validated`, {
      requestId: reqId,
      feedCount: body.feeds.length,
      windowSec,
    });
  }

  private async getRealTimeFeedValues(feeds: any[]): Promise<any[]> {
    const results = [];
    const startTime = performance.now();

    // Process feeds in parallel for better performance
    const feedPromises = feeds.map(async feed => {
      const feedStartTime = performance.now();

      try {
        // Check cache first (1-second TTL)
        const cachedPrice = this.cacheService.getPrice(feed);

        if (cachedPrice && this.isFreshData(cachedPrice.timestamp)) {
          const responseTime = performance.now() - feedStartTime;
          this.logger.debug(`Cache hit for ${feed.name}: ${responseTime.toFixed(2)}ms`);

          return {
            feed,
            value: cachedPrice.value,
            source: "cache",
            timestamp: cachedPrice.timestamp,
            confidence: cachedPrice.confidence,
          };
        }

        // Get fresh aggregated price
        const aggregatedPrice = await this.aggregationService.getAggregatedPrice(feed);

        if (aggregatedPrice) {
          const result = {
            feed,
            value: aggregatedPrice.price,
            source: "aggregated",
            timestamp: aggregatedPrice.timestamp,
            confidence: aggregatedPrice.confidence,
          };

          // Cache the fresh data
          this.cacheService.setPrice(feed, {
            value: aggregatedPrice.price,
            timestamp: aggregatedPrice.timestamp,
            sources: aggregatedPrice.sources,
            confidence: aggregatedPrice.confidence,
          });

          const responseTime = performance.now() - feedStartTime;
          this.logger.debug(`Aggregated price for ${feed.name}: ${responseTime.toFixed(2)}ms`);

          return result;
        } else {
          // Fallback to provider service
          const fallbackResult = await this.providerService.getValue(feed);
          const responseTime = performance.now() - feedStartTime;
          this.logger.debug(`Fallback service for ${feed.name}: ${responseTime.toFixed(2)}ms`);

          return {
            ...fallbackResult,
            source: "fallback",
            timestamp: Date.now(),
            confidence: 0.8, // Lower confidence for fallback data
          };
        }
      } catch (error) {
        const responseTime = performance.now() - feedStartTime;
        this.logger.error(
          `Error getting real-time value for feed ${JSON.stringify(feed)} (${responseTime.toFixed(2)}ms):`,
          error
        );

        // Fallback to provider service
        try {
          const fallbackResult = await this.providerService.getValue(feed);
          this.logger.warn(`Used fallback service for failed feed ${feed.name}`);

          return {
            ...fallbackResult,
            source: "fallback_error",
            timestamp: Date.now(),
            confidence: 0.6, // Even lower confidence for error fallback
          };
        } catch (fallbackError) {
          this.logger.error(`Fallback also failed for feed ${JSON.stringify(feed)}:`, fallbackError);

          // Return error result instead of throwing to allow partial success
          return {
            feed,
            error: {
              code: "FEED_NOT_FOUND",
              message: `Unable to retrieve data for feed: ${JSON.stringify(feed)}`,
              timestamp: Date.now(),
            },
          };
        }
      }
    });

    try {
      const feedResults = await Promise.allSettled(feedPromises);

      // Process results and separate successful from failed
      const successfulResults = [];
      const failedFeeds = [];

      feedResults.forEach((result, index) => {
        if (result.status === "fulfilled") {
          if (result.value.error) {
            failedFeeds.push({ feed: feeds[index], error: result.value.error });
          } else {
            successfulResults.push(result.value);
          }
        } else {
          failedFeeds.push({
            feed: feeds[index],
            error: {
              code: "PROCESSING_ERROR",
              message: result.reason?.message || "Unknown error processing feed",
              timestamp: Date.now(),
            },
          });
        }
      });

      // Log performance metrics
      const totalResponseTime = performance.now() - startTime;
      this.logger.log(
        `Processed ${feeds.length} feeds in ${totalResponseTime.toFixed(2)}ms (${successfulResults.length} successful, ${failedFeeds.length} failed)`
      );

      // If all feeds failed, throw an error
      if (successfulResults.length === 0) {
        throw new HttpException(
          {
            error: "ALL_FEEDS_FAILED",
            code: 5002,
            message: "Unable to retrieve data for any requested feeds",
            timestamp: Date.now(),
            requestId: this.generateRequestId(),
            failedFeeds: failedFeeds,
          },
          HttpStatus.SERVICE_UNAVAILABLE
        );
      }

      // If some feeds failed, log warning but return successful results
      if (failedFeeds.length > 0) {
        this.logger.warn(`${failedFeeds.length} out of ${feeds.length} feeds failed to retrieve data`, {
          failedFeeds: failedFeeds.map(f => f.feed.name),
        });
      }

      return successfulResults;
    } catch (error) {
      const totalResponseTime = performance.now() - startTime;
      this.logger.error(`Critical error processing feeds (${totalResponseTime.toFixed(2)}ms):`, error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          error: "FEED_PROCESSING_ERROR",
          code: 5003,
          message: "Critical error occurred while processing feed requests",
          timestamp: Date.now(),
          requestId: this.generateRequestId(),
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  private async getCachedHistoricalData(feeds: any[], votingRoundId: number): Promise<(any | null)[]> {
    const results = [];

    for (const feed of feeds) {
      const cachedEntry = this.cacheService.getForVotingRound(feed, votingRoundId);

      if (cachedEntry) {
        results.push({
          feed,
          value: cachedEntry.value,
        });
      } else {
        results.push(null);
      }
    }

    return results;
  }

  private async cacheHistoricalData(feeds: any[], data: any[], votingRoundId: number): Promise<void> {
    for (let i = 0; i < feeds.length; i++) {
      const feed = feeds[i];
      const feedData = data[i];

      if (feedData) {
        this.cacheService.setForVotingRound(
          feed,
          votingRoundId,
          {
            value: feedData.value,
            timestamp: Date.now(),
            sources: ["historical"],
            confidence: 1.0,
            votingRound: votingRoundId,
          },
          60000 // 1 minute TTL for historical data
        );
      }
    }
  }

  private combineHistoricalResults(
    allFeeds: any[],
    cachedResults: (any | null)[],
    missingFeeds: any[],
    freshData: any[]
  ): any[] {
    const results = [];
    let freshIndex = 0;

    for (let i = 0; i < allFeeds.length; i++) {
      if (cachedResults[i]) {
        results.push(cachedResults[i]);
      } else {
        results.push(freshData[freshIndex]);
        freshIndex++;
      }
    }

    return results;
  }

  private async getOptimizedVolumes(feeds: any[], windowSec: number): Promise<any[]> {
    // Use existing CCXT volume processing with USDT conversion
    return await this.providerService.getVolumes(feeds, windowSec);
  }

  private isFreshData(timestamp: number): boolean {
    const age = Date.now() - timestamp;
    return age <= 2000; // 2-second freshness requirement
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
  async healthCheck(): Promise<any> {
    const startTime = performance.now();
    const requestId = this.generateRequestId();

    try {
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

      const responseTime = performance.now() - startTime;

      const response = {
        status: overallStatus,
        timestamp: Date.now(),
        version: "1.0.0",
        uptime: process.uptime(),
        responseTime: Math.round(responseTime),
        memory: {
          used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024), // MB
          total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024), // MB
          external: Math.round(process.memoryUsage().external / 1024 / 1024), // MB
          rss: Math.round(process.memoryUsage().rss / 1024 / 1024), // MB
        },
        components,
        details: {
          requestId,
          environment: process.env.NODE_ENV || "development",
          nodeVersion: process.version,
          platform: process.platform,
          pid: process.pid,
        },
      };

      // Log health check performance
      this.logger.log(`Health check completed in ${responseTime.toFixed(2)}ms - Status: ${overallStatus}`, {
        requestId,
        status: overallStatus,
        responseTime,
        componentStatuses,
      });

      // Log performance warning if health check is slow
      if (responseTime > 1000) {
        this.logger.warn(`Health check response time ${responseTime.toFixed(2)}ms exceeded 1s threshold`, {
          requestId,
          responseTime,
        });
      }

      if (overallStatus === "unhealthy") {
        throw new HttpException(response, HttpStatus.SERVICE_UNAVAILABLE);
      }

      return response;
    } catch (error) {
      const responseTime = performance.now() - startTime;
      this.logger.error(`Health check failed in ${responseTime.toFixed(2)}ms:`, error, { requestId });

      if (error instanceof HttpException) {
        throw error;
      }

      const errorResponse = {
        status: "unhealthy",
        timestamp: Date.now(),
        responseTime: Math.round(responseTime),
        error: "Health check failed",
        details: {
          error: error.message,
          requestId,
          stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
        },
      };

      throw new HttpException(errorResponse, HttpStatus.SERVICE_UNAVAILABLE);
    }
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
  async getApiMetrics(): Promise<any> {
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

  private generateRequestId(): string {
    return this.errorHandler.generateRequestId();
  }

  // Enhanced logging and monitoring methods
  private logApiRequest(method: string, url: string, body?: any, requestId?: string): void {
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
    error?: string
  ): void {
    // Record metrics in API monitor
    this.apiMonitor.recordApiRequest({
      endpoint: url,
      method,
      statusCode,
      responseTime,
      responseSize,
      timestamp: Date.now(),
      requestId,
      error,
    });

    // Log via error handler
    this.errorHandler.logApiCall(method, url, responseTime, statusCode, requestId);

    // Additional detailed logging
    this.logger.log(
      `API Response: ${method} ${url} - ${statusCode} - ${responseTime.toFixed(2)}ms - ${responseSize} bytes`,
      {
        requestId,
        method,
        url,
        statusCode,
        responseTime,
        responseSize,
        timestamp: Date.now(),
      }
    );

    // Log performance warnings
    this.errorHandler.logPerformanceWarning(`${method} ${url}`, responseTime, 100, requestId);
  }

  private sanitizeRequestBody(body: any): any {
    if (!body) return body;

    // Remove sensitive information from logs
    const sanitized = { ...body };

    // Remove any potential API keys or sensitive data
    if (sanitized.apiKey) sanitized.apiKey = "[REDACTED]";
    if (sanitized.secret) sanitized.secret = "[REDACTED]";
    if (sanitized.password) sanitized.password = "[REDACTED]";

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
