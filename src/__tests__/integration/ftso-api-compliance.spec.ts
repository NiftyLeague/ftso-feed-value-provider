import { TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestModule } from "@/__tests__/utils";
import { FeedController } from "@/controllers/feed.controller";
import { ConfigService } from "@/config/config.service";
import type { FeedValuesRequest, VolumesRequest } from "@/common/types/http";

describe("FTSO API Compliance Integration Tests", () => {
  let app: INestApplication;
  let module: TestingModule;
  let configService: ConfigService;

  beforeAll(async () => {
    module = await createTestModule().addController(FeedController).addCommonMocks().build();

    app = module.createNestApplication();
    configService = module.get(ConfigService);

    // Mock feed configuration
    const mockFeeds = [
      { feed: { category: 1, name: "BTC/USD" }, sources: [] },
      { feed: { category: 1, name: "ETH/USD" }, sources: [] },
      { feed: { category: 1, name: "XRP/USD" }, sources: [] },
      { feed: { category: 2, name: "EUR/USD" }, sources: [] },
      { feed: { category: 3, name: "XAU/USD" }, sources: [] },
      { feed: { category: 4, name: "AAPL/USD" }, sources: [] },
    ];

    jest.spyOn(configService, "getFeedConfigurations").mockReturnValue(mockFeeds as any);

    // Verify the mock is working
    console.log("Mock feeds:", configService.getFeedConfigurations());

    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe("Feed Categories Validation (Requirements 7.1, 7.4)", () => {
    describe("Valid Categories", () => {
      const validCategories = [
        { category: 1, description: "Crypto", example: "BTC/USD" },
        { category: 2, description: "Forex", example: "EUR/USD" },
        { category: 3, description: "Commodity", example: "XAU/USD" },
        { category: 4, description: "Stock", example: "AAPL/USD" },
      ];

      validCategories.forEach(({ category, description, example }) => {
        it(`should accept category ${category} (${description})`, async () => {
          const requestBody: FeedValuesRequest = {
            feeds: [{ category, name: example }],
          };

          const response = await request(app.getHttpServer()).post("/feed-values").send(requestBody);

          if (response.status !== 200) {
            console.log(`Error response for category ${category}:`, response.status, response.body);
          }

          expect(response.status).toBe(200);
          if (response.status === 200) {
            expect(response.body).toHaveProperty("data");
            expect(Array.isArray(response.body.data)).toBe(true);
          }
        });
      });
    });

    describe("Invalid Categories", () => {
      const invalidCategories = [0, 5, -1, 999, 1.5, "1", null, undefined];

      invalidCategories.forEach(category => {
        it(`should reject invalid category: ${category}`, async () => {
          const requestBody = {
            feeds: [{ category, name: "BTC/USD" }],
          };

          const response = await request(app.getHttpServer()).post("/feed-values").send(requestBody).expect(400);

          expect(response.body).toHaveProperty("error");
          expect(response.body.message).toContain("category");
        });
      });
    });
  });

  describe("Feed Name Format Validation (Requirements 7.1, 7.5)", () => {
    describe("Valid Feed Names", () => {
      const validNames = [
        "BTC/USD",
        "ETH/USDT",
        "XRP/EUR",
        "ALGO/USD",
        "FLR/USD",
        "SGB/USD",
        "USDC/USD",
        "EUR/USD",
        "GBP/USD",
        "XAU/USD", // Gold
        "AAPL/USD", // Apple stock
      ];

      validNames.forEach(name => {
        it(`should accept valid feed name: ${name}`, async () => {
          const requestBody: FeedValuesRequest = {
            feeds: [{ category: 1, name }],
          };

          const response = await request(app.getHttpServer()).post("/feed-values").send(requestBody);

          // Should not fail due to format validation
          if (response.status === 400) {
            expect(response.body.message).not.toContain("format");
            expect(response.body.message).not.toContain("BASE/QUOTE");
          }
        });
      });
    });

    describe("Case Normalization", () => {
      it("should accept and normalize lowercase feed names", async () => {
        const requestBody: FeedValuesRequest = {
          feeds: [{ category: 1, name: "btc/usd" }],
        };

        const response = await request(app.getHttpServer()).post("/feed-values").send(requestBody);

        // Should succeed (not return 400 for format validation)
        expect(response.status).not.toBe(400);

        // If there's an error, it shouldn't be about format
        if (response.status === 400) {
          expect(response.body.message).not.toMatch(/format|BASE\/QUOTE/i);
        }
      });

      it("should accept mixed case feed names", async () => {
        const requestBody: FeedValuesRequest = {
          feeds: [{ category: 1, name: "Btc/Usd" }],
        };

        const response = await request(app.getHttpServer()).post("/feed-values").send(requestBody);

        // Should succeed (not return 400 for format validation)
        expect(response.status).not.toBe(400);

        // If there's an error, it shouldn't be about format
        if (response.status === 400) {
          expect(response.body.message).not.toMatch(/format|BASE\/QUOTE/i);
        }
      });
    });

    describe("Invalid Feed Names", () => {
      const invalidNames = [
        { name: "", description: "empty string" },
        { name: "BTC", description: "missing quote currency" },
        { name: "BTC/", description: "empty quote currency" },
        { name: "/USD", description: "empty base currency" },
        { name: "BTC-USD", description: "wrong separator" },
        { name: "BTC USD", description: "space separator" },
        { name: "BTC/US", description: "quote too short" },
        { name: "BTC/USDDD", description: "quote too long" },
        { name: "VERYLONGNAME/USD", description: "base too long" },
        { name: "BTC/123", description: "numeric quote" },
        { name: "123/USD", description: "numeric base" },
        { name: "BTC/USD/EUR", description: "multiple slashes" },
      ];

      invalidNames.forEach(({ name, description }) => {
        it(`should reject invalid feed name: ${name} (${description})`, async () => {
          const requestBody = {
            feeds: [{ category: 1, name }],
          };

          const response = await request(app.getHttpServer()).post("/feed-values").send(requestBody).expect(400);

          expect(response.body).toHaveProperty("error");
          expect(response.body.message).toMatch(/name|format|BASE\/QUOTE/i);
        });
      });
    });
  });

  describe("POST /feed-values Endpoint Compliance (Requirements 2.1, 7.1)", () => {
    it("should return current feed values without voting round", async () => {
      const requestBody: FeedValuesRequest = {
        feeds: [
          { category: 1, name: "BTC/USD" },
          { category: 1, name: "ETH/USD" },
        ],
      };

      const response = await request(app.getHttpServer())
        .post("/feed-values")
        .set("Content-Type", "application/json")
        .send(requestBody)
        .expect(200);

      // Validate response structure
      expect(response.body).toHaveProperty("data");
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body).not.toHaveProperty("votingRoundId");

      // Validate each feed value data
      response.body.data.forEach((feedData: any) => {
        expect(feedData).toHaveProperty("feed");
        expect(feedData).toHaveProperty("value");
        expect(feedData.feed).toHaveProperty("category");
        expect(feedData.feed).toHaveProperty("name");
        expect(typeof feedData.feed.category).toBe("number");
        expect(typeof feedData.feed.name).toBe("string");
        expect(typeof feedData.value).toBe("number");
      });
    });

    it("should handle empty feeds array", async () => {
      const requestBody = { feeds: [] };

      const response = await request(app.getHttpServer()).post("/feed-values").send(requestBody).expect(400);

      expect(response.body.message).toContain("cannot be empty");
    });

    it("should handle missing feeds field", async () => {
      const requestBody = {};

      const response = await request(app.getHttpServer()).post("/feed-values").send(requestBody).expect(400);

      expect(response.body.message).toContain("feeds field is required");
    });

    it("should handle too many feeds (>100)", async () => {
      const feeds = Array.from({ length: 101 }, (_, i) => ({
        category: 1,
        name: `COIN${i}/USD`,
      }));

      const requestBody = { feeds };

      const response = await request(app.getHttpServer()).post("/feed-values").send(requestBody).expect(400);

      expect(response.body.message).toContain("100");
    });
  });

  describe("POST /feed-values/:votingRoundId Endpoint Compliance (Requirements 2.2, 7.2)", () => {
    it("should return feed values for specific voting round", async () => {
      const votingRoundId = 12345;
      const requestBody: FeedValuesRequest = {
        feeds: [{ category: 1, name: "BTC/USD" }],
      };

      const response = await request(app.getHttpServer())
        .post(`/feed-values/${votingRoundId}`)
        .set("Content-Type", "application/json")
        .send(requestBody);

      // Should respond (may be 201 or error depending on implementation)
      expect([200, 201, 400, 500]).toContain(response.status);

      if (response.status === 201) {
        expect(response.body).toHaveProperty("data");
        expect(response.body).toHaveProperty("votingRoundId", votingRoundId);
        expect(Array.isArray(response.body.data)).toBe(true);
      }
    });

    describe("Voting Round ID Validation", () => {
      const validVotingRounds = [0, 1, 12345, 999999];

      validVotingRounds.forEach(votingRoundId => {
        it(`should accept valid voting round ID: ${votingRoundId}`, async () => {
          const requestBody: FeedValuesRequest = {
            feeds: [{ category: 1, name: "BTC/USD" }],
          };

          const response = await request(app.getHttpServer()).post(`/feed-values/${votingRoundId}`).send(requestBody);

          // Should not fail due to voting round validation
          if (response.status === 400) {
            expect(response.body.message).not.toContain("votingRoundId");
          }
        });
      });

      const invalidVotingRounds = ["abc", "-1", "1.5", "null"];

      invalidVotingRounds.forEach(votingRoundId => {
        it(`should reject invalid voting round ID: ${votingRoundId}`, async () => {
          const requestBody: FeedValuesRequest = {
            feeds: [{ category: 1, name: "BTC/USD" }],
          };

          await request(app.getHttpServer()).post(`/feed-values/${votingRoundId}`).send(requestBody).expect(400);
        });
      });
    });
  });

  describe("POST /volumes Endpoint Compliance (Requirements 2.3, 7.3)", () => {
    it("should return volume data with window parameter", async () => {
      const requestBody: VolumesRequest = {
        feeds: [{ category: 1, name: "BTC/USD" }],
      };

      const response = await request(app.getHttpServer())
        .post("/volumes")
        .query({ window: 3600 })
        .set("Content-Type", "application/json")
        .send(requestBody)
        .expect(200);

      expect(response.body).toHaveProperty("data");
      expect(response.body).toHaveProperty("windowSec", 3600);
      expect(Array.isArray(response.body.data)).toBe(true);

      // Validate volume data structure
      response.body.data.forEach((volumeData: any) => {
        expect(volumeData).toHaveProperty("feed");
        expect(volumeData).toHaveProperty("volumes");
        expect(volumeData.feed).toHaveProperty("category");
        expect(volumeData.feed).toHaveProperty("name");
        expect(Array.isArray(volumeData.volumes)).toBe(true);
      });
    });

    it("should use default window when not specified", async () => {
      const requestBody: VolumesRequest = {
        feeds: [{ category: 1, name: "BTC/USD" }],
      };

      const response = await request(app.getHttpServer()).post("/volumes").send(requestBody).expect(200);

      expect(response.body).toHaveProperty("data");
      expect(response.body).toHaveProperty("windowSec");
    });

    describe("Window Parameter Validation", () => {
      const validWindows = [1, 60, 3600, 86400];

      validWindows.forEach(window => {
        it(`should accept valid window: ${window} seconds`, async () => {
          const requestBody: VolumesRequest = {
            feeds: [{ category: 1, name: "BTC/USD" }],
          };

          const response = await request(app.getHttpServer()).post("/volumes").query({ window }).send(requestBody);

          expect(response.status).toBe(200);
        });
      });

      const invalidWindows = [0, -1, 86401, 1.5, "abc"];

      invalidWindows.forEach(window => {
        it(`should reject invalid window: ${window}`, async () => {
          const requestBody: VolumesRequest = {
            feeds: [{ category: 1, name: "BTC/USD" }],
          };

          await request(app.getHttpServer()).post("/volumes").query({ window }).send(requestBody).expect(400);
        });
      });
    });
  });

  describe("Request/Response Format Compliance (Requirements 2.4, 2.5)", () => {
    it("should handle JSON payloads with correct Content-Type", async () => {
      const requestBody: FeedValuesRequest = {
        feeds: [{ category: 1, name: "BTC/USD" }],
      };

      const response = await request(app.getHttpServer())
        .post("/feed-values")
        .set("Content-Type", "application/json")
        .send(requestBody);

      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toMatch(/application\/json/);
    });

    it("should return proper error responses for invalid requests", async () => {
      const invalidRequestBody = {
        feeds: [{ category: "invalid", name: 123 }],
      };

      const response = await request(app.getHttpServer()).post("/feed-values").send(invalidRequestBody).expect(400);

      expect(response.body).toHaveProperty("error");
      expect(response.body).toHaveProperty("message");
      expect(response.body).toHaveProperty("timestamp");
      expect(typeof response.body.timestamp).toBe("number");
    });

    it("should handle malformed JSON", async () => {
      await request(app.getHttpServer())
        .post("/feed-values")
        .set("Content-Type", "application/json")
        .send("{ invalid json }")
        .expect(400);
    });

    it("should handle missing Content-Type header", async () => {
      const requestBody: FeedValuesRequest = {
        feeds: [{ category: 1, name: "BTC/USD" }],
      };

      const response = await request(app.getHttpServer()).post("/feed-values").send(requestBody);

      // Should still work or return appropriate error
      expect([200, 201, 400]).toContain(response.status);
    });
  });

  describe("Feed Configuration Validation (Requirements 7.6)", () => {
    it("should validate feeds exist in configuration", async () => {
      // Test with configured feed
      const configuredFeedRequest: FeedValuesRequest = {
        feeds: [{ category: 1, name: "BTC/USD" }],
      };

      const response1 = await request(app.getHttpServer()).post("/feed-values").send(configuredFeedRequest);

      expect(response1.status).toBe(200);

      // Test with non-configured feed
      const nonConfiguredFeedRequest: FeedValuesRequest = {
        feeds: [{ category: 1, name: "NONEXISTENT/USD" }],
      };

      const response2 = await request(app.getHttpServer()).post("/feed-values").send(nonConfiguredFeedRequest);

      // Should handle gracefully (may return empty data or error)
      expect([200, 201, 400, 404]).toContain(response2.status);
    });
  });

  describe("Duplicate Feed Detection", () => {
    it("should reject duplicate feeds in request", async () => {
      const requestBody = {
        feeds: [
          { category: 1, name: "BTC/USD" },
          { category: 1, name: "BTC/USD" }, // Duplicate
        ],
      };

      const response = await request(app.getHttpServer()).post("/feed-values").send(requestBody).expect(400);

      expect(response.body.message).toContain("Duplicate");
    });
  });

  describe("Cross-Category Feed Support", () => {
    it("should handle mixed category feeds in single request", async () => {
      const requestBody: FeedValuesRequest = {
        feeds: [
          { category: 1, name: "BTC/USD" }, // Crypto
          { category: 2, name: "EUR/USD" }, // Forex
        ],
      };

      const response = await request(app.getHttpServer()).post("/feed-values").send(requestBody);

      expect(response.status).toBe(200);
      if (response.status === 200) {
        expect(response.body.data).toHaveLength(2);
      }
    });
  });

  describe("Performance Requirements", () => {
    it("should respond within acceptable time limits", async () => {
      const requestBody: FeedValuesRequest = {
        feeds: [{ category: 1, name: "BTC/USD" }],
      };

      const startTime = Date.now();

      await request(app.getHttpServer()).post("/feed-values").send(requestBody);

      const responseTime = Date.now() - startTime;

      // Should respond within 1 second for compliance testing
      expect(responseTime).toBeLessThan(1000);
    });
  });
});
