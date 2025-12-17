import { HttpException, HttpStatus } from "@nestjs/common";

import { BaseController } from "../base.controller";
import { ErrorCode } from "../../types/error-handling";

class TestController extends BaseController {
  public async callExecuteOperation<T>(
    operation: () => Promise<T>,
    operationName: string,
    opts?: { requestId?: string; timeout?: number; performanceThreshold?: number }
  ) {
    return this.executeOperation(operation, operationName, opts);
  }

  public callSanitizeRequestBody(body: unknown) {
    return this.sanitizeRequestBody(body);
  }

  public callCalculateResponseSize(response: unknown) {
    return this.calculateResponseSize(response);
  }

  public callCreateErrorResponse(error: string, code: number, message: string, requestId?: string, details?: unknown) {
    return this.createErrorResponse(error, code, message, requestId, details);
  }

  public callThrowHttpException(
    status: HttpStatus,
    error: string,
    code: number,
    message: string,
    requestId?: string,
    details?: unknown
  ) {
    return this.throwHttpException(status, error, code, message, requestId, details);
  }

  public async callHandleControllerOperation<T>(
    operation: () => Promise<T>,
    operationName: string,
    method: string,
    url: string,
    options?: Record<string, unknown>
  ) {
    return this.handleControllerOperation(operation, operationName, method, url, options as any);
  }

  public async callExecuteWithRetry<T>(
    operation: () => Promise<T>,
    context: {
      operationName: string;
      serviceType?: "http" | "database" | "cache" | "external-api" | "websocket";
      endpoint?: string;
      retryConfig?: Record<string, unknown>;
    }
  ) {
    return this.executeWithRetry(operation, context as any);
  }

  public callExtractRequestMetadata(request: any) {
    return this.extractRequestMetadata(request);
  }

  public callExtractClientIp(request: any) {
    return this.extractClientIp(request);
  }

  public callSanitizeForLogging(data: unknown) {
    return this.sanitizeForLogging(data);
  }

  public callHandleValidationError(message: string, details?: Record<string, unknown>, requestId?: string) {
    return this.handleValidationError(message, details, requestId);
  }

  public callHandleAuthenticationError(message?: string, requestId?: string) {
    return this.handleAuthenticationError(message, requestId);
  }

  public callHandleRateLimitError(requestId?: string, retryAfter?: number) {
    return this.handleRateLimitError(requestId, retryAfter);
  }

  public callHandleExternalServiceError(serviceName: string, originalError: Error, requestId?: string) {
    return this.handleExternalServiceError(serviceName, originalError, requestId);
  }
}

