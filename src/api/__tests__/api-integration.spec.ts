import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "@/app.module";
import { EnhancedFeedId } from "@/types/enhanced-feed-id.types";
import { FeedCategory } from "@/types/feed-category.enum";

describe("API Integration Tests", () => {
  let app: INestApplication;
  let module: TestingModule;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await module.close();
  });

  describe("POST /feed-values", () => {
    it("should return current feed values for valid feeds", async () => {
      const requestBody = {
        feeds: [
          { category: FeedCategory.Crypto, name: "BTC/USD" },
          { category: FeedCategory.Crypto, name: "ETH/USD" },
        ],
      };

      const response = await request(app.getHttpServer()).post("/feed-values").send(requestBody).expect(200);

      expect(response.body).toHaveProperty("feeds");
      expect(response.body).toHaveProperty("timestamp");
      expect(response.body.feeds).toHaveLength(2);

      // Verify feed structure
      response.body.feeds.forEach((feed: any) => {
        expect(feed).toHaveProperty("feedId");
        expect(feed).toHaveProperty("value");
        expect(feed).toHaveProperty("decimals");
        expect(typeof feed.value).toBe("number");
        expect(typeof feed.decimals).toBe("number");
      });
    });

    it("should handle empty feeds array", async () => {
      const requestBody = { feeds: [] };

      const response = await request(app.getHttpServer()).post("/feed-values").send(requestBody).expect(200);

      expect(response.body.feeds).toHaveLength(0);
      expect(response.body).toHaveProperty("timestamp");
    });

    it("should return 400 for invalid feed categories", async () => {
      const requestBody = {
        feeds: [{ category: 999, name: "BTC/USD" }],
      };

      const response = await request(app.getHttpServer()).post("/feed-values").send(requestBody).expect(400);

      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toBe("Validation Error");
      expect(response.body.code).toBe(4001);
    });

    it("should return 400 for invalid feed names", async () => {
      const requestBody = {
        feeds: [{ category: FeedCategory.Crypto, name: "" }],
      };

      const response = await request(app.getHttpServer())
        .post("/feed-values")
        .send(requestBody)
        .send(requestBody)
        .expect(400);

      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toBe("Validation Error");
      expect(response.body.code).toBe(4002);
    });

    it("should return 404 for non-existent feeds", async () => {
      const requestBody = {
        feeds: [{ category: FeedCategory.Crypto, name: "NONEXISTENT/USD" }],
      };

      const response = await request(app.getHttpServer()).post("/feed-values").send(requestBody).expect(404);

      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toBe("Not Found");
      expect(response.body.code).toBe(4041);
    });

    it("should respond within 100ms for optimal performance", async () => {
      const requestBody = {
        feeds: [{ category: FeedCategory.Crypto, name: "BTC/USD" }],
      };

      const startTime = Date.now();

      await request(app.getHttpServer()).post("/feed-values").send(requestBody).expect(200);

      const responseTime = Date.now() - startTime;
      expect(responseTime).toBeLessThan(100);
    });

    it("should handle concurrent requests efficiently", async () => {
      const requestBody = {
        feeds: [
          { category: FeedCategory.Crypto, name: "BTC/USD" },
          { category: FeedCategory.Crypto, name: "ETH/USD" },
        ],
      };

      const concurrentRequests = 10;
      const promises = Array(concurrentRequests)
        .fill(null)
        .map(() => request(app.getHttpServer()).post("/feed-values").send(requestBody));

      const startTime = Date.now();
      const responses = await Promise.all(promises);
      const totalTime = Date.now() - startTime;

      // All requests should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.feeds).toHaveLength(2);
      });

      // Should handle concurrent requests efficiently
      expect(totalTime).toBeLessThan(1000); // Less than 1 second for 10 concurrent requests
    });

    it("should include proper CORS headers", async () => {
      const requestBody = {
        feeds: [{ category: FeedCategory.Crypto, name: "BTC/USD" }],
      };

      const response = await request(app.getHttpServer()).post("/feed-values").send(requestBody).expect(200);

      expect(response.headers).toHaveProperty("access-control-allow-origin");
      expect(response.headers).toHaveProperty("access-control-allow-methods");
      expect(response.headers).toHaveProperty("access-control-allow-headers");
    });

    it("should handle large feed requests", async () => {
      const feeds = [];
      for (let i = 0; i < 100; i++) {
        feeds.push({ category: FeedCategory.Crypto, name: `SYMBOL${i}/USD` });
      }

      const requestBody = { feeds };

      const response = await request(app.getHttpServer()).post("/feed-values").send(requestBody);

      // Should handle gracefully (either succeed or return appropriate error)
      expect([200, 400, 404]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body.feeds).toBeDefined();
      }
    });
  });

  describe("POST /feed-values/:votingRoundId", () => {
    it("should return historical feed values for valid voting round", async () => {
      const votingRoundId = "12345";
      const requestBody = {
        feeds: [{ category: FeedCategory.Crypto, name: "BTC/USD" }],
      };

      const response = await request(app.getHttpServer())
        .post(`/feed-values/${votingRoundId}`)
        .send(requestBody)
        .expect(200);

      expect(response.body).toHaveProperty("feeds");
      expect(response.body).toHaveProperty("timestamp");
      expect(response.body).toHaveProperty("votingRoundId");
      expect(response.body.votingRoundId).toBe(votingRoundId);
    });

    it("should return 400 for invalid voting round ID", async () => {
      const invalidVotingRoundId = "invalid";
      const requestBody = {
        feeds: [{ category: FeedCategory.Crypto, name: "BTC/USD" }],
      };

      const response = await request(app.getHttpServer())
        .post(`/feed-values/${invalidVotingRoundId}`)
        .send(requestBody)
        .expect(400);

      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toBe("Validation Error");
      expect(response.body.code).toBe(4003);
    });

    it("should return 404 for non-existent voting round", async () => {
      const nonExistentVotingRoundId = "999999";
      const requestBody = {
        feeds: [{ category: FeedCategory.Crypto, name: "BTC/USD" }],
      };

      const response = await request(app.getHttpServer())
        .post(`/feed-values/${nonExistentVotingRoundId}`)
        .send(requestBody)
        .expect(404);

      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toBe("Not Found");
    });

    it("should maintain performance for historical queries", async () => {
      const votingRoundId = "12345";
      const requestBody = {
        feeds: [
          { category: FeedCategory.Crypto, name: "BTC/USD" },
          { category: FeedCategory.Crypto, name: "ETH/USD" },
        ],
      };

      const startTime = Date.now();

      await request(app.getHttpServer()).post(`/feed-values/${votingRoundId}`).send(requestBody);

      const responseTime = Date.now() - startTime;
      expect(responseTime).toBeLessThan(200); // Allow slightly more time for historical queries
    });
  });

  describe("POST /volumes", () => {
    it("should return volume data for valid time window", async () => {
      const requestBody = {
        feeds: [{ category: FeedCategory.Crypto, name: "BTC/USD" }],
        startTime: Date.now() - 3600000, // 1 hour ago
        endTime: Date.now(),
      };

      const response = await request(app.getHttpServer()).post("/volumes").send(requestBody).expect(200);

      expect(response.body).toHaveProperty("feeds");
      expect(response.body).toHaveProperty("timeWindow");
      expect(response.body.timeWindow).toHaveProperty("start");
      expect(response.body.timeWindow).toHaveProperty("end");

      response.body.feeds.forEach((feed: any) => {
        expect(feed).toHaveProperty("feedId");
        expect(feed).toHaveProperty("volume");
        expect(feed).toHaveProperty("decimals");
        expect(typeof feed.volume).toBe("number");
        expect(typeof feed.decimals).toBe("number");
      });
    });

    it("should return 400 for invalid time window", async () => {
      const requestBody = {
        feeds: [{ category: FeedCategory.Crypto, name: "BTC/USD" }],
        startTime: Date.now(), // Start time after end time
        endTime: Date.now() - 3600000,
      };

      const response = await request(app.getHttpServer()).post("/volumes").send(requestBody).expect(400);

      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toBe("Validation Error");
      expect(response.body.code).toBe(4004);
    });

    it("should handle missing time parameters", async () => {
      const requestBody = {
        feeds: [{ category: FeedCategory.Crypto, name: "BTC/USD" }],
        // Missing startTime and endTime
      };

      const response = await request(app.getHttpServer()).post("/volumes").send(requestBody).expect(400);

      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toBe("Validation Error");
    });

    it("should handle large time windows efficiently", async () => {
      const requestBody = {
        feeds: [{ category: FeedCategory.Crypto, name: "BTC/USD" }],
        startTime: Date.now() - 86400000 * 7, // 7 days ago
        endTime: Date.now(),
      };

      const startTime = Date.now();

      const response = await request(app.getHttpServer()).post("/volumes").send(requestBody);

      const responseTime = Date.now() - startTime;

      // Should handle large time windows (either succeed or return appropriate error)
      expect([200, 400, 404]).toContain(response.status);
      expect(responseTime).toBeLessThan(5000); // Should respond within 5 seconds
    });
  });

  describe("Rate Limiting", () => {
    it("should enforce rate limits", async () => {
      const requestBody = {
        feeds: [{ category: FeedCategory.Crypto, name: "BTC/USD" }],
      };

      // Make many requests rapidly
      const rapidRequests = Array(100)
        .fill(null)
        .map(() => request(app.getHttpServer()).post("/feed-values").send(requestBody));

      const responses = await Promise.allSettled(rapidRequests);

      // Some requests should be rate limited
      const rateLimitedResponses = responses.filter(
        result => result.status === "fulfilled" && (result.value as any).status === 429
      );

      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });

    it("should return proper rate limit headers", async () => {
      const requestBody = {
        feeds: [{ category: FeedCategory.Crypto, name: "BTC/USD" }],
      };

      const response = await request(app.getHttpServer()).post("/feed-values").send(requestBody);

      // Should include rate limit headers
      expect(response.headers).toHaveProperty("x-ratelimit-limit");
      expect(response.headers).toHaveProperty("x-ratelimit-remaining");
      expect(response.headers).toHaveProperty("x-ratelimit-reset");
    });
  });

  describe("Error Handling", () => {
    it("should return structured error responses", async () => {
      const invalidRequestBody = {
        feeds: "invalid", // Should be array
      };

      const response = await request(app.getHttpServer()).post("/feed-values").send(invalidRequestBody).expect(400);

      expect(response.body).toHaveProperty("error");
      expect(response.body).toHaveProperty("code");
      expect(response.body).toHaveProperty("message");
      expect(response.body).toHaveProperty("timestamp");
      expect(response.body).toHaveProperty("requestId");

      expect(typeof response.body.error).toBe("string");
      expect(typeof response.body.code).toBe("number");
      expect(typeof response.body.message).toBe("string");
      expect(typeof response.body.timestamp).toBe("number");
      expect(typeof response.body.requestId).toBe("string");
    });

    it("should handle malformed JSON gracefully", async () => {
      const response = await request(app.getHttpServer())
        .post("/feed-values")
        .set("Content-Type", "application/json")
        .send("invalid json")
        .expect(400);

      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toBe("Validation Error");
    });

    it("should handle missing Content-Type header", async () => {
      const requestBody = {
        feeds: [{ category: FeedCategory.Crypto, name: "BTC/USD" }],
      };

      const response = await request(app.getHttpServer())
        .post("/feed-values")
        .send(JSON.stringify(requestBody))
        // Don't set Content-Type header
        .expect(400);

      expect(response.body).toHaveProperty("error");
    });

    it("should handle oversized requests", async () => {
      // Create a very large request body
      const largeRequestBody = {
        feeds: Array(10000).fill({ category: FeedCategory.Crypto, name: "BTC/USD" }),
      };

      const response = await request(app.getHttpServer()).post("/feed-values").send(largeRequestBody);

      // Should either process or reject with appropriate error
      expect([200, 400, 413]).toContain(response.status);

      if (response.status === 413) {
        expect(response.body).toHaveProperty("error");
        expect(response.body.error).toContain("Payload Too Large");
      }
    });
  });

  describe("Security Headers", () => {
    it("should include security headers", async () => {
      const requestBody = {
        feeds: [{ category: FeedCategory.Crypto, name: "BTC/USD" }],
      };

      const response = await request(app.getHttpServer()).post("/feed-values").send(requestBody).expect(200);

      // Check for common security headers
      expect(response.headers).toHaveProperty("x-content-type-options");
      expect(response.headers).toHaveProperty("x-frame-options");
      expect(response.headers).toHaveProperty("x-xss-protection");
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
    });

    it("should not expose sensitive server information", async () => {
      const requestBody = {
        feeds: [{ category: FeedCategory.Crypto, name: "BTC/USD" }],
      };

      const response = await request(app.getHttpServer()).post("/feed-values").send(requestBody);

      // Should not expose server version or technology stack
      expect(response.headers["x-powered-by"]).toBeUndefined();
      expect(response.headers["server"]).not.toContain("Express");
      expect(response.headers["server"]).not.toContain("Node.js");
    });
  });

  describe("Health Check Endpoints", () => {
    it("should provide health check endpoint", async () => {
      const response = await request(app.getHttpServer()).get("/health").expect(200);

      expect(response.body).toHaveProperty("status");
      expect(response.body.status).toBe("ok");
      expect(response.body).toHaveProperty("timestamp");
      expect(response.body).toHaveProperty("uptime");
    });

    it("should provide detailed health status", async () => {
      const response = await request(app.getHttpServer()).get("/health/detailed").expect(200);

      expect(response.body).toHaveProperty("status");
      expect(response.body).toHaveProperty("components");
      expect(response.body.components).toHaveProperty("database");
      expect(response.body.components).toHaveProperty("exchanges");
      expect(response.body.components).toHaveProperty("cache");
    });
  });

  describe("Metrics Endpoint", () => {
    it("should provide metrics endpoint", async () => {
      const response = await request(app.getHttpServer()).get("/metrics").expect(200);

      expect(response.body).toHaveProperty("requests");
      expect(response.body).toHaveProperty("responseTime");
      expect(response.body).toHaveProperty("errors");
      expect(response.body).toHaveProperty("uptime");
    });

    it("should track request metrics", async () => {
      // Make a few requests to generate metrics
      const requestBody = {
        feeds: [{ category: FeedCategory.Crypto, name: "BTC/USD" }],
      };

      await request(app.getHttpServer()).post("/feed-values").send(requestBody);

      await request(app.getHttpServer()).post("/feed-values").send(requestBody);

      const response = await request(app.getHttpServer()).get("/metrics").expect(200);

      expect(response.body.requests.total).toBeGreaterThanOrEqual(2);
      expect(response.body.responseTime.average).toBeGreaterThan(0);
    });
  });

  describe("Data Freshness", () => {
    it("should serve data no older than 2 seconds", async () => {
      const requestBody = {
        feeds: [{ category: FeedCategory.Crypto, name: "BTC/USD" }],
      };

      const response = await request(app.getHttpServer()).post("/feed-values").send(requestBody).expect(200);

      const currentTime = Date.now();
      const dataAge = currentTime - response.body.timestamp;

      expect(dataAge).toBeLessThan(2000); // Data should be fresh
    });

    it("should indicate data staleness in response", async () => {
      const requestBody = {
        feeds: [{ category: FeedCategory.Crypto, name: "BTC/USD" }],
      };

      const response = await request(app.getHttpServer()).post("/feed-values").send(requestBody).expect(200);

      // Response should include data quality indicators
      expect(response.body).toHaveProperty("timestamp");

      if (response.body.dataQuality) {
        expect(response.body.dataQuality).toHaveProperty("freshness");
        expect(response.body.dataQuality).toHaveProperty("confidence");
      }
    });
  });
});
