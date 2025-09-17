import * as dotenv from "dotenv";
dotenv.config();

import helmet from "helmet";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerDocumentOptions, SwaggerModule } from "@nestjs/swagger";
import { ValidationPipe, LogLevel } from "@nestjs/common";
import { FilteredLogger } from "@/common/logging/filtered-logger";
import { AppModule } from "@/app.module";
import { EnhancedLoggerService } from "@/common/logging/enhanced-logger.service";
import { HttpExceptionFilter } from "@/common/filters/http-exception.filter";
import { EnvironmentUtils } from "@/common/utils/environment.utils";
import { ConfigService } from "@/config/config.service";

// Global application instance for graceful shutdown
let app: INestApplication | null = null;
let logger: FilteredLogger | null = null;
let enhancedLogger: EnhancedLoggerService | null = null;

async function bootstrap() {
  const operationId = `bootstrap_${Date.now()}`;

  try {
    // Initialize filtered logger that handles log level filtering internally
    logger = new FilteredLogger("Bootstrap");

    // Validate critical environment variables first
    await validateEnvironment();

    // Create NestJS application
    const appCreationStart = performance.now();
    app = await NestFactory.create(AppModule, {
      logger: getLogLevels(),
      abortOnError: false, // Allow graceful error handling during startup
    });

    // Get configuration service and initialize enhanced logger
    const configService = app.get(ConfigService);
    const config = configService.getEnvironmentConfig();
    enhancedLogger = new EnhancedLoggerService("Bootstrap", config);

    enhancedLogger.startPerformanceTimer(operationId, "application_bootstrap", "Bootstrap");

    enhancedLogger.logCriticalOperation("application_startup", "Bootstrap", {
      nodeVersion: process.version,
      platform: process.platform,
      pid: process.pid,
      environment: config.nodeEnv,
      timestamp: Date.now(),
    });

    // Start memory monitoring
    startMemoryMonitoring(enhancedLogger);

    // Configure logging levels
    enhancedLogger.log(`Log level configured: ${config.logLevel}`, {
      component: "Bootstrap",
      operation: "configure_logging",
      metadata: {
        logLevel: config.logLevel,
        enableFileLogging: config.logging.enableFileLogging,
        enablePerformanceLogging: config.logging.enablePerformanceLogging,
        enableDebugLogging: config.logging.enableDebugLogging,
      },
    });

    // Configure CORS
    app.enableCors({
      origin: true, // Or specify allowed origins: ["http://localhost:3000", "https://yourdomain.com"]
      methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "Accept"],
      exposedHeaders: ["Content-Range", "X-Total-Count"],
      credentials: true,
      maxAge: 3600,
    });

    const appCreationTime = performance.now() - appCreationStart;

    enhancedLogger.log(`NestJS application created in ${appCreationTime.toFixed(2)}ms`, {
      component: "Bootstrap",
      operation: "create_nestjs_app",
      duration: appCreationTime,
    });

    // Configure security middleware
    app.use(
      helmet({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
          },
        },
      })
    );

    enhancedLogger.log("Security middleware configured", {
      component: "Bootstrap",
      operation: "configure_security",
    });

    // Configure global validation pipe
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        disableErrorMessages: process.env.NODE_ENV === "production",
      })
    );

    // Configure enhanced global exception filter with standardized error handling
    app.useGlobalFilters(new HttpExceptionFilter());

    // Configure API documentation
    const basePath = process.env.VALUE_PROVIDER_CLIENT_BASE_PATH ?? "";
    await setupSwaggerDocumentation(app, basePath);

    // Set global prefix for API routes
    app.setGlobalPrefix(basePath);

    // Configure graceful shutdown handlers
    setupGracefulShutdown();

    // Start the HTTP server
    const PORT = EnvironmentUtils.parseInt("VALUE_PROVIDER_CLIENT_PORT", 3101, { min: 1, max: 65535 });

    const serverStartTime = performance.now();
    await app.listen(PORT, "0.0.0.0");
    const serverStartDuration = performance.now() - serverStartTime;

    enhancedLogger.logCriticalOperation(
      "http_server_started",
      "Bootstrap",
      {
        port: PORT,
        host: "0.0.0.0",
        basePath,
        startupTime: serverStartDuration,
      },
      true
    );

    // Wait for application to be fully initialized
    await waitForApplicationReady();

    enhancedLogger.logCriticalOperation(
      "application_startup",
      "Bootstrap",
      {
        status: "completed",
        port: PORT,
        basePath,
        readyToServe: true,
      },
      true
    );

    enhancedLogger.endPerformanceTimer(operationId, true, {
      port: PORT,
      basePath,
      environment: process.env.NODE_ENV || "development",
    });
  } catch (error) {
    const errObj = error instanceof Error ? error : new Error(String(error));

    // Use enhanced logger if available, otherwise fall back to standard logger
    if (enhancedLogger) {
      enhancedLogger.error(errObj, {
        component: "Bootstrap",
        operation: "application_startup",
        severity: "critical",
        metadata: {
          phase: "bootstrap",
          environment: process.env.NODE_ENV || "development",
        },
      });
      enhancedLogger.endPerformanceTimer(operationId, false, { error: errObj.message });
    } else if (logger) {
      logger.error("Application startup failed:", errObj.stack, errObj.message);
    }

    // Attempt graceful cleanup
    if (app) {
      try {
        await app.close();
        if (enhancedLogger) {
          enhancedLogger.log("Application cleanup completed during startup failure", {
            component: "Bootstrap",
            operation: "cleanup_on_failure",
          });
        } else if (logger) {
          logger.log("Application cleanup completed during startup failure");
        }
      } catch (closeError) {
        const closeErrObj = closeError instanceof Error ? closeError : new Error(String(closeError));
        if (enhancedLogger) {
          enhancedLogger.error(closeErrObj, {
            component: "Bootstrap",
            operation: "cleanup_on_failure",
            severity: "high",
          });
        } else if (logger) {
          logger.error("Application cleanup failed:", closeErrObj.stack, closeErrObj.message);
        }
      }
    }

    process.exit(1);
  }
}

