import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from "@nestjs/common";
import { RateLimiterService } from "../middleware/rate-limiter.service";
import { ApiErrorHandlerService } from "../error-handling/api-error-handler.service";

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly rateLimiter: RateLimiterService,
    private readonly errorHandler: ApiErrorHandlerService
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    // Get client identifier (IP address or API key)
    const clientId = this.getClientId(request);

    // Check rate limit
    const rateLimitInfo = this.rateLimiter.checkRateLimit(clientId);

    // Add rate limit headers
    response.setHeader("X-RateLimit-Limit", this.rateLimiter.getConfig().maxRequests);
    response.setHeader("X-RateLimit-Remaining", rateLimitInfo.remainingPoints);
    response.setHeader("X-RateLimit-Reset", new Date(Date.now() + rateLimitInfo.msBeforeNext).toISOString());

    if (rateLimitInfo.isBlocked) {
      // Record the blocked request
      this.rateLimiter.recordRequest(clientId, false);

      // Add retry-after header
      response.setHeader("Retry-After", Math.ceil(rateLimitInfo.msBeforeNext / 1000));

      const requestId = this.errorHandler.generateRequestId();
      throw this.errorHandler.handleRateLimitError(requestId);
    }

    // Record successful request check
    this.rateLimiter.recordRequest(clientId, true);

    return true;
  }

  private getClientId(request: any): string {
    // Try to get client ID from various sources
    const apiKey = request.headers["x-api-key"];
    if (apiKey) {
      return `api:${apiKey}`;
    }

    // Use IP address as fallback
    const ip =
      request.ip ||
      request.connection?.remoteAddress ||
      request.socket?.remoteAddress ||
      request.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      "unknown";

    return `ip:${ip}`;
  }
}
