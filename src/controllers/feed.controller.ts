import {
  Body,
  Controller,
  Param,
  DefaultValuePipe,
  ParseIntPipe,
  Post,
  Inject,
  Query,
  HttpException,
  HttpStatus,
  UseGuards,
  Header,
  HttpCode,
} from "@nestjs/common";
import { RateLimitGuard } from "@/common/rate-limiting/rate-limit.guard";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { BaseController } from "@/common/base/base.controller";
import { ValidationUtils } from "@/common/utils/validation.utils";
import { FtsoProviderService } from "@/app.service";
import type {
  FeedId,
  FeedValueData,
  FeedValuesRequest,
  FeedValuesResponse,
  FeedVolumeData,
  FeedVolumesResponse,
  RoundFeedValuesResponse,
  VolumesRequest,
} from "@/common/types/http";

import { RealTimeCacheService } from "@/cache/real-time-cache.service";
import { RealTimeAggregationService } from "@/aggregators/real-time-aggregation.service";

import { StandardizedErrorHandlerService } from "../error-handling/standardized-error-handler.service";
import { UniversalRetryService } from "../error-handling/universal-retry.service";
import { ApiMonitorService } from "../monitoring/api-monitor.service";

@ApiTags("FTSO Feed Values")
@Controller()
@UseGuards(RateLimitGuard)
export class FeedController extends BaseController {
  constructor(
    @Inject("FTSO_PROVIDER_SERVICE") private readonly providerService: FtsoProviderService,
    standardizedErrorHandler: StandardizedErrorHandlerService,
    universalRetryService: UniversalRetryService,
    private readonly cacheService: RealTimeCacheService,
    private readonly aggregationService: RealTimeAggregationService,
    private readonly apiMonitor: ApiMonitorService
  ) {
    super();
    // Inject standardized error handling services
    this.standardizedErrorHandler = standardizedErrorHandler;
    this.universalRetryService = universalRetryService;
  }

  @Post("feed-values")
  @HttpCode(200)
  @Header("Content-Type", "application/json")
  @ApiOperation({
    summary: "Get current feed values",
    description: "Returns real-time feed values with sub-100ms response time and 1-second cache TTL",
  })
  @ApiResponse({ status: 200, description: "Current feed values retrieved successfully" })
  @ApiResponse({ status: 400, description: "Invalid feed request" })
  @ApiResponse({ status: 500, description: "Internal server error" })
  async getCurrentFeedValues(@Body() body: FeedValuesRequest): Promise<FeedValuesResponse> {
    return this.handleControllerOperation(
      async () => {
        // Validate feed requests - this will throw BadRequestException for invalid input
        this.validateFeedRequest(body);

        // Get real-time data with caching and retry logic using our own executeWithRetry
        const values = await this.executeWithRetry(() => this.getRealTimeFeedValues(body.feeds), {
          operationName: "getRealTimeFeedValues",
          serviceType: "external-api",
          endpoint: "getCurrentFeedValues",
          retryConfig: { maxRetries: 2, initialDelayMs: 500 },
        });

        this.logger.log(`Current feed values: ${values.length} feeds`, {
          feedCount: values.length,
        });

        return {
          data: values,
        };
      },
      "getCurrentFeedValues",
      "POST",
      "/feed-values",
      {
        body,
        useStandardizedErrorHandling: false,
        useRetryLogic: false,
        performanceThreshold: 100, // Sub-100ms requirement
      }
    );
  }