describe("BaseController", () => {
  let controller: TestController;

  beforeEach(() => {
    controller = new TestController();
    (controller as any).logger = {
      log: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
  });

  it("generates a request id", () => {
    expect(typeof (controller as any).generateRequestId()).toBe("string");
    expect(((controller as any).generateRequestId() as string).length).toBeGreaterThan(0);
  });

  it("executeOperation returns success response and logs", async () => {
    const res = await controller.callExecuteOperation(async () => 123, "Op", {
      requestId: "rid",
      performanceThreshold: 999999,
    });

    expect(res.success).toBe(true);
    expect(res.data).toBe(123);
    expect(res.requestId).toBe("rid");
    expect((controller as any).logger.debug).toHaveBeenCalled();
  });

  it("executeOperation logs warning when exceeding performance threshold", async () => {
    const res = await controller.callExecuteOperation(
      async () => {
        // Ensure the timer has a non-zero duration
        await new Promise(resolve => setImmediate(resolve));
        return 123;
      },
      "Op",
      { requestId: "rid", performanceThreshold: 0 }
    );

    expect(res.success).toBe(true);
    expect((controller as any).logger.warn).toHaveBeenCalled();
  });

  it("executeOperation rethrows errors and logs error", async () => {
    await expect(
      controller.callExecuteOperation(
        async () => {
          throw new Error("boom");
        },
        "Op",
        { performanceThreshold: 999999 }
      )
    ).rejects.toThrow("boom");

    expect((controller as any).logger.error).toHaveBeenCalled();
  });

  it("sanitizes request body and truncates feeds", () => {
    const body = { feeds: [1, 2, 3, 4, 5], foo: "bar" };
    const sanitized: any = controller.callSanitizeRequestBody(body);

    expect(sanitized.foo).toBe("bar");
    expect(sanitized.feeds).toHaveLength(4);
    expect(sanitized.feeds[3]).toEqual({ truncated: "... and 2 more feeds" });
  });

  it("sanitizeRequestBody returns error object for non-serializable inputs", () => {
    const body: any = { a: 1 };
    body.self = body;

    expect(controller.callSanitizeRequestBody(body)).toEqual({ error: "Unable to sanitize request body" });
  });

  it("calculateResponseSize returns 0 for non-serializable responses", () => {
    const value: any = { a: 1 };
    value.self = value;
    expect(controller.callCalculateResponseSize(value)).toBe(0);
  });

  it("creates error response with optional details", () => {
    const res = controller.callCreateErrorResponse("X", 1, "msg", "rid", { a: 1 });
    expect(res).toEqual(
      expect.objectContaining({ error: "X", code: 1, message: "msg", requestId: "rid", details: { a: 1 } })
    );
  });

  it("creates error response without details when details is undefined", () => {
    const res = controller.callCreateErrorResponse("X", 1, "msg", "rid");
    expect(res).toEqual(expect.objectContaining({ error: "X", code: 1, message: "msg", requestId: "rid" }));
    expect(res).not.toHaveProperty("details");
  });

  it("throws HttpException with standardized error response", () => {
    expect(() =>
      controller.callThrowHttpException(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_ERROR, 4000, "bad", "rid")
    ).toThrow(HttpException);

    try {
      controller.callThrowHttpException(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_ERROR, 4000, "bad", "rid");
    } catch (e) {
      const ex = e as HttpException;
      expect(ex.getStatus()).toBe(HttpStatus.BAD_REQUEST);
      expect(ex.getResponse()).toEqual(
        expect.objectContaining({ error: ErrorCode.VALIDATION_ERROR, requestId: "rid" })
      );
    }
  });

  it("handleControllerOperation executes operation and logs request/response", async () => {
    const apiReqSpy = jest.spyOn(controller as any, "logApiRequest");
    const apiResSpy = jest.spyOn(controller as any, "logApiResponse");

    const out = await controller.callHandleControllerOperation(async () => ({ ok: true }), "Op", "GET", "/x", {
      requestId: "rid",
      useStandardizedErrorHandling: false,
    });

    expect(out).toEqual({ ok: true });
    expect(apiReqSpy).toHaveBeenCalledWith("GET", "/x", undefined, "rid");
    expect(apiResSpy).toHaveBeenCalled();
  });

  it("handleControllerOperation uses standardized error handling when available", async () => {
    const standardizedErrorHandler = {
      executeWithStandardizedHandling: jest.fn(async (op: any) => op()),
      handleValidationError: jest.fn(),
      handleAuthenticationError: jest.fn(),
      handleRateLimitError: jest.fn(),
      handleExternalServiceError: jest.fn(),
    };
    const retry = {
      executeWithRetry: jest.fn(async (op: any) => op()),
    };

    (controller as any).standardizedErrorHandler = standardizedErrorHandler;
    (controller as any).universalRetryService = retry;

    const out = await controller.callHandleControllerOperation(async () => ({ ok: true }), "Op", "GET", "/x", {
      requestId: "rid",
      body: { token: "secret" },
      useStandardizedErrorHandling: true,
      useRetryLogic: true,
      retryConfig: { maxAttempts: 2 },
    });

    expect(out).toEqual({ ok: true });
    expect(standardizedErrorHandler.executeWithStandardizedHandling).toHaveBeenCalled();
    expect(retry.executeWithRetry).toHaveBeenCalled();
  });

  it("handleControllerOperation logs failures and rethrows", async () => {
    const apiResSpy = jest.spyOn(controller as any, "logApiResponse");

    await expect(
      controller.callHandleControllerOperation(
        async () => {
          throw new HttpException({ msg: "no" }, HttpStatus.TOO_MANY_REQUESTS);
        },
        "Op",
        "POST",
        "/x",
        { requestId: "rid", useStandardizedErrorHandling: false }
      )
    ).rejects.toBeInstanceOf(HttpException);

    expect(apiResSpy).toHaveBeenCalled();
    expect((controller as any).logger.error).toHaveBeenCalled();
  });

  it("executeWithRetry uses retry service variants when provided", async () => {
    const retry = {
      executeHttpWithRetry: jest.fn(async (op: any) => op()),
      executeDatabaseWithRetry: jest.fn(async (op: any) => op()),
      executeCacheWithRetry: jest.fn(async (op: any) => op()),
      executeExternalApiWithRetry: jest.fn(async (op: any) => op()),
      executeWithRetry: jest.fn(async (op: any) => op()),
    };

    (controller as any).universalRetryService = retry;

    await expect(
      controller.callExecuteWithRetry(async () => 1, { operationName: "x", serviceType: "http" })
    ).resolves.toBe(1);
    await expect(
      controller.callExecuteWithRetry(async () => 2, { operationName: "x", serviceType: "database" })
    ).resolves.toBe(2);
    await expect(
      controller.callExecuteWithRetry(async () => 3, { operationName: "x", serviceType: "cache" })
    ).resolves.toBe(3);
    await expect(
      controller.callExecuteWithRetry(async () => 4, { operationName: "x", serviceType: "external-api" })
    ).resolves.toBe(4);
    await expect(controller.callExecuteWithRetry(async () => 5, { operationName: "x" })).resolves.toBe(5);

    expect(retry.executeHttpWithRetry).toHaveBeenCalled();
    expect(retry.executeDatabaseWithRetry).toHaveBeenCalled();
    expect(retry.executeCacheWithRetry).toHaveBeenCalled();
    expect(retry.executeExternalApiWithRetry).toHaveBeenCalled();
    expect(retry.executeWithRetry).toHaveBeenCalled();
  });

  it("executeWithRetry falls back to direct operation when no retry service", async () => {
    (controller as any).universalRetryService = undefined;
    await expect(
      controller.callExecuteWithRetry(async () => 123, { operationName: "x", serviceType: "http" })
    ).resolves.toBe(123);
  });

  it("executeWithRetry external-api falls back when retry returns undefined", async () => {
    const retry = {
      executeExternalApiWithRetry: jest.fn(async () => undefined),
    };
    (controller as any).universalRetryService = retry;
    const op = jest.fn(async () => 42);

    await expect(
      controller.callExecuteWithRetry(op, { operationName: "x", serviceType: "external-api", endpoint: "/e" })
    ).resolves.toBe(42);
    expect(op).toHaveBeenCalled();
  });

  it("executeWithRetry external-api falls back when retry throws", async () => {
    const retry = {
      executeExternalApiWithRetry: jest.fn(async () => {
        throw new Error("retry failed");
      }),
    };
    (controller as any).universalRetryService = retry;
    const op = jest.fn(async () => 42);

    await expect(
      controller.callExecuteWithRetry(op, { operationName: "x", serviceType: "external-api", endpoint: "/e" })
    ).resolves.toBe(42);
    expect(op).toHaveBeenCalled();
  });

  it("handle*Error helpers fall back when standardized handler missing", () => {
    (controller as any).standardizedErrorHandler = undefined;

    expect(controller.callHandleValidationError("bad")?.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(controller.callHandleAuthenticationError()?.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    expect(controller.callHandleRateLimitError("rid", 123)?.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(controller.callHandleExternalServiceError("svc", new Error("boom"), "rid")?.getStatus()).toBe(
      HttpStatus.BAD_GATEWAY
    );
  });

  it("handle*Error helpers delegate when standardized handler present", () => {
    const standardizedErrorHandler = {
      handleValidationError: jest.fn(() => new HttpException({ ok: 1 }, HttpStatus.BAD_REQUEST)),
      handleAuthenticationError: jest.fn(() => new HttpException({ ok: 1 }, HttpStatus.UNAUTHORIZED)),
      handleRateLimitError: jest.fn(() => new HttpException({ ok: 1 }, HttpStatus.TOO_MANY_REQUESTS)),
      handleExternalServiceError: jest.fn(() => new HttpException({ ok: 1 }, HttpStatus.BAD_GATEWAY)),
    };
    (controller as any).standardizedErrorHandler = standardizedErrorHandler;

    expect(controller.callHandleValidationError("bad")?.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(controller.callHandleAuthenticationError()?.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    expect(controller.callHandleRateLimitError("rid", 123)?.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(controller.callHandleExternalServiceError("svc", new Error("boom"), "rid")?.getStatus()).toBe(
      HttpStatus.BAD_GATEWAY
    );

    expect(standardizedErrorHandler.handleValidationError).toHaveBeenCalled();
    expect(standardizedErrorHandler.handleAuthenticationError).toHaveBeenCalled();
    expect(standardizedErrorHandler.handleRateLimitError).toHaveBeenCalled();
    expect(standardizedErrorHandler.handleExternalServiceError).toHaveBeenCalled();
  });

  it("extracts request metadata and client ip", () => {
    const req = {
      method: "GET",
      path: "/p",
      query: { q: 1 },
      params: { id: "x" },
      get: (h: string) => {
        const headers: Record<string, string> = {
          "X-Forwarded-For": "1.2.3.4, 5.6.7.8",
          "X-Correlation-ID": "cid",
          "User-Agent": "ua",
        };
        return headers[h];
      },
      socket: { remoteAddress: "9.9.9.9" },
    };

    expect(controller.callExtractClientIp(req)).toBe("1.2.3.4");

    const meta = controller.callExtractRequestMetadata(req);
    expect(meta.correlationId).toBe("cid");
    expect(meta.userAgent).toBe("ua");
    expect(meta.ipAddress).toBe("1.2.3.4");
    expect(meta.additionalContext).toEqual(expect.objectContaining({ method: "GET", path: "/p" }));
  });

  it("extracts client ip from X-Real-IP and falls back to unknown", () => {
    expect(controller.callExtractClientIp({ get: (h: string) => (h === "X-Real-IP" ? "2.2.2.2" : undefined) })).toBe(
      "2.2.2.2"
    );
    expect(controller.callExtractClientIp({ get: () => undefined, socket: {} })).toBe("unknown");
  });

  it("extracts correlation id from X-Request-ID and user/session ids from request object", () => {
    const req = {
      method: "POST",
      path: "/p",
      query: {},
      params: {},
      get: (h: string) => {
        const headers: Record<string, string> = {
          "X-Request-ID": "rid",
          "X-User-ID": "hdr-user",
        };
        return headers[h];
      },
      user: { id: "user-1" },
      session: { id: "sess-1" },
      socket: { remoteAddress: "9.9.9.9" },
    };

    const meta = controller.callExtractRequestMetadata(req);
    expect(meta.correlationId).toBe("rid");
    expect(meta.userId).toBe("hdr-user");
    expect(meta.sessionId).toBe("sess-1");
  });

  it("sanitizes sensitive fields", () => {
    expect(controller.callSanitizeForLogging({ password: "x", token: "y", ok: 1 })).toEqual({
      password: "[REDACTED]",
      token: "[REDACTED]",
      ok: 1,
    });
  });
});
