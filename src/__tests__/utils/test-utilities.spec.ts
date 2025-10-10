import { TestDataBuilder, TestHelpers, MockFactory, createTestModule } from "./index";
import { FeedCategory } from "@/common/types/core";

describe("Test Utilities", () => {
  describe("TestDataBuilder", () => {
    it("should create valid feed IDs", () => {
      const feedId = TestDataBuilder.createCoreFeedId();

      expect(feedId).toHaveProperty("category");
      expect(feedId).toHaveProperty("name");
      expect(feedId.category).toBe(FeedCategory.Crypto);
      expect(feedId.name).toBe("BTC/USD");
    });

    it("should create valid price updates", () => {
      const update = TestDataBuilder.createPriceUpdate();

      expect(update).toHaveProperty("symbol");
      expect(update).toHaveProperty("price");
      expect(update).toHaveProperty("timestamp");
      expect(update).toHaveProperty("source");
      expect(typeof update.price).toBe("number");
      expect(typeof update.timestamp).toBe("number");
    });

    it("should create multiple price updates", () => {
      const updates = TestDataBuilder.createPriceUpdates(3);

      expect(updates).toHaveLength(3);
      expect(updates[0]).toHaveProperty("symbol");
      expect(updates[1]).toHaveProperty("symbol");
      expect(updates[2]).toHaveProperty("symbol");
    });
  });

  describe("TestHelpers", () => {
    it("should wait for specified time", async () => {
      const start = Date.now();
      await TestHelpers.wait(50);
      const duration = Date.now() - start;

      expect(duration).toBeGreaterThanOrEqual(45);
      expect(duration).toBeLessThan(100);
    });

    it("should measure execution time", async () => {
      const result = await TestHelpers.measureTime(async () => {
        await TestHelpers.wait(50);
        return "test result";
      });

      expect(result.result).toBe("test result");
      expect(result.duration).toBeGreaterThan(40);
    });

    it("should generate random data", () => {
      const str = TestHelpers.generateRandomString(10);
      const num = TestHelpers.generateRandomNumber(1, 10);
      const bool = TestHelpers.generateRandomBoolean();

      expect(typeof str).toBe("string");
      expect(str).toHaveLength(10);
      expect(typeof num).toBe("number");
      expect(num).toBeGreaterThanOrEqual(1);
      expect(num).toBeLessThanOrEqual(10);
      expect(typeof bool).toBe("boolean");
    });
  });

  describe("MockFactory", () => {
    it("should create mock WebSocket", () => {
      const ws = MockFactory.createWebSocket();

      expect(ws).toHaveProperty("send");
      expect(ws).toHaveProperty("close");
      expect(ws).toHaveProperty("readyState");
      expect(typeof ws.send).toBe("function");
    });

    it("should create mock HTTP client", () => {
      const client = MockFactory.createHttpClient();

      expect(client).toHaveProperty("get");
      expect(client).toHaveProperty("post");
      expect(client).toHaveProperty("defaults");
      expect(typeof client.get).toBe("function");
    });

    it("should create mock logger", () => {
      const logger = MockFactory.createLogger();

      expect(logger).toHaveProperty("log");
      expect(logger).toHaveProperty("error");
      expect(logger).toHaveProperty("warn");
      expect(typeof logger.log).toBe("function");
    });
  });

  describe("TestModuleBuilder", () => {
    it("should create test modules", async () => {
      const module = await createTestModule().addCommonMocks().build();

      expect(module).toBeDefined();
      await module.close();
    });
  });
});