  @Post("feed-values/:votingRoundId")
  @HttpCode(200)
  @Header("Content-Type", "application/json")
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
    return this.handleControllerOperation(
      async () => {
        // ParseIntPipe already validates that votingRoundId is a valid integer
        // Additional validation using our utility for business rules
        ValidationUtils.validateVotingRoundId(votingRoundId);

        // Validate feed requests - this will throw BadRequestException for invalid input
        this.validateFeedRequest(body);

        // Try to get cached historical data first with retry logic
        const cachedResults = await this.executeWithRetry(
          () => this.getCachedHistoricalData(body.feeds, votingRoundId),
          {
            operationName: "getCachedHistoricalData",
            serviceType: "cache",
            retryConfig: { maxRetries: 1, initialDelayMs: 100 },
          }
        );

        // Get fresh data for any missing feeds
        const missingFeeds = body.feeds.filter((_, index) => !cachedResults[index]);
        let freshData: FeedValueData[] = [];

        if (missingFeeds.length > 0) {
          freshData = await this.executeWithRetry(() => this.providerService.getValues(missingFeeds), {
            operationName: "getProviderValues",
            serviceType: "external-api",
            endpoint: "getValues",
            retryConfig: { maxRetries: 3, initialDelayMs: 1000 },
          });

          // Cache the fresh data for this voting round
          await this.executeWithRetry(() => this.cacheHistoricalData(missingFeeds, freshData, votingRoundId), {
            operationName: "cacheHistoricalData",
            serviceType: "cache",
            retryConfig: { maxRetries: 1, initialDelayMs: 100 },
          });
        }

        // Combine cached and fresh data
        const values = this.combineHistoricalResults(body.feeds, cachedResults, missingFeeds, freshData);

        this.logger.log(`Feed values for voting round ${votingRoundId}: ${values.length} feeds`, {
          votingRoundId,
          feedCount: values.length,
        });

        return {
          votingRoundId,
          data: values,
        };
      },
      "getFeedValues",
      "POST",
      `/feed-values/${votingRoundId}`,
      {
        body,
        useStandardizedErrorHandling: false,
        useRetryLogic: false,
      }
    );
  }

  @Post("volumes")
  @HttpCode(200)
  @Header("Content-Type", "application/json")
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
    return this.handleControllerOperation(
      async () => {
        // Validate volume request - this will throw BadRequestException for invalid input
        this.validateVolumeRequest(body, windowSec);

        // Get volumes with USDT conversion using existing CCXT processing with retry logic
        const values = await this.executeWithRetry(() => this.getOptimizedVolumes(body.feeds, windowSec), {
          operationName: "getOptimizedVolumes",
          serviceType: "external-api",
          endpoint: "getVolumes",
          retryConfig: { maxRetries: 2, initialDelayMs: 1000 },
        });

        this.logger.log(`Feed volumes for last ${windowSec} seconds: ${values.length} feeds`, {
          windowSec,
          feedCount: values.length,
        });

        return {
          data: values,
          windowSec,
        };
      },
      "getFeedVolumes",
      "POST",
      "/volumes",
      {
        body: { ...body, windowSec },
        useStandardizedErrorHandling: false,
        useRetryLogic: false,
      }
    );
  }

  // Private helper methods

  private validateFeedRequest(body: FeedValuesRequest): void {
    // Use basic validation for FTSO API compliance
    ValidationUtils.validateFeedValuesRequest(body);
  }

  private validateVolumeRequest(body: VolumesRequest, windowSec: number): void {
    // Use enhanced validation for FTSO API compliance
    ValidationUtils.validateVolumesRequest(body);

    // Validate time window with FTSO-specific limits
    ValidationUtils.validateTimeWindow(windowSec);

    // Log valid volume request
    this.logger.debug(`Volume request validated`, {
      feedCount: body.feeds.length,
      windowSec,
    });
  }

  private async getRealTimeFeedValues(feeds: FeedId[]): Promise<FeedValueData[]> {
    this.startTimer("getRealTimeFeedValues");

    // Process feeds in parallel for better performance
    const feedPromises = feeds.map(async feed => {
      this.startTimer(`feed_${feed.name}`);

      try {
        // Check cache first (1-second TTL)
        const cachedPrice = this.cacheService.getPrice(feed);

        if (cachedPrice && this.isFreshData(cachedPrice.timestamp)) {
          const responseTime = this.endTimer(`feed_${feed.name}`);
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

          const responseTime = this.endTimer(`feed_${feed.name}`);
          this.logger.debug(`Aggregated price for ${feed.name}: ${responseTime.toFixed(2)}ms`);

          return result;
        } else {
          // Fallback to provider service
          const fallbackResult = await this.providerService.getValue(feed);
          const responseTime = this.endTimer(`feed_${feed.name}`);
          this.logger.debug(`Fallback service for ${feed.name}: ${responseTime.toFixed(2)}ms`);

          if (!fallbackResult) {
            // Return error result if fallback service also fails
            return {
              feed,
              error: {
                code: "FEED_NOT_FOUND",
                message: `Unable to retrieve data for feed: ${JSON.stringify(feed)}`,
                timestamp: Date.now(),
              },
            };
          }

          return {
            ...fallbackResult,
            source: "fallback",
            timestamp: Date.now(),
            confidence: 0.8, // Lower confidence for fallback data
          };
        }
      } catch (error) {
        const responseTime = this.endTimer(`feed_${feed.name}`);
        this.logger.error(
          `Error getting real-time value for feed ${JSON.stringify(feed)} (${responseTime.toFixed(2)}ms):`,
          error
        );

        // Fallback to provider service
        try {
          const fallbackResult = await this.providerService.getValue(feed);
          this.logger.warn(`Used fallback service for failed feed ${feed.name}`);

          if (!fallbackResult) {
            throw new Error("Fallback service returned undefined");
          }

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
      const successfulResults: FeedValueData[] = [];
      const failedFeeds: Array<{
        feed: FeedId;
        error: { code: string; message: string; timestamp: number };
      }> = [];

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
      const totalResponseTime = this.endTimer("getRealTimeFeedValues");
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
      const totalResponseTime = this.endTimer("getRealTimeFeedValues");
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

  private async getCachedHistoricalData(feeds: FeedId[], votingRoundId: number): Promise<(FeedValueData | null)[]> {
    const results: (FeedValueData | null)[] = [];

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

  private async cacheHistoricalData(feeds: FeedId[], data: FeedValueData[], votingRoundId: number): Promise<void> {
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
    allFeeds: FeedId[],
    cachedResults: (FeedValueData | null)[],
    missingFeeds: FeedId[],
    freshData: FeedValueData[]
  ): FeedValueData[] {
    const results: FeedValueData[] = new Array(allFeeds.length);

    // First, fill in all cached results
    for (let i = 0; i < allFeeds.length; i++) {
      if (cachedResults && cachedResults[i]) {
        results[i] = cachedResults[i] as FeedValueData;
      }
    }

    // If there are no missing feeds, filter out any nulls and return
    if (missingFeeds.length === 0) {
      const validResults = results.filter(result => result !== null && result !== undefined) as FeedValueData[];
      return validResults;
    }

    // Handle case where we need fresh data but none is available
    if (!freshData || freshData.length === 0) {
      if (missingFeeds.length > 0) {
        throw new HttpException(
          {
            error: "DATA_UNAVAILABLE",
            message: "Fresh data unavailable for requested feeds",
            statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          },
          HttpStatus.SERVICE_UNAVAILABLE
        );
      }
      const validResults = results.filter(result => result !== null && result !== undefined) as FeedValueData[];
      return validResults;
    }

    // Map each missing feed to its corresponding fresh data
    let freshIndex = 0;
    for (let i = 0; i < allFeeds.length; i++) {
      if (!results[i]) {
        // This position needs fresh data
        if (freshIndex >= freshData.length) {
          throw new HttpException(
            {
              error: "INSUFFICIENT_DATA",
              message: `Insufficient fresh data: expected ${missingFeeds.length} but received ${freshData.length}`,
              statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            },
            HttpStatus.INTERNAL_SERVER_ERROR
          );
        }
        if (freshData && freshData[freshIndex]) {
          results[i] = freshData[freshIndex];
        }
        freshIndex++;
      }
    }

    return results.filter(result => result !== null && result !== undefined) as FeedValueData[];
  }

  private async getOptimizedVolumes(feeds: FeedId[], windowSec: number): Promise<FeedVolumeData[]> {
    // Input validation
    if (!feeds || !Array.isArray(feeds)) {
      throw new HttpException(
        {
          error: "INVALID_INPUT",
          message: "feeds must be a valid array",
          code: 4001,
          timestamp: Date.now(),
        },
        HttpStatus.BAD_REQUEST
      );
    }

    if (feeds.length === 0) {
      throw new HttpException(
        {
          error: "INVALID_INPUT",
          message: "feeds array cannot be empty",
          code: 4002,
          timestamp: Date.now(),
        },
        HttpStatus.BAD_REQUEST
      );
    }

    // Use existing CCXT volume processing with USDT conversion
    try {
      const volumes = await this.providerService.getVolumes(feeds, windowSec);

      if (!volumes || volumes.length === 0) {
        // Return empty volumes instead of throwing an error
        // This handles the case where volume data is not yet implemented
        return feeds.map(feed => ({
          feed,
          volumes: [],
        }));
      }

      if (volumes.length !== feeds.length) {
        this.logger.warn(`Volume data mismatch: expected ${feeds.length} feeds but got ${volumes.length}`);
      }

      return volumes;
    } catch (error) {
      const isHttpException = error instanceof HttpException;

      if (isHttpException) {
        throw error; // Re-throw HttpExceptions as they are already properly formatted
      }

      this.logger.error(`Error fetching volumes:`, error);

      throw new HttpException(
        {
          error: "VOLUME_FETCH_ERROR",
          message: "Failed to fetch volume data",
          code: 5001,
          timestamp: Date.now(),
          details: error instanceof Error ? error.message : undefined,
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  private isFreshData(timestamp: number): boolean {
    const age = Date.now() - timestamp;
    return age <= 2000; // 2-second freshness requirement
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
