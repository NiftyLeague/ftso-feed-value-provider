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
});
