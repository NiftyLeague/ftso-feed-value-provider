import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ProductionIntegrationService } from "./production-integration.service";
import { FtsoProviderService } from "@/app.service";
import { ConfigService } from "@/config/config.service";

interface StartupValidationResult {
  success: boolean;
  errors: string[];
  warnings: string[];
  validatedServices: string[];
  timestamp: number;
  validationTime: number;
}

@Injectable()
export class StartupValidationService implements OnModuleInit {
  private readonly logger = new Logger(StartupValidationService.name);
  private validationResult: StartupValidationResult | null = null;

  constructor(
    private readonly integrationService: ProductionIntegrationService,
    private readonly configService: ConfigService
  ) {}

  async onModuleInit(): Promise<void> {
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
        this.logger.error("❌ Application startup validation failed");
        this.validationResult.errors.forEach(error => {
          this.logger.error(`❌ ${error}`);
        });
        throw new Error(`Startup validation failed: ${this.validationResult.errors.join(", ")}`);
      }
    } catch (error) {
      this.logger.error("Fatal error during startup validation:", error);
      throw error;
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
      result.errors.push(`Validation process failed: ${error.message}`);
      result.success = false;
      result.validationTime = Date.now() - startTime;
      return result;
    }
  }

  private async validateConfiguration(result: StartupValidationResult): Promise<void> {
    try {
      // Test configuration service
      const feedConfigs = this.configService.getFeedConfigurations();

      if (!feedConfigs || feedConfigs.length === 0) {
        result.warnings.push("No feed configurations found - system may not provide data");
      } else {
        this.logger.debug(`Found ${feedConfigs.length} feed configurations`);
      }

      result.validatedServices.push("ConfigService");
    } catch (error) {
      result.errors.push(`Configuration validation failed: ${error.message}`);
    }
  }

  private async validateIntegrationService(result: StartupValidationResult): Promise<void> {
    try {
      // Test integration service health
      const health = await this.integrationService.getSystemHealth();

      if (health.status === "unhealthy") {
        result.errors.push("Integration service is unhealthy");
      } else if (health.status === "degraded") {
        result.warnings.push("Integration service is in degraded state");
      }

      // Check adapter connections
      if (health.adapters && health.adapters.totalAdapters === 0) {
        result.warnings.push("No exchange adapters are registered");
      } else if (health.adapters && health.adapters.activeAdapters === 0) {
        result.warnings.push("No exchange adapters are active");
      }

      result.validatedServices.push("ProductionIntegrationService");
    } catch (error) {
      result.errors.push(`Integration service validation failed: ${error.message}`);
    }
  }

  private validateEnvironmentVariables(result: StartupValidationResult): void {
    const requiredVars = ["VALUE_PROVIDER_CLIENT_PORT", "USE_PRODUCTION_INTEGRATION", "NODE_ENV"];

    const missingVars = requiredVars.filter(varName => !process.env[varName]);

    if (missingVars.length > 0) {
      result.errors.push(`Missing required environment variables: ${missingVars.join(", ")}`);
    }

    // Validate port
    const port = parseInt(process.env.VALUE_PROVIDER_CLIENT_PORT || "3101");
    if (isNaN(port) || port < 1 || port > 65535) {
      result.errors.push(`Invalid port number: ${process.env.VALUE_PROVIDER_CLIENT_PORT}`);
    }

    // Check for API keys if in production mode
    if (process.env.USE_PRODUCTION_INTEGRATION === "true") {
      const exchangeKeys = [
        "BINANCE_API_KEY",
        "COINBASE_API_KEY",
        "KRAKEN_API_KEY",
        "OKX_API_KEY",
        "CRYPTOCOM_API_KEY",
      ];

      const missingKeys = exchangeKeys.filter(key => !process.env[key]);
      if (missingKeys.length === exchangeKeys.length) {
        result.warnings.push("No exchange API keys configured - may limit data availability");
      }
    }

    result.validatedServices.push("Environment Variables");
  }

  private validateSystemResources(result: StartupValidationResult): void {
    try {
      // Check memory usage
      const memUsage = process.memoryUsage();
      const memUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;

      if (memUsagePercent > 80) {
        result.warnings.push(`High memory usage at startup: ${memUsagePercent.toFixed(1)}%`);
      }

      // Check available memory
      const os = require("os");
      const freeMemory = os.freemem();
      const totalMemory = os.totalmem();
      const freeMemoryPercent = (freeMemory / totalMemory) * 100;

      if (freeMemoryPercent < 10) {
        result.warnings.push(`Low system memory available: ${freeMemoryPercent.toFixed(1)}%`);
      }

      // Check Node.js version
      const nodeVersion = process.version;
      const majorVersion = parseInt(nodeVersion.substring(1).split(".")[0]);

      if (majorVersion < 18) {
        result.warnings.push(`Node.js version ${nodeVersion} may not be fully supported (recommended: 18+)`);
      }

      result.validatedServices.push("System Resources");
    } catch (error) {
      result.warnings.push(`System resource validation failed: ${error.message}`);
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
