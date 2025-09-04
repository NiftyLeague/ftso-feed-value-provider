import { BadRequestException } from "@nestjs/common";
import { ValidationUtils } from "../utils/validation.utils";

describe("ValidationUtils", () => {
  describe("validateFeedId", () => {
    it("should validate valid feed ID", () => {
      const validFeed = { category: 1, name: "BTC/USD" };
      const result = ValidationUtils.validateFeedId(validFeed);

      expect(result).toEqual(validFeed);
    });

    it("should throw error for invalid category", () => {
      const invalidFeed = { category: 5, name: "BTC/USD" };

      expect(() => ValidationUtils.validateFeedId(invalidFeed)).toThrow(BadRequestException);
    });

    it("should throw error for invalid name format", () => {
      const invalidFeed = { category: 1, name: "BTCUSD" };

      expect(() => ValidationUtils.validateFeedId(invalidFeed)).toThrow(BadRequestException);
    });

    it("should throw error for missing fields", () => {
      expect(() => ValidationUtils.validateFeedId({})).toThrow(BadRequestException);
    });
  });

  describe("validateFeedIds", () => {
    it("should validate array of valid feed IDs", () => {
      const validFeeds = [
        { category: 1, name: "BTC/USD" },
        { category: 2, name: "EUR/USD" },
      ];

      const result = ValidationUtils.validateFeedIds(validFeeds);
      expect(result).toEqual(validFeeds);
    });

    it("should throw error for empty array", () => {
      expect(() => ValidationUtils.validateFeedIds([])).toThrow(BadRequestException);
    });

    it("should throw error for non-array input", () => {
      expect(() => ValidationUtils.validateFeedIds("not-array")).toThrow(BadRequestException);
    });

    it("should throw error for too many feeds", () => {
      const tooManyFeeds = Array(101).fill({ category: 1, name: "BTC/USD" });

      expect(() => ValidationUtils.validateFeedIds(tooManyFeeds)).toThrow(BadRequestException);
    });
  });

  describe("validateVotingRoundId", () => {
    it("should validate valid voting round ID", () => {
      const result = ValidationUtils.validateVotingRoundId(12345);
      expect(result).toBe(12345);
    });

    it("should throw error for negative voting round ID", () => {
      expect(() => ValidationUtils.validateVotingRoundId(-1)).toThrow(BadRequestException);
    });

    it("should throw error for non-integer voting round ID", () => {
      expect(() => ValidationUtils.validateVotingRoundId(123.45)).toThrow(BadRequestException);
    });

    it("should throw error for non-number voting round ID", () => {
      expect(() => ValidationUtils.validateVotingRoundId("123")).toThrow(BadRequestException);
    });
  });

  describe("validateTimeWindow", () => {
    it("should validate valid time window", () => {
      const result = ValidationUtils.validateTimeWindow(3600);
      expect(result).toBe(3600);
    });

    it("should throw error for negative time window", () => {
      expect(() => ValidationUtils.validateTimeWindow(-1)).toThrow(BadRequestException);
    });

    it("should throw error for zero time window", () => {
      expect(() => ValidationUtils.validateTimeWindow(0)).toThrow(BadRequestException);
    });

    it("should throw error for too large time window", () => {
      expect(() => ValidationUtils.validateTimeWindow(100000)).toThrow(BadRequestException);
    });
  });

  describe("validateTimestamp", () => {
    it("should validate valid timestamp", () => {
      const now = Date.now();
      const result = ValidationUtils.validateTimestamp(now, "testTime");
      expect(result).toBe(now);
    });

    it("should throw error for timestamp too far in past", () => {
      const twoYearsAgo = Date.now() - 2 * 365 * 24 * 60 * 60 * 1000;

      expect(() => ValidationUtils.validateTimestamp(twoYearsAgo, "testTime")).toThrow(BadRequestException);
    });

    it("should throw error for timestamp too far in future", () => {
      const twoYearsFromNow = Date.now() + 2 * 365 * 24 * 60 * 60 * 1000;

      expect(() => ValidationUtils.validateTimestamp(twoYearsFromNow, "testTime")).toThrow(BadRequestException);
    });
  });

  describe("validateTimeRange", () => {
    it("should validate valid time range", () => {
      const now = Date.now();
      const oneHourAgo = now - 60 * 60 * 1000;

      const result = ValidationUtils.validateTimeRange(oneHourAgo, now);

      expect(result).toEqual({
        startTime: oneHourAgo,
        endTime: now,
      });
    });

    it("should throw error when startTime is after endTime", () => {
      const now = Date.now();
      const oneHourFromNow = now + 60 * 60 * 1000;

      expect(() => ValidationUtils.validateTimeRange(oneHourFromNow, now)).toThrow(BadRequestException);
    });

    it("should handle undefined values", () => {
      const result = ValidationUtils.validateTimeRange(undefined, undefined);
      expect(result).toEqual({});
    });
  });

  describe("validateFeedValuesRequest", () => {
    it("should validate valid feed values request", () => {
      const validRequest = {
        feeds: [{ category: 1, name: "BTC/USD" }],
      };

      const result = ValidationUtils.validateFeedValuesRequest(validRequest);
      expect(result).toEqual(validRequest);
    });

    it("should throw error for missing feeds field", () => {
      expect(() => ValidationUtils.validateFeedValuesRequest({})).toThrow(BadRequestException);
    });
  });

  describe("validateVolumesRequest", () => {
    it("should validate valid volumes request", () => {
      const now = Date.now();
      const oneHourAgo = now - 60 * 60 * 1000;

      const validRequest = {
        feeds: [{ category: 1, name: "BTC/USD" }],
        startTime: oneHourAgo,
        endTime: now,
      };

      const result = ValidationUtils.validateVolumesRequest(validRequest);
      expect(result).toEqual(validRequest);
    });

    it("should validate volumes request without time range", () => {
      const validRequest = {
        feeds: [{ category: 1, name: "BTC/USD" }],
      };

      const result = ValidationUtils.validateVolumesRequest(validRequest);
      expect(result.feeds).toEqual(validRequest.feeds);
      expect(result.startTime).toBeUndefined();
      expect(result.endTime).toBeUndefined();
    });
  });

  describe("sanitizeString", () => {
    it("should sanitize valid string", () => {
      const result = ValidationUtils.sanitizeString("  valid string  ", "test");
      expect(result).toBe("valid string");
    });

    it("should throw error for dangerous characters", () => {
      expect(() => ValidationUtils.sanitizeString("<script>", "test")).toThrow(BadRequestException);
    });

    it("should throw error for empty string", () => {
      expect(() => ValidationUtils.sanitizeString("   ", "test")).toThrow(BadRequestException);
    });

    it("should throw error for too long string", () => {
      const longString = "a".repeat(101);
      expect(() => ValidationUtils.sanitizeString(longString, "test")).toThrow(BadRequestException);
    });
  });

  describe("validateNumericRange", () => {
    it("should validate number in range", () => {
      const result = ValidationUtils.validateNumericRange(50, "test", 0, 100);
      expect(result).toBe(50);
    });

    it("should throw error for number below minimum", () => {
      expect(() => ValidationUtils.validateNumericRange(-1, "test", 0, 100)).toThrow(BadRequestException);
    });

    it("should throw error for number above maximum", () => {
      expect(() => ValidationUtils.validateNumericRange(101, "test", 0, 100)).toThrow(BadRequestException);
    });

    it("should throw error for float when integer required", () => {
      expect(() => ValidationUtils.validateNumericRange(50.5, "test", 0, 100, false)).toThrow(BadRequestException);
    });

    it("should throw error for NaN", () => {
      expect(() => ValidationUtils.validateNumericRange(NaN, "test")).toThrow(BadRequestException);
    });
  });

  // FTSO-specific validation tests
  describe("FTSO Feed Category Validation", () => {
    it("should accept all valid FTSO categories", () => {
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

  describe("FTSO Feed Name Validation", () => {
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

    it("should provide format guidance in error messages", () => {
      expect(() => ValidationUtils.validateFeedName("INVALID", "name")).toThrow(/BASE\/QUOTE.*BTC\/USD/);
    });
  });

  describe("Enhanced Feed ID Validation", () => {
    it("should validate complete feed ID with enhanced validation", () => {
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

  describe("Enhanced Feed Array Validation", () => {
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

    it("should enforce FTSO limit of 100 feeds", () => {
      const tooManyFeeds = Array.from({ length: 101 }, (_, i) => ({
        category: 1,
        name: `COIN${i}/USD`,
      }));

      expect(() => ValidationUtils.validateFeedIds(tooManyFeeds)).toThrow(/cannot contain more than 100.*FTSO limit/);
    });
  });

  describe("FTSO Utility Methods", () => {
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
