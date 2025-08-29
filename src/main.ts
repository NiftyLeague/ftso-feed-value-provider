import * as dotenv from "dotenv";
dotenv.config();

import helmet from "helmet";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerDocumentOptions, SwaggerModule } from "@nestjs/swagger";
import { LogLevel, Logger, ValidationPipe } from "@nestjs/common";
import { AppModule } from "@/app.module";

// Global application instance for graceful shutdown
let app: any = null;
const logger = new Logger("Bootstrap");

async function bootstrap() {
  try {
    logger.log("Starting Production FTSO Feed Value Provider...");

    // Validate critical environment variables
    await validateEnvironment();

    // Configure logging levels
    const logLevels = getLogLevels();
    logger.log(`Log level configured: ${process.env.LOG_LEVEL || "log"}`);

    // Create NestJS application
    app = await NestFactory.create(AppModule, {
      logger: logLevels,
      abortOnError: false, // Allow graceful error handling during startup
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
    const PORT = process.env.VALUE_PROVIDER_CLIENT_PORT ? parseInt(process.env.VALUE_PROVIDER_CLIENT_PORT) : 3101;

    await app.listen(PORT, "0.0.0.0");

    logger.log(`✅ Production FTSO Feed Value Provider started successfully`);
    logger.log(`🌐 Server listening on: http://localhost:${PORT}`);
    logger.log(`📚 API Documentation: http://localhost:${PORT}${basePath}/api-doc`);
    logger.log(`🏥 Health Check: http://localhost:${PORT}${basePath}/health`);

    // Wait for application to be fully initialized
    await waitForApplicationReady();

    logger.log("🚀 Application is ready to serve requests");
  } catch (error) {
    logger.error("❌ Failed to start application:", error);

    // Attempt graceful cleanup
    if (app) {
      try {
        await app.close();
      } catch (closeError) {
        logger.error("Error during cleanup:", closeError);
      }
    }

    process.exit(1);
  }
}

async function validateEnvironment(): Promise<void> {
  const requiredEnvVars = ["VALUE_PROVIDER_CLIENT_PORT", "USE_PRODUCTION_INTEGRATION"];

  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(", ")}`);
  }

  // Validate port number
  const port = parseInt(process.env.VALUE_PROVIDER_CLIENT_PORT || "3101");
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

async function setupSwaggerDocumentation(app: any, basePath: string): Promise<void> {
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
      operationIdFactory: (controllerKey: string, methodKey: string) => methodKey,
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
    const timeoutMs = parseInt(process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS || "30000");
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
  const maxWaitTime = parseInt(process.env.APP_READINESS_TIMEOUT_MS || "30000");
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
      logger.debug(`Readiness check failed: ${error.message}`);
    }

    await new Promise(resolve => setTimeout(resolve, checkInterval));
  }

  logger.warn(`⚠️ Application readiness check timed out after ${maxWaitTime}ms, but continuing startup`);
}

// Start the application
void bootstrap();
