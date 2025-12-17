import { HttpException, HttpStatus } from "@nestjs/common";
import type { ArgumentsHost } from "@nestjs/common";

import { HttpExceptionFilter } from "../http-exception.filter";

type HostFactoryOptions = {
  method?: string;
  path?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  headerGet?: Record<string, string | undefined>;
};

describe("HttpExceptionFilter", () => {
  // Make sure Jest/ts-jest errors are visible even with global stdout/stderr suppression.
  beforeAll(() => {
    // The repo's global test teardown expects fake timers to be enabled.
    jest.useFakeTimers();
    (global as any).enableTestLogging?.();
  });

  afterAll(() => {
    (global as any).disableTestLogging?.();
    jest.useRealTimers();
  });

  const makeHost = (
    opts?: HostFactoryOptions
  ): {
    host: ArgumentsHost;
    request: any;
    response: any;
  } => {
    const headerGet = new Map<string, string | undefined>(
      Object.entries(opts?.headerGet ?? {}).map(([k, v]) => [k.toLowerCase(), v])
    );

    const request = {
      method: opts?.method ?? "GET",
      path: opts?.path ?? "/test",
      url: opts?.url ?? "/test",
      query: {},
      headers: opts?.headers ?? {},
      get: jest.fn((name: string) => headerGet.get(name.toLowerCase())),
      connection: { remoteAddress: "203.0.113.9" },
      socket: { remoteAddress: "203.0.113.9" },
    };

    const response = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    const host: ArgumentsHost = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as any;

    return { host, request, response };
  };

  let filter: HttpExceptionFilter;

  beforeEach(() => {
    jest.useFakeTimers();
    filter = new HttpExceptionFilter();

    // Stub the internal Nest Logger instance.
    (filter as any).logger = {
      error: jest.fn(),
      warn: jest.fn(),
      log: jest.fn(),
      debug: jest.fn(),
    };
  });

  it("handles HttpException with string response and standardizes context", () => {
    const { host, response } = makeHost({
      method: "GET",
      path: "/prices",
      headers: { authorization: "Bearer SECRET" },
    });

    const ex = new HttpException("rate limited", HttpStatus.TOO_MANY_REQUESTS);

    filter.catch(ex, host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.TOO_MANY_REQUESTS);
    expect(response.setHeader).toHaveBeenCalledWith("X-Content-Type-Options", "nosniff");
    expect(response.setHeader).toHaveBeenCalledWith("X-Frame-Options", "DENY");
    expect(response.setHeader).toHaveBeenCalledWith("X-XSS-Protection", "1; mode=block");

    const body = response.json.mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.retryable).toBe(true);
    expect(body.error.context.method).toBe("GET");
    expect(body.error.context.path).toBe("/prices");
    expect(body.error.context.httpStatus).toBe(HttpStatus.TOO_MANY_REQUESTS);

    // 429 should be WARN-level
    expect((filter as any).logger.warn).toHaveBeenCalled();
    expect((filter as any).logger.error).not.toHaveBeenCalled();
  });

  it("sets Retry-After when HttpException provides an object response (retryable status)", () => {
    const { host, response } = makeHost({ method: "GET", path: "/prices" });

    const ex = new HttpException(
      {
        error: "RATE_LIMIT",
        message: "too many",
        context: { foo: "bar" },
      },
      HttpStatus.TOO_MANY_REQUESTS
    );

    filter.catch(ex, host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.TOO_MANY_REQUESTS);
    expect(response.setHeader).toHaveBeenCalledWith("Retry-After", 60);

    const body = response.json.mock.calls[0][0];
    expect(body.retryable).toBe(true);
    expect(body.retryAfter).toBe(60000);
    expect((filter as any).logger.warn).toHaveBeenCalled();
  });

  it("handles HttpException with object response (non-retryable) and logs debug for client errors", () => {
    const { host, response } = makeHost({
      method: "POST",
      path: "/submit",
      headerGet: { "user-agent": "jest" },
    });

    const ex = new HttpException(
      {
        error: "BAD_REQUEST",
        message: "invalid payload",
        timestamp: 123,
        context: { foo: "bar" },
      },
      HttpStatus.BAD_REQUEST
    );

    filter.catch(ex, host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);

    const body = response.json.mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.retryable).toBe(false);
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.message).toBe("invalid payload");
    expect(body.error.context.foo).toBe("bar");
    expect(body.error.context.method).toBe("POST");
    expect(body.error.context.path).toBe("/submit");

    // 400 should be DEBUG-level (not warn)
    expect((filter as any).logger.debug).toHaveBeenCalled();
    expect((filter as any).logger.warn).not.toHaveBeenCalled();
  });

  it("passes through already standardized responses and logs readiness failures as debug", () => {
    const { host, response } = makeHost({
      method: "GET",
      path: "/health/ready",
    });

    const standardized = {
      success: false,
      error: {
        code: "NOT_READY",
        message: "System not ready",
        severity: "medium",
        module: "Test",
        timestamp: Date.now(),
        context: {},
      },
      timestamp: Date.now(),
      requestId: "req_test",
      retryable: true,
      retryAfter: 5000,
    };

    const ex = new HttpException(standardized as any, HttpStatus.SERVICE_UNAVAILABLE);

    filter.catch(ex, host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(response.setHeader).toHaveBeenCalledWith("Retry-After", 5);

    expect((filter as any).logger.debug).toHaveBeenCalled();
    expect((filter as any).logger.error).not.toHaveBeenCalled();
  });

  it("handles generic Error exceptions as 500 and logs error", () => {
    const { host, response } = makeHost({ method: "GET", path: "/boom" });

    filter.catch(new Error("timeout while connecting"), host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect((filter as any).logger.error).toHaveBeenCalled();

    const body = response.json.mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.error.message).toContain("timeout");
  });

  it("handles non-Error unknown exceptions", () => {
    const { host, response } = makeHost({ method: "GET", path: "/weird" });

    filter.catch({ message: "odd" }, host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);

    const body = response.json.mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.error.message).toContain("odd");
  });
});