async function validateEnvironment(): Promise<void> {
  const requiredEnvVars = ["VALUE_PROVIDER_CLIENT_PORT"];

  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(", ")}`);
  }

  // Validate port number
  EnvironmentUtils.parseInt("VALUE_PROVIDER_CLIENT_PORT", 3101, { min: 1, max: 65535 });

  // Logger now handles filtering internally
  if (logger) {
    logger.log("✅ Environment validation passed");
  }
}

function getLogLevels(): LogLevel[] {
  const logLevel = process.env.LOG_LEVEL?.toLowerCase();

  switch (logLevel) {
    case "fatal":
      return ["fatal"];
    case "error":
      return ["fatal", "error"];
    case "warn":
      return ["fatal", "error", "warn"];
    case "log":
      return ["fatal", "error", "warn", "log"];
    case "debug":
      return ["fatal", "error", "warn", "log", "debug"];
    case "verbose":
      return ["fatal", "error", "warn", "log", "debug", "verbose"];
    default:
      return ["fatal", "error", "warn", "log"];
  }
}

async function setupSwaggerDocumentation(app: INestApplication, basePath: string): Promise<void> {
  try {
    const config = new DocumentBuilder()
      .setTitle("Production FTSO Feed Value Provider API")
      .setDescription(
        "Production-grade FTSO protocol data provider with real-time caching, rate limiting, and comprehensive error handling."
      )
      .setVersion("1.0.0")
      .addTag("FTSO Provider", "Feed value and volume data endpoints")
      .addTag("System Health", "Health check and monitoring endpoints")
      .build();

    const options: SwaggerDocumentOptions = {
      operationIdFactory: (_controllerKey: string, methodKey: string) => methodKey,
    };

    const document = SwaggerModule.createDocument(app, config, options);
    SwaggerModule.setup(`${basePath}/api-doc`, app, document);

    if (logger) {
      logger.log("✅ API documentation configured");
    }
  } catch (error) {
    if (logger) {
      logger.error("Failed to setup Swagger documentation:", String(error));
    }
    throw error;
  }
}

function setupGracefulShutdown(): void {
  let isShuttingDown = false;

  // Handle process termination signals
  const signals = ["SIGTERM", "SIGINT", "SIGUSR2"];

  signals.forEach(signal => {
    process.on(signal, async () => {
      if (isShuttingDown) {
        if (logger) {
          logger.log(`Received ${signal} during shutdown, ignoring...`);
        }
        return;
      }

      isShuttingDown = true;
      if (logger) {
        logger.log(`Received ${signal}, starting graceful shutdown...`);
      }

      try {
        await gracefulShutdown();
        process.exit(0);
      } catch (error) {
        if (logger) {
          logger.error(`Error during ${signal} shutdown:`, String(error));
        }
        process.exit(1);
      }
    });
  });

  // Handle uncaught exceptions
  process.on("uncaughtException", async error => {
    if (isShuttingDown) {
      if (logger) {
        logger.log("Uncaught exception during shutdown, ignoring...");
      }
      return;
    }

    isShuttingDown = true;
    if (logger) {
      logger.error("Uncaught Exception:", error.stack, error.message);
    }

    try {
      await gracefulShutdown();
    } catch (shutdownError) {
      if (logger) {
        logger.error("Error during exception shutdown:", String(shutdownError));
      }
    }

    process.exit(1);
  });

  // Handle unhandled promise rejections
  process.on("unhandledRejection", async (reason, promise) => {
    if (isShuttingDown) {
      if (logger) {
        logger.log("Unhandled rejection during shutdown, ignoring...");
      }
      return;
    }

    isShuttingDown = true;
    if (logger) {
      logger.error(`Unhandled Rejection at: ${promise} reason: ${reason}`);
    }

    try {
      await gracefulShutdown();
    } catch (shutdownError) {
      if (logger) {
        logger.error("Error during rejection shutdown:", String(shutdownError));
      }
    }

    process.exit(1);
  });

  if (logger) {
    logger.log("✅ Graceful shutdown handlers configured");
  }
}

async function gracefulShutdown(): Promise<void> {
  if (!app) {
    if (logger) {
      logger.log("No application instance to shutdown");
    }
    return;
  }

  try {
    if (logger) {
      logger.log("🛑 Initiating graceful shutdown...");
    }

    // Set a timeout for shutdown process
    const timeoutMs = EnvironmentUtils.parseInt("GRACEFUL_SHUTDOWN_TIMEOUT_MS", 30000, { min: 1000, max: 300000 });
    const shutdownTimeout = setTimeout(() => {
      if (logger) {
        logger.error(`⏰ Shutdown timeout reached after ${timeoutMs}ms, forcing exit`);
      }
      process.exit(1);
    }, timeoutMs);

    // Log shutdown start time
    const shutdownStartTime = Date.now();

    // Close the NestJS application (this will trigger OnModuleDestroy hooks)
    if (logger) {
      logger.log("Closing NestJS application...");
    }
    await app.close();

    // Clear the app reference
    app = null;

    const shutdownDuration = Date.now() - shutdownStartTime;
    clearTimeout(shutdownTimeout);

    if (logger) {
      logger.log(`✅ Graceful shutdown completed in ${shutdownDuration}ms`);
    }

    // Give a moment for any final cleanup
    await new Promise(resolve => setTimeout(resolve, 100));
  } catch (error) {
    const errObj = error instanceof Error ? error : new Error(String(error));
    if (logger) {
      logger.error("❌ Error during graceful shutdown:", errObj.stack, errObj.message);
    }

    // Force exit after a short delay to allow error logging
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  }
}

async function waitForApplicationReady(): Promise<void> {
  const maxWaitTime = EnvironmentUtils.parseInt("APP_READINESS_TIMEOUT_MS", 30000, { min: 1000, max: 300000 });
  const checkInterval = 1000; // 1 second
  const startTime = Date.now();

  if (logger) {
    logger.log("Waiting for application to be ready...");
  }

  while (Date.now() - startTime < maxWaitTime) {
    try {
      // Try to access the health endpoint to verify the application is ready
      const port = process.env.VALUE_PROVIDER_CLIENT_PORT || 3101;
      const basePath = process.env.VALUE_PROVIDER_CLIENT_BASE_PATH || "";
      const url = `http://localhost:${port}${basePath}/health/ready`;

      // Create a timeout promise
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Request timeout")), 5000)
      );

      const response = await Promise.race([fetch(url, { method: "GET" }), timeoutPromise]);

      if (response.ok) {
        const data = await response.json();
        if (data.ready) {
          if (logger) {
            logger.log(`✅ Application ready after ${Date.now() - startTime}ms`);
          }
          return; // Application is ready
        }
      }
    } catch (error) {
      // Health check not ready yet, continue waiting
      const msg = error instanceof Error ? error.message : String(error);
      if (logger) {
        logger.debug(`Readiness check failed: ${msg}`);
      }
    }

    await new Promise(resolve => setTimeout(resolve, checkInterval));
  }

  if (logger) {
    logger.warn(`⚠️ Application readiness check timed out after ${maxWaitTime}ms, but continuing startup`);
  }
}

