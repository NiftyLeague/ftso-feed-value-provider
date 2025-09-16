import { Test, TestingModule } from "@nestjs/testing";
import { ExecutionContext, CallHandler } from "@nestjs/common";
import { of, throwError } from "rxjs";
import { ResponseTimeInterceptor } from "../response-time.interceptor";
import { ClientIdentificationUtils } from "../../utils/client-identification.utils";

// Mock the ClientIdentificationUtils
jest.mock("../../utils/client-identification.utils", () => ({
  ClientIdentificationUtils: {
    getClientInfo: jest.fn(),
    sanitizeUserAgent: jest.fn(),
  },
}));

describe("ResponseTimeInterceptor", () => {
  let interceptor: ResponseTimeInterceptor;
  let mockExecutionContext: ExecutionContext;
  let mockCallHandler: CallHandler;
  let mockRequest: any;
  let mockResponse: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ResponseTimeInterceptor],
    }).compile();

    interceptor = module.get<ResponseTimeInterceptor>(ResponseTimeInterceptor);

    // Mock request object
    mockRequest = {
      method: "GET",
      url: "/api/test",
      headers: {
        "user-agent": "Mozilla/5.0 (Test Browser)",
        "x-request-id": "test-request-123",
      },
      startTime: Date.now(),
    };

    // Mock response object
    mockResponse = {
      statusCode: 200,
      setHeader: jest.fn(),
    };

    // Mock execution context
    mockExecutionContext = {
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(mockRequest),
        getResponse: jest.fn().mockReturnValue(mockResponse),
      }),
    } as any;

    // Mock call handler
    mockCallHandler = {
      handle: jest.fn(),
    } as any;

    // Mock ClientIdentificationUtils
    (ClientIdentificationUtils.getClientInfo as jest.Mock).mockReturnValue({
      sanitized: "test-client-123",
    });
    (ClientIdentificationUtils.sanitizeUserAgent as jest.Mock).mockReturnValue("Test Browser");
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("intercept", () => {
    it("should measure response time and add headers for successful response", done => {
      const responseData = { message: "test response" };
      mockCallHandler.handle = jest.fn().mockReturnValue(of(responseData));

      interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe({
        next: data => {
          expect(data).toEqual(responseData);
          expect(mockResponse.setHeader).toHaveBeenCalledWith("X-Response-Time", expect.stringMatching(/\d+ms/));
          expect(mockResponse.setHeader).toHaveBeenCalledWith("X-Request-ID", "test-request-123");
          expect(mockResponse.setHeader).toHaveBeenCalledWith("X-Timestamp", expect.any(String));
          expect(mockResponse.setHeader).toHaveBeenCalledWith("X-Response-Size", expect.stringMatching(/\d+ bytes/));
          done();
        },
        error: done,
      });
    });

    it("should handle error responses with appropriate headers", done => {
      const error = new Error("Test error") as Error & { status?: number };
      error.status = 500;
      mockCallHandler.handle = jest.fn().mockReturnValue(throwError(() => error));

      interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe({
        next: () => done(new Error("Should not call next for error")),
        error: err => {
          expect(err).toBe(error);
          expect(mockResponse.setHeader).toHaveBeenCalledWith("X-Response-Time", expect.stringMatching(/\d+ms/));
          expect(mockResponse.setHeader).toHaveBeenCalledWith("X-Request-ID", "test-request-123");
          expect(mockResponse.setHeader).toHaveBeenCalledWith("X-Timestamp", expect.any(String));
          expect(mockResponse.setHeader).toHaveBeenCalledWith("X-Error", "true");
          done();
        },
      });
    });

    it("should log slow responses (>1000ms)", done => {
      const responseData = { message: "slow response" };

      // Mock Date.now to simulate slow response
      const originalNow = Date.now;
      let callCount = 0;
      Date.now = jest.fn(() => {
        callCount++;
        return callCount === 1 ? 0 : 1500; // 1.5 second response
      });

      mockCallHandler.handle = jest.fn().mockReturnValue(of(responseData));

      // Mock logger methods
      const mockLogger = {
        error: jest.fn(),
        warn: jest.fn(),
        log: jest.fn(),
      };
      (interceptor as any).logger = mockLogger;

      interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe({
        next: data => {
          expect(data).toEqual(responseData);
          expect(mockLogger.warn).toHaveBeenCalledWith(
            expect.stringContaining("SLOW RESPONSE"),
            expect.objectContaining({
              method: "GET",
              url: "/api/test",
              statusCode: 200,
              responseTime: 1500,
            })
          );
          Date.now = originalNow;
          done();
        },
        error: err => {
          Date.now = originalNow;
          done(err);
        },
      });
    });

    it("should log responses above target (>100ms)", done => {
      const responseData = { message: "above target response" };

      // Mock Date.now to simulate response above target
      const originalNow = Date.now;
      let callCount = 0;
      Date.now = jest.fn(() => {
        callCount++;
        return callCount === 1 ? 0 : 150; // 150ms response
      });

      mockCallHandler.handle = jest.fn().mockReturnValue(of(responseData));

      // Mock logger methods
      const mockLogger = {
        error: jest.fn(),
        warn: jest.fn(),
        log: jest.fn(),
      };
      (interceptor as any).logger = mockLogger;

      interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe({
        next: data => {
          expect(data).toEqual(responseData);
          expect(mockLogger.warn).toHaveBeenCalledWith(
            expect.stringContaining("Above Target"),
            expect.objectContaining({
              method: "GET",
              url: "/api/test",
              statusCode: 200,
              responseTime: 150,
            })
          );
          Date.now = originalNow;
          done();
        },
        error: err => {
          Date.now = originalNow;
          done(err);
        },
      });
    });

    it("should log server errors (5xx)", done => {
      const responseData = { message: "server error" };
      mockResponse.statusCode = 500;
      mockCallHandler.handle = jest.fn().mockReturnValue(of(responseData));

      // Mock logger methods
      const mockLogger = {
        error: jest.fn(),
        warn: jest.fn(),
        log: jest.fn(),
      };
      (interceptor as any).logger = mockLogger;

      interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe({
        next: data => {
          expect(data).toEqual(responseData);
          expect(mockLogger.error).toHaveBeenCalledWith(
            expect.stringContaining("Server Error"),
            expect.objectContaining({
              method: "GET",
              url: "/api/test",
              statusCode: 500,
            })
          );
          done();
        },
        error: done,
      });
    });

    it("should log client errors (4xx)", done => {
      const responseData = { message: "client error" };
      mockResponse.statusCode = 400;
      mockCallHandler.handle = jest.fn().mockReturnValue(of(responseData));

      // Mock logger methods
      const mockLogger = {
        error: jest.fn(),
        warn: jest.fn(),
        log: jest.fn(),
      };
      (interceptor as any).logger = mockLogger;

      interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe({
        next: data => {
          expect(data).toEqual(responseData);
          expect(mockLogger.warn).toHaveBeenCalledWith(
            expect.stringContaining("Client Error"),
            expect.objectContaining({
              method: "GET",
              url: "/api/test",
              statusCode: 400,
            })
          );
          done();
        },
        error: done,
      });
    });

    it("should handle missing request ID header", done => {
      mockRequest.headers = { "user-agent": "Test Browser" }; // No x-request-id
      const responseData = { message: "test response" };
      mockCallHandler.handle = jest.fn().mockReturnValue(of(responseData));

      interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe({
        next: data => {
          expect(data).toEqual(responseData);
          expect(mockResponse.setHeader).toHaveBeenCalledWith("X-Request-ID", "unknown");
          done();
        },
        error: done,
      });
    });

    it("should handle missing user agent", done => {
      mockRequest.headers = { "x-request-id": "test-request-123" }; // No user-agent
      const responseData = { message: "test response" };
      mockCallHandler.handle = jest.fn().mockReturnValue(of(responseData));

      interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe({
        next: data => {
          expect(data).toEqual(responseData);
          expect(ClientIdentificationUtils.sanitizeUserAgent).toHaveBeenCalledWith("unknown");
          done();
        },
        error: done,
      });
    });
  });

  describe("calculateResponseSize", () => {
    it("should calculate size for string response", () => {
      const stringResponse = "test response data";
      const size = (interceptor as any).calculateResponseSize(stringResponse);
      expect(size).toBe(stringResponse.length);
    });

    it("should calculate size for object response", () => {
      const objectResponse = { message: "test", data: [1, 2, 3] };
      const size = (interceptor as any).calculateResponseSize(objectResponse);
      expect(size).toBe(JSON.stringify(objectResponse).length);
    });

    it("should return 0 for null/undefined response", () => {
      expect((interceptor as any).calculateResponseSize(null)).toBe(0);
      expect((interceptor as any).calculateResponseSize(undefined)).toBe(0);
    });

    it("should return 0 for circular reference objects", () => {
      const circularObj: any = { name: "test" };
      circularObj.self = circularObj;

      const size = (interceptor as any).calculateResponseSize(circularObj);
      expect(size).toBe(0);
    });

    it("should handle JSON.stringify errors gracefully", () => {
      // Mock JSON.stringify to throw an error
      const originalStringify = JSON.stringify;
      JSON.stringify = jest.fn().mockImplementation(() => {
        throw new Error("JSON stringify error");
      });

      const size = (interceptor as any).calculateResponseSize({ test: "data" });
      expect(size).toBe(0);

      // Restore original function
      JSON.stringify = originalStringify;
    });
  });

  describe("Client Information", () => {
    it("should get client information from request", () => {
      mockCallHandler.handle = jest.fn().mockReturnValue(of({}));
      interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe();

      expect(ClientIdentificationUtils.getClientInfo).toHaveBeenCalledWith(mockRequest);
    });

    it("should sanitize user agent", () => {
      mockCallHandler.handle = jest.fn().mockReturnValue(of({}));
      interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe();

      expect(ClientIdentificationUtils.sanitizeUserAgent).toHaveBeenCalledWith("Mozilla/5.0 (Test Browser)");
    });
  });

  describe("Request Context", () => {
    it("should set start time on request object", done => {
      const responseData = { message: "test response" };
      mockCallHandler.handle = jest.fn().mockReturnValue(of(responseData));

      interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe({
        next: () => {
          expect(mockRequest.startTime).toBeDefined();
          expect(typeof mockRequest.startTime).toBe("number");
          done();
        },
        error: done,
      });
    });

    it("should handle different HTTP methods", done => {
      const methods = ["GET", "POST", "PUT", "DELETE", "PATCH"];
      let completed = 0;

      methods.forEach(method => {
        mockRequest.method = method;
        const responseData = { message: `test ${method} response` };
        mockCallHandler.handle = jest.fn().mockReturnValue(of(responseData));

        interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe({
          next: data => {
            expect(data).toEqual(responseData);
            completed++;
            if (completed === methods.length) {
              done();
            }
          },
          error: done,
        });
      });
    });

    it("should handle different URL patterns", done => {
      const urls = ["/api/health", "/api/feeds", "/api/metrics", "/api/test"];
      let completed = 0;

      urls.forEach(url => {
        mockRequest.url = url;
        const responseData = { message: `test response for ${url}` };
        mockCallHandler.handle = jest.fn().mockReturnValue(of(responseData));

        interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe({
          next: data => {
            expect(data).toEqual(responseData);
            completed++;
            if (completed === urls.length) {
              done();
            }
          },
          error: done,
        });
      });
    });
  });
});
