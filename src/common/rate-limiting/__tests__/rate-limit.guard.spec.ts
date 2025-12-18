import type { ExecutionContext } from "@nestjs/common";
import { HttpException, HttpStatus } from "@nestjs/common";

import { RateLimitGuard } from "@/common/rate-limiting/rate-limit.guard";
import { ApiErrorCodes } from "@/common/types/error-handling";
import { ClientIdentificationUtils } from "@/common/utils/client-identification.utils";

describe("RateLimitGuard", () => {
  const createContext = (request: any, response: any): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    }) as unknown as ExecutionContext;

  it("bypasses rate limiting for /health endpoints", () => {
    const rateLimiter = {
      checkRateLimit: jest.fn(),
      getRateLimitConfig: jest.fn(),
      recordRequest: jest.fn(),
    };

    const guard = new RateLimitGuard(rateLimiter as any);

    const request = { url: "/health", method: "GET" };
    const response = { setHeader: jest.fn() };

    const allowed = guard.canActivate(createContext(request, response));

    expect(allowed).toBe(true);
    expect(response.setHeader).toHaveBeenCalledWith("X-RateLimit-Bypassed", "health-endpoint");
    expect(rateLimiter.checkRateLimit).not.toHaveBeenCalled();
    expect(rateLimiter.recordRequest).not.toHaveBeenCalled();
  });

  it("allows requests under limit and sets rate limit headers", () => {
    jest.spyOn(ClientIdentificationUtils, "getClientInfo").mockReturnValue({
      id: "client-1",
      sanitized: "client-1",
    } as any);

    const rateLimiter = {
      checkRateLimit: jest.fn().mockReturnValue({
        isBlocked: false,
        remainingPoints: 9,
        msBeforeNext: 1500,
        totalHits: 1,
        totalHitsInWindow: 1,
      }),
      getRateLimitConfig: jest.fn().mockReturnValue({ maxRequests: 10, windowMs: 1000 }),
      recordRequest: jest.fn(),
    };

    const guard = new RateLimitGuard(rateLimiter as any);

    const request = { url: "/api/feeds", method: "GET" };
    const response = { setHeader: jest.fn() };

    const allowed = guard.canActivate(createContext(request, response));

    expect(allowed).toBe(true);
    expect(rateLimiter.checkRateLimit).toHaveBeenCalledWith("client-1");
    expect(rateLimiter.recordRequest).toHaveBeenCalledWith("client-1", true);

    // Core headers
    expect(response.setHeader).toHaveBeenCalledWith("X-RateLimit-Limit", 10);
    expect(response.setHeader).toHaveBeenCalledWith("X-RateLimit-Remaining", 9);
    expect(response.setHeader).toHaveBeenCalledWith("X-RateLimit-Window", "1000ms");

    // Tracking headers
    expect(response.setHeader).toHaveBeenCalledWith("X-Client-ID", "client-1");
    expect(response.setHeader).toHaveBeenCalledWith("X-Request-Count", "1");
  });

  it("blocks requests over limit with 429 and Retry-After", () => {
    jest.spyOn(ClientIdentificationUtils, "getClientInfo").mockReturnValue({
      id: "client-2",
      sanitized: "client-2",
    } as any);

    const rateLimiter = {
      checkRateLimit: jest.fn().mockReturnValue({
        isBlocked: true,
        remainingPoints: 0,
        msBeforeNext: 2000,
        totalHits: 99,
        totalHitsInWindow: 10,
      }),
      getRateLimitConfig: jest.fn().mockReturnValue({ maxRequests: 10, windowMs: 1000 }),
      recordRequest: jest.fn(),
    };

    const guard = new RateLimitGuard(rateLimiter as any);

    const request = { url: "/api/feeds", method: "GET" };
    const response = { setHeader: jest.fn() };

    try {
      guard.canActivate(createContext(request, response));
      throw new Error("expected to throw");
    } catch (err) {
      expect(rateLimiter.recordRequest).toHaveBeenCalledWith("client-2", false);
      expect(response.setHeader).toHaveBeenCalledWith("Retry-After", expect.any(Number));

      expect(err).toBeInstanceOf(HttpException);
      const httpErr = err as HttpException;
      expect(httpErr.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);

      const body = httpErr.getResponse() as any;
      expect(body.code).toBe(ApiErrorCodes.RATE_LIMIT_EXCEEDED);
      expect(body.error).toBe("RATE_LIMIT_EXCEEDED");
    }
  });
});
