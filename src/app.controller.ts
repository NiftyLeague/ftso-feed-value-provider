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

@ApiTags("Production FTSO Feed Value Provider API")
@Controller()
@UseInterceptors(ResponseTimeInterceptor)
@UseGuards(RateLimitGuard)
export class FtsoProviderController {
  private logger = new Logger(FtsoProviderController.name);

  constructor(
    @Inject("FTSO_PROVIDER_SERVICE") private readonly providerService: FtsoProviderService,
    private readonly cacheService: RealTimeCacheService,
    private readonly aggregationService: RealTimeAggregationService,
    private readonly errorHandler: ApiErrorHandlerService
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

    try {
      // Validate voting round ID
      if (votingRoundId < 0) {
        throw new HttpException(
          {
            error: "INVALID_VOTING_ROUND",
            code: 4003,
            message: "Voting round ID must be non-negative",
            timestamp: Date.now(),
            requestId: this.generateRequestId(),
          },
          HttpStatus.BAD_REQUEST
        );
      }

      // Validate feed requests
      this.validateFeedRequest(body);

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

      this.logger.log(
        `Feed values for voting round ${votingRoundId}: ${values.length} feeds, ${responseTime.toFixed(2)}ms`
      );

      // Log performance warning if exceeding target
      if (responseTime > 100) {
        this.logger.warn(
          `Historical feed values response time ${responseTime.toFixed(2)}ms exceeded 100ms target for voting round ${votingRoundId}`
        );
      }

      return {
        votingRoundId,
        data: values,
      };
    } catch (error) {
      const responseTime = performance.now() - startTime;
      this.logger.error(
        `Error getting feed values for voting round ${votingRoundId} (${responseTime.toFixed(2)}ms):`,
        error
      );

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          error: "INTERNAL_ERROR",
          code: 5001,
          message: "Failed to retrieve feed values for voting round",
          timestamp: Date.now(),
          requestId: this.generateRequestId(),
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
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

    try {
      // Validate feed requests
      this.validateFeedRequest(body);

      // Get real-time data with caching
      const values = await this.getRealTimeFeedValues(body.feeds);

      const responseTime = performance.now() - startTime;

      this.logger.log(`Current feed values: ${values.length} feeds, ${responseTime.toFixed(2)}ms`);

      // Log performance warning if exceeding target
      if (responseTime > 100) {
        this.logger.warn(`Current feed values response time ${responseTime.toFixed(2)}ms exceeded 100ms target`);
      }

      return {
        data: values,
      };
    } catch (error) {
      const responseTime = performance.now() - startTime;
      this.logger.error(`Error getting current feed values (${responseTime.toFixed(2)}ms):`, error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          error: "INTERNAL_ERROR",
          code: 5001,
          message: "Failed to retrieve current feed values",
          timestamp: Date.now(),
          requestId: this.generateRequestId(),
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
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

    try {
      // Validate volume request
      this.validateVolumeRequest(body, windowSec);

      // Get volumes with USDT conversion using existing CCXT processing
      const values = await this.getOptimizedVolumes(body.feeds, windowSec);

      const responseTime = performance.now() - startTime;

      this.logger.log(
        `Feed volumes for last ${windowSec} seconds: ${values.length} feeds, ${responseTime.toFixed(2)}ms`
      );

      // Log performance warning if exceeding target
      if (responseTime > 100) {
        this.logger.warn(
          `Volume response time ${responseTime.toFixed(2)}ms exceeded 100ms target for ${windowSec}s window`
        );
      }

      return {
        data: values,
      };
    } catch (error) {
      const responseTime = performance.now() - startTime;
      this.logger.error(`Error getting feed volumes (${responseTime.toFixed(2)}ms):`, error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          error: "INTERNAL_ERROR",
          code: 5001,
          message: "Failed to retrieve feed volumes",
          timestamp: Date.now(),
          requestId: this.generateRequestId(),
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  // Private helper methods

  private validateFeedRequest(body: FeedValuesRequest): void {
    if (!body || !Array.isArray(body.feeds) || body.feeds.length === 0) {
      throw new HttpException(
        {
          error: "INVALID_FEED_REQUEST",
          code: 4000,
          message: "Request must contain a non-empty feeds array",
          timestamp: Date.now(),
          requestId: this.generateRequestId(),
        },
        HttpStatus.BAD_REQUEST
      );
    }

    // Validate each feed ID
    for (const feed of body.feeds) {
      if (!isValidFeedId(feed)) {
        throw new HttpException(
          {
            error: "INVALID_FEED_ID",
            code: 4001,
            message: `Invalid feed ID: ${JSON.stringify(feed)}`,
            timestamp: Date.now(),
            requestId: this.generateRequestId(),
          },
          HttpStatus.BAD_REQUEST
        );
      }
    }
  }

  private validateVolumeRequest(body: VolumesRequest, windowSec: number): void {
    this.validateFeedRequest(body);

    if (windowSec <= 0 || windowSec > 3600) {
      throw new HttpException(
        {
          error: "INVALID_TIME_WINDOW",
          code: 4004,
          message: "Time window must be between 1 and 3600 seconds",
          timestamp: Date.now(),
          requestId: this.generateRequestId(),
        },
        HttpStatus.BAD_REQUEST
      );
    }
  }

  private async getRealTimeFeedValues(feeds: any[]): Promise<any[]> {
    const results = [];

    for (const feed of feeds) {
      try {
        // Check cache first (1-second TTL)
        const cachedPrice = this.cacheService.getPrice(feed);

        if (cachedPrice && this.isFreshData(cachedPrice.timestamp)) {
          results.push({
            feed,
            value: cachedPrice.value,
          });
          continue;
        }

        // Get fresh aggregated price
        const aggregatedPrice = await this.aggregationService.getAggregatedPrice(feed);

        if (aggregatedPrice) {
          const result = {
            feed,
            value: aggregatedPrice.price,
          };

          // Cache the fresh data
          this.cacheService.setPrice(feed, {
            value: aggregatedPrice.price,
            timestamp: aggregatedPrice.timestamp,
            sources: aggregatedPrice.sources,
            confidence: aggregatedPrice.confidence,
          });

          results.push(result);
        } else {
          // Fallback to provider service
          const fallbackResult = await this.providerService.getValue(feed);
          results.push(fallbackResult);
        }
      } catch (error) {
        this.logger.error(`Error getting real-time value for feed ${JSON.stringify(feed)}:`, error);

        // Fallback to provider service
        try {
          const fallbackResult = await this.providerService.getValue(feed);
          results.push(fallbackResult);
        } catch (fallbackError) {
          this.logger.error(`Fallback also failed for feed ${JSON.stringify(feed)}:`, fallbackError);
          throw new HttpException(
            {
              error: "FEED_NOT_FOUND",
              code: 4041,
              message: `Unable to retrieve data for feed: ${JSON.stringify(feed)}`,
              timestamp: Date.now(),
              requestId: this.generateRequestId(),
            },
            HttpStatus.NOT_FOUND
          );
        }
      }
    }

    return results;
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
    description: "Returns system health status and performance metrics",
  })
  @ApiResponse({ status: 200, description: "System is healthy" })
  @ApiResponse({ status: 503, description: "System is unhealthy" })
  async healthCheck(): Promise<any> {
    try {
      const health = await this.providerService.healthCheck();
      const performanceMetrics = await this.providerService.getPerformanceMetrics();

      const response = {
        status: health.status,
        timestamp: Date.now(),
        version: "1.0.0",
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        performance: performanceMetrics,
        details: health.details,
      };

      if (health.status === "unhealthy") {
        throw new HttpException(response, HttpStatus.SERVICE_UNAVAILABLE);
      }

      return response;
    } catch (error) {
      this.logger.error("Health check failed:", error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          status: "unhealthy",
          timestamp: Date.now(),
          error: "Health check failed",
          details: { error: error.message },
        },
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }

  private generateRequestId(): string {
    return this.errorHandler.generateRequestId();
  }
}
