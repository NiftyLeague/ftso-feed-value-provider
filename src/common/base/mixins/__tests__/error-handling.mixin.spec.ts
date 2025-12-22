import { WithErrorHandling } from "../error-handling.mixin";

describe("WithErrorHandling", () => {
  class BaseService {
    logger = {
      error: jest.fn(),
      debug: jest.fn(),
      log: jest.fn(),
    };

    logError = jest.fn();
    logWarning = jest.fn();
  }

  const MixedService = WithErrorHandling(BaseService);

  let service: InstanceType<typeof MixedService>;

  beforeEach(() => {
    service = new MixedService();
  });

  describe("handleError", () => {
    it("should track and throw by default (and log)", () => {
      const error = new Error("boom");

      expect(() => service.handleError(error, "ctx")).toThrow(error);
      expect(service.getErrorCount("ctx")).toBe(1);
      expect(service.logError).toHaveBeenCalledWith(error, "ctx", undefined);
    });

    it("should support shouldLog=false and shouldThrow=false", () => {
      const error = new Error("boom");

      expect(() => service.handleError(error, "ctx", { shouldLog: false, shouldThrow: false })).not.toThrow();
      expect(service.getErrorCount("ctx")).toBe(1);
      expect(service.logError).not.toHaveBeenCalled();
    });

    it("should log threshold exceeded when threshold is reached", () => {
      service.handleError(new Error("e1"), "ctx", { shouldThrow: false, threshold: 2 });
      service.handleError(new Error("e2"), "ctx", { shouldThrow: false, threshold: 2 });

      expect(service.logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Error threshold exceeded for ctx: 2 errors")
      );
    });
  });

  describe("executeWithErrorHandling", () => {
    it("should return result when operation succeeds", async () => {
      const result = await service.executeWithErrorHandling(async () => 123, "op");
      expect(result).toBe(123);
      expect(service.getErrorCount("op")).toBe(0);
    });

    it("should retry and use warn logging by default", async () => {
      let calls = 0;
      const onError = jest.fn();

      const resultPromise = service.executeWithErrorHandling(
        async () => {
          calls++;
          if (calls === 1) throw new Error("timeout");
          return "ok";
        },
        "op",
        { retries: 1, retryDelay: 0, onError }
      );

      await expect(resultPromise).resolves.toBe("ok");
      expect(onError).toHaveBeenCalledWith(expect.any(Error), 0);
      expect(service.logWarning).toHaveBeenCalled();
    });

    it("should use debug logging when retryLogLevel=debug", async () => {
      let calls = 0;

      const resultPromise = service.executeWithErrorHandling(
        async () => {
          calls++;
          if (calls === 1) throw new Error("network");
          return "ok";
        },
        "op",
        { retries: 1, retryDelay: 0, retryLogLevel: "debug" }
      );

      await expect(resultPromise).resolves.toBe("ok");
      expect(service.logger.debug).toHaveBeenCalled();
    });

    it("should execute fallback after all retries fail and shouldThrow=false", async () => {
      const fallback = jest.fn().mockResolvedValue("fallback");

      const result = await service.executeWithErrorHandling(
        async () => {
          throw new Error("fail");
        },
        "op",
        { retries: 1, retryDelay: 0, shouldThrow: false, fallback }
      );

      expect(result).toBe("fallback");
      expect(fallback).toHaveBeenCalledTimes(1);
      expect(service.logger.log).toHaveBeenCalledWith(expect.stringContaining("Executing fallback for op"));
      expect(service.getErrorCount("op")).toBeGreaterThan(0);
    });

    it("should record fallback errors and return undefined when fallback fails and shouldThrow=false", async () => {
      const fallback = jest.fn().mockRejectedValue(new Error("fallback failed"));

      const result = await service.executeWithErrorHandling(
        async () => {
          throw new Error("fail");
        },
        "op",
        { retries: 0, retryDelay: 0, shouldThrow: false, fallback }
      );

      expect(result).toBeUndefined();
      expect(service.getErrorCount("op_fallback")).toBe(1);
    });

    it("should throw last error when all retries fail and shouldThrow=true", async () => {
      await expect(
        service.executeWithErrorHandling(
          async () => {
            throw new Error("fail");
          },
          "op",
          { retries: 1, retryDelay: 0, shouldThrow: true }
        )
      ).rejects.toThrow("fail");
    });

    it("should reset tracking per context or globally", () => {
      service.handleError(new Error("e"), "ctx", { shouldThrow: false });
      expect(service.getErrorCount("ctx")).toBe(1);

      service.resetErrorTracking("ctx");
      expect(service.getErrorCount("ctx")).toBe(0);

      service.handleError(new Error("e"), "a", { shouldThrow: false });
      service.handleError(new Error("e"), "b", { shouldThrow: false });
      service.resetErrorTracking();
      expect(service.getErrorCount("a")).toBe(0);
      expect(service.getErrorCount("b")).toBe(0);
    });
  });
});
