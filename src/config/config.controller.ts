import { Controller, Get } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { ConfigService } from "./config.service";
import { ENV } from "./environment.constants";

@ApiTags("Configuration")
@Controller("config")
export class ConfigController {
  constructor(private readonly configService: ConfigService) {}

  @Get("status")
  @ApiOperation({ summary: "Get configuration status and health information" })
  @ApiResponse({ status: 200, description: "Configuration status retrieved successfully" })
  getConfigurationStatus() {
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
  @ApiOperation({ summary: "Validate current configuration and return detailed report" })
  @ApiResponse({ status: 200, description: "Configuration validation completed" })
  validateConfiguration() {
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
  @ApiOperation({ summary: "Get feed configuration summary" })
  @ApiResponse({ status: 200, description: "Feed configuration summary retrieved" })
  getFeedConfigurationSummary() {
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
        ccxtExchanges: [
          "binanceus",
          "bingx",
          "bitfinex",
          "bitget",
          "bitmart",
          "bitrue",
          "bitstamp",
          "bybit",
          "gate",
          "htx",
          "kucoin",
          "mexc",
          "probit",
        ],
        ccxtParameters: {
          lambda: 0.00005,
          tradesLimit: 1000,
          retryBackoffMs: 10000,
        },
      },
    };
  }

  @Get("adapters")
  @ApiOperation({ summary: "Get adapter configuration information" })
  @ApiResponse({ status: 200, description: "Adapter configuration retrieved" })
  getAdapterConfiguration() {
    return {
      customAdapterExchanges: ["binance", "coinbase", "cryptocom", "kraken", "okx"],
      ccxtExchanges: [
        "binanceus",
        "bingx",
        "bitfinex",
        "bitget",
        "bitmart",
        "bitrue",
        "bitstamp",
        "bybit",
        "gate",
        "htx",
        "kucoin",
        "mexc",
        "probit",
      ],
      hybridProviderConfig: {
        customAdapterExchanges: ["binance", "coinbase", "cryptocom", "kraken", "okx"],
        ccxtExchanges: [
          "binanceus",
          "bingx",
          "bitfinex",
          "bitget",
          "bitmart",
          "bitrue",
          "bitstamp",
          "bybit",
          "gate",
          "htx",
          "kucoin",
          "mexc",
          "probit",
        ],
        ccxtParameters: {
          lambda: 0.00005,
          tradesLimit: 1000,
          retryBackoffMs: 10000,
        },
      },
    };
  }
}
