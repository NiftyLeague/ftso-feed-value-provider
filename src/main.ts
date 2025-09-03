import * as dotenv from "dotenv";
dotenv.config();

import helmet from "helmet";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerDocumentOptions, SwaggerModule } from "@nestjs/swagger";
import { LogLevel, Logger, ValidationPipe } from "@nestjs/common";
import { AppModule } from "@/app.module";
import { EnhancedLoggerService } from "@/common/logging/enhanced-logger.service";

// Global application instance for graceful shutdown
let app: INestApplication | null = null;
const logger = new Logger("Bootstrap");
const enhancedLogger = new EnhancedLoggerService("Bootstrap");

async function bootstrap() {
  const operationId = `bootstrap_${Date.now()}`;
  enhancedLogger.startPerformanceTimer(operationId, "application_bootstrap", "Bootstrap");

  try {
    enhancedLogger.logCriticalOperation("application_startup", "Bootstrap", {
      nodeVersion: process.version,
      platform: process.platform,
      pid: process.pid,
      environment: process.env.NODE_ENV || "development",
      timestamp: Date.now(),
    });

    // Validate critical environment variables
    await validateEnvironment();

    // Configure logging levels
    const logLevels = getLogLevels();
    enhancedLogger.log(`Log level configured: ${process.env.LOG_LEVEL || "log"}`, {
      component: "Bootstrap",
      operation: "configure_logging",
      metadata: {
        logLevel: process.env.LOG_LEVEL || "log",
        enableFileLogging: process.env.ENABLE_FILE_LOGGING,
        enablePerformanceLogging: process.env.ENABLE_PERFORMANCE_LOGGING,
        enableDebugLogging: process.env.ENABLE_DEBUG_LOGGING,
      },
    });

    // Create NestJS application
    const appCreationStart = performance.now();
    app = await NestFactory.create(AppModule, {
      logger: logLevels,
      abortOnError: false, // Allow graceful error handling during startup
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

    // Configure API documentation
    const basePath = process.env.VALUE_PROVIDER_CLIENT_BASE_PATH ?? "";
    await setupSwaggerDocumentation(app, basePath);

    // Set global prefix for API routes
    app.setGlobalPrefix(basePath);

    // Configure graceful shutdown handlers
    setupGracefulShutdown();

    // Start the HTTP server
    const PORT = process.env.VALUE_PROVIDER_CLIENT_PORT ? parseInt(process.env.VALUE_PROVIDER_CLIENT_PORT, 10) : 3101;

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

    // Attempt graceful cleanup
    if (app) {
      try {
        await app.close();
        enhancedLogger.log("Application cleanup completed during startup failure", {
          component: "Bootstrap",
          operation: "cleanup_on_failure",
        });
      } catch (closeError) {
        const closeErrObj = closeError instanceof Error ? closeError : new Error(String(closeError));
        enhancedLogger.error(closeErrObj, {
          component: "Bootstrap",
          operation: "cleanup_on_failure",
          severity: "high",
        });
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
  const port = parseInt(process.env.VALUE_PROVIDER_CLIENT_PORT || "3101", 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port number: ${process.env.VALUE_PROVIDER_CLIENT_PORT}`);
  }

  logger.log("✅ Environment validation passed");
}

function getLogLevels(): LogLevel[] {
  const logLevel = process.env.LOG_LEVEL?.toLowerCase();

  switch (logLevel) {
    case "error":
      return ["error"];
    case "warn":
      return ["error", "warn"];
    case "debug":
      return ["error", "warn", "log", "debug", "verbose"];
    case "verbose":
      return ["error", "warn", "log", "debug", "verbose"];
    default:
      return ["error", "warn", "log"];
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

    logger.log("✅ API documentation configured");
  } catch (error) {
    logger.error("Failed to setup Swagger documentation:", error);
    throw error;
  }
}

function setupGracefulShutdown(): void {
  // Handle process termination signals
  const signals = ["SIGTERM", "SIGINT", "SIGUSR2"];

  signals.forEach(signal => {
    process.on(signal, async () => {
      logger.log(`Received ${signal}, starting graceful shutdown...`);
      await gracefulShutdown();
    });
  });

  // Handle uncaught exceptions
  process.on("uncaughtException", async error => {
    logger.error("Uncaught Exception:", error);
    await gracefulShutdown();
    process.exit(1);
  });

  // Handle unhandled promise rejections
  process.on("unhandledRejection", async (reason, promise) => {
    logger.error("Unhandled Rejection at:", promise, "reason:", reason);
    await gracefulShutdown();
    process.exit(1);
  });

  logger.log("✅ Graceful shutdown handlers configured");
}

async function gracefulShutdown(): Promise<void> {
  if (!app) {
    return;
  }

  try {
    logger.log("🛑 Initiating graceful shutdown...");

    // Set a timeout for shutdown process
    const timeoutMs = parseInt(process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS || "30000", 10);
    const shutdownTimeout = setTimeout(() => {
      logger.error(`⏰ Shutdown timeout reached after ${timeoutMs}ms, forcing exit`);
      process.exit(1);
    }, timeoutMs);

    // Close the NestJS application (this will trigger OnModuleDestroy hooks)
    await app.close();

    clearTimeout(shutdownTimeout);
    logger.log("✅ Graceful shutdown completed");
  } catch (error) {
    logger.error("❌ Error during graceful shutdown:", error);
    process.exit(1);
  }
}

async function waitForApplicationReady(): Promise<void> {
  const maxWaitTime = parseInt(process.env.APP_READINESS_TIMEOUT_MS || "30000", 10);
  const checkInterval = 1000; // 1 second
  const startTime = Date.now();

  logger.log("Waiting for application to be ready...");

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
          logger.log(`✅ Application ready after ${Date.now() - startTime}ms`);
          return; // Application is ready
        }
      }
    } catch (error) {
      // Health check not ready yet, continue waiting
      const msg = error instanceof Error ? error.message : String(error);
      logger.debug(`Readiness check failed: ${msg}`);
    }

    await new Promise(resolve => setTimeout(resolve, checkInterval));
  }

  logger.warn(`⚠️ Application readiness check timed out after ${maxWaitTime}ms, but continuing startup`);
}

// Start the application
void bootstrap();
