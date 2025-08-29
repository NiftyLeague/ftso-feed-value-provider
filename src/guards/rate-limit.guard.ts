import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from "@nestjs/common";
import { RateLimiterService } from "@/middleware/rate-limiter.service";
import { ApiErrorHandlerService } from "@/error-handling/api-error-handler.service";

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
            clientId: this.sanitizeClientId(clientId),
            method,
            url,
          },
        },
        HttpStatus.TOO_MANY_REQUESTS
      );

      // Log rate limit violation with context
      console.warn(`Rate limit exceeded for client ${this.sanitizeClientId(clientId)}`, {
        requestId,
        clientId: this.sanitizeClientId(clientId),
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
    response.setHeader("X-Client-ID", this.sanitizeClientId(clientId));
    response.setHeader("X-Request-Count", rateLimitInfo.totalHitsInWindow.toString());

    // Log successful rate limit check for high-frequency clients
    if (rateLimitInfo.totalHitsInWindow > this.rateLimiter.getConfig().maxRequests * 0.8) {
      console.log(`High request volume from client ${this.sanitizeClientId(clientId)}`, {
        clientId: this.sanitizeClientId(clientId),
        method,
        url,
        totalHitsInWindow: rateLimitInfo.totalHitsInWindow,
        limit: this.rateLimiter.getConfig().maxRequests,
        remainingPoints: rateLimitInfo.remainingPoints,
      });
    }

    return true;
  }

  private getClientId(request: any): string {
    // Try to get client ID from various sources in order of preference

    // 1. API Key (highest priority)
    const apiKey = request.headers["x-api-key"];
    if (apiKey && typeof apiKey === "string" && apiKey.length > 0) {
      return `api:${apiKey}`;
    }

    // 2. Authorization header (Bearer token)
    const authHeader = request.headers["authorization"];
    if (authHeader && typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      if (token.length > 0) {
        return `bearer:${token}`;
      }
    }

    // 3. Custom client ID header
    const clientId = request.headers["x-client-id"];
    if (clientId && typeof clientId === "string" && clientId.length > 0) {
      return `client:${clientId}`;
    }

    // 4. IP address as fallback
    const ip = this.getClientIP(request);
    return `ip:${ip}`;
  }

  private getClientIP(request: any): string {
    // Try multiple sources for IP address
    const candidates = [
      request.ip,
      request.connection?.remoteAddress,
      request.socket?.remoteAddress,
      request.headers["x-forwarded-for"]?.split(",")[0]?.trim(),
      request.headers["x-real-ip"],
      request.headers["x-client-ip"],
      request.headers["cf-connecting-ip"], // Cloudflare
    ];

    for (const candidate of candidates) {
      if (candidate && typeof candidate === "string" && candidate.length > 0 && candidate !== "unknown") {
        return candidate;
      }
    }

    return "unknown";
  }

  private sanitizeClientId(clientId: string): string {
    // Sanitize client ID for logging (hide sensitive parts)
    if (clientId.startsWith("api:")) {
      const apiKey = clientId.substring(4);
      if (apiKey.length > 8) {
        return `api:${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`;
      }
      return `api:${apiKey.substring(0, Math.min(4, apiKey.length))}...`;
    }

    if (clientId.startsWith("bearer:")) {
      const token = clientId.substring(7);
      if (token.length > 8) {
        return `bearer:${token.substring(0, 4)}...${token.substring(token.length - 4)}`;
      }
      return `bearer:${token.substring(0, Math.min(4, token.length))}...`;
    }

    // For IP addresses and client IDs, return as-is (they're not sensitive)
    return clientId;
  }
}
