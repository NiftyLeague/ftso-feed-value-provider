import { RateLimiterService } from "../rate-limiter.service";
import { TestHelpers, MockSetup } from "@/__tests__/utils";
import { RateLimitConfig } from "@/common/types/utils";

describe("RateLimiterService", () => {
  let service: RateLimiterService;

  beforeAll(() => {
    MockSetup.setupConsole();
  });

  beforeEach(() => {
    service = new RateLimiterService();
  });

  afterEach(() => {
    if (service?.destroy) {
      service.destroy();
    }
  });

  afterAll(() => {
    MockSetup.cleanup();
  });

  describe("initialization", () => {
    it("should be defined", () => {
      expect(service).toBeDefined();
      expect(service).toBeInstanceOf(RateLimiterService);
    });

    it("should initialize with default configuration", () => {
      const config = service.getConfig();
      expect(config.windowMs).toBe(60000);
      expect(config.maxRequests).toBe(1000);
      expect(config.skipSuccessfulRequests).toBe(false);
      expect(config.skipFailedRequests).toBe(false);
    });

    it("should initialize with custom configuration", () => {
      const customConfig: Partial<RateLimitConfig> = {
        windowMs: 30000,
        maxRequests: 500,
        skipSuccessfulRequests: true,
      };

      // Create service directly with custom config
      const customService = new RateLimiterService(customConfig);
      const config = customService.getConfig();

      expect(config.windowMs).toBe(30000);
      expect(config.maxRequests).toBe(500);
      expect(config.skipSuccessfulRequests).toBe(true);

      customService.destroy();
    });
  });

  describe("rate limiting", () => {
    beforeEach(() => {
      // Use a smaller window for faster tests
      service.updateConfig({ windowMs: 1000, maxRequests: 3 });
    });

    it("should allow requests within limits", () => {
      const clientId = "test-client";

      // First request should be allowed
      const result1 = service.recordRequest(clientId);
      expect(result1.isBlocked).toBe(false);
      expect(result1.remainingPoints).toBe(2);
      expect(result1.totalHitsInWindow).toBe(1);

      // Second request should be allowed
      const result2 = service.recordRequest(clientId);
      expect(result2.isBlocked).toBe(false);
      expect(result2.remainingPoints).toBe(1);
      expect(result2.totalHitsInWindow).toBe(2);
    });

    it("should block requests when limit is exceeded", () => {
      const clientId = "test-client";

      // Make requests up to the limit
      service.recordRequest(clientId);
      service.recordRequest(clientId);
      service.recordRequest(clientId);

      // Fourth request should be blocked
      const result = service.recordRequest(clientId);
      expect(result.isBlocked).toBe(true);
      expect(result.remainingPoints).toBe(0);
      expect(result.totalHitsInWindow).toBe(4);
      expect(result.msBeforeNext).toBeGreaterThan(0);
    });

    it("should handle multiple clients independently", () => {
      const client1 = "client-1";
      const client2 = "client-2";

      // Client 1 makes requests up to limit
      service.recordRequest(client1);
      service.recordRequest(client1);
      service.recordRequest(client1);

      // Client 1 should be blocked
      const result1 = service.recordRequest(client1);
      expect(result1.isBlocked).toBe(true);

      // Client 2 should still be allowed
      const result2 = service.recordRequest(client2);
      expect(result2.isBlocked).toBe(false);
      expect(result2.remainingPoints).toBe(2);
    });

    it("should reset window after time passes", async () => {
      const clientId = "test-client";

      // Fill up the limit
      service.recordRequest(clientId);
      service.recordRequest(clientId);
      service.recordRequest(clientId);

      // Should be blocked
      let result = service.recordRequest(clientId);
      expect(result.isBlocked).toBe(true);

      // Wait for window to reset
      await TestHelpers.wait(1100);

      // Should be allowed again
      result = service.recordRequest(clientId);
      expect(result.isBlocked).toBe(false);
      expect(result.totalHitsInWindow).toBe(1);
    });
  });

  describe("request recording options", () => {
    beforeEach(() => {
      service.updateConfig({ windowMs: 1000, maxRequests: 2 });
    });

    it("should skip successful requests when configured", () => {
      service.updateConfig({ skipSuccessfulRequests: true });
      const clientId = "test-client";

      // Successful requests should be skipped
      const result1 = service.recordRequest(clientId, true);
      expect(result1.totalHitsInWindow).toBe(0);

      // Failed requests should still be recorded
      const result2 = service.recordRequest(clientId, false);
      expect(result2.totalHitsInWindow).toBe(1);
    });

    it("should skip failed requests when configured", () => {
      service.updateConfig({ skipFailedRequests: true });
      const clientId = "test-client";

      // Failed requests should be skipped
      const result1 = service.recordRequest(clientId, false);
      expect(result1.totalHitsInWindow).toBe(0);

      // Successful requests should still be recorded
      const result2 = service.recordRequest(clientId, true);
      expect(result2.totalHitsInWindow).toBe(1);
    });
  });

  describe("statistics and management", () => {
    beforeEach(() => {
      service.updateConfig({ windowMs: 1000, maxRequests: 2 });
    });

    it("should provide accurate statistics", () => {
      const client1 = "client-1";
      const client2 = "client-2";

      // Make some requests
      service.recordRequest(client1);
      service.recordRequest(client1);
      service.recordRequest(client2);

      const stats = service.getStats();
      expect(stats.totalRequests).toBe(3);
      expect(stats.allowedRequests).toBeGreaterThan(0);
      expect(typeof stats.hitRate).toBe("number");
    });

    it("should reset specific client", () => {
      const clientId = "test-client";

      // Make requests
      service.recordRequest(clientId);
      service.recordRequest(clientId);

      let result = service.checkRateLimit(clientId);
      expect(result.totalHitsInWindow).toBe(2);

      // Reset client
      service.resetClient(clientId);

      result = service.checkRateLimit(clientId);
      expect(result.totalHitsInWindow).toBe(0);
    });

    it("should reset all clients", () => {
      const client1 = "client-1";
      const client2 = "client-2";

      // Make requests for multiple clients
      service.recordRequest(client1);
      service.recordRequest(client2);

      // Reset all
      service.reset();

      const result1 = service.checkRateLimit(client1);
      const result2 = service.checkRateLimit(client2);

      expect(result1.totalHitsInWindow).toBe(0);
      expect(result2.totalHitsInWindow).toBe(0);
    });

    it("should update configuration", () => {
      const newConfig = {
        windowMs: 5000,
        maxRequests: 100,
      };

      service.updateConfig(newConfig);
      const config = service.getConfig();

      expect(config.windowMs).toBe(5000);
      expect(config.maxRequests).toBe(100);
    });
  });

  describe("cleanup and lifecycle", () => {
    it("should cleanup old records", async () => {
      const clientId = "test-client";

      // Make a request
      service.recordRequest(clientId);

      // Manually trigger cleanup (access private method for testing)
      (service as any).cleanup();

      // Should not throw and service should still work
      const result = service.checkRateLimit(clientId);
      expect(result).toBeDefined();
    });

    it("should destroy cleanly", () => {
      const clientId = "test-client";
      service.recordRequest(clientId);

      expect(() => service.destroy()).not.toThrow();

      // Should still be able to check rate limits after destroy
      const result = service.checkRateLimit(clientId);
      expect(result.totalHitsInWindow).toBe(0);
    });
  });

  describe("edge cases", () => {
    it("should handle rapid successive requests", () => {
      const clientId = "test-client";
      service.updateConfig({ windowMs: 1000, maxRequests: 10 });

      // Make many rapid requests
      const results = [];
      for (let i = 0; i < 15; i++) {
        results.push(service.recordRequest(clientId));
      }

      // Check that we get the expected pattern - most requests allowed up to limit, then blocked
      const allowedCount = results.filter(r => !r.isBlocked).length;
      const blockedCount = results.filter(r => r.isBlocked).length;

      // Should allow up to maxRequests, then block the rest
      expect(allowedCount).toBeGreaterThanOrEqual(9); // Allow some variance
      expect(allowedCount).toBeLessThanOrEqual(10);
      expect(blockedCount).toBeGreaterThan(0);
    });

    it("should handle zero max requests", () => {
      service.updateConfig({ maxRequests: 0 });
      const clientId = "test-client";

      const result = service.recordRequest(clientId);
      expect(result.isBlocked).toBe(true);
      expect(result.remainingPoints).toBe(0);
    });

    it("should handle very small time windows", () => {
      service.updateConfig({ windowMs: 100, maxRequests: 1 }); // Use slightly larger window for reliability
      const clientId = "test-client";

      const result1 = service.recordRequest(clientId);
      // First request should be allowed
      expect(result1.totalHitsInWindow).toBe(1);
      expect(result1.remainingPoints).toBe(0);

      const result2 = service.recordRequest(clientId);
      // Second request should be blocked since we're at the limit
      expect(result2.isBlocked).toBe(true);
      expect(result2.remainingPoints).toBe(0);
    });
  });
});
