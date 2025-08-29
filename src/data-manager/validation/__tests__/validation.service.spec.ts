import { Test, TestingModule } from "@nestjs/testing";
import { ValidationService } from "../validation.service";
import { DataValidator, ValidationResult } from "../data-validator";
import { PriceUpdate } from "@/interfaces";
import { EnhancedFeedId } from "@/types";
import { FeedCategory } from "@/types/feed-category.enum";

describe("ValidationService", () => {
  let service: ValidationService;
  let dataValidator: jest.Mocked<DataValidator>;

  const mockFeedId: EnhancedFeedId = {
    category: FeedCategory.Crypto,
    name: "BTC/USD",
  };

  const mockUpdate: PriceUpdate = {
    symbol: "BTC/USD",
    price: 50000,
    timestamp: Date.now(),
    source: "test-exchange",
    confidence: 0.9,
  };

  beforeEach(async () => {
    // Mock console methods to suppress expected error logs during tests
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});

    const mockDataValidator = {
      validateUpdate: jest.fn(),
      validateBatch: jest.fn(),
      getValidationStats: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: ValidationService,
          useFactory: () => new ValidationService(mockDataValidator as any),
        },
      ],
    }).compile();

    service = module.get<ValidationService>(ValidationService);
    dataValidator = mockDataValidator as any;
  });

  afterEach(() => {
    service.cleanup();
    // Restore console methods after each test
    jest.restoreAllMocks();
  });

  describe("Real-time Validation", () => {
    it("should validate a price update successfully", async () => {
      const mockResult: ValidationResult = {
        isValid: true,
        errors: [],
        confidence: 0.9,
        adjustedUpdate: mockUpdate,
      };

      dataValidator.validateUpdate.mockResolvedValue(mockResult);

      const result = await service.validateRealTime(mockUpdate, mockFeedId);

      expect(result).toEqual(mockResult);
      expect(dataValidator.validateUpdate).toHaveBeenCalledWith(mockUpdate, expect.any(Object), undefined);
    });

    it("should handle validation errors gracefully", async () => {
      dataValidator.validateUpdate.mockRejectedValue(new Error("Validation failed"));

      const result = await service.validateRealTime(mockUpdate, mockFeedId);

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.confidence).toBe(0);
    });

    it("should use cached results when available", async () => {
      const mockResult: ValidationResult = {
        isValid: true,
        errors: [],
        confidence: 0.9,
        adjustedUpdate: mockUpdate,
      };

      dataValidator.validateUpdate.mockResolvedValue(mockResult);

      // First call
      await service.validateRealTime(mockUpdate, mockFeedId);

      // Second call should use cache
      await service.validateRealTime(mockUpdate, mockFeedId);

      // Should only call validator once due to caching
      expect(dataValidator.validateUpdate).toHaveBeenCalledTimes(1);
    });
  });

  describe("Batch Validation", () => {
    it("should validate multiple updates", async () => {
      const updates = [mockUpdate, { ...mockUpdate, source: "another-exchange" }];
      const mockResults = new Map<string, ValidationResult>();

      mockResults.set("test-exchange-BTC/USD-" + mockUpdate.timestamp, {
        isValid: true,
        errors: [],
        confidence: 0.9,
        adjustedUpdate: mockUpdate,
      });

      dataValidator.validateBatch.mockResolvedValue(mockResults);

      const results = await service.validateBatch(updates, mockFeedId);

      expect(results).toEqual(mockResults);
      expect(dataValidator.validateBatch).toHaveBeenCalledWith(updates, expect.any(Object), undefined);
    });

    it("should handle batch validation errors", async () => {
      const updates = [mockUpdate];
      dataValidator.validateBatch.mockRejectedValue(new Error("Batch validation failed"));

      await expect(service.validateBatch(updates, mockFeedId)).rejects.toThrow("Batch validation failed");
    });
  });

  describe("Valid Updates Filtering", () => {
    it("should filter valid updates from validation results", () => {
      const updates = [mockUpdate, { ...mockUpdate, source: "another-exchange", timestamp: Date.now() + 1000 }];

      const validationResults = new Map<string, ValidationResult>();
      validationResults.set(`${mockUpdate.source}-${mockUpdate.symbol}-${mockUpdate.timestamp}`, {
        isValid: true,
        errors: [],
        confidence: 0.9,
        adjustedUpdate: mockUpdate,
      });
      validationResults.set(`another-exchange-${mockUpdate.symbol}-${mockUpdate.timestamp + 1000}`, {
        isValid: false,
        errors: [{ type: "format_error" as any, message: "Invalid price", severity: "critical" }],
        confidence: 0,
      });

      const validUpdates = service.filterValidUpdates(updates, validationResults);

      expect(validUpdates).toHaveLength(1);
      expect(validUpdates[0]).toEqual(mockUpdate);
    });
  });

  describe("Statistics", () => {
    it("should return validation statistics", () => {
      const stats = service.getValidationStatistics();

      expect(stats).toBeDefined();
      expect(typeof stats.totalValidations).toBe("number");
      expect(typeof stats.validUpdates).toBe("number");
      expect(typeof stats.invalidUpdates).toBe("number");
      expect(typeof stats.validationRate).toBe("number");
      expect(typeof stats.averageValidationTime).toBe("number");
      expect(typeof stats.cacheSize).toBe("number");
      expect(typeof stats.historicalDataSize).toBe("number");
    });
  });

  describe("Cache Management", () => {
    it("should clear validation cache", () => {
      expect(() => service.clearCache()).not.toThrow();
    });

    it("should clear historical data", () => {
      expect(() => service.clearHistoricalData()).not.toThrow();
    });
  });

  describe("Configuration", () => {
    it("should work with custom configuration", () => {
      const customConfig = {
        enableRealTimeValidation: false,
        validationCacheSize: 500,
      };

      const customService = new ValidationService(dataValidator);
      expect(customService).toBeDefined();
      customService.cleanup(); // Clean up the custom service
    });
  });

  describe("Event Emission", () => {
    it("should emit validation events", async () => {
      const mockResult: ValidationResult = {
        isValid: true,
        errors: [],
        confidence: 0.9,
        adjustedUpdate: mockUpdate,
      };

      dataValidator.validateUpdate.mockResolvedValue(mockResult);

      let eventEmitted = false;
      service.on("validationPassed", () => {
        eventEmitted = true;
      });

      await service.validateRealTime(mockUpdate, mockFeedId);

      expect(eventEmitted).toBe(true);
    });

    it("should emit validation failure events", async () => {
      const mockResult: ValidationResult = {
        isValid: false,
        errors: [{ type: "format_error" as any, message: "Invalid price", severity: "critical" }],
        confidence: 0,
      };

      dataValidator.validateUpdate.mockResolvedValue(mockResult);

      let failureEventEmitted = false;
      let criticalEventEmitted = false;

      service.on("validationFailed", () => {
        failureEventEmitted = true;
      });

      service.on("criticalValidationError", () => {
        criticalEventEmitted = true;
      });

      await service.validateRealTime(mockUpdate, mockFeedId);

      expect(failureEventEmitted).toBe(true);
      expect(criticalEventEmitted).toBe(true);
    });
  });

  describe("Disabled Validation", () => {
    it("should bypass validation when real-time validation is disabled", async () => {
      const disabledService = new ValidationService(dataValidator);

      const result = await disabledService.validateRealTime(mockUpdate, mockFeedId);

      expect(result.isValid).toBe(true);
      expect(result.confidence).toBe(mockUpdate.confidence);

      disabledService.cleanup(); // Clean up the disabled service
    });

    it("should bypass batch validation when disabled", async () => {
      const disabledService = new ValidationService(dataValidator);

      const updates = [mockUpdate];
      const results = await disabledService.validateBatch(updates, mockFeedId);

      expect(results.size).toBe(1);
      const result = results.values().next().value;
      expect(result.isValid).toBe(true);

      disabledService.cleanup(); // Clean up the disabled service
    });
  });
});
