import { LogContext } from "./logger.types";

export interface ILogger {
  log(message: any, context?: LogContext, ...optionalParams: any[]): any;
  error(message: any, context?: LogContext, ...optionalParams: any[]): any;
  warn(message: any, context?: LogContext, ...optionalParams: any[]): any;
  debug?(message: any, context?: LogContext, ...optionalParams: any[]): any;
  verbose?(message: any, context?: LogContext, ...optionalParams: any[]): any;
  fatal?(message: any, context?: LogContext, ...optionalParams: any[]): any;
  dir?(message: any, context?: LogContext, ...optionalParams: any[]): any;
}
