// Test for common.utils.ts
import { sleepFor } from "../common.utils";

describe("Common Utils", () => {
  describe("sleepFor", () => {
    it("should sleep for the specified duration", async () => {
      const start = Date.now();
      await sleepFor(100);
      const end = Date.now();

      expect(end - start).toBeGreaterThanOrEqual(90); // Allow some tolerance
      expect(end - start).toBeLessThan(200); // Should not be too much longer
    });

    it("should handle zero duration", async () => {
      const start = Date.now();
      await sleepFor(0);
      const end = Date.now();

      expect(end - start).toBeLessThan(10); // Should be very fast
    });

    it("should handle negative duration", async () => {
      const start = Date.now();
      await sleepFor(-100);
      const end = Date.now();

      expect(end - start).toBeLessThan(10); // Should be very fast
    });
  });
});
