import { BadRequestException } from "@nestjs/common";
import { ValidationUtils } from "../utils/validation.utils";
import type { FeedId } from "@/common/types/http";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";
import { FtsoValidationUtils } from "../utils/ftso-validation.utils";

describe("FtsoValidationUtils", () => {
  describe("validateFeedCategory", () => {
    it("should accept valid categories", () => {
      const validCategories = [1, 2, 3, 4];

      validCategories.forEach(category => {
        expect(() => FtsoValidationUtils.validateFeedCategory(category, "category")).not.toThrow();
        expect(FtsoValidationUtils.validateFeedCategory(category, "category")).toBe(category);
      });
    });

    it("should reject invalid categories", () => {
      const invalidCategories = [0, 5, -1, 999, 1.5, "1", null, undefined];

      invalidCategories.forEach(category => {
        expect(() => FtsoValidationUtils.validateFeedCategory(category, "category")).toThrow(BadRequestException);
      });
    });

    it("should provide descriptive error messages", () => {
      expect(() => FtsoValidationUtils.validateFeedCategory(5, "category")).toThrow(
        /1 \(Crypto\), 2 \(Forex\), 3 \(Commodity\), 4 \(Stock\)/
      );
    });
  });

  describe("validateFeedName", () => {
    it("should accept valid feed names", () => {
      const validNames = ["BTC/USD", "ETH/USDT", "XRP/EUR", "ALGO/USD", "FLR/USD", "EUR/USD", "XAU/USD"];

      validNames.forEach(name => {
        expect(() => FtsoValidationUtils.validateFeedName(name, "name")).not.toThrow();
        expect(FtsoValidationUtils.validateFeedName(name, "name")).toBe(name.toUpperCase());
      });
    });

    it("should normalize feed names to uppercase", () => {
      expect(FtsoValidationUtils.validateFeedName("btc/usd", "name")).toBe("BTC/USD");
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
        expect(() => FtsoValidationUtils.validateFeedName(name, "name")).toThrow(BadRequestException);
      });
    });

    it("should reject unsupported currencies", () => {
      expect(() => FtsoValidationUtils.validateFeedName("UNKNOWN/USD", "name")).toThrow(/unsupported base currency/);

      expect(() => FtsoValidationUtils.validateFeedName("BTC/XYZ", "name")).toThrow(/unsupported quote currency/);
    });

    it("should provide format guidance in error messages", () => {
      expect(() => FtsoValidationUtils.validateFeedName("INVALID", "name")).toThrow(/BASE\/QUOTE.*BTC\/USD/);
    });
  });

  describe("validateFtsoFeedId", () => {
    it("should validate complete feed ID", () => {
      const validFeed = { category: 1, name: "BTC/USD" };

      const result = FtsoValidationUtils.validateFtsoFeedId(validFeed);

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
        expect(() => FtsoValidationUtils.validateFtsoFeedId(feed)).toThrow(BadRequestException);
      });
    });
  });

  describe("validateFtsoFeedIds", () => {
    it("should validate array of feed IDs", () => {
      const validFeeds = [
        { category: 1, name: "BTC/USD" },
        { category: 2, name: "EUR/USD" },
      ];

      const result = FtsoValidationUtils.validateFtsoFeedIds(validFeeds);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ category: 1, name: "BTC/USD" });
      expect(result[1]).toEqual({ category: 2, name: "EUR/USD" });
    });

    it("should reject non-arrays", () => {
      const invalidInputs = [null, undefined, "string", 123, {}];

      invalidInputs.forEach(input => {
        expect(() => FtsoValidationUtils.validateFtsoFeedIds(input)).toThrow(/must be an array/);
      });
    });

    it("should reject empty arrays", () => {
      expect(() => FtsoValidationUtils.validateFtsoFeedIds([])).toThrow(/cannot be empty/);
    });

    it("should reject arrays with too many items", () => {
      const tooManyFeeds = Array.from({ length: 101 }, (_, i) => ({
        category: 1,
        name: `COIN${i}/USD`,
      }));

      expect(() => FtsoValidationUtils.validateFtsoFeedIds(tooManyFeeds)).toThrow(/cannot contain more than 100/);
    });

    it("should detect duplicate feeds", () => {
      const duplicateFeeds = [
        { category: 1, name: "BTC/USD" },
        { category: 1, name: "BTC/USD" }, // Duplicate
      ];

      expect(() => FtsoValidationUtils.validateFtsoFeedIds(duplicateFeeds)).toThrow(/Duplicate feed detected/);
    });

    it("should allow same name with different categories", () => {
      const validFeeds = [
        { category: 1, name: "USD/EUR" }, // Crypto pair
        { category: 2, name: "USD/EUR" }, // Forex pair
      ];

      expect(() => FtsoValidationUtils.validateFtsoFeedIds(validFeeds)).not.toThrow();
    });
  });

  describe("validateFtsoFeedValuesRequest", () => {
    it("should validate valid feed values request", () => {
      const validRequest = {
        feeds: [{ category: 1, name: "BTC/USD" }],
      };

      const result = FtsoValidationUtils.validateFtsoFeedValuesRequest(validRequest);

      expect(result).toEqual({
        feeds: [{ category: 1, name: "BTC/USD" }],
      });
    });

    it("should reject invalid request bodies", () => {
      const invalidBodies = [null, undefined, "string", 123, [], {}, { feeds: null }, { feeds: "invalid" }];

      invalidBodies.forEach(body => {
        expect(() => FtsoValidationUtils.validateFtsoFeedValuesRequest(body)).toThrow(BadRequestException);
      });
    });
  });

  describe("validateFtsoVolumesRequest", () => {
    it("should validate valid volumes request", () => {
      const validRequest = {
        feeds: [{ category: 1, name: "BTC/USD" }],
        startTime: Date.now() - 3600000,
        endTime: Date.now(),
      };

      const result = FtsoValidationUtils.validateFtsoVolumesRequest(validRequest);

      expect(result.feeds).toHaveLength(1);
      expect(result.startTime).toBeDefined();
      expect(result.endTime).toBeDefined();
    });

    it("should handle optional time parameters", () => {
      const requestWithoutTime = {
        feeds: [{ category: 1, name: "BTC/USD" }],
      };

      const result = FtsoValidationUtils.validateFtsoVolumesRequest(requestWithoutTime);

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

      expect(() => FtsoValidationUtils.validateFtsoVolumesRequest(invalidTimeRequest)).toThrow(
        /startTime must be before endTime/
      );
    });
  });

  describe("validateVotingRoundId", () => {
    it("should accept valid voting round IDs", () => {
      const validIds = [0, 1, 12345, 999999, Number.MAX_SAFE_INTEGER];

      validIds.forEach(id => {
        expect(() => FtsoValidationUtils.validateVotingRoundId(id)).not.toThrow();
        expect(FtsoValidationUtils.validateVotingRoundId(id)).toBe(id);
      });
    });

    it("should reject invalid voting round IDs", () => {
      const invalidIds = [-1, 1.5, "123", null, undefined, Number.MAX_SAFE_INTEGER + 1];

      invalidIds.forEach(id => {
        expect(() => FtsoValidationUtils.validateVotingRoundId(id)).toThrow(BadRequestException);
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
        expect(() => FtsoValidationUtils.validateTimestamp(timestamp, "timestamp")).not.toThrow();
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
        expect(() => FtsoValidationUtils.validateTimestamp(timestamp, "timestamp")).toThrow(BadRequestException);
      });
    });
  });

  describe("validateVolumeWindow", () => {
    it("should accept valid window values", () => {
      const validWindows = [1, 60, 3600, 86400];

      validWindows.forEach(window => {
        expect(() => FtsoValidationUtils.validateVolumeWindow(window)).not.toThrow();
        expect(FtsoValidationUtils.validateVolumeWindow(window)).toBe(window);
      });
    });

    it("should reject invalid window values", () => {
      const invalidWindows = [0, -1, 86401, 1.5, "60", null, undefined];

      invalidWindows.forEach(window => {
        expect(() => FtsoValidationUtils.validateVolumeWindow(window)).toThrow(BadRequestException);
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
      expect(() =>
        FtsoValidationUtils.validateFeedExists({ category: 1, name: "BTC/USD" }, availableFeeds)
      ).not.toThrow();
    });

    it("should throw for non-existing feeds", () => {
      expect(() =>
        FtsoValidationUtils.validateFeedExists({ category: 1, name: "NONEXISTENT/USD" }, availableFeeds)
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

      expect(() => FtsoValidationUtils.validateFeedsExist(feedsToCheck, availableFeeds)).not.toThrow();
    });

    it("should throw if any feed doesn't exist", () => {
      const feedsToCheck = [
        { category: 1, name: "BTC/USD" },
        { category: 1, name: "NONEXISTENT/USD" },
      ];

      expect(() => FtsoValidationUtils.validateFeedsExist(feedsToCheck, availableFeeds)).toThrow(/Feed not found/);
    });
  });

  describe("utility methods", () => {
    describe("getCategoryDescription", () => {
      it("should return correct descriptions", () => {
        expect(FtsoValidationUtils.getCategoryDescription(1)).toBe("Crypto");
        expect(FtsoValidationUtils.getCategoryDescription(2)).toBe("Forex");
        expect(FtsoValidationUtils.getCategoryDescription(3)).toBe("Commodity");
        expect(FtsoValidationUtils.getCategoryDescription(4)).toBe("Stock");
        expect(FtsoValidationUtils.getCategoryDescription(999)).toBe("Unknown");
      });
    });

    describe("isValidFeedNameFormat", () => {
      it("should return true for valid names", () => {
        expect(FtsoValidationUtils.isValidFeedNameFormat("BTC/USD")).toBe(true);
        expect(FtsoValidationUtils.isValidFeedNameFormat("ETH/USDT")).toBe(true);
      });

      it("should return false for invalid names", () => {
        expect(FtsoValidationUtils.isValidFeedNameFormat("INVALID")).toBe(false);
        expect(FtsoValidationUtils.isValidFeedNameFormat("BTC-USD")).toBe(false);
      });
    });

    describe("isValidCategory", () => {
      it("should return true for valid categories", () => {
        [1, 2, 3, 4].forEach(category => {
          expect(FtsoValidationUtils.isValidCategory(category)).toBe(true);
        });
      });

      it("should return false for invalid categories", () => {
        [0, 5, -1, 999].forEach(category => {
          expect(FtsoValidationUtils.isValidCategory(category)).toBe(false);
        });
      });
    });
  });
});
