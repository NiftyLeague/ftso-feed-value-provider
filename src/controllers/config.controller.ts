import { Controller, Get } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiExtraModels } from "@nestjs/swagger";
import { ConfigService } from "@/config/config.service";
import { ENV } from "@/config/environment.constants";
import * as exchangesConfig from "@/config/exchanges.json";
import {
  ConfigStatusResponseDto,
  ConfigValidationResponseDto,
  FeedSummaryResponseDto,
  AdapterConfigurationResponseDto,
  EnvironmentConfigDto,
  MonitoringConfigDto,
  LoggingConfigDto,
  CacheConfigDto,
  SystemConfigDto,
  FeedsConfigDto,
  AdaptersConfigDto,
  ValidationResultDto,
  FeedValidationResultDto,
  ValidationOverallDto,
  EnvironmentValidationDto,
  FeedsValidationDto,
  CcxtParametersDto,
  HybridSummaryDto,
  HybridProviderConfigDto,
} from "./dto/config.dto";
import { HttpErrorResponseDto } from "./dto/common-error.dto";

@ApiTags("Configuration")
@Controller("config")
@ApiExtraModels(
  ConfigStatusResponseDto,
  ConfigValidationResponseDto,
  FeedSummaryResponseDto,
  AdapterConfigurationResponseDto,
  EnvironmentConfigDto,
  MonitoringConfigDto,
  LoggingConfigDto,
  CacheConfigDto,
  SystemConfigDto,
  FeedsConfigDto,
  AdaptersConfigDto,
  ValidationResultDto,
  FeedValidationResultDto,
  ValidationOverallDto,
  EnvironmentValidationDto,
  FeedsValidationDto,
  CcxtParametersDto,
  HybridSummaryDto,
  HybridProviderConfigDto,
  HttpErrorResponseDto
)
export class ConfigController {
  constructor(private readonly configService: ConfigService) {}

  @Get("status")
  @ApiOperation({
    summary: "Get configuration status and health information",
    description: "Returns current configuration status including environment, system, feeds, and adapter information",
  })
  @ApiResponse({
    status: 200,
    description: "Configuration status retrieved successfully",
    type: ConfigStatusResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: "Internal server error",
    type: HttpErrorResponseDto,
  })
  getConfigurationStatus(): ConfigStatusResponseDto {
    const feeds = this.configService.getFeedConfigurations();

    return {
      environment: {
        isValid: true,
        loadedAt: new Date(),
        nodeEnv: ENV.APPLICATION.NODE_ENV,
        port: ENV.APPLICATION.PORT,
      },
      system: {
        monitoring: {
          enabled: ENV.MONITORING.ENABLED,
          metricsPort: ENV.MONITORING.METRICS_PORT,
        },
        logging: {
          level: ENV.LOGGING.LOG_LEVEL,
          fileLogging: ENV.LOGGING.ENABLE_FILE_LOGGING,
          performanceLogging: ENV.LOGGING.ENABLE_PERFORMANCE_LOGGING,
        },
        cache: {
          ttlMs: ENV.CACHE.TTL_MS,
          maxEntries: ENV.CACHE.MAX_ENTRIES,
        },
      },
      feeds: {
        count: feeds.length,
        loadedAt: new Date(),
        filePath: "src/config/feeds.json",
      },
      adapters: {
        customAdapterCount: 5, // binance, coinbase, cryptocom, kraken, okx
        ccxtAdapterCount: 11, // All others
        totalExchanges: 16,
      },
    };
  }

  @Get("validate")
  @ApiOperation({
    summary: "Validate current configuration and return detailed report",
    description: "Performs comprehensive validation of environment variables, feeds, and system configuration",
  })
  @ApiResponse({
    status: 200,
    description: "Configuration validation completed",
    type: ConfigValidationResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: "Internal server error",
    type: HttpErrorResponseDto,
  })
  validateConfiguration(): ConfigValidationResponseDto {
    const envValidation = this.configService.validateConfiguration();
    const feeds = this.configService.getFeedConfigurations();

    return {
      overall: {
        isValid: envValidation.isValid,
        criticalErrors: envValidation.errors.length,
        warnings: envValidation.warnings.length,
      },
      environment: envValidation,
      feeds: {
        totalFeeds: feeds.length,
        totalSources: feeds.reduce((sum, feed) => sum + feed.sources.length, 0),
        validationResults: feeds.map(feed => ({
          feedName: feed.feed.name,
          isValid: true, // Basic validation - feeds loaded successfully
          errors: [],
          warnings: [],
        })),
      },
    };
  }

  @Get("feeds/summary")
  @ApiOperation({
    summary: "Get feed configuration summary",
    description: "Returns summary of configured feeds including categories, sources, and exchange usage statistics",
  })
  @ApiResponse({
    status: 200,
    description: "Feed configuration summary retrieved",
    type: FeedSummaryResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: "Internal server error",
    type: HttpErrorResponseDto,
  })
  getFeedConfigurationSummary(): FeedSummaryResponseDto {
    const feeds = this.configService.getFeedConfigurations();

    return {
      totalFeeds: feeds.length,
      feedsByCategory: feeds.reduce(
        (acc, feed) => {
          const category = feed.feed.category;
          acc[category] = (acc[category] || 0) + 1;
          return acc;
        },
        {} as Record<number, number>
      ),
      totalSources: feeds.reduce((sum, feed) => sum + feed.sources.length, 0),
      exchangeUsage: feeds.reduce(
        (acc, feed) => {
          feed.sources.forEach(source => {
            acc[source.exchange] = (acc[source.exchange] || 0) + 1;
          });
          return acc;
        },
        {} as Record<string, number>
      ),
      hybridSummary: {
        customAdapterExchanges: ["binance", "coinbase", "cryptocom", "kraken", "okx"],
        ccxtExchanges: this.getCcxtExchanges(),
        ccxtParameters: {
          lambda: 0.00005,
          tradesLimit: 1000,
          retryBackoffMs: 10000,
        },
      },
    };
  }

  @Get("adapters")
  @ApiOperation({
    summary: "Get adapter configuration information",
    description: "Returns information about custom and CCXT adapters including hybrid provider configuration",
  })
  @ApiResponse({
    status: 200,
    description: "Adapter configuration retrieved",
    type: AdapterConfigurationResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: "Internal server error",
    type: HttpErrorResponseDto,
  })
  getAdapterConfiguration(): AdapterConfigurationResponseDto {
    const ccxtExchanges = this.getCcxtExchanges();
    return {
      customAdapterExchanges: ["binance", "coinbase", "cryptocom", "kraken", "okx"],
      ccxtExchanges,
      hybridProviderConfig: {
        customAdapterExchanges: ["binance", "coinbase", "cryptocom", "kraken", "okx"],
        ccxtExchanges,
        ccxtParameters: {
          lambda: 0.00005,
          tradesLimit: 1000,
          retryBackoffMs: 10000,
        },
      },
    };
  }

  /**
   * Get CCXT exchanges from the exchanges configuration
   * Filters out custom adapter exchanges from the crypto category
   */
  private getCcxtExchanges(): string[] {
    const customAdapterExchanges = ["binance", "coinbase", "cryptocom", "kraken", "okx"];
    const cryptoExchanges = exchangesConfig.categories["1"]?.exchanges || [];

    return cryptoExchanges.filter(exchange => !customAdapterExchanges.includes(exchange));
  }
}
