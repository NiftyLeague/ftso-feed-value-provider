import { Test, TestingModule } from "@nestjs/testing";
import { type PriceUpdate, FeedCategory } from "@/common/types/core";
import { ValidationErrorType } from "@/common/types/error-handling";
import { DataValidator, ValidationContext } from "../data-validator";
import { UniversalRetryService } from "@/error-handling/universal-retry.service";

describe("DataValidator", () => {
  let validator: DataValidator;
  let module: TestingModule;
  let mockUniversalRetryService: jest.Mocked<UniversalRetryService>;

  beforeEach(async () => {
    mockUniversalRetryService = {
      executeWithRetry: jest.fn(),
    } as any;

    module = await Test.createTestingModule({
      providers: [
        {
          provide: DataValidator,
          useFactory: () => new DataValidator(mockUniversalRetryService),
        },
      ],
    }).compile();

    validator = module.get<DataValidator>(DataValidator);
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

  const createValidContext = (): ValidationContext => ({
    feedId: { category: FeedCategory.Crypto, name: "BTC/USD" },
    timestamp: Date.now(),
    source: "binance",
    historicalPrices: [
      { symbol: "BTC/USD", price: 49800, timestamp: Date.now() - 5000, source: "coinbase", confidence: 0.9 },
      { symbol: "BTC/USD", price: 50100, timestamp: Date.now() - 3000, source: "kraken", confidence: 0.92 },
      { symbol: "BTC/USD", price: 49900, timestamp: Date.now() - 1000, source: "okx", confidence: 0.88 },
    ],
    crossSourcePrices: [
      { symbol: "BTC/USD", price: 50050, timestamp: Date.now() - 500, source: "coinbase", confidence: 0.9 },
      { symbol: "BTC/USD", price: 49950, timestamp: Date.now() - 300, source: "kraken", confidence: 0.92 },
    ],
  });

  describe("Format Validation", () => {
    it("should pass validation for valid update", async () => {
      const update = createValidUpdate();
      const context = createValidContext();

      mockUniversalRetryService.executeWithRetry.mockImplementation(async operation => {
        return await operation();
      });

      const result = await validator.validateUpdate(update, context);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should fail validation for missing symbol", async () => {
      const update = { ...createValidUpdate(), symbol: "" };
      const context = createValidContext();

      const result = await validator.validateUpdate(update, context);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          type: ValidationErrorType.FORMAT_ERROR,
          severity: "critical",
          field: "symbol",
        })
      );
    });

    it("should fail validation for invalid price", async () => {
      const update = { ...createValidUpdate(), price: NaN };
      const context = createValidContext();

      const result = await validator.validateUpdate(update, context);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          type: ValidationErrorType.FORMAT_ERROR,
          severity: "critical",
          field: "price",
        })
      );
    });

    it("should fail validation for invalid timestamp", async () => {
      const update = { ...createValidUpdate(), timestamp: 0 };
      const context = createValidContext();

      const result = await validator.validateUpdate(update, context);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          type: ValidationErrorType.FORMAT_ERROR,
          severity: "critical",
          field: "timestamp",
        })
      );
    });

    it("should fail validation for missing source", async () => {
      const update = { ...createValidUpdate(), source: "" };
      const context = createValidContext();

      const result = await validator.validateUpdate(update, context);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          type: ValidationErrorType.FORMAT_ERROR,
          severity: "critical",
          field: "source",
        })
      );
    });

    it("should flag invalid confidence value", async () => {
      const update = { ...createValidUpdate(), confidence: 1.5 };
      const context = createValidContext();

      const result = await validator.validateUpdate(update, context);

      expect(result.errors).toContainEqual(
        expect.objectContaining({
          type: ValidationErrorType.FORMAT_ERROR,
          severity: "medium",
          field: "confidence",
        })
      );
    });
  });

  describe("Range Validation", () => {
    it("should fail validation for negative price", async () => {
      const update = { ...createValidUpdate(), price: -100 };
      const context = createValidContext();

      const result = await validator.validateUpdate(update, context);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          type: ValidationErrorType.PRICE_OUT_OF_RANGE,
          severity: "critical",
          field: "price",
        })
      );
    });

    it("should fail validation for price below minimum", async () => {
      const update = { ...createValidUpdate(), price: 0.005 };
      const context = createValidContext();
      const config = { priceRange: { min: 0.01, max: 1000000 } };

      const result = await validator.validateUpdate(update, context, config);

      expect(result.errors).toContainEqual(
        expect.objectContaining({
          type: ValidationErrorType.PRICE_OUT_OF_RANGE,
          severity: "high",
          field: "price",
        })
      );
    });

    it("should fail validation for price above maximum", async () => {
      const update = { ...createValidUpdate(), price: 2000000 };
      const context = createValidContext();
      const config = { priceRange: { min: 0.01, max: 1000000 } };

      const result = await validator.validateUpdate(update, context, config);

      expect(result.errors).toContainEqual(
        expect.objectContaining({
          type: ValidationErrorType.PRICE_OUT_OF_RANGE,
          severity: "high",
          field: "price",
        })
      );
    });
  });

  describe("Staleness Validation", () => {
    it("should fail validation for stale data", async () => {
      const update = { ...createValidUpdate(), timestamp: Date.now() - 5000 }; // 5 seconds old
      const context = createValidContext();
      const config = { maxAge: 2000 }; // 2 seconds max

      const result = await validator.validateUpdate(update, context, config);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          type: ValidationErrorType.STALE_DATA,
          severity: "critical",
          field: "timestamp",
        })
      );
    });

    it("should warn for data approaching staleness", async () => {
      const update = { ...createValidUpdate(), timestamp: Date.now() - 1700 }; // 1.7 seconds old
      const context = createValidContext();
      const config = { maxAge: 2000 }; // 2 seconds max (80% = 1.6s)

      const result = await validator.validateUpdate(update, context, config);

      expect(result.errors).toContainEqual(
        expect.objectContaining({
          type: ValidationErrorType.STALE_DATA,
          severity: "low",
          field: "timestamp",
        })
      );
    });

    it("should pass validation for fresh data", async () => {
      const update = { ...createValidUpdate(), timestamp: Date.now() - 500 }; // 0.5 seconds old
      const context = createValidContext();
      const config = { maxAge: 2000 }; // 2 seconds max

      const result = await validator.validateUpdate(update, context, config);

      const stalenessErrors = result.errors.filter(e => e.type === ValidationErrorType.STALE_DATA);
      expect(stalenessErrors).toHaveLength(0);
    });
  });

  describe("Outlier Detection", () => {
    it("should detect statistical outliers", async () => {
      const update = { ...createValidUpdate(), price: 80000 }; // Significantly higher than historical
      const context = createValidContext();

      const result = await validator.validateUpdate(update, context);

      expect(result.errors).toContainEqual(
        expect.objectContaining({
          type: ValidationErrorType.OUTLIER_ERROR,
          field: "price",
        })
      );
    });

    it("should detect percentage deviation outliers", async () => {
      const update = { ...createValidUpdate(), price: 60000 }; // 20% higher than recent average
      const context = createValidContext();
      const config = { outlierThreshold: 0.1 }; // 10% threshold

      const result = await validator.validateUpdate(update, context, config);

      expect(result.errors).toContainEqual(
        expect.objectContaining({
          type: ValidationErrorType.OUTLIER_ERROR,
          field: "price",
        })
      );
    });

    it("should pass validation for normal price variations", async () => {
      const update = { ...createValidUpdate(), price: 50200 }; // Small variation
      const context = createValidContext();

      const result = await validator.validateUpdate(update, context);

      const outlierErrors = result.errors.filter(e => e.type === ValidationErrorType.OUTLIER_ERROR);
      expect(outlierErrors).toHaveLength(0);
    });

    it("should handle insufficient historical data gracefully", async () => {
      const update = createValidUpdate();
      const context = { ...createValidContext(), historicalPrices: [] };

      const result = await validator.validateUpdate(update, context);

      const outlierErrors = result.errors.filter(e => e.type === ValidationErrorType.OUTLIER_ERROR);
      expect(outlierErrors).toHaveLength(0);
    });
  });

  describe("Cross-Source Validation", () => {
    it("should detect cross-source deviations", async () => {
      const update = { ...createValidUpdate(), price: 52000 }; // Deviates from cross-source median
      const context = createValidContext();

      const result = await validator.validateUpdate(update, context);

      expect(result.errors).toContainEqual(
        expect.objectContaining({
          type: ValidationErrorType.CROSS_SOURCE_ERROR,
          field: "price",
        })
      );
    });

    it("should pass validation for consistent cross-source prices", async () => {
      const update = { ...createValidUpdate(), price: 50000 }; // Close to cross-source median
      const context = createValidContext();

      const result = await validator.validateUpdate(update, context);

      const crossSourceErrors = result.errors.filter(e => e.type === ValidationErrorType.CROSS_SOURCE_ERROR);
      expect(crossSourceErrors).toHaveLength(0);
    });

    it("should handle insufficient cross-source data gracefully", async () => {
      const update = createValidUpdate();
      const context = { ...createValidContext(), crossSourcePrices: [] };

      const result = await validator.validateUpdate(update, context);

      const crossSourceErrors = result.errors.filter(e => e.type === ValidationErrorType.CROSS_SOURCE_ERROR);
      expect(crossSourceErrors).toHaveLength(0);
    });

    it("should filter out same-source prices", async () => {
      const update = { ...createValidUpdate(), source: "binance" };
      const context = {
        ...createValidContext(),
        crossSourcePrices: [
          { symbol: "BTC/USD", price: 50000, timestamp: Date.now(), source: "binance", confidence: 0.9 },
          { symbol: "BTC/USD", price: 50100, timestamp: Date.now(), source: "coinbase", confidence: 0.9 },
        ],
      };

      const result = await validator.validateUpdate(update, context);

      // Should not flag as cross-source error since only one other source
      const crossSourceErrors = result.errors.filter(e => e.type === ValidationErrorType.CROSS_SOURCE_ERROR);
      expect(crossSourceErrors).toHaveLength(0);
    });
  });

  describe("Consensus Validation", () => {
    it("should detect consensus deviations", async () => {
      const update = { ...createValidUpdate(), price: 50500 }; // 1% deviation
      const context = { ...createValidContext(), consensusMedian: 50000 };

      const result = await validator.validateUpdate(update, context);

      expect(result.errors).toContainEqual(
        expect.objectContaining({
          type: ValidationErrorType.CONSENSUS_ERROR,
          field: "price",
        })
      );
    });

    it("should pass validation for consensus-aligned prices", async () => {
      const update = { ...createValidUpdate(), price: 50100 }; // 0.2% deviation
      const context = { ...createValidContext(), consensusMedian: 50000 };

      const result = await validator.validateUpdate(update, context);

      const consensusErrors = result.errors.filter(e => e.type === ValidationErrorType.CONSENSUS_ERROR);
      expect(consensusErrors).toHaveLength(0);
    });

    it("should handle missing consensus data gracefully", async () => {
      const update = createValidUpdate();
      const context = { ...createValidContext(), consensusMedian: undefined };

      const result = await validator.validateUpdate(update, context);

      const consensusErrors = result.errors.filter(e => e.type === ValidationErrorType.CONSENSUS_ERROR);
      expect(consensusErrors).toHaveLength(0);
    });
  });

  describe("Confidence Adjustment", () => {
    it("should reduce confidence for validation errors", async () => {
      const update = { ...createValidUpdate(), confidence: 0.9, price: 80000 }; // Outlier
      const context = createValidContext();

      const result = await validator.validateUpdate(update, context);

      expect(result.confidence).toBeLessThan(0.9);
      expect(result.adjustedUpdate?.confidence).toBeLessThan(0.9);
    });

    it("should severely reduce confidence for critical errors", async () => {
      const update = { ...createValidUpdate(), confidence: 0.9, price: -100 }; // Critical error
      const context = createValidContext();

      const result = await validator.validateUpdate(update, context);

      expect(result.confidence).toBeLessThan(0.1);
    });

    it("should maintain confidence for valid updates", async () => {
      const update = { ...createValidUpdate(), confidence: 0.9 };
      const context = createValidContext();

      const result = await validator.validateUpdate(update, context);

      expect(result.confidence).toBe(0.9);
    });
  });

  describe("Batch Validation", () => {
    it("should validate multiple updates", async () => {
      const updates = [
        createValidUpdate(),
        { ...createValidUpdate(), source: "coinbase", price: 50100 },
        { ...createValidUpdate(), source: "kraken", price: -100 }, // Invalid
      ];
      const context = createValidContext();

      const results = await validator.validateBatch(updates, context);

      expect(results.size).toBe(3);

      const validResults = Array.from(results.values()).filter(r => r.isValid);
      const invalidResults = Array.from(results.values()).filter(r => !r.isValid);

      expect(validResults).toHaveLength(2);
      expect(invalidResults).toHaveLength(1);
    });
  });

  describe("Validation Statistics", () => {
    it("should calculate validation statistics", async () => {
      const results = [
        {
          isValid: true,
          errors: [],
          confidence: 0.9,
          warnings: [],
          timestamp: Date.now(),
        },
        {
          isValid: false,
          errors: [
            {
              code: "PRICE_OUT_OF_RANGE",
              type: ValidationErrorType.PRICE_OUT_OF_RANGE,
              message: "test",
              severity: "high" as const,
            },
          ],
          confidence: 0.1,
          warnings: [],
          timestamp: Date.now(),
        },
        {
          isValid: true,
          errors: [],
          confidence: 0.8,
          warnings: [],
          timestamp: Date.now(),
        },
      ];

      const stats = validator.getValidationStats(results);

      expect(stats.total).toBe(3);
      expect(stats.valid).toBe(2);
      expect(stats.invalid).toBe(1);
      expect(stats.validationRate).toBeCloseTo(2 / 3);
      expect(stats.averageConfidence).toBeCloseTo(0.6);
    });
  });

  describe("Error Handling", () => {
    it("should handle validation errors gracefully", async () => {
      const update = null as any; // Invalid input
      const context = createValidContext();

      const result = await validator.validateUpdate(update, context);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          type: ValidationErrorType.FORMAT_ERROR,
          severity: "critical",
        })
      );
    });
  });
});
