import { Logger } from "@nestjs/common";
import { shouldLog, type LogLevel } from "../types/logging";

/**
 * A NestJS Logger that automatically filters messages based on LOG_LEVEL
 * This makes log level filtering transparent to calling code
 */
export class FilteredLogger extends Logger {
  private readonly currentLogLevel: LogLevel;

  constructor(context: string) {
    super(context);
    this.currentLogLevel = (process.env.LOG_LEVEL as LogLevel) || "log";
  }

  /**
   * Override log method to add filtering
   */
  override log(message: unknown, ...optionalParams: unknown[]): void {
    if (shouldLog("log", this.currentLogLevel)) {
      super.log(message, ...optionalParams);
    }
  }

  /**
   * Override error method to add filtering
   */
  override error(message: unknown, ...optionalParams: unknown[]): void {
    if (shouldLog("error", this.currentLogLevel)) {
      super.error(message, ...optionalParams);
    }
  }

  /**
   * Override warn method to add filtering
   */
  override warn(message: unknown, ...optionalParams: unknown[]): void {
    if (shouldLog("warn", this.currentLogLevel)) {
      super.warn(message, ...optionalParams);
    }
  }

  /**
   * Override debug method to add filtering
   */
  override debug(message: unknown, ...optionalParams: unknown[]): void {
    if (shouldLog("debug", this.currentLogLevel)) {
      super.debug(message, ...optionalParams);
    }
  }

  /**
   * Override verbose method to add filtering
   */
  override verbose(message: unknown, ...optionalParams: unknown[]): void {
    if (shouldLog("verbose", this.currentLogLevel)) {
      super.verbose(message, ...optionalParams);
    }
  }

  /**
   * Add fatal method with filtering
   */
  override fatal(message: unknown, ...optionalParams: unknown[]): void {
    if (shouldLog("fatal", this.currentLogLevel)) {
      super.error(`[FATAL] ${message}`, ...optionalParams);
    }
  }
}
