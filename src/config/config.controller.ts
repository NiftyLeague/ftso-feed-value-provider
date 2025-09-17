import { Controller, Get } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { ConfigService } from "./config.service";

@ApiTags("Configuration")
@Controller("config")
export class ConfigController {
  constructor(private readonly configService: ConfigService) {}

  @Get("status")
  @ApiOperation({ summary: "Get configuration status and health information" })
  @ApiResponse({ status: 200, description: "Configuration status retrieved successfully" })
  getConfigurationStatus() {
    return this.configService.getConfigurationStatus();
  }

  @Get("validate")
  @ApiOperation({ summary: "Validate current configuration and return detailed report" })
  @ApiResponse({ status: 200, description: "Configuration validation completed" })
  validateConfiguration() {
    return this.configService.validateCurrentConfiguration();
  }

  @Get("environment")
  @ApiOperation({ summary: "Get environment configuration (sanitized)" })
  @ApiResponse({ status: 200, description: "Environment configuration retrieved" })
  getEnvironmentConfiguration() {
    const config = this.configService.getEnvironmentConfig();

    // Sanitize sensitive information
    const sanitized = {
      ...config,
      exchangeApiKeys: Object.keys(config.exchangeApiKeys).reduce(
        (acc, exchange) => {
          acc[exchange] = {
            hasApiKey: !!config.exchangeApiKeys[exchange].apiKey,
            hasSecret: !!config.exchangeApiKeys[exchange].secret,
            hasPassphrase: !!config.exchangeApiKeys[exchange].passphrase,
          };
          return acc;
        },
        {} as Record<string, { hasApiKey: boolean; hasSecret: boolean; hasPassphrase: boolean }>
      ),
      alerting: {
        ...config.alerting,
        email: {
          ...config.alerting.email,
          username: config.alerting.email.username ? "[CONFIGURED]" : "",
          password: config.alerting.email.password ? "[CONFIGURED]" : "",
        },
      },
    };

    return sanitized;
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
      hybridSummary: this.configService.getHybridProviderConfig(),
    };
  }

  @Get("adapters")
  @ApiOperation({ summary: "Get adapter configuration information" })
  @ApiResponse({ status: 200, description: "Adapter configuration retrieved" })
  getAdapterConfiguration() {
    return {
      customAdapterExchanges: this.configService.getCustomAdapterExchanges(),
      ccxtExchanges: this.configService.getCcxtExchanges(),
      hybridProviderConfig: this.configService.getHybridProviderConfig(),
    };
  }

  @Get("reload/feeds")
  @ApiOperation({ summary: "Reload feed configurations from feeds.json" })
  @ApiResponse({ status: 200, description: "Feed configurations reloaded successfully" })
  reloadFeedConfigurations() {
    try {
      this.configService.reloadFeedConfigurations();
      return {
        success: true,
        message: "Feed configurations reloaded successfully",
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: "Failed to reload feed configurations",
        error: message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  @Get("reload/environment")
  @ApiOperation({ summary: "Reload environment configuration" })
  @ApiResponse({ status: 200, description: "Environment configuration reloaded successfully" })
  reloadEnvironmentConfiguration() {
    try {
      this.configService.reloadEnvironmentConfiguration();
      return {
        success: true,
        message: "Environment configuration reloaded successfully",
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: "Failed to reload environment configuration",
        error: message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  @Get("hotreload/enable")
  @ApiOperation({ summary: "Enable hot-reload for feed configurations" })
  @ApiResponse({ status: 200, description: "Hot-reload enabled successfully" })
  enableHotReload() {
    try {
      this.configService.enableFeedConfigurationHotReload();
      return {
        success: true,
        message: "Feed configuration hot-reload enabled",
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: "Failed to enable hot-reload",
        error: message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  @Get("hotreload/disable")
  @ApiOperation({ summary: "Disable hot-reload for feed configurations" })
  @ApiResponse({ status: 200, description: "Hot-reload disabled successfully" })
  disableHotReload() {
    try {
      this.configService.disableFeedConfigurationHotReload();
      return {
        success: true,
        message: "Feed configuration hot-reload disabled",
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: "Failed to disable hot-reload",
        error: message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}
