import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from "@nestjs/common";
import { BaseService } from "@/common/base/base.service";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";

@Injectable()
export class ResponseTimeInterceptor extends BaseService implements NestInterceptor {
  constructor() {
    super("ResponseTimeInterceptor");
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const startTime = Date.now();
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const method = request.method;
    const url = request.url;
    const userAgent = request.headers["user-agent"] || "unknown";
    const clientId = this.getClientIdentifier(request);

    // Add request start time for downstream services
    request.startTime = startTime;

    return next.handle().pipe(
      tap({
        next: responseData => {
          const responseTime = Date.now() - startTime;
          const statusCode = response.statusCode || 200;

          // Add comprehensive response headers
          response.setHeader("X-Response-Time", `${responseTime}ms`);
          response.setHeader("X-Request-ID", request.headers["x-request-id"] || "unknown");
          response.setHeader("X-Timestamp", new Date().toISOString());

          // Calculate response size
          const responseSize = this.calculateResponseSize(responseData);
          if (responseSize > 0) {
            response.setHeader("X-Response-Size", `${responseSize} bytes`);
          }

          // Comprehensive logging with context
          const logContext = {
            method,
            url,
            statusCode,
            responseTime,
            responseSize,
            clientId: this.sanitizeClientId(clientId),
            userAgent: this.sanitizeUserAgent(userAgent),
            timestamp: new Date().toISOString(),
          };

          // Log based on response time and status
          if (statusCode >= 500) {
            this.logger.error(`${method} ${url} - ${statusCode} - ${responseTime}ms - Server Error`, logContext);
          } else if (statusCode >= 400) {
            this.logger.warn(`${method} ${url} - ${statusCode} - ${responseTime}ms - Client Error`, logContext);
          } else if (responseTime > 1000) {
            this.logger.warn(`${method} ${url} - ${statusCode} - ${responseTime}ms - SLOW RESPONSE`, logContext);
          } else if (responseTime > 100) {
            this.logger.warn(`${method} ${url} - ${statusCode} - ${responseTime}ms - Above Target`, logContext);
          } else {
            this.logger.log(`${method} ${url} - ${statusCode} - ${responseTime}ms`, logContext);
          }

          // Performance monitoring alerts
          if (responseTime > 5000) {
            this.logger.error(`CRITICAL: Extremely slow response: ${method} ${url} took ${responseTime}ms`, {
              ...logContext,
              alert: "CRITICAL_SLOW_RESPONSE",
              threshold: 5000,
            });
          }
        },
        error: error => {
          const responseTime = Date.now() - startTime;
          const statusCode = error.status || 500;

          // Add error response headers
          response.setHeader("X-Response-Time", `${responseTime}ms`);
          response.setHeader("X-Request-ID", request.headers["x-request-id"] || "unknown");
          response.setHeader("X-Timestamp", new Date().toISOString());
          response.setHeader("X-Error", "true");

          const logContext = {
            method,
            url,
            statusCode,
            responseTime,
            clientId: this.sanitizeClientId(clientId),
            userAgent: this.sanitizeUserAgent(userAgent),
            error: error.message,
            timestamp: new Date().toISOString(),
          };

          this.logger.error(
            `${method} ${url} - ${statusCode} - ${responseTime}ms - ERROR: ${error.message}`,
            logContext
          );
        },
      })
    );
  }

  private getClientIdentifier(request: any): string {
    // Try to get client identifier from various sources
    const apiKey = request.headers["x-api-key"];
    if (apiKey) return `api:${apiKey}`;

    const clientId = request.headers["x-client-id"];
    if (clientId) return `client:${clientId}`;

    const ip =
      request.ip ||
      request.connection?.remoteAddress ||
      request.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      "unknown";
    return `ip:${ip}`;
  }

  private sanitizeClientId(clientId: string): string {
    if (clientId.startsWith("api:")) {
      const apiKey = clientId.substring(4);
      return apiKey.length > 8
        ? `api:${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`
        : `api:${apiKey.substring(0, 4)}...`;
    }
    return clientId;
  }

  private sanitizeUserAgent(userAgent: string): string {
    // Truncate very long user agent strings
    return userAgent.length > 100 ? `${userAgent.substring(0, 100)}...` : userAgent;
  }

  private calculateResponseSize(responseData: any): number {
    try {
      if (!responseData) return 0;
      if (typeof responseData === "string") return responseData.length;
      return JSON.stringify(responseData).length;
    } catch {
      return 0;
    }
  }
}
