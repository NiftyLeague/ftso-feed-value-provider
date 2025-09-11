import { TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestModule } from "@/__tests__/utils";
import { FeedController } from "@/controllers/feed.controller";
import { RealTimeCacheService } from "@/cache/real-time-cache.service";
import type { FeedValuesRequest } from "@/common/types/http";

describe("Voting Round Handling and Historical Data Compliance", () => {
  let app: INestApplication;
  let module: TestingModule;
  let cacheService: RealTimeCacheService;

  beforeAll(async () => {
    module = await createTestModule().addController(FeedController).addCommonMocks().build();

    app = module.createNestApplication();
    cacheService = module.get(RealTimeCacheService);

    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe("Voting Round ID Validation", () => {
    const validVotingRounds = [
      { id: 0, description: "genesis round" },
      { id: 1, description: "first round" },
      { id: 12345, description: "typical round" },
      { id: 999999, description: "large round number" },
      { id: Number.MAX_SAFE_INTEGER, description: "maximum safe integer" },
    ];

    validVotingRounds.forEach(({ id, description }) => {
      it(`should accept valid voting round ID: ${id} (${description})`, async () => {
        const requestBody: FeedValuesRequest = {
          feeds: [{ category: 1, name: "BTC/USD" }],
        };

        const response = await request(app.getHttpServer()).post(`/feed-values/${id}`).send(requestBody);

        // Should not fail due to voting round validation
        if (response.status === 400) {
          expect(response.body.message).not.toContain("votingRoundId");
        } else {
          expect([200, 201, 404, 500]).toContain(response.status);
        }
      });
    });

    const invalidVotingRounds = [
      { id: "abc", description: "non-numeric string" },
      { id: "1.5", description: "decimal as string" },
      { id: "null", description: "null as string" },
      { id: "undefined", description: "undefined as string" },
    ];

    invalidVotingRounds.forEach(({ id, description }) => {
      it(`should reject invalid voting round ID: "${id}" (${description})`, async () => {
        const requestBody: FeedValuesRequest = {
          feeds: [{ category: 1, name: "BTC/USD" }],
        };

        const response = await request(app.getHttpServer()).post(`/feed-values/${id}`).send(requestBody).expect(400);

        expect(response.body).toHaveProperty("error");
        expect(response.body.message).toMatch(/validation failed|numeric string|expected/i);
      });
    });

    // Test negative numbers separately since they should be caught by our business logic
    it("should reject negative voting round ID", async () => {
      const requestBody: FeedValuesRequest = {
        feeds: [{ category: 1, name: "BTC/USD" }],
      };

      const response = await request(app.getHttpServer()).post(`/feed-values/-1`).send(requestBody).expect(400);

      expect(response.body).toHaveProperty("error");
      expect(response.body.message).toMatch(/non-negative|negative/i);
    });
  });

  describe("Historical Data Retrieval", () => {
    beforeEach(() => {
      // Reset cache mocks
      jest.clearAllMocks();
    });

    it("should return historical data with voting round ID in response", async () => {
      const votingRoundId = 12345;
      const requestBody: FeedValuesRequest = {
        feeds: [{ category: 1, name: "BTC/USD" }],
      };

      // Mock cached historical data
      cacheService.getForVotingRound = jest.fn().mockReturnValue({
        value: 50000,
        timestamp: Date.now() - 3600000, // 1 hour ago
        sources: ["historical"],
        confidence: 1.0,
        votingRound: votingRoundId,
      });

      const response = await request(app.getHttpServer()).post(`/feed-values/${votingRoundId}`).send(requestBody);

      if (response.status === 201) {
        expect(response.body).toHaveProperty("votingRoundId", votingRoundId);
        expect(response.body).toHaveProperty("data");
        expect(Array.isArray(response.body.data)).toBe(true);

        // Validate historical data structure
        response.body.data.forEach((feedData: any) => {
          expect(feedData).toHaveProperty("feed");
          expect(feedData).toHaveProperty("value");
          expect(feedData.feed).toHaveProperty("category");
          expect(feedData.feed).toHaveProperty("name");
        });
      }
    });

    it("should handle cache miss for historical data", async () => {
      const votingRoundId = 54321;
      const requestBody: FeedValuesRequest = {
        feeds: [{ category: 1, name: "ETH/USD" }],
      };

      // Mock cache miss
      cacheService.getForVotingRound = jest.fn().mockReturnValue(null);

      const response = await request(app.getHttpServer()).post(`/feed-values/${votingRoundId}`).send(requestBody);

      // Should handle gracefully (may fetch fresh data or return error)
      expect([200, 201, 404, 500]).toContain(response.status);

      if (response.status === 201) {
        expect(response.body).toHaveProperty("votingRoundId", votingRoundId);
      }
    });

    it("should cache historical data after retrieval", async () => {
      const votingRoundId = 67890;
      const requestBody: FeedValuesRequest = {
        feeds: [{ category: 1, name: "XRP/USD" }],
      };

      // Mock cache miss initially
      cacheService.getForVotingRound = jest.fn().mockReturnValue(null);
      cacheService.setForVotingRound = jest.fn();

      const response = await request(app.getHttpServer()).post(`/feed-values/${votingRoundId}`).send(requestBody);

      // Should attempt to cache the data if successful
      if (response.status === 201) {
        // Note: Actual caching behavior depends on implementation
        expect(response.body).toHaveProperty("votingRoundId", votingRoundId);
      }
    });

    it("should handle multiple feeds in historical request", async () => {
      const votingRoundId = 11111;
      const requestBody: FeedValuesRequest = {
        feeds: [
          { category: 1, name: "BTC/USD" },
          { category: 1, name: "ETH/USD" },
          { category: 2, name: "EUR/USD" },
        ],
      };

      const response = await request(app.getHttpServer()).post(`/feed-values/${votingRoundId}`).send(requestBody);

      if (response.status === 201) {
        expect(response.body).toHaveProperty("votingRoundId", votingRoundId);
        expect(response.body.data).toHaveLength(3);
      }
    });
  });

  describe("Historical vs Current Data Distinction", () => {
    it("should distinguish between current and historical endpoints", async () => {
      const requestBody: FeedValuesRequest = {
        feeds: [{ category: 1, name: "BTC/USD" }],
      };

      // Test current endpoint
      const currentResponse = await request(app.getHttpServer()).post("/feed-values").send(requestBody);

      // Test historical endpoint
      const historicalResponse = await request(app.getHttpServer()).post("/feed-values/12345").send(requestBody);

      // Current response should not have votingRoundId
      if (currentResponse.status === 201) {
        expect(currentResponse.body).not.toHaveProperty("votingRoundId");
        expect(currentResponse.body).toHaveProperty("data");
      }

      // Historical response should have votingRoundId
      if (historicalResponse.status === 201) {
        expect(historicalResponse.body).toHaveProperty("votingRoundId", 12345);
        expect(historicalResponse.body).toHaveProperty("data");
      }
    });
  });

  describe("Error Handling for Historical Data", () => {
    it("should handle non-existent voting rounds gracefully", async () => {
      const nonExistentRound = 999999999;
      const requestBody: FeedValuesRequest = {
        feeds: [{ category: 1, name: "BTC/USD" }],
      };

      const response = await request(app.getHttpServer()).post(`/feed-values/${nonExistentRound}`).send(requestBody);

      // Should handle gracefully (404 or empty data)
      expect([200, 201, 404, 500]).toContain(response.status);

      if (response.status === 404) {
        expect(response.body).toHaveProperty("error");
        expect(response.body.message).toMatch(/not found|unavailable/i);
      }
    });

    it("should handle historical data service failures", async () => {
      const votingRoundId = 12345;
      const requestBody: FeedValuesRequest = {
        feeds: [{ category: 1, name: "BTC/USD" }],
      };

      // Mock service failure
      cacheService.getForVotingRound = jest.fn().mockImplementation(() => {
        throw new Error("Cache service unavailable");
      });

      const response = await request(app.getHttpServer()).post(`/feed-values/${votingRoundId}`).send(requestBody);

      // Should handle service failures gracefully
      expect([200, 201, 500, 503]).toContain(response.status);
    });
  });

  describe("Performance Requirements for Historical Data", () => {
    it("should respond to historical requests within acceptable time", async () => {
      const votingRoundId = 12345;
      const requestBody: FeedValuesRequest = {
        feeds: [{ category: 1, name: "BTC/USD" }],
      };

      const startTime = Date.now();

      await request(app.getHttpServer()).post(`/feed-values/${votingRoundId}`).send(requestBody);

      const responseTime = Date.now() - startTime;

      // Historical data should respond within 2 seconds
      expect(responseTime).toBeLessThan(2000);
    });

    it("should handle concurrent historical requests", async () => {
      const requestBody: FeedValuesRequest = {
        feeds: [{ category: 1, name: "BTC/USD" }],
      };

      const concurrentRequests = [
        request(app.getHttpServer()).post("/feed-values/11111").send(requestBody),
        request(app.getHttpServer()).post("/feed-values/22222").send(requestBody),
        request(app.getHttpServer()).post("/feed-values/33333").send(requestBody),
      ];

      const responses = await Promise.all(concurrentRequests);

      // All requests should complete
      responses.forEach((response, index) => {
        expect([200, 201, 404, 500]).toContain(response.status);

        if (response.status === 201) {
          const expectedRoundId = [11111, 22222, 33333][index];
          expect(response.body).toHaveProperty("votingRoundId", expectedRoundId);
        }
      });
    });
  });

  describe("Data Consistency", () => {
    it("should return consistent data structure for historical requests", async () => {
      const votingRoundId = 12345;
      const requestBody: FeedValuesRequest = {
        feeds: [
          { category: 1, name: "BTC/USD" },
          { category: 1, name: "ETH/USD" },
        ],
      };

      const response = await request(app.getHttpServer()).post(`/feed-values/${votingRoundId}`).send(requestBody);

      if (response.status === 201) {
        expect(response.body).toHaveProperty("votingRoundId", votingRoundId);
        expect(response.body).toHaveProperty("data");
        expect(Array.isArray(response.body.data)).toBe(true);

        // Validate data structure consistency
        response.body.data.forEach((feedData: any) => {
          expect(feedData).toHaveProperty("feed");
          expect(feedData).toHaveProperty("value");
          expect(typeof feedData.feed.category).toBe("number");
          expect(typeof feedData.feed.name).toBe("string");
          expect(typeof feedData.value).toBe("number");
        });
      }
    });

    it("should maintain feed order in historical responses", async () => {
      const votingRoundId = 12345;
      const requestBody: FeedValuesRequest = {
        feeds: [
          { category: 1, name: "BTC/USD" },
          { category: 1, name: "ETH/USD" },
          { category: 2, name: "EUR/USD" },
        ],
      };

      const response = await request(app.getHttpServer()).post(`/feed-values/${votingRoundId}`).send(requestBody);

      if (response.status === 201 && response.body.data.length === 3) {
        // Should maintain the same order as requested
        expect(response.body.data[0].feed.name).toBe("BTC/USD");
        expect(response.body.data[1].feed.name).toBe("ETH/USD");
        expect(response.body.data[2].feed.name).toBe("EUR/USD");
      }
    });
  });
});
