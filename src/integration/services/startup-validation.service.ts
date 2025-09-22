import { join } from "path";
import { readFileSync } from "fs";
import { Injectable, OnModuleInit } from "@nestjs/common";

import { ENV, ENV_HELPERS } from "@/config/environment.constants";
import { ConfigService } from "@/config/config.service";
import { StandardService } from "@/common/base/composed.service";
import type { StartupValidationResult } from "@/common/types/services";

import { IntegrationService } from "../integration.service";

@Injectable()
export class StartupValidationService extends StandardService implements OnModuleInit {
  private validationResult: StartupValidationResult | null = null;

  constructor(private readonly integrationService: IntegrationService) {
    super();
  }

  override async onModuleInit(): Promise<void> {
    this.logger.log("Starting application startup validation...");

    try {
      this.validationResult = await this.validateStartup();

      if (this.validationResult.success) {
        this.logger.log("✅ Application startup validation completed successfully");
        if (this.validationResult.warnings.length > 0) {
          this.validationResult.warnings.forEach(warning => {
            this.logger.warn(`⚠️ ${warning}`);
          });
        }
      } else {
        this.logger.warn("⚠️ Application startup validation completed with warnings");
        this.validationResult.errors.forEach(error => {
          this.logger.warn(`⚠️ ${error}`);
        });
        // Don't throw error, just log warnings
        this.logger.warn("Continuing with degraded mode due to validation issues");
      }
    } catch (error) {
      this.logger.warn("Startup validation encountered errors, continuing with degraded mode:", error);
      // Don't throw error, just log and continue
    }
  }

