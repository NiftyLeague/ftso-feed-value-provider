import { BadRequestException } from "@nestjs/common";
import type { FeedId } from "@/common/types/http";
import { ValidationUtils } from "../utils/validation.utils";

describe("ValidationUtils", () => {
  describe("validateFeedCategory", () => {
    it("should accept valid categories", () => {
      const validCategories = [1, 2, 3, 4];

      validCategories.forEach(category => {
        expect(() => ValidationUtils.validateFeedCategory(category, "category")).not.toThrow();
        expect(ValidationUtils.validateFeedCategory(category, "category")).toBe(category);
      });
    });

    it("should reject invalid categories", () => {
      const invalidCategories = [0, 5, -1, 999, 1.5, "1", null, undefined];

      invalidCategories.forEach(category => {
        expect(() => ValidationUtils.validateFeedCategory(category, "category")).toThrow(BadRequestException);
      });
    });

    it("should provide descriptive error messages", () => {
      expect(() => ValidationUtils.validateFeedCategory(5, "category")).toThrow(
        /1 \(Crypto\), 2 \(Forex\), 3 \(Commodity\), 4 \(Stock\)/
      );
    });
  });

  describe("validateFeedName", () => {
    it("should accept valid feed names", () => {
      const validNames = ["BTC/USD", "ETH/USDT", "XRP/EUR", "ALGO/USD", "FLR/USD", "EUR/USD", "XAU/USD"];

      validNames.forEach(name => {
        expect(() => ValidationUtils.validateFeedName(name, "name")).not.toThrow();
        expect(ValidationUtils.validateFeedName(name, "name")).toBe(name.toUpperCase());
      });
    });

    it("should normalize feed names to uppercase", () => {
      expect(ValidationUtils.validateFeedName("btc/usd", "name")).toBe("BTC/USD");
    });

    it("should reject invalid feed name formats", () => {
      const invalidNames = [
        "",
        "BTC",
        "BTC/",
        "/USD",
        "BTC-USD",
        "BTC USD",
        "BTC/US",
        "BTC/USDDD",
        "VERYLONGNAME/USD",
        "BTC/123",
        "123/USD",
        "BTC/USD/EUR",
      ];

      invalidNames.forEach(name => {
        expect(() => ValidationUtils.validateFeedName(name, "name")).toThrow(BadRequestException);
      });
    });

    it("should reject currencies with invalid format", () => {
      // Test with configured feeds - should validate against actual configuration
      const configuredFeeds = [
        { category: 1, name: "BTC/USD" },
        { category: 1, name: "ETH/USD" },
      ];

      expect(() => ValidationUtils.validateFeedName("UNKNOWN/USD", "name", configuredFeeds)).toThrow(
        /not configured in the system/
      );
      expect(() => ValidationUtils.validateFeedName("BTC/XYZ", "name", configuredFeeds)).toThrow(
        /not configured in the system/
      );
    });

    it("should use basic validation when no configured feeds provided", () => {
      // Without configured feeds, should use basic validation (format and length only)
      expect(() => ValidationUtils.validateFeedName("UNKNOWN/USD", "name")).not.toThrow();
      expect(() => ValidationUtils.validateFeedName("BTC/XYZ", "name")).not.toThrow();
    });

    it("should provide format guidance in error messages", () => {
      expect(() => ValidationUtils.validateFeedName("INVALID", "name")).toThrow(/BASE\/QUOTE.*BTC\/USD/);
    });
  });

  describe("validateFeedId", () => {
    it("should validate complete feed ID", () => {
      const validFeed = { category: 1, name: "BTC/USD" };

      const result = ValidationUtils.validateFeedId(validFeed);

      expect(result).toEqual({ category: 1, name: "BTC/USD" });
    });

    it("should reject invalid feed objects", () => {
      const invalidFeeds = [
        null,
        undefined,
        "string",
        123,
        [],
        {},
        { category: 1 }, // missing name
        { name: "BTC/USD" }, // missing category
        { category: "1", name: "BTC/USD" }, // invalid category type
        { category: 1, name: 123 }, // invalid name type
      ];

      invalidFeeds.forEach(feed => {
        expect(() => ValidationUtils.validateFeedId(feed)).toThrow(BadRequestException);
      });
    });
  });

  describe("validateFeedIds", () => {
    it("should validate array of feed IDs", () => {
      const validFeeds = [
        { category: 1, name: "BTC/USD" },
        { category: 2, name: "EUR/USD" },
      ];

      const result = ValidationUtils.validateFeedIds(validFeeds);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ category: 1, name: "BTC/USD" });
      expect(result[1]).toEqual({ category: 2, name: "EUR/USD" });
    });

    it("should reject non-arrays", () => {
      const invalidInputs = [null, undefined, "string", 123, {}];

      invalidInputs.forEach(input => {
        expect(() => ValidationUtils.validateFeedIds(input)).toThrow(/must be an array/);
      });
    });

    it("should reject empty arrays", () => {
      expect(() => ValidationUtils.validateFeedIds([])).toThrow(/cannot be empty/);
    });

    it("should reject arrays with too many items", () => {
      const tooManyFeeds = Array.from({ length: 101 }, (_, i) => ({
        category: 1,
        name: `COIN${i}/USD`,
      }));

      expect(() => ValidationUtils.validateFeedIds(tooManyFeeds)).toThrow(/cannot contain more than 100/);
    });

    it("should detect duplicate feeds", () => {
      const duplicateFeeds = [
        { category: 1, name: "BTC/USD" },
        { category: 1, name: "BTC/USD" }, // Duplicate
      ];

      expect(() => ValidationUtils.validateFeedIds(duplicateFeeds)).toThrow(/Duplicate feed detected/);
    });

    it("should allow same name with different categories", () => {
      const validFeeds = [
        { category: 1, name: "USD/EUR" }, // Crypto pair
        { category: 2, name: "USD/EUR" }, // Forex pair
      ];

      expect(() => ValidationUtils.validateFeedIds(validFeeds)).not.toThrow();
    });
  });

  describe("validateFeedValuesRequest", () => {
    it("should validate valid feed values request", () => {
      const validRequest = {
        feeds: [{ category: 1, name: "BTC/USD" }],
      };

      const result = ValidationUtils.validateFeedValuesRequest(validRequest);

      expect(result).toEqual({
        feeds: [{ category: 1, name: "BTC/USD" }],
      });
    });

    it("should reject invalid request bodies", () => {
      const invalidBodies = [null, undefined, "string", 123, [], {}, { feeds: null }, { feeds: "invalid" }];

      invalidBodies.forEach(body => {
        expect(() => ValidationUtils.validateFeedValuesRequest(body)).toThrow(BadRequestException);
      });
    });
  });

  describe("validateVolumesRequest", () => {
    it("should validate valid volumes request", () => {
      const validRequest = {
        feeds: [{ category: 1, name: "BTC/USD" }],
        startTime: Date.now() - 3600000,
        endTime: Date.now(),
      };

      const result = ValidationUtils.validateVolumesRequest(validRequest);

      expect(result.feeds).toHaveLength(1);
      expect(result.startTime).toBeDefined();
      expect(result.endTime).toBeDefined();
    });

    it("should handle optional time parameters", () => {
      const requestWithoutTime = {
        feeds: [{ category: 1, name: "BTC/USD" }],
      };

      const result = ValidationUtils.validateVolumesRequest(requestWithoutTime);

      expect(result.feeds).toHaveLength(1);
      expect(result.startTime).toBeUndefined();
      expect(result.endTime).toBeUndefined();
    });

    it("should validate time range", () => {
      const invalidTimeRequest = {
        feeds: [{ category: 1, name: "BTC/USD" }],
        startTime: Date.now(),
        endTime: Date.now() - 3600000, // End before start
      };

      expect(() => ValidationUtils.validateVolumesRequest(invalidTimeRequest)).toThrow(
        /startTime must be before endTime/
      );
    });
  });

  describe("validateVotingRoundId", () => {
    it("should accept valid voting round IDs", () => {
      const validIds = [0, 1, 12345, 999999, Number.MAX_SAFE_INTEGER];

      validIds.forEach(id => {
        expect(() => ValidationUtils.validateVotingRoundId(id)).not.toThrow();
        expect(ValidationUtils.validateVotingRoundId(id)).toBe(id);
      });
    });

    it("should reject invalid voting round IDs", () => {
      const invalidIds = [-1, 1.5, "123", null, undefined, Number.MAX_SAFE_INTEGER + 1];

      invalidIds.forEach(id => {
        expect(() => ValidationUtils.validateVotingRoundId(id)).toThrow(BadRequestException);
      });
    });
  });

  describe("validateTimestamp", () => {
    it("should accept valid timestamps", () => {
      const now = Date.now();
      const validTimestamps = [
        now,
        now - 86400000, // 1 day ago
        now + 86400000, // 1 day from now
      ];

      validTimestamps.forEach(timestamp => {
        expect(() => ValidationUtils.validateTimestamp(timestamp, "timestamp")).not.toThrow();
      });
    });

    it("should reject invalid timestamps", () => {
      const now = Date.now();
      const invalidTimestamps = [
        -1,
        1.5,
        "123",
        null,
        undefined,
        now - 400 * 24 * 60 * 60 * 1000, // Too far in past
        now + 400 * 24 * 60 * 60 * 1000, // Too far in future
      ];

      invalidTimestamps.forEach(timestamp => {
        expect(() => ValidationUtils.validateTimestamp(timestamp, "timestamp")).toThrow(BadRequestException);
      });
    });
  });

  describe("validateTimeWindow", () => {
    it("should accept valid window values", () => {
      const validWindows = [1, 60, 3600, 86400];

      validWindows.forEach(window => {
        expect(() => ValidationUtils.validateTimeWindow(window)).not.toThrow();
        expect(ValidationUtils.validateTimeWindow(window)).toBe(window);
      });
    });

    it("should reject invalid window values", () => {
      const invalidWindows = [0, -1, 86401, 1.5, "60", null, undefined];

      invalidWindows.forEach(window => {
        expect(() => ValidationUtils.validateTimeWindow(window)).toThrow(BadRequestException);
      });
    });
  });

  describe("validateFeedExists", () => {
    const availableFeeds: FeedId[] = [
      { category: 1, name: "BTC/USD" },
      { category: 1, name: "ETH/USD" },
      { category: 2, name: "EUR/USD" },
    ];

    it("should pass for existing feeds", () => {
      expect(() => ValidationUtils.validateFeedExists({ category: 1, name: "BTC/USD" }, availableFeeds)).not.toThrow();
    });

    it("should throw for non-existing feeds", () => {
      expect(() =>
        ValidationUtils.validateFeedExists({ category: 1, name: "NONEXISTENT/USD" }, availableFeeds)
      ).toThrow(/Feed not found/);
    });
  });

  describe("validateFeedsExist", () => {
    const availableFeeds: FeedId[] = [
      { category: 1, name: "BTC/USD" },
      { category: 1, name: "ETH/USD" },
    ];

    it("should pass for all existing feeds", () => {
      const feedsToCheck = [
        { category: 1, name: "BTC/USD" },
        { category: 1, name: "ETH/USD" },
      ];

      expect(() => ValidationUtils.validateFeedsExist(feedsToCheck, availableFeeds)).not.toThrow();
    });

    it("should throw if any feed doesn't exist", () => {
      const feedsToCheck = [
        { category: 1, name: "BTC/USD" },
        { category: 1, name: "NONEXISTENT/USD" },
      ];

      expect(() => ValidationUtils.validateFeedsExist(feedsToCheck, availableFeeds)).toThrow(/Feed not found/);
    });
  });

  describe("utility methods", () => {
    describe("getCategoryDescription", () => {
      it("should return correct descriptions", () => {
        expect(ValidationUtils.getCategoryDescription(1)).toBe("Crypto");
        expect(ValidationUtils.getCategoryDescription(2)).toBe("Forex");
        expect(ValidationUtils.getCategoryDescription(3)).toBe("Commodity");
        expect(ValidationUtils.getCategoryDescription(4)).toBe("Stock");
        expect(ValidationUtils.getCategoryDescription(999)).toBe("Unknown");
      });
    });

    describe("isValidFeedNameFormat", () => {
      it("should return true for valid names", () => {
        expect(ValidationUtils.isValidFeedNameFormat("BTC/USD")).toBe(true);
        expect(ValidationUtils.isValidFeedNameFormat("ETH/USDT")).toBe(true);
      });

      it("should return false for invalid names", () => {
        expect(ValidationUtils.isValidFeedNameFormat("INVALID")).toBe(false);
        expect(ValidationUtils.isValidFeedNameFormat("BTC-USD")).toBe(false);
      });
    });

    describe("isValidCategory", () => {
      it("should return true for valid categories", () => {
        [1, 2, 3, 4].forEach(category => {
          expect(ValidationUtils.isValidCategory(category)).toBe(true);
        });
      });

      it("should return false for invalid categories", () => {
        [0, 5, -1, 999].forEach(category => {
          expect(ValidationUtils.isValidCategory(category)).toBe(false);
        });
      });
    });
  });
});
