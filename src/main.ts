import * as dotenv from "dotenv";
dotenv.config();

import helmet from "helmet";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerDocumentOptions, SwaggerModule } from "@nestjs/swagger";
import { ValidationPipe, LogLevel } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";
import { FilteredLogger } from "@/common/logging/filtered-logger";
import { AppModule } from "@/app.module";
import { EnhancedLoggerService } from "@/common/logging/enhanced-logger.service";
import { HttpExceptionFilter } from "@/common/filters/http-exception.filter";
import { RateLimitGuard } from "@/common/rate-limiting/rate-limit.guard";
import { RateLimiterService } from "@/common/rate-limiting/rate-limiter.service";
import { ENV, ENV_HELPERS } from "@/config/environment.constants";

// Global application instance for graceful shutdown
let app: INestApplication | null = null;
let logger: FilteredLogger | null = null;
let enhancedLogger: EnhancedLoggerService | null = null;
let memoryMonitoringInterval: NodeJS.Timeout | null = null;

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

    // Initialize enhanced logger (uses ENV constants directly)
    enhancedLogger = new EnhancedLoggerService("Bootstrap");

    enhancedLogger.startPerformanceTimer(operationId, "application_bootstrap", "Bootstrap");

    // Log heap size configuration for verification
    const v8 = await import("v8");
    const heapStats = v8.getHeapStatistics();
    const heapSizeMB = Math.round(heapStats.heap_size_limit / 1024 / 1024);

    enhancedLogger.log(`Node.js heap size configured: ${heapSizeMB}MB`, {
      component: "Bootstrap",
      operation: "heap_verification",
      heapSizeLimitMB: heapSizeMB,
      nodeOptions: process.env.NODE_OPTIONS || null,
      isProductionReady: heapSizeMB >= 1000, // 1GB minimum for production
    });

    enhancedLogger.logCriticalOperation("application_startup", "Bootstrap", {
      nodeVersion: process.version,
      platform: process.platform,
      pid: process.pid,
      environment: ENV.APPLICATION.NODE_ENV,
      heapSizeMB: heapSizeMB,
      timestamp: Date.now(),
    });

    // Start memory monitoring
    startMemoryMonitoring(enhancedLogger);

    // Configure logging levels
    enhancedLogger.log(`Log level configured: ${ENV.LOGGING.LOG_LEVEL}`, {
      component: "Bootstrap",
      operation: "configure_logging",
      metadata: {
        logLevel: ENV.LOGGING.LOG_LEVEL,
        enableFileLogging: ENV.LOGGING.ENABLE_FILE_LOGGING,
        enablePerformanceLogging: ENV.LOGGING.ENABLE_PERFORMANCE_LOGGING,
        enableDebugLogging: ENV.LOGGING.ENABLE_DEBUG_LOGGING,
      },
    });

    const appCreationTime = performance.now() - appCreationStart;

    enhancedLogger.log(`NestJS application created in ${appCreationTime.toFixed(2)}ms`, {
      component: "Bootstrap",
      operation: "create_nestjs_app",
      duration: appCreationTime,
    });

    // Configure CORS with proper security settings
    app.enableCors({
      origin: process.env.CORS_ORIGIN || true, // Allow all origins in development, restrict in production
      methods: ["GET", "POST", "OPTIONS"], // Only allow necessary methods
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
      exposedHeaders: ["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"],
      credentials: false,
      maxAge: ENV.APPLICATION.CORS_MAX_AGE,
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
        crossOriginEmbedderPolicy: false, // Allow for API usage
        hsts: {
          maxAge: 31536000,
          includeSubDomains: true,
          preload: true,
        },
      })
    );

    enhancedLogger.log("Security middleware configured", {
      component: "Bootstrap",
      operation: "configure_security",
    });

    // Add HTTP method filtering middleware
    app.use((req: Request, res: Response, next: NextFunction): void => {
      const allowedMethods = ["GET", "POST", "OPTIONS"];
      if (!allowedMethods.includes(req.method)) {
        res.status(405).json({
          success: false,
          error: {
            code: "METHOD_NOT_ALLOWED",
            message: "Method Not Allowed",
            severity: "medium",
            module: "HttpFilter",
            timestamp: Date.now(),
            context: {
              classification: "VALIDATION_ERROR",
              method: req.method,
              allowedMethods,
              httpStatus: 405,
            },
          },
          timestamp: Date.now(),
          requestId: `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
          retryable: false,
        });
        return;
      }
      next();
    });

    // Add Content-Type validation middleware for POST requests
    app.use((req: Request, res: Response, next: NextFunction): void => {
      if (req.method === "POST") {
        const contentType = req.get("Content-Type");
        if (!contentType || !contentType.includes("application/json")) {
          res.status(415).json({
            success: false,
            error: {
              code: "UNSUPPORTED_MEDIA_TYPE",
              message: "Unsupported Media Type. Only application/json is accepted.",
              severity: "medium",
              module: "HttpFilter",
              timestamp: Date.now(),
              context: {
                classification: "VALIDATION_ERROR",
                method: req.method,
                contentType: contentType || "none",
                expectedContentType: "application/json",
                httpStatus: 415,
              },
            },
            timestamp: Date.now(),
            requestId: `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
            retryable: false,
          });
          return;
        }
      }
      next();
    });

    // Configure global validation pipe
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        disableErrorMessages: ENV_HELPERS.isProduction(),
      })
    );

    // Configure enhanced global exception filter with standardized error handling
    app.useGlobalFilters(new HttpExceptionFilter());

    // Configure global rate limiting
    const rateLimiterService = new RateLimiterService({
      windowMs: 60000, // 1 minute
      maxRequests: 100, // 100 requests per minute per client
      skipSuccessfulRequests: false,
      skipFailedRequests: false,
    });

    const rateLimitGuard = new RateLimitGuard(rateLimiterService);
    app.useGlobalGuards(rateLimitGuard);

    enhancedLogger.log("Rate limiting configured", {
      component: "Bootstrap",
      operation: "configure_rate_limiting",
      windowMs: 60000,
      maxRequests: 100,
    });

    // Configure API documentation
    const basePath = ENV.APPLICATION.BASE_PATH;
    await setupSwaggerDocumentation(app, basePath);

    // Set global prefix for API routes
    app.setGlobalPrefix(basePath);

    // Configure graceful shutdown handlers
    setupGracefulShutdown();

    // Start the HTTP server IMMEDIATELY to avoid blocking
    const PORT = ENV.APPLICATION.PORT;

    if (enhancedLogger) {
      enhancedLogger.log("🚀 Starting HTTP server...", {
        component: "Bootstrap",
        operation: "start_http_server",
        port: PORT,
      });
    }

    const serverStartTime = performance.now();
    try {
      await app.listen(PORT, "0.0.0.0");

      if (enhancedLogger) {
        enhancedLogger.log(`🎉 HTTP server is now listening on port ${PORT}`, {
          component: "Bootstrap",
          operation: "server_listening",
          port: PORT,
          host: "0.0.0.0",
        });
      }
    } catch (error) {
      const errObj = error instanceof Error ? error : new Error(String(error));

      if (errObj.message.includes("EADDRINUSE")) {
        enhancedLogger.error(errObj, {
          component: "Bootstrap",
          operation: "server_startup",
          severity: "critical",
          metadata: {
            port: PORT,
            suggestion: "Port is already in use. Try stopping other instances or use a different port.",
          },
        });

        // In development, suggest solutions
        if (!ENV_HELPERS.isProduction()) {
          console.error(`\n🚨 Port ${PORT} is already in use!`);
          console.error(`💡 Try running: lsof -ti :${PORT} | xargs kill`);
          console.error(`💡 Or set a different port: export APP_PORT=3102\n`);
        }
      }

      throw errObj;
    }
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

    // Log successful server startup
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

    // Application is ready to serve requests
    // Start non-blocking readiness monitoring with delay to avoid error logs during initialization
    if (enhancedLogger) {
      setTimeout(() => {
        void checkApplicationReadiness(enhancedLogger!, PORT, basePath);
      }, 10000); // Give integration service and data sources time to initialize (increased from 5s to 10s)
    }

    enhancedLogger.endPerformanceTimer(operationId, true, {
      port: PORT,
      basePath,
      environment: ENV.APPLICATION.NODE_ENV,
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
          environment: ENV.APPLICATION.NODE_ENV,
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
  // Validate port number using centralized constants (includes existence check)
  // Port validation is handled during ENV.PORT initialization

  // Logger now handles filtering internally
  if (logger) {
    logger.log("✅ Environment validation passed");
  }
}

function getLogLevels(): LogLevel[] {
  const logLevel = ENV.LOGGING.LOG_LEVEL.toLowerCase();

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
        "Production-grade FTSO protocol data provider with real-time caching, rate limiting, and comprehensive error handling. " +
          "Provides sub-100ms response times for feed values with 1-second cache TTL and Kubernetes-compatible health probes."
      )
      .setVersion("1.0.0")
      .addTag(
        "FTSO Feed Values",
        "Real-time and historical feed value endpoints with sub-100ms response times and comprehensive error handling"
      )
      .addTag(
        "System Health",
        "Kubernetes-compatible health probes (liveness, readiness) and detailed system health monitoring"
      )
      .addTag(
        "API Metrics and Monitoring",
        "Prometheus-compatible metrics and detailed API performance analytics with endpoint statistics"
      )
      .addTag("Configuration", "Runtime configuration inspection and validation endpoints for system diagnostics")
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
    const timeoutMs = ENV.TIMEOUTS.GRACEFUL_SHUTDOWN_MS;
    const shutdownTimeout = setTimeout(() => {
      if (logger) {
        logger.error(`⏰ Shutdown timeout reached after ${timeoutMs}ms, forcing exit`);
      }
      process.exit(1);
    }, timeoutMs);

    // Log shutdown start time
    const shutdownStartTime = Date.now();

    // Clear memory monitoring interval
    if (memoryMonitoringInterval) {
      clearInterval(memoryMonitoringInterval);
      memoryMonitoringInterval = null;
      if (logger) {
        logger.log("Memory monitoring interval cleared");
      }
    }

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
    await new Promise(resolve => setTimeout(resolve, ENV.TIMEOUTS.CLEANUP_DELAY_MS));
  } catch (error) {
    const errObj = error instanceof Error ? error : new Error(String(error));
    if (logger) {
      logger.error("❌ Error during graceful shutdown:", errObj.stack, errObj.message);
    }

    // Force exit after a short delay to allow error logging
    setTimeout(() => {
      process.exit(1);
    }, ENV.TIMEOUTS.FORCE_EXIT_DELAY_MS);
  }
}