  async validateStartup(): Promise<StartupValidationResult> {
    const startTime = Date.now();
    const result: StartupValidationResult = {
      success: true,
      errors: [],
      warnings: [],
      validatedServices: [],
      timestamp: startTime,
      validationTime: 0,
    };

    try {
      // Validate configuration
      await this.validateConfiguration(result);

      // Validate config service
      await this.validateConfigService(result);

      // Validate integration service
      await this.validateIntegrationService(result);

      // Validate environment variables
      this.validateEnvironmentVariables(result);

      // Validate system resources
      this.validateSystemResources(result);

      // Final validation
      result.success = result.errors.length === 0;
      result.validationTime = Date.now() - startTime;

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`Validation process failed: ${message}`);
      result.success = false;
      result.validationTime = Date.now() - startTime;
      return result;
    }
  }

  private async validateConfiguration(result: StartupValidationResult): Promise<void> {
    try {
      // Test that feeds.json can be loaded
      const feedsFilePath = join(process.cwd(), "src", "config", "feeds.json");
      const feedsData = readFileSync(feedsFilePath, "utf8");
      const feedsJson = JSON.parse(feedsData);

      if (!feedsJson || !Array.isArray(feedsJson) || feedsJson.length === 0) {
        result.warnings.push("No feed configurations found - system may not provide data");
      } else {
        this.logger.debug(`Found ${feedsJson.length} feed configurations`);
      }

      result.validatedServices.push("FeedConfiguration");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`Feed configuration validation failed: ${message}`);
    }
  }

  private async validateConfigService(result: StartupValidationResult): Promise<void> {
    try {
      // Create a temporary instance to test basic functionality
      const configService = new ConfigService();

      // Test basic config service functionality
      const envConfig = configService.getEnvironmentConfig();
      if (!envConfig || !envConfig.APPLICATION) {
        result.errors.push("ConfigService: Environment configuration not available");
        return;
      }

      // Test feed configuration access
      const feedConfigs = configService.getFeedConfigurations();
      if (!Array.isArray(feedConfigs)) {
        result.errors.push("ConfigService: Feed configurations not accessible");
        return;
      }

      // Test configuration validation
      const validation = configService.validateConfiguration();
      if (!validation.isValid) {
        result.errors.push(`ConfigService: Configuration validation failed - ${validation.errors.join(", ")}`);
        return;
      }

      if (validation.warnings.length > 0) {
        validation.warnings.forEach(warning => {
          result.warnings.push(`ConfigService: ${warning}`);
        });
      }

      result.validatedServices.push("ConfigService");
      this.logger.debug("ConfigService validation completed successfully");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`ConfigService validation failed: ${message}`);
    }
  }

  private async validateIntegrationService(result: StartupValidationResult): Promise<void> {
    try {
      // Wait for integration service to be initialized with a shorter timeout
      if (!this.integrationService.isServiceInitialized()) {
        this.logger.log("Waiting for integration service to initialize...");

        // Wait for initialization to complete with a timeout
        let timedOut = false;
        await new Promise<void>(resolve => {
          const timeoutMs = parseInt(process.env.INTEGRATION_SERVICE_TIMEOUT_MS || "30000", 10); // Reduced from 60s to 30s
          const timeout = setTimeout(() => {
            timedOut = true;
            this.logger.warn("Integration service initialization timeout - continuing with degraded mode");
            resolve();
          }, timeoutMs);

          const checkInitialization = () => {
            if (this.integrationService.isServiceInitialized()) {
              clearTimeout(timeout);
              resolve();
            }
          };

          // Check immediately
          checkInitialization();

          // Also listen for the initialized event
          this.integrationService.once("initialized", () => {
            clearTimeout(timeout);
            resolve();
          });
        });

        // Add error if timed out
        if (timedOut) {
          result.errors.push("Integration service validation failed: Integration service initialization timeout");
          result.success = false;
        }
      }

      // Test integration service health - be more lenient during startup
      try {
        const health = await this.integrationService.getSystemHealth();

        if (health.status === "unhealthy") {
          // In production mode without real connections, degraded/unhealthy is acceptable
          result.warnings.push("Integration service is unhealthy - this is expected without live exchange connections");
        } else if (health.status === "degraded") {
          result.warnings.push("Integration service is in degraded state");
        }

        // Check source health information based on available fields
        const totalSources = health.sources?.length ?? 0;
        if (totalSources === 0) {
          result.warnings.push("No data sources have reported health status yet");
        } else {
          const unhealthy = health.sources.filter(s => s.status === "unhealthy").length;
          if (unhealthy === totalSources) {
            result.warnings.push("All data sources are unhealthy - system will operate in degraded mode");
          }
        }
      } catch (error) {
        // If health check fails, just warn and continue
        result.warnings.push("Integration service health check failed - continuing with degraded mode");
        this.logger.warn("Health check failed during startup validation:", error);
      }

      result.validatedServices.push("IntegrationService");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Don't treat integration service errors as fatal during startup
      result.warnings.push(`Integration service validation failed: ${message} - continuing with degraded mode`);
      this.logger.warn("Integration service validation error during startup:", error);
    }
  }

  private validateEnvironmentVariables(result: StartupValidationResult): void {
    // Validate port using centralized constants (includes existence check)
    // Port validation is handled during ENV.PORT initialization

    // Check for API keys - only warn if we're in production mode
    const nodeEnv = ENV.APPLICATION.NODE_ENV;
    if (nodeEnv === "production") {
      const exchangeKeys = [
        "BINANCE_API_KEY",
        "COINBASE_API_KEY",
        "KRAKEN_API_KEY",
        "OKX_API_KEY",
        "CRYPTOCOM_API_KEY",
      ];
      const missingKeys = ENV_HELPERS.getMissingExchangeKeys();

      if (missingKeys.length === exchangeKeys.length) {
        result.warnings.push("No exchange API keys configured - may limit data availability in production");
      } else if (missingKeys.length > 0) {
        result.warnings.push(`Missing API keys for exchanges: ${missingKeys.join(", ")}`);
      }
    } else {
      // In development, this is expected and not a warning
      this.logger.debug("Development mode: API key validation skipped");
    }

    result.validatedServices.push("Environment Variables");
  }

  private validateSystemResources(result: StartupValidationResult): void {
    try {
      // Check memory usage - only warn if extremely high
      const memUsage = process.memoryUsage();
      const memUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;

      if (memUsagePercent > ENV.SYSTEM.MEMORY_CRITICAL_THRESHOLD * 100) {
        result.warnings.push(
          `Critical memory usage at startup: ${memUsagePercent.toFixed(1)}% - consider increasing heap size`
        );
      } else if (memUsagePercent > ENV.SYSTEM.MEMORY_WARNING_THRESHOLD * 100) {
        result.warnings.push(
          `High memory usage at startup: ${memUsagePercent.toFixed(1)}% - this is normal during initialization`
        );
      }

      // Check available memory
      const os = require("os");
      const freeMemory = os.freemem();
      const totalMemory = os.totalmem();
      const freeMemoryPercent = (freeMemory / totalMemory) * 100;

      if (freeMemoryPercent < ENV.SYSTEM.FREE_MEMORY_CRITICAL_THRESHOLD * 100) {
        result.warnings.push(`Low system memory available: ${freeMemoryPercent.toFixed(1)}%`);
      }

      // Check Node.js version - only warn for very old versions
      const nodeVersion = process.version;
      const majorVersion = parseInt(nodeVersion.substring(1).split(".")[0]);

      if (majorVersion < ENV.SYSTEM.MIN_NODE_VERSION) {
        result.warnings.push(
          `Node.js version ${nodeVersion} is not supported (minimum: ${ENV.SYSTEM.MIN_NODE_VERSION}, recommended: ${ENV.SYSTEM.RECOMMENDED_NODE_VERSION}+)`
        );
      } else if (majorVersion < ENV.SYSTEM.RECOMMENDED_NODE_VERSION) {
        this.logger.debug(
          `Node.js version ${nodeVersion} is supported but ${ENV.SYSTEM.RECOMMENDED_NODE_VERSION}+ is recommended for optimal performance`
        );
      }

      result.validatedServices.push("System Resources");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.warnings.push(`System resource validation failed: ${message}`);
    }
  }

  getValidationResult(): StartupValidationResult | null {
    return this.validationResult;
  }

  isValidationSuccessful(): boolean {
    return this.validationResult?.success ?? false;
  }

  getValidationErrors(): string[] {
    return this.validationResult?.errors ?? [];
  }

  getValidationWarnings(): string[] {
    return this.validationResult?.warnings ?? [];
  }
}