function startMemoryMonitoring(_logger: EnhancedLoggerService): void {
  const memoryCheckInterval = 30000; // Check every 30 seconds
  const memoryWarningThreshold = 0.8; // 80% of heap used
  const memoryCriticalThreshold = 0.9; // 90% of heap used

  setInterval(() => {
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
    const heapUsedPercent = memUsage.heapUsed / memUsage.heapTotal;

    const memoryInfo = {
      heapUsed: `${heapUsedMB}MB`,
      heapTotal: `${heapTotalMB}MB`,
      heapUsedPercent: `${(heapUsedPercent * 100).toFixed(1)}%`,
      external: `${Math.round(memUsage.external / 1024 / 1024)}MB`,
      rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
    };

    if (heapUsedPercent >= memoryCriticalThreshold) {
      if (logger) {
        logger.error(`CRITICAL: Memory usage is dangerously high - ${JSON.stringify(memoryInfo)}`);
      }
    } else if (heapUsedPercent >= memoryWarningThreshold) {
      if (logger) {
        logger.warn(`WARNING: Memory usage is high - ${JSON.stringify(memoryInfo)}`);
      }
    } else {
      if (logger) {
        logger.debug(`Memory usage normal - ${JSON.stringify(memoryInfo)}`);
      }
    }
  }, memoryCheckInterval);

  if (logger) {
    logger.log(
      `Memory monitoring started - checkInterval: ${memoryCheckInterval}ms, warningThreshold: ${memoryWarningThreshold * 100}%, criticalThreshold: ${memoryCriticalThreshold * 100}%`
    );
  }
}

// Start the application
void bootstrap();
