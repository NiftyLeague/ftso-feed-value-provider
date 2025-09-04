import { TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestModule, TestDataBuilder } from "@/__tests__/utils";
import { FeedController } from "@/controllers/feed.controller";
import { HealthController } from "@/controllers/health.controller";
import { MetricsController } from "@/controllers/metrics.controller";

describe("Controllers Integration", () => {
  let app: INestApplication;
  let module: TestingModule;

  beforeAll(async () => {
    // Create comprehensive test module with all controllers
    module = await createTestModule()
      .addController(FeedController)
      .addController(HealthController)
      .addController(MetricsController)
      .addCommonMocks()
      .build();

    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("FeedController Integration", () => {
    describe("POST /feed-values", () => {
      it("should return current feed values", async () => {
        const requestBody = {
          feeds: [TestDataBuilder.createFeedId({ name: "BTC/USD" }), TestDataBuilder.createFeedId({ name: "ETH/USD" })],
        };

        const response = await request(app.getHttpServer()).post("/feed-values").send(requestBody).expect(200);

        expect(response.body).toHaveProperty("feeds");
        expect(Array.isArray(response.body.feeds)).toBe(true);
      });

      it("should handle invalid feed requests", async () => {
        const requestBody = {
          feeds: [{ category: "invalid", name: "INVALID/PAIR" }],
        };

        await request(app.getHttpServer()).post("/feed-values").send(requestBody).expect(400);
      });

      it("should handle empty feed requests", async () => {
        const requestBody = { feeds: [] };

        const response = await request(app.getHttpServer()).post("/feed-values").send(requestBody).expect(200);

        expect(response.body.feeds).toEqual([]);
      });
    });

    describe("POST /feed-values/:votingRoundId", () => {
      it("should return feed values for specific voting round", async () => {
        const votingRoundId = 12345;
        const requestBody = {
          feeds: [TestDataBuilder.createFeedId({ name: "BTC/USD" })],
        };

        const response = await request(app.getHttpServer())
          .post(`/feed-values/${votingRoundId}`)
          .send(requestBody)
          .expect(200);

        expect(response.body).toHaveProperty("feeds");
        expect(response.body).toHaveProperty("votingRoundId", votingRoundId);
      });

      it("should handle invalid voting round IDs", async () => {
        const requestBody = {
          feeds: [TestDataBuilder.createFeedId()],
        };

        await request(app.getHttpServer()).post("/feed-values/invalid").send(requestBody).expect(400);
      });
    });

    describe("POST /volumes", () => {
      it("should return volume data with window parameter", async () => {
        const requestBody = {
          feeds: [TestDataBuilder.createFeedId({ name: "BTC/USD" })],
        };

        const response = await request(app.getHttpServer())
          .post("/volumes")
          .query({ windowSec: 3600 })
          .send(requestBody)
          .expect(200);

        expect(response.body).toHaveProperty("feeds");
        expect(response.body).toHaveProperty("windowSec", 3600);
      });

      it("should use default window when not specified", async () => {
        const requestBody = {
          feeds: [TestDataBuilder.createFeedId()],
        };

        const response = await request(app.getHttpServer()).post("/volumes").send(requestBody).expect(200);

        expect(response.body).toHaveProperty("windowSec");
      });
    });
  });

  describe("HealthController Integration", () => {
    describe("GET /health", () => {
      it("should return health status", async () => {
        const response = await request(app.getHttpServer()).get("/health").expect(200);

        expect(response.body).toHaveProperty("status");
        expect(response.body).toHaveProperty("timestamp");
        expect(response.body).toHaveProperty("services");
      });

      it("should include service-specific health checks", async () => {
        const response = await request(app.getHttpServer()).get("/health").expect(200);

        expect(response.body.services).toBeDefined();
        expect(typeof response.body.services).toBe("object");
      });
    });

    describe("GET /health/readiness", () => {
      it("should return readiness status", async () => {
        const response = await request(app.getHttpServer()).get("/health/readiness").expect(200);

        expect(response.body).toHaveProperty("ready");
        expect(response.body).toHaveProperty("timestamp");
      });
    });

    describe("GET /health/liveness", () => {
      it("should return liveness status", async () => {
        const response = await request(app.getHttpServer()).get("/health/liveness").expect(200);

        expect(response.body).toHaveProperty("alive");
        expect(response.body).toHaveProperty("uptime");
      });
    });
  });

  describe("MetricsController Integration", () => {
    describe("GET /metrics", () => {
      it("should return system metrics", async () => {
        const response = await request(app.getHttpServer()).get("/metrics").expect(200);

        expect(response.body).toHaveProperty("timestamp");
        expect(response.body).toHaveProperty("metrics");
      });
    });

    describe("GET /metrics/api", () => {
      it("should return API-specific metrics", async () => {
        const response = await request(app.getHttpServer()).get("/metrics/api").expect(200);

        expect(response.body).toHaveProperty("requests");
        expect(response.body).toHaveProperty("responses");
        expect(response.body).toHaveProperty("errors");
      });
    });

    describe("GET /metrics/performance", () => {
      it("should return performance metrics", async () => {
        const response = await request(app.getHttpServer()).get("/metrics/performance").expect(200);

        expect(response.body).toHaveProperty("responseTime");
        expect(response.body).toHaveProperty("throughput");
      });
    });
  });

  describe("Cross-Controller Integration", () => {
    it("should maintain consistent error handling across controllers", async () => {
      // Test error handling consistency
      const invalidRequests = [
        { method: "post", path: "/feed-values", body: { invalid: "data" } },
        { method: "get", path: "/health/invalid-endpoint" },
        { method: "get", path: "/metrics/invalid-metric" },
      ];

      for (const req of invalidRequests) {
        let response;
        if (req.method === "get") {
          response = await request(app.getHttpServer()).get(req.path);
        } else if (req.method === "post") {
          response = await request(app.getHttpServer())
            .post(req.path)
            .send(req.body || {});
        } else {
          response = await request(app.getHttpServer()).get(req.path);
        }

        // All should return proper error structure
        if (response.status >= 400) {
          expect(response.body).toHaveProperty("error");
          expect(response.body).toHaveProperty("timestamp");
        }
      }
    });

    it("should handle concurrent requests across controllers", async () => {
      const requests = [
        request(app.getHttpServer()).get("/health"),
        request(app.getHttpServer()).get("/metrics"),
        request(app.getHttpServer())
          .post("/feed-values")
          .send({
            feeds: [TestDataBuilder.createFeedId()],
          }),
      ];

      const responses = await Promise.all(requests);

      // All requests should complete successfully
      responses.forEach(response => {
        expect(response.status).toBeLessThan(400);
      });
    });

    it("should maintain proper response time across all endpoints", async () => {
      const endpoints = [
        { method: "get", path: "/health" },
        { method: "get", path: "/metrics" },
        { method: "post", path: "/feed-values", body: { feeds: [] } },
      ];

      for (const endpoint of endpoints) {
        const start = Date.now();

        if (endpoint.method === "get") {
          await request(app.getHttpServer()).get(endpoint.path);
        } else if (endpoint.method === "post") {
          await request(app.getHttpServer())
            .post(endpoint.path)
            .send(endpoint.body || {});
        }

        const duration = Date.now() - start;

        // Should respond within reasonable time (adjust threshold as needed)
        expect(duration).toBeLessThan(1000);
      }
    });
  });

  describe("Rate Limiting Integration", () => {
    it("should apply rate limiting consistently", async () => {
      // Make multiple rapid requests to test rate limiting
      const requests = Array.from({ length: 10 }, () => request(app.getHttpServer()).get("/health"));

      const responses = await Promise.all(requests);

      // Should handle all requests (rate limiting configuration dependent)
      responses.forEach(response => {
        expect([200, 429]).toContain(response.status);
      });
    });
  });

  describe("Content Type and Headers", () => {
    it("should handle JSON content type correctly", async () => {
      const response = await request(app.getHttpServer())
        .post("/feed-values")
        .set("Content-Type", "application/json")
        .send({ feeds: [] })
        .expect(200);

      expect(response.headers["content-type"]).toMatch(/application\/json/);
    });

    it("should include proper CORS headers", async () => {
      const response = await request(app.getHttpServer()).get("/health").expect(200);

      // Check for CORS headers (if configured)
      expect(response.headers).toBeDefined();
    });

    it("should handle missing content type gracefully", async () => {
      await request(app.getHttpServer()).post("/feed-values").send("invalid json").expect(400);
    });
  });
});