async function checkApplicationReadiness(logger: EnhancedLoggerService, port: number, basePath: string): Promise<void> {
  const maxAttempts = 6; // Try for 60 seconds (6 * 10s intervals) - reduced frequency
  let attempts = 0;

  const checkReadiness = async (): Promise<void> => {
    attempts++;

    try {
      const url = `http://localhost:${port}${basePath}/health/ready`;
      const response = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(ENV.TIMEOUTS.READINESS_REQUEST_TIMEOUT_MS),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.ready) {
          logger.log(`✅ Application readiness confirmed after ${attempts * 10} seconds`);
          return;
        }
      }

      // Not ready yet, but server is responding
      logger.debug(`Readiness check ${attempts}/${maxAttempts}: System not fully ready yet`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.debug(`Readiness check ${attempts}/${maxAttempts}: ${msg}`);
    }

    // Schedule next check if we haven't exceeded max attempts
    if (attempts < maxAttempts) {
      setTimeout(checkReadiness, 10000); // Increased from 5s to 10s
    } else {
      logger.warn(
        `⚠️ Application readiness monitoring completed after ${maxAttempts * 10} seconds. System may still be initializing.`
      );
    }
  };

  // Start the first check
  await checkReadiness();
}

function startMemoryMonitoring(_logger: EnhancedLoggerService): void {
  const memoryCheckInterval = ENV.INTERVALS.SYSTEM_CHECK_MS;
  const memoryWarningThreshold = ENV.SYSTEM.MEMORY_WARNING_THRESHOLD;
  const memoryCriticalThreshold = ENV.SYSTEM.MEMORY_CRITICAL_THRESHOLD;

  memoryMonitoringInterval = setInterval(async () => {
    const memUsage = process.memoryUsage();
    const v8 = await import("v8");
    const heapStats = v8.getHeapStatistics();

    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
    const heapLimitMB = Math.round(heapStats.heap_size_limit / 1024 / 1024);

    // Use heap limit for percentage calculation, not current heap total
    const heapUsedPercent = memUsage.heapUsed / heapStats.heap_size_limit;
    const currentHeapUtilization = memUsage.heapUsed / memUsage.heapTotal;

    const memoryInfo = {
      heapUsed: `${heapUsedMB}MB`,
      heapTotal: `${heapTotalMB}MB`,
      heapLimit: `${heapLimitMB}MB`,
      heapUsedPercent: `${(heapUsedPercent * 100).toFixed(1)}%`,
      currentHeapUtilization: `${(currentHeapUtilization * 100).toFixed(1)}%`,
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
