/**
 * Tests for feeds loading and counting functionality
 */

import { ConfigService } from "../config.service";

describe("Feeds Loading and Counting", () => {
  let configService: ConfigService;

  beforeEach(() => {
    configService = new ConfigService();
  });

  describe("ConfigService feeds methods", () => {
    it("should load feeds count correctly", () => {
      const count = configService.getFeedsCount();
      expect(count).toBe(63);
    });

    it("should load feeds count with fallback", () => {
      const count = configService.getFeedsCountWithFallback();
      expect(count).toBe(63);
    });

    it("should return fallback count when feeds loading fails", () => {
      // Mock the getFeedConfigurations to throw an error
      jest.spyOn(configService, "getFeedConfigurations").mockImplementation(() => {
        throw new Error("Mock error");
      });

      const count = configService.getFeedsCountWithFallback(42);
      expect(count).toBe(42);
    });

    it("should load feed configurations", () => {
      const feeds = configService.getFeedConfigurations();
      expect(Array.isArray(feeds)).toBe(true);
      expect(feeds.length).toBe(63);

      // Verify structure of first feed
      if (feeds.length > 0) {
        const firstFeed = feeds[0];
        expect(firstFeed).toHaveProperty("feed");
        expect(firstFeed).toHaveProperty("sources");
        expect(firstFeed.feed).toHaveProperty("category");
        expect(firstFeed.feed).toHaveProperty("name");
        expect(Array.isArray(firstFeed.sources)).toBe(true);
      }
    });
  });

  describe("Feeds configuration validation", () => {
    it("should validate feeds.json can be loaded through ConfigService", () => {
      expect(() => configService.getFeedsCount()).not.toThrow();
    });

    it("should handle errors gracefully with fallback", () => {
      const count = configService.getFeedsCountWithFallback(42);
      expect(typeof count).toBe("number");
      expect(count).toBeGreaterThan(0);
    });
  });

  describe("Feed count consistency", () => {
    it("should return consistent count across different methods", () => {
      const configServiceCount = configService.getFeedsCount();
      const feedsArrayLength = configService.getFeedConfigurations().length;

      expect(configServiceCount).toBe(feedsArrayLength);
      expect(configServiceCount).toBe(63);
    });
  });
});
