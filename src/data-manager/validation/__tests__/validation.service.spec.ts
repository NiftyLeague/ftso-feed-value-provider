import { Test, TestingModule } from "@nestjs/testing";
import { ValidationService } from "../validation.service";
import { DataValidator, ValidationResult } from "../data-validator";
import { PriceUpdate } from "@/interfaces";
import { EnhancedFeedId } from "@/types";
import { FeedCategory } from "@/types/feed-category.enum";

// Mock DataValidator
const mockValidator = {
  validateUpdate: jest.fn(),
  validateBatch: jest.fn(),
};

describe("ValidationService", () => {
  let service: ValidationService;
  let module: TestingModule;

  beforeEach(async () => {
    jest.clearAllMocks();

    module = await Test.createTestingModule({
      providers: [
        {
          provide: ValidationService,
          useFactory: () => new ValidationService(mockValidator as any),
        },
      ],
    }).compile();

    service = module.get<ValidationService>(ValidationService);
  });

  afterEach(async () => {
    await module.close();
  });

  const createValidUpdate = (): PriceUpdate => ({
    symbol: "BTC/USD",
    price: 50000,
    timestamp: Date.now(),
    source: "binance",
    confidence: 0.95,
  });

  const createValidFeedId = (): EnhancedFeedId => ({
    category: FeedCategory.Crypto,
    name: "BTC/USD",
  });

  const createValidResult = (): ValidationResult => ({
    isValid: true,
    errors: [],
    confidence: 0.95,
    adjustedUpdate: createValidUpdate(),
  });

  describe("Real-time Validation", () => {
    it("should validate update in real-time", async () => {
      const update = createValidUpdate();
      const feedId = createValidFeedId();
      const expectedResult = createValidResult();

      mockValidator.validateUpdate.mockResolvedValue(expectedResult);

      const result = await service.validateRealTime(update, feedId);

      expect(result).toEqual(expectedResult);
      expect(mockValidator.validateUpdate).toHaveBeenCalledWith(
        update,
        expect.objectContaining({
          feedId,
          historicalPrices: expect.any(Array),
          crossSourcePrices: expect.any(Array),
        }),
        undefined
      );
    });

    it("should use cached results when available", async () => {
      const update = createValidUpdate();
      const feedId = createValidFeedId();
      const expectedResult = createValidResult();

      mockValidator.validateUpdate.mockResolvedValue(expectedResult);

      // First call
      await service.validateRealTime(update, feedId);

      // Second call with same parameters
      const result = await service.validateRealTime(update, feedId);

      expect(result).toEqual(expectedResult);
      expect(mockValidator.validateUpdate).toHaveBeenCalledTimes(1); // Should use cache
    });

    it("should update historical data after validation", async () => {
      const update1 = createValidUpdate();
      const update2 = { ...createValidUpdate(), timestamp: Date.now() + 1000 };
      const feedId = createValidFeedId();

      mockValidator.validateUpdate.mockResolvedValue(createValidResult());

      await service.validateRealTime(update1, feedId);
      await service.validateRealTime(update2, feedId);

      // Second validation should have historical data from first update
      expect(mockValidator.validateUpdate).toHaveBeenCalledTimes(2);

      const secondCallContext = mockValidator.validateUpdate.mock.calls[1][1];
      expect(secondCallContext.historicalPrices).toContainEqual(expect.objectContaining({ source: update1.source }));
    });

    it("should emit validation events", done => {
      const update = createValidUpdate();
      const feedId = createValidFeedId();
      const expectedResult = createValidResult();

      mockValidator.validateUpdate.mockResolvedValue(expectedResult);

      service.on("validationPassed", event => {
        expect(event.update).toEqual(update);
        expect(event.feedId).toEqual(feedId);
        expect(event.result).toEqual(expectedResult);
        done();
      });

      service.validateRealTime(update, feedId);
    });

    it("should emit validation failed events", done => {
      const update = createValidUpdate();
      const feedId = createValidFeedId();
      const failedResult: ValidationResult = {
        isValid: false,
        errors: [{ type: "format_error" as any, message: "Test error", severity: "high" }],
        confidence: 0.1,
      };

      mockValidator.validateUpdate.mockResolvedValue(failedResult);

      service.on("validationFailed", event => {
        expect(event.update).toEqual(update);
        expect(event.feedId).toEqual(feedId);
        expect(event.result).toEqual(failedResult);
        done();
      });

      service.validateRealTime(update, feedId);
    });

    it("should emit critical error events", done => {
      const update = createValidUpdate();
      const feedId = createValidFeedId();
      const criticalResult: ValidationResult = {
        isValid: false,
        errors: [{ type: "format_error" as any, message: "Critical error", severity: "critical" }],
        confidence: 0,
      };

      mockValidator.validateUpdate.mockResolvedValue(criticalResult);

      service.on("criticalValidationError", event => {
        expect(event.update).toEqual(update);
        expect(event.feedId).toEqual(feedId);
        expect(event.error.severity).toBe("critical");
        done();
      });

      service.validateRealTime(update, feedId);
    });

    it("should handle validation errors gracefully", async () => {
      const update = createValidUpdate();
      const feedId = createValidFeedId();

      mockValidator.validateUpdate.mockRejectedValue(new Error("Validation failed"));

      const result = await service.validateRealTime(update, feedId);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          message: expect.stringContaining("Validation service error"),
          severity: "critical",
        })
      );
    });

    it("should skip validation when disabled", async () => {
      const disabledService = new ValidationService(mockValidator as any, {
        enableRealTimeValidation: false,
      });

      const update = createValidUpdate();
      const feedId = createValidFeedId();

      const result = await disabledService.validateRealTime(update, feedId);

      expect(result.isValid).toBe(true);
      expect(mockValidator.validateUpdate).not.toHaveBeenCalled();
    });
  });

  describe("Batch Validation", () => {
    it("should validate multiple updates", async () => {
      const updates = [
        createValidUpdate(),
        { ...createValidUpdate(), source: "coinbase" },
        { ...createValidUpdate(), source: "kraken" },
      ];
      const feedId = createValidFeedId();

      const mockResults = new Map([
        ["binance-BTC/USD-" + updates[0].timestamp, createValidResult()],
        ["coinbase-BTC/USD-" + updates[1].timestamp, createValidResult()],
        ["kraken-BTC/USD-" + updates[2].timestamp, createValidResult()],
      ]);

      mockValidator.validateBatch.mockResolvedValue(mockResults);

      const results = await service.validateBatch(updates, feedId);

      expect(results.size).toBe(3);
      expect(mockValidator.validateBatch).toHaveBeenCalledWith(updates, expect.objectContaining({ feedId }), undefined);
    });

    it("should emit batch validation completed event", done => {
      const updates = [createValidUpdate(), createValidUpdate()];
      const feedId = createValidFeedId();

      mockValidator.validateBatch.mockResolvedValue(new Map());

      service.on("batchValidationCompleted", event => {
        expect(event.feedId).toEqual(feedId);
        expect(event.totalUpdates).toBe(2);
        done();
      });

      service.validateBatch(updates, feedId);
    });

    it("should skip batch validation when disabled", async () => {
      const disabledService = new ValidationService(mockValidator as any, {
        enableBatchValidation: false,
      });

      const updates = [createValidUpdate()];
      const feedId = createValidFeedId();

      const results = await disabledService.validateBatch(updates, feedId);

      expect(results.size).toBe(1);
      expect(mockValidator.validateBatch).not.toHaveBeenCalled();
    });
  });

  describe("Valid Updates Filtering", () => {
    it("should filter valid updates from batch results", () => {
      const updates = [
        createValidUpdate(),
        { ...createValidUpdate(), source: "coinbase" },
        { ...createValidUpdate(), source: "kraken" },
      ];

      const validationResults = new Map([
        ["binance-BTC/USD-" + updates[0].timestamp, { isValid: true, adjustedUpdate: updates[0] } as ValidationResult],
        [
          "coinbase-BTC/USD-" + updates[1].timestamp,
          { isValid: false, adjustedUpdate: updates[1] } as ValidationResult,
        ],
        ["kraken-BTC/USD-" + updates[2].timestamp, { isValid: true, adjustedUpdate: updates[2] } as ValidationResult],
      ]);

      const validUpdates = service.filterValidUpdates(updates, validationResults);

      expect(validUpdates).toHaveLength(2);
      expect(validUpdates).toContainEqual(updates[0]);
      expect(validUpdates).toContainEqual(updates[2]);
      expect(validUpdates).not.toContainEqual(updates[1]);
    });

    it("should handle missing validation results", () => {
      const updates = [createValidUpdate()];
      const validationResults = new Map();

      const validUpdates = service.filterValidUpdates(updates, validationResults);

      expect(validUpdates).toHaveLength(0);
    });
  });

  describe("Statistics", () => {
    it("should track validation statistics", async () => {
      const update = createValidUpdate();
      const feedId = createValidFeedId();

      mockValidator.validateUpdate.mockResolvedValue(createValidResult());

      await service.validateRealTime(update, feedId);

      const stats = service.getValidationStatistics();

      expect(stats.totalValidations).toBe(1);
      expect(stats.validUpdates).toBe(1);
      expect(stats.invalidUpdates).toBe(0);
      expect(stats.validationRate).toBe(1);
    });

    it("should track failed validations", async () => {
      const update = createValidUpdate();
      const feedId = createValidFeedId();

      mockValidator.validateUpdate.mockResolvedValue({
        isValid: false,
        errors: [],
        confidence: 0,
      });

      await service.validateRealTime(update, feedId);

      const stats = service.getValidationStatistics();

      expect(stats.totalValidations).toBe(1);
      expect(stats.validUpdates).toBe(0);
      expect(stats.invalidUpdates).toBe(1);
      expect(stats.validationRate).toBe(0);
    });

    it("should calculate average validation time", async () => {
      const update = createValidUpdate();
      const feedId = createValidFeedId();

      mockValidator.validateUpdate.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return createValidResult();
      });

      await service.validateRealTime(update, feedId);

      const stats = service.getValidationStatistics();

      expect(stats.averageValidationTime).toBeGreaterThan(0);
    });
  });

  describe("Cache Management", () => {
    it("should clear validation cache", async () => {
      const update = createValidUpdate();
      const feedId = createValidFeedId();

      mockValidator.validateUpdate.mockResolvedValue(createValidResult());

      // Populate cache
      await service.validateRealTime(update, feedId);

      let stats = service.getValidationStatistics();
      expect(stats.cacheSize).toBeGreaterThan(0);

      // Clear cache
      service.clearCache();

      stats = service.getValidationStatistics();
      expect(stats.cacheSize).toBe(0);
    });

    it("should clear historical data", async () => {
      const update = createValidUpdate();
      const feedId = createValidFeedId();

      mockValidator.validateUpdate.mockResolvedValue(createValidResult());

      // Populate historical data
      await service.validateRealTime(update, feedId);

      let stats = service.getValidationStatistics();
      expect(stats.historicalDataSize).toBeGreaterThan(0);

      // Clear historical data
      service.clearHistoricalData();

      stats = service.getValidationStatistics();
      expect(stats.historicalDataSize).toBe(0);
    });
  });

  describe("Configuration", () => {
    it("should use custom configuration", () => {
      const customConfig = {
        validationCacheSize: 500,
        validationCacheTTL: 10000,
        historicalDataWindow: 100,
        crossSourceWindow: 20000,
      };

      const customService = new ValidationService(mockValidator as any, customConfig);

      // Configuration is private, but we can test its effects
      expect(customService).toBeDefined();
    });

    it("should use default configuration when none provided", () => {
      const defaultService = new ValidationService(mockValidator as any);

      expect(defaultService).toBeDefined();
    });
  });

  describe("Cross-Source Price Management", () => {
    it("should maintain cross-source prices within time window", async () => {
      const feedId = createValidFeedId();

      // Add old update
      const oldUpdate = { ...createValidUpdate(), timestamp: Date.now() - 15000 }; // 15 seconds old
      mockValidator.validateUpdate.mockResolvedValue(createValidResult());
      await service.validateRealTime(oldUpdate, feedId);

      // Add recent update
      const recentUpdate = { ...createValidUpdate(), timestamp: Date.now() - 1000 }; // 1 second old
      await service.validateRealTime(recentUpdate, feedId);

      // The validation context should only include recent cross-source prices
      const lastCallContext = mockValidator.validateUpdate.mock.calls[1][1];
      const crossSourceTimestamps = lastCallContext.crossSourcePrices.map((p: PriceUpdate) => p.timestamp);

      // Should not include very old prices (depends on crossSourceWindow config)
      expect(crossSourceTimestamps.every((ts: number) => Date.now() - ts < 15000)).toBe(true);
    });
  });
});
