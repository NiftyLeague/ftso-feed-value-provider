import { Test, TestingModule } from "@nestjs/testing";
import { ValidationService } from "../validation.service";
import { DataValidator } from "../data-validator";
import { UniversalRetryService } from "@/error-handling/universal-retry.service";
import type { DataValidatorResult } from "@/common/types/data-manager";
import { FeedCategory } from "@/common/types/core";
import { ValidationErrorType, ErrorCode, ErrorSeverity } from "@/common/types/error-handling";
import { TestDataBuilder, MockSetup } from "@/__tests__/utils";

describe("ValidationService", () => {
  let service: ValidationService;
  let dataValidator: jest.Mocked<DataValidator>;
  let universalRetryService: jest.Mocked<UniversalRetryService>;

  const mockFeedId = TestDataBuilder.createCoreFeedId({
    category: FeedCategory.Crypto,
    name: "BTC/USD",
  });

  const mockUpdate = TestDataBuilder.createPriceUpdate({
    symbol: "BTC/USD",
    price: 50000,
    source: "test-exchange",
    confidence: 0.9,
  });

  beforeEach(async () => {
    // Use centralized console mocking
    MockSetup.setupConsole();

    const mockDataValidator = {
      validateUpdate: jest.fn(),
      validateBatch: jest.fn(),
      getValidationStats: jest.fn(),
    };

    const mockUniversalRetryService = {
      executeWithRetry: jest.fn().mockImplementation(async fn => {
        return await fn();
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: ValidationService,
          useFactory: () => new ValidationService(mockDataValidator as any, mockUniversalRetryService as any),
        },
      ],
    }).compile();

    service = module.get<ValidationService>(ValidationService);
    dataValidator = mockDataValidator as any;
    universalRetryService = mockUniversalRetryService as any;
  });

  afterEach(async () => {
    await service.cleanup();
    // Restore console methods after each test
    jest.restoreAllMocks();
  });

  describe("Real-time Validation", () => {
    it("should validate a price update successfully", async () => {
      const mockResult = TestDataBuilder.createValidatorResult({
        isValid: true,
        confidence: 0.9,
        adjustedUpdate: mockUpdate,
      });

      dataValidator.validateUpdate.mockResolvedValue(mockResult);
      universalRetryService.executeWithRetry.mockImplementation(async operation => {
        return await operation();
      });

      const result = await service.validateRealTime(mockUpdate, mockFeedId);

      expect(result).toEqual(mockResult);
      expect(universalRetryService.executeWithRetry).toHaveBeenCalled();
    });

    it("should handle validation errors gracefully", async () => {
      universalRetryService.executeWithRetry.mockResolvedValue(undefined);

      const result = await service.validateRealTime(mockUpdate, mockFeedId);

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.confidence).toBe(0);
    });

    it("should use cached results when available", async () => {
      const mockResult = TestDataBuilder.createValidatorResult({
        isValid: true,
        confidence: 0.9,
        adjustedUpdate: mockUpdate,
      });

      dataValidator.validateUpdate.mockResolvedValue(mockResult);
      universalRetryService.executeWithRetry.mockImplementation(async operation => {
        return await operation();
      });

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
      const mockResults = new Map<string, DataValidatorResult>();

      mockResults.set("test-exchange-BTC/USD-" + mockUpdate.timestamp, {
        isValid: true,
        errors: [],
        warnings: [],
        timestamp: Date.now(),
        confidence: 0.9,
        adjustedUpdate: mockUpdate,
      });

      dataValidator.validateBatch.mockResolvedValue(mockResults);
      universalRetryService.executeWithRetry.mockImplementation(async operation => {
        return await operation();
      });

      const results = await service.validateBatch(updates, mockFeedId);

      expect(results).toEqual(mockResults);
      expect(universalRetryService.executeWithRetry).toHaveBeenCalled();
    });

    it("should handle batch validation errors", async () => {
      const updates = [mockUpdate];
      universalRetryService.executeWithRetry.mockRejectedValue(new Error("Batch validation failed"));

      await expect(service.validateBatch(updates, mockFeedId)).rejects.toThrow("Batch validation failed");
    });
  });

  describe("Valid Updates Filtering", () => {
    it("should filter valid updates from validation results", () => {
      const updates = [mockUpdate, { ...mockUpdate, source: "another-exchange", timestamp: Date.now() + 1000 }];

      const validationResults = new Map<string, DataValidatorResult>();
      validationResults.set(`${mockUpdate.source}-${mockUpdate.symbol}-${mockUpdate.timestamp}`, {
        isValid: true,
        errors: [],
        confidence: 0.9,
        adjustedUpdate: mockUpdate,
        warnings: [],
        timestamp: Date.now(),
      });
      validationResults.set(`another-exchange-${mockUpdate.symbol}-${mockUpdate.timestamp + 1000}`, {
        isValid: false,
        errors: [
          {
            code: ErrorCode.DATA_VALIDATION_FAILED,
            type: ValidationErrorType.FORMAT_ERROR,
            message: "Invalid price",
            severity: ErrorSeverity.CRITICAL,
            operation: "validateRealTime",
            validationErrors: ["Invalid price"],
          },
        ],
        confidence: 0,
        warnings: [],
        timestamp: Date.now(),
      });

      const validUpdates = service.filterValidUpdates(updates, validationResults);

      expect(validUpdates).toHaveLength(1);
      expect(validUpdates[0]).toEqual(mockUpdate);
    });
  });

  describe("Statistics", () => {
    it("should return validation statistics", () => {
      const stats = service.getValidationStats();

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
    it("should work with custom configuration", async () => {
      // Using default config; ensure service constructs successfully

      const customService = new ValidationService(dataValidator, universalRetryService);
      expect(customService).toBeDefined();
      await customService.cleanup(); // Clean up the custom service
    });
  });

  describe("Event Emission", () => {
    it("should emit validation events", async () => {
      const mockResult: DataValidatorResult = {
        isValid: true,
        errors: [],
        confidence: 0.9,
        adjustedUpdate: mockUpdate,
        warnings: [],
        timestamp: Date.now(),
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
      const mockResult: DataValidatorResult = {
        isValid: false,
        errors: [
          {
            code: ErrorCode.DATA_VALIDATION_FAILED,
            type: ValidationErrorType.FORMAT_ERROR,
            message: "Invalid price",
            severity: ErrorSeverity.CRITICAL,
            operation: "validateRealTime",
            validationErrors: ["Invalid price"],
          },
        ],
        confidence: 0,
        warnings: [],
        timestamp: Date.now(),
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
      const disabledService = new ValidationService(dataValidator, universalRetryService, {
        enableRealTimeValidation: false,
      });

      const result = await disabledService.validateRealTime(mockUpdate, mockFeedId);

      expect(result.isValid).toBe(true);
      expect(result.confidence).toBe(mockUpdate.confidence);

      await disabledService.cleanup(); // Clean up the disabled service
    });

    it("should bypass batch validation when disabled", async () => {
      const disabledService = new ValidationService(dataValidator, universalRetryService, {
        enableBatchValidation: false,
      });

      const updates = [mockUpdate];
      const results = await disabledService.validateBatch(updates, mockFeedId);

      expect(results.size).toBe(1);
      const result = results.values().next().value as DataValidatorResult;
      expect(result.isValid).toBe(true);

      await disabledService.cleanup(); // Clean up the disabled service
    });
  });
});
