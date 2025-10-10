import { Injectable } from "@nestjs/common";

import { ENV } from "@/config/environment.constants";
import { ConfigService } from "@/config/config.service";
import { EventDrivenService } from "@/common/base";
import type { StartupValidationResult } from "@/common/types/services";

import { IntegrationService } from "../integration.service";

@Injectable()
export class StartupValidationService extends EventDrivenService {
  private validationResult: StartupValidationResult | null = null;

  constructor(private readonly integrationService: IntegrationService) {
    super();
    // Start validation asynchronously to avoid blocking server startup
    this.startAsyncValidation();
  }

  private startAsyncValidation(): void {
    // Use setTimeout to ensure this runs after the current call stack
    setTimeout(async () => {
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
    }, 1000); // Wait 1 second to allow server startup to complete
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
      await this.validateSystemResources(result);

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
      // Use ConfigService to validate feeds.json can be loaded consistently
      const configService = new ConfigService();

      const feedsCount = configService.getFeedsCount();

      if (feedsCount === 0) {
        result.warnings.push("No feed configurations found - system may not provide data");
      } else {
        this.logger.debug(`Found ${feedsCount} feed configurations`);
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
          // Use a more reasonable timeout for development mode
          const timeoutMs = ENV.TIMEOUTS.INTEGRATION_MS;

          const timeout = setTimeout(() => {
            timedOut = true;
            this.logger.warn(
              `Integration service initialization timeout after ${timeoutMs}ms - continuing with degraded mode`
            );
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

          // ✅ Use waitForCondition instead of polling
          this.waitForCondition(() => this.integrationService.isServiceInitialized(), {
            maxAttempts: Math.ceil(timeoutMs / 500),
            checkInterval: 500,
            timeout: timeoutMs,
          })
            .then(success => {
              if (success) {
                clearTimeout(timeout);
                resolve();
              }
            })
            .catch(() => {
              // Condition checking failed, but timeout will handle it
            });
        });

        // Add warning if timed out, but don't fail startup
        if (timedOut) {
          result.warnings.push("Integration service initialization timeout - continuing with degraded mode");
        }
      }

      // Test integration service health - consistent behavior across environments
      try {
        const health = await this.integrationService.getSystemHealth();

        if (health.status === "unhealthy") {
          result.warnings.push("Integration service is unhealthy - this is expected without live exchange connections");
        } else if (health.status === "degraded") {
          result.warnings.push("Integration service is in degraded state");
        }

        // Check source health information based on available fields
        const totalSources = health.sources?.length ?? 0;
        if (totalSources === 0) {
          // This is normal during startup - data sources need time to initialize
          this.logger.debug("Data sources are still initializing - health status not yet available");
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

    result.validatedServices.push("Environment Variables");
  }

  private async validateSystemResources(result: StartupValidationResult): Promise<void> {
    try {
      // Check memory usage against heap size limit, not current heap total
      const memUsage = process.memoryUsage();
      const v8 = await import("v8");
      const heapStats = v8.getHeapStatistics();

      // Calculate percentage against heap size limit for more accurate assessment
      const memUsagePercent = (memUsage.heapUsed / heapStats.heap_size_limit) * 100;
      const currentHeapUtilization = (memUsage.heapUsed / memUsage.heapTotal) * 100;

      if (memUsagePercent > ENV.SYSTEM.MEMORY_CRITICAL_THRESHOLD * 100) {
        result.warnings.push(
          `Critical memory usage at startup: ${memUsagePercent.toFixed(1)}% of heap limit (${currentHeapUtilization.toFixed(1)}% of current heap) - consider increasing heap size`
        );
      } else if (memUsagePercent > ENV.SYSTEM.MEMORY_WARNING_THRESHOLD * 100) {
        // In development, high memory usage during startup is normal
        this.logger.debug(
          `High memory usage during startup: ${memUsagePercent.toFixed(1)}% of heap limit (${currentHeapUtilization.toFixed(1)}% of current heap) - this is normal during initialization and will stabilize`
        );
      } else {
        this.logger.debug(
          `Memory usage during startup: ${memUsagePercent.toFixed(1)}% of heap limit (${currentHeapUtilization.toFixed(1)}% of current heap) - within normal range`
        );
      }

      // Check available memory
      const os = await import("os");
      const freeMemory = os.freemem();
      const totalMemory = os.totalmem();
      const freeMemoryPercent = (freeMemory / totalMemory) * 100;

      if (freeMemoryPercent < ENV.SYSTEM.FREE_MEMORY_CRITICAL_THRESHOLD * 100) {
        // In development, low system memory is often expected
        this.logger.debug(`Low system memory available: ${freeMemoryPercent.toFixed(1)}% - monitoring for stability`);
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
