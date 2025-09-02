import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from "@nestjs/common";
import { RateLimiterService } from "./rate-limiter.service";
import { ApiErrorHandlerService } from "@/error-handling/api-error-handler.service";
import { ClientIdentificationUtils } from "../utils/client-identification.utils";

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
    const clientInfo = ClientIdentificationUtils.getClientInfo(request);
    const clientId = clientInfo.id;
    const method = request.method;
    const url = request.url;

    // Check rate limit
    const rateLimitInfo = this.rateLimiter.checkRateLimit(clientId);

    // Add comprehensive rate limit headers
    response.setHeader("X-RateLimit-Limit", this.rateLimiter.getConfig().maxRequests);
    response.setHeader("X-RateLimit-Remaining", rateLimitInfo.remainingPoints);
    response.setHeader("X-RateLimit-Reset", new Date(Date.now() + rateLimitInfo.msBeforeNext).toISOString());
    response.setHeader("X-RateLimit-Window", `${this.rateLimiter.getConfig().windowMs}ms`);

    if (rateLimitInfo.isBlocked) {
      // Record the blocked request
      this.rateLimiter.recordRequest(clientId, false);

      // Add retry-after header
      const retryAfterSeconds = Math.ceil(rateLimitInfo.msBeforeNext / 1000);
      response.setHeader("Retry-After", retryAfterSeconds);

      const requestId = this.errorHandler.generateRequestId();

      // Enhanced rate limit error with more context
      const rateLimitError = new HttpException(
        {
          error: "RATE_LIMIT_EXCEEDED",
          code: 4291,
          message: `Rate limit exceeded. Too many requests from client.`,
          timestamp: Date.now(),
          requestId,
          rateLimitInfo: {
            limit: this.rateLimiter.getConfig().maxRequests,
            windowMs: this.rateLimiter.getConfig().windowMs,
            totalHits: rateLimitInfo.totalHits,
            totalHitsInWindow: rateLimitInfo.totalHitsInWindow,
            retryAfterSeconds,
            resetTime: new Date(Date.now() + rateLimitInfo.msBeforeNext).toISOString(),
          },
          clientInfo: {
            clientId: clientInfo.sanitized,
            method,
            url,
          },
        },
        HttpStatus.TOO_MANY_REQUESTS
      );

      // Log rate limit violation with context
      console.warn(`Rate limit exceeded for client ${clientInfo.sanitized}`, {
        requestId,
        clientId: clientInfo.sanitized,
        method,
        url,
        totalHits: rateLimitInfo.totalHits,
        totalHitsInWindow: rateLimitInfo.totalHitsInWindow,
        limit: this.rateLimiter.getConfig().maxRequests,
        windowMs: this.rateLimiter.getConfig().windowMs,
        retryAfterSeconds,
      });

      throw rateLimitError;
    }

    // Record successful request check
    this.rateLimiter.recordRequest(clientId, true);

    // Add request tracking headers for monitoring
    response.setHeader("X-Client-ID", clientInfo.sanitized);
    response.setHeader("X-Request-Count", rateLimitInfo.totalHitsInWindow.toString());

    // Log successful rate limit check for high-frequency clients
    if (rateLimitInfo.totalHitsInWindow > this.rateLimiter.getConfig().maxRequests * 0.8) {
      console.log(`High request volume from client ${clientInfo.sanitized}`, {
        clientId: clientInfo.sanitized,
        method,
        url,
        totalHitsInWindow: rateLimitInfo.totalHitsInWindow,
        limit: this.rateLimiter.getConfig().maxRequests,
        remainingPoints: rateLimitInfo.remainingPoints,
      });
    }

    return true;
  }
}
