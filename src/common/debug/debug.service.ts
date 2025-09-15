import { Injectable, Logger } from "@nestjs/common";

@Injectable()
export class DebugService {
  private readonly logger = new Logger(DebugService.name);

  constructor() {
    this.logger.log("Debug service initialized - only available in development mode");
  }

  logDebug(message: string, context?: Record<string, unknown>): void {
    this.logger.debug(`[DEBUG] ${message}`, context);
  }

  logPerformance(operation: string, duration: number): void {
    this.logger.debug(`[PERF] ${operation} took ${duration}ms`);
  }

  logMemoryUsage(): void {
    const usage = process.memoryUsage();
    this.logger.debug(
      `[MEMORY] RSS: ${Math.round(usage.rss / 1024 / 1024)}MB, Heap: ${Math.round(usage.heapUsed / 1024 / 1024)}MB`
    );
  }
}
