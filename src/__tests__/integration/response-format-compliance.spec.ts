import { TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestModule } from "@/__tests__/utils";
import { FeedController } from "@/controllers/feed.controller";
import type { FeedValuesRequest, VolumesRequest } from "@/common/types/http";

describe("FTSO API Response Format Compliance", () => {
  let app: INestApplication;
  let module: TestingModule;

  beforeAll(async () => {
    module = await createTestModule().addController(FeedController).addCommonMocks().build();

    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe("Content-Type and Headers Compliance", () => {
    it("should accept application/json Content-Type", async () => {
      const requestBody: FeedValuesRequest = {
        feeds: [{ category: 1, name: "BTC/USD" }],
      };

      const response = await request(app.getHttpServer())
        .post("/feed-values")
        .set("Content-Type", "application/json")
        .send(requestBody);

      expect([200, 201]).toContain(response.status);
      expect(response.headers["content-type"]).toMatch(/application\/json/);
    });

    it("should return JSON responses", async () => {
      const requestBody: FeedValuesRequest = {
        feeds: [{ category: 1, name: "BTC/USD" }],
      };

      const response = await request(app.getHttpServer()).post("/feed-values").send(requestBody);

      expect(response.headers["content-type"]).toMatch(/application\/json/);
      expect(() => JSON.parse(JSON.stringify(response.body))).not.toThrow();
    });

    it("should handle missing Content-Type gracefully", async () => {
      const requestBody: FeedValuesRequest = {
        feeds: [{ category: 1, name: "BTC/USD" }],
      };

      const response = await request(app.getHttpServer()).post("/feed-values").send(requestBody);

      // Should still work or return appropriate error
      expect([200, 201, 400]).toContain(response.status);
    });

    it("should reject non-JSON content types appropriately", async () => {
      const response = await request(app.getHttpServer())
        .post("/feed-values")
        .set("Content-Type", "text/plain")
        .send("not json");

      expect([400, 415]).toContain(response.status);
    });
  });

  describe("Current Feed Values Response Format (/feed-values)", () => {
    it("should return correct response structure", async () => {
      const requestBody: FeedValuesRequest = {
        feeds: [
          { category: 1, name: "BTC/USD" },
          { category: 1, name: "ETH/USD" },
        ],
      };

      const response = await request(app.getHttpServer()).post("/feed-values").send(requestBody).expect(201);

      // Validate top-level structure
      expect(response.body).toHaveProperty("data");
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body).not.toHaveProperty("votingRoundId");

      // Validate each feed value data item
      response.body.data.forEach((item: any) => {
        expect(item).toHaveProperty("feed");
        expect(item).toHaveProperty("value");

        // Validate feed structure
        expect(item.feed).toHaveProperty("category");
        expect(item.feed).toHaveProperty("name");
        expect(typeof item.feed.category).toBe("number");
        expect(typeof item.feed.name).toBe("string");

        // Validate value
        expect(typeof item.value).toBe("number");
        expect(isFinite(item.value)).toBe(true);
      });
    });

    it("should maintain feed order in response", async () => {
      const requestBody: FeedValuesRequest = {
        feeds: [
          { category: 1, name: "BTC/USD" },
          { category: 2, name: "EUR/USD" },
          { category: 1, name: "ETH/USD" },
        ],
      };

      const response = await request(app.getHttpServer()).post("/feed-values").send(requestBody).expect(201);

      expect(response.body.data).toHaveLength(3);
      expect(response.body.data[0].feed.name).toBe("BTC/USD");
      expect(response.body.data[1].feed.name).toBe("EUR/USD");
      expect(response.body.data[2].feed.name).toBe("ETH/USD");
    });

    it("should handle single feed request", async () => {
      const requestBody: FeedValuesRequest = {
        feeds: [{ category: 1, name: "BTC/USD" }],
      };

      const response = await request(app.getHttpServer()).post("/feed-values").send(requestBody).expect(201);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].feed.category).toBe(1);
      expect(response.body.data[0].feed.name).toBe("BTC/USD");
    });
  });

  describe("Historical Feed Values Response Format (/feed-values/:votingRoundId)", () => {
    it("should return correct response structure with voting round ID", async () => {
      const votingRoundId = 12345;
      const requestBody: FeedValuesRequest = {
        feeds: [{ category: 1, name: "BTC/USD" }],
      };

      const response = await request(app.getHttpServer()).post(`/feed-values/${votingRoundId}`).send(requestBody);

      if (response.status === 201) {
        // Validate top-level structure
        expect(response.body).toHaveProperty("votingRoundId", votingRoundId);
        expect(response.body).toHaveProperty("data");
        expect(Array.isArray(response.body.data)).toBe(true);

        // Validate data structure (same as current feed values)
        response.body.data.forEach((item: any) => {
          expect(item).toHaveProperty("feed");
          expect(item).toHaveProperty("value");
          expect(item.feed).toHaveProperty("category");
          expect(item.feed).toHaveProperty("name");
          expect(typeof item.feed.category).toBe("number");
          expect(typeof item.feed.name).toBe("string");
          expect(typeof item.value).toBe("number");
        });
      }
    });

    it("should include voting round ID as integer", async () => {
      const votingRoundId = 67890;
      const requestBody: FeedValuesRequest = {
        feeds: [{ category: 1, name: "BTC/USD" }],
      };

      const response = await request(app.getHttpServer()).post(`/feed-values/${votingRoundId}`).send(requestBody);

      if (response.status === 201) {
        expect(response.body.votingRoundId).toBe(votingRoundId);
        expect(Number.isInteger(response.body.votingRoundId)).toBe(true);
      }
    });
  });

  describe("Volume Data Response Format (/volumes)", () => {
    it("should return correct volume response structure", async () => {
      const requestBody: VolumesRequest = {
        feeds: [{ category: 1, name: "BTC/USD" }],
      };

      const response = await request(app.getHttpServer())
        .post("/volumes")
        .query({ window: 3600 })
        .send(requestBody)
        .expect(201);

      // Validate top-level structure
      expect(response.body).toHaveProperty("data");
      expect(response.body).toHaveProperty("windowSec", 3600);
      expect(Array.isArray(response.body.data)).toBe(true);

      // Validate volume data structure
      response.body.data.forEach((item: any) => {
        expect(item).toHaveProperty("feed");
        expect(item).toHaveProperty("volumes");

        // Validate feed structure
        expect(item.feed).toHaveProperty("category");
        expect(item.feed).toHaveProperty("name");
        expect(typeof item.feed.category).toBe("number");
        expect(typeof item.feed.name).toBe("string");

        // Validate volumes array
        expect(Array.isArray(item.volumes)).toBe(true);

        // Validate individual volume entries (if any)
        item.volumes.forEach((volume: any) => {
          expect(volume).toHaveProperty("exchange");
          expect(volume).toHaveProperty("volume");
          expect(typeof volume.exchange).toBe("string");
          expect(typeof volume.volume).toBe("number");
          expect(isFinite(volume.volume)).toBe(true);
        });
      });
    });

    it("should include window parameter in response", async () => {
      const windowSec = 1800; // 30 minutes
      const requestBody: VolumesRequest = {
        feeds: [{ category: 1, name: "BTC/USD" }],
      };

      const response = await request(app.getHttpServer())
        .post("/volumes")
        .query({ window: windowSec })
        .send(requestBody)
        .expect(201);

      expect(response.body.windowSec).toBe(windowSec);
      expect(Number.isInteger(response.body.windowSec)).toBe(true);
    });

    it("should handle default window parameter", async () => {
      const requestBody: VolumesRequest = {
        feeds: [{ category: 1, name: "BTC/USD" }],
      };

      const response = await request(app.getHttpServer()).post("/volumes").send(requestBody).expect(201);

      expect(response.body).toHaveProperty("windowSec");
      expect(typeof response.body.windowSec).toBe("number");
      expect(Number.isInteger(response.body.windowSec)).toBe(true);
    });
  });

  describe("Error Response Format Compliance", () => {
    it("should return standardized error format for validation errors", async () => {
      const invalidRequest = {
        feeds: [{ category: "invalid", name: 123 }],
      };

      const response = await request(app.getHttpServer()).post("/feed-values").send(invalidRequest).expect(400);

      // Validate error response structure
      expect(response.body).toHaveProperty("error");
      expect(response.body).toHaveProperty("message");
      expect(response.body).toHaveProperty("timestamp");

      expect(typeof response.body.error).toBe("string");
      expect(typeof response.body.message).toBe("string");
      expect(typeof response.body.timestamp).toBe("number");
      expect(Number.isInteger(response.body.timestamp)).toBe(true);
    });

    it("should return appropriate HTTP status codes", async () => {
      const testCases = [
        {
          request: { feeds: [] },
          expectedStatus: 400,
          description: "empty feeds array",
        },
        {
          request: { feeds: [{ category: 999, name: "INVALID/USD" }] },
          expectedStatus: 400,
          description: "invalid category",
        },
        {
          request: {},
          expectedStatus: 400,
          description: "missing feeds field",
        },
      ];

      for (const testCase of testCases) {
        const response = await request(app.getHttpServer())
          .post("/feed-values")
          .send(testCase.request)
          .expect(testCase.expectedStatus);

        expect(response.body).toHaveProperty("error");
      }
    });

    it("should handle malformed JSON gracefully", async () => {
      const response = await request(app.getHttpServer())
        .post("/feed-values")
        .set("Content-Type", "application/json")
        .send("{ invalid json }")
        .expect(400);

      expect(response.body).toHaveProperty("error");
      expect(response.body).toHaveProperty("message");
    });
  });

  describe("Data Type Validation", () => {
    it("should ensure numeric values are properly formatted", async () => {
      const requestBody: FeedValuesRequest = {
        feeds: [{ category: 1, name: "BTC/USD" }],
      };

      const response = await request(app.getHttpServer()).post("/feed-values").send(requestBody).expect(201);

      response.body.data.forEach((item: any) => {
        // Category should be integer
        expect(Number.isInteger(item.feed.category)).toBe(true);
        expect(item.feed.category).toBeGreaterThan(0);
        expect(item.feed.category).toBeLessThanOrEqual(4);

        // Value should be finite number
        expect(typeof item.value).toBe("number");
        expect(isFinite(item.value)).toBe(true);
        expect(isNaN(item.value)).toBe(false);
      });
    });

    it("should ensure string values are properly formatted", async () => {
      const requestBody: FeedValuesRequest = {
        feeds: [{ category: 1, name: "BTC/USD" }],
      };

      const response = await request(app.getHttpServer()).post("/feed-values").send(requestBody).expect(201);

      response.body.data.forEach((item: any) => {
        // Name should be non-empty string
        expect(typeof item.feed.name).toBe("string");
        expect(item.feed.name.length).toBeGreaterThan(0);
        expect(item.feed.name).toMatch(/^[A-Z0-9]+\/[A-Z]+$/);
      });
    });
  });

  describe("Response Consistency", () => {
    it("should return consistent response structure across multiple requests", async () => {
      const requestBody: FeedValuesRequest = {
        feeds: [{ category: 1, name: "BTC/USD" }],
      };

      const responses = await Promise.all([
        request(app.getHttpServer()).post("/feed-values").send(requestBody),
        request(app.getHttpServer()).post("/feed-values").send(requestBody),
        request(app.getHttpServer()).post("/feed-values").send(requestBody),
      ]);

      // All responses should have the same structure
      responses.forEach(response => {
        if (response.status === 201) {
          expect(response.body).toHaveProperty("data");
          expect(Array.isArray(response.body.data)).toBe(true);
          expect(response.body.data).toHaveLength(1);
          expect(response.body.data[0]).toHaveProperty("feed");
          expect(response.body.data[0]).toHaveProperty("value");
        }
      });
    });

    it("should maintain consistent field names and types", async () => {
      const requestBody: FeedValuesRequest = {
        feeds: [
          { category: 1, name: "BTC/USD" },
          { category: 2, name: "EUR/USD" },
        ],
      };

      const response = await request(app.getHttpServer()).post("/feed-values").send(requestBody).expect(201);

      // All items should have identical structure
      const firstItem = response.body.data[0];
      const fieldNames = Object.keys(firstItem);
      const feedFieldNames = Object.keys(firstItem.feed);

      response.body.data.forEach((item: any) => {
        expect(Object.keys(item)).toEqual(fieldNames);
        expect(Object.keys(item.feed)).toEqual(feedFieldNames);
        expect(typeof item.feed.category).toBe(typeof firstItem.feed.category);
        expect(typeof item.feed.name).toBe(typeof firstItem.feed.name);
        expect(typeof item.value).toBe(typeof firstItem.value);
      });
    });
  });
});
