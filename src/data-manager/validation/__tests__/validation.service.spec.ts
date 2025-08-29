import { Test, TestingModule } from "@nestjs/testing";
import { ValidationService } from "../validation.service";
import { DataValidator } from "../data-validator";
import { EnhancedFeedId } from "@/types/enhanced-feed-id.types";
import { FeedCategory } from "@/types/feed-category.enum";
import { PriceUpdate } from "@/interfaces/data-source.interface";

describe("ValidationService", () => {
  let service: ValidationService;
  let dataValidator: jest.Mocked<DataValidator>;
  let module: TestingModule;

  const mockFeedId: EnhancedFeedId = {
    category: FeedCategory.Crypto,
    name: "BTC/USD",
  };

  beforeEach(async () => {
    const mockDataValidator = {
      validateUpdate: jest.fn(),
      validateBatch: jest.fn(),
      getValidationStats: jest.fn(),
    };

    module = await Test.createTestingModule({
      providers: [
        ValidationService,
        {
          provide: DataValidator,
          useValue: mockDataValidator,
        },
      ],
    }).compile();

    service = module.get<ValidationService>(ValidationService);
    dataValidator = module.get(DataValidator);
  });

  afterEach(async () => {
    await module.close();
  });

  describe("single update validation", () => {
    it("should validate a single price update", async () => {
      const update: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        source: "binance",
        confidence: 0.9,
      };

      const mockValidationResult = {
        isValid: true,
        errors: [],
        confidence: 0.9,
        adjustedUpdate: undefined,
      };

      dataValidator.validateUpdate.mockResolvedValue(mockValidationResult);

      const result = await service.validatePriceUpdate(mockFeedId, update);

      expect(result).toEqual(mockValidationResult);
      expect(dataValidator.validateUpdate).toHaveBeenCalledWith(
        update,
        expect.objectContaining({
          feedId: mockFeedId,
        })
      );
    });

    it("should build validation context with historical data", async () => {
      const update: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        source: "binance",
        confidence: 0.9,
      };

      // Add some historical data
      const historicalUpdate: PriceUpdate = {
        symbol: "BTC/USD",
        price: 49800,
        timestamp: Date.now() - 5000,
        source: "coinbase",
        confidence: 0.85,
      };

      await service.addHistoricalData(mockFeedId, historicalUpdate);

      dataValidator.validateUpdate.mockResolvedValue({
        isValid: true,
        errors: [],
        confidence: 0.9,
        adjustedUpdate: undefined,
      });

      await service.validatePriceUpdate(mockFeedId, update);

      expect(dataValidator.validateUpdate).toHaveBeenCalledWith(
        update,
        expect.objectContaining({
          feedId: mockFeedId,
          historicalPrices: expect.arrayContaining([historicalUpdate]),
        })
      );
    });

    it("should include cross-source data in validation context", async () => {
      const update: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        source: "binance",
        confidence: 0.9,
      };

      const crossSourceUpdate: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50100,
        timestamp: Date.now() - 1000,
        source: "coinbase",
        confidence: 0.85,
      };

      service.addCrossSourceData(mockFeedId, crossSourceUpdate);

      dataValidator.validateUpdate.mockResolvedValue({
        isValid: true,
        errors: [],
        confidence: 0.9,
        adjustedUpdate: undefined,
      });

      await service.validatePriceUpdate(mockFeedId, update);

      expect(dataValidator.validateUpdate).toHaveBeenCalledWith(
        update,
        expect.objectContaining({
          feedId: mockFeedId,
          crossSourcePrices: expect.arrayContaining([crossSourceUpdate]),
        })
      );
    });

    it("should handle validation errors gracefully", async () => {
      const update: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        source: "binance",
        confidence: 0.9,
      };

      dataValidator.validateUpdate.mockRejectedValue(new Error("Validation failed"));

      const result = await service.validatePriceUpdate(mockFeedId, update);

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain("Validation failed");
    });
  });

  describe("batch validation", () => {
    it("should validate multiple updates", async () => {
      const updates: PriceUpdate[] = [
        {
          symbol: "BTC/USD",
          price: 50000,
          timestamp: Date.now(),
          source: "binance",
          confidence: 0.9,
        },
        {
          symbol: "BTC/USD",
          price: 50100,
          timestamp: Date.now() - 500,
          source: "coinbase",
          confidence: 0.85,
        },
      ];

      const mockBatchResults = new Map([
        [updates[0], { isValid: true, errors: [], confidence: 0.9 }],
        [updates[1], { isValid: true, errors: [], confidence: 0.85 }],
      ]);

      dataValidator.validateBatch.mockResolvedValue(mockBatchResults);

      const results = await service.validateBatch(mockFeedId, updates);

      expect(results.size).toBe(2);
      expect(dataValidator.validateBatch).toHaveBeenCalledWith(
        updates,
        expect.objectContaining({
          feedId: mockFeedId,
        })
      );
    });

    it("should handle empty batch", async () => {
      const updates: PriceUpdate[] = [];

      const results = await service.validateBatch(mockFeedId, updates);

      expect(results.size).toBe(0);
      expect(dataValidator.validateBatch).not.toHaveBeenCalled();
    });

    it("should filter valid updates from batch", async () => {
      const updates: PriceUpdate[] = [
        {
          symbol: "BTC/USD",
          price: 50000,
          timestamp: Date.now(),
          source: "binance",
          confidence: 0.9,
        },
        {
          symbol: "BTC/USD",
          price: -100, // Invalid
          timestamp: Date.now() - 500,
          source: "coinbase",
          confidence: 0.85,
        },
      ];

      const mockBatchResults = new Map([
        [updates[0], { isValid: true, errors: [], confidence: 0.9 }],
        [updates[1], { isValid: false, errors: [{ type: "RANGE_ERROR", message: "Invalid price" }], confidence: 0 }],
      ]);

      dataValidator.validateBatch.mockResolvedValue(mockBatchResults);

      const validUpdates = await service.getValidUpdatesFromBatch(mockFeedId, updates);

      expect(validUpdates).toHaveLength(1);
      expect(validUpdates[0]).toEqual(updates[0]);
    });
  });

  describe("historical data management", () => {
    it("should maintain historical data within time window", async () => {
      const now = Date.now();
      const recentUpdate: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: now - 1000, // 1 second ago
        source: "binance",
        confidence: 0.9,
      };

      const oldUpdate: PriceUpdate = {
        symbol: "BTC/USD",
        price: 49000,
        timestamp: now - 10000, // 10 seconds ago
        source: "coinbase",
        confidence: 0.85,
      };

      await service.addHistoricalData(mockFeedId, recentUpdate);
      await service.addHistoricalData(mockFeedId, oldUpdate);

      const historicalData = service.getHistoricalData(mockFeedId);

      // Should only contain recent data (within 5 second window by default)
      expect(historicalData).toHaveLength(1);
      expect(historicalData[0]).toEqual(recentUpdate);
    });

    it("should limit historical data size", async () => {
      const updates: PriceUpdate[] = [];
      const now = Date.now();

      // Add more updates than the limit
      for (let i = 0; i < 150; i++) {
        const update: PriceUpdate = {
          symbol: "BTC/USD",
          price: 50000 + i,
          timestamp: now - i * 100, // Spread over time
          source: "binance",
          confidence: 0.9,
        };
        updates.push(update);
        await service.addHistoricalData(mockFeedId, update);
      }

      const historicalData = service.getHistoricalData(mockFeedId);

      // Should be limited to max size (100 by default)
      expect(historicalData.length).toBeLessThanOrEqual(100);
    });

    it("should clear historical data", async () => {
      const update: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        source: "binance",
        confidence: 0.9,
      };

      await service.addHistoricalData(mockFeedId, update);
      expect(service.getHistoricalData(mockFeedId)).toHaveLength(1);

      service.clearHistoricalData(mockFeedId);
      expect(service.getHistoricalData(mockFeedId)).toHaveLength(0);
    });
  });

  describe("cross-source data management", () => {
    it("should maintain cross-source data", () => {
      const update: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        source: "binance",
        confidence: 0.9,
      };

      service.addCrossSourceData(mockFeedId, update);

      const crossSourceData = service.getCrossSourceData(mockFeedId);
      expect(crossSourceData).toHaveLength(1);
      expect(crossSourceData[0]).toEqual(update);
    });

    it("should filter out stale cross-source data", () => {
      const now = Date.now();
      const freshUpdate: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: now - 1000, // 1 second ago
        source: "binance",
        confidence: 0.9,
      };

      const staleUpdate: PriceUpdate = {
        symbol: "BTC/USD",
        price: 49000,
        timestamp: now - 10000, // 10 seconds ago
        source: "coinbase",
        confidence: 0.85,
      };

      service.addCrossSourceData(mockFeedId, freshUpdate);
      service.addCrossSourceData(mockFeedId, staleUpdate);

      const crossSourceData = service.getCrossSourceData(mockFeedId);

      // Should only contain fresh data
      expect(crossSourceData).toHaveLength(1);
      expect(crossSourceData[0]).toEqual(freshUpdate);
    });

    it("should clear cross-source data", () => {
      const update: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        source: "binance",
        confidence: 0.9,
      };

      service.addCrossSourceData(mockFeedId, update);
      expect(service.getCrossSourceData(mockFeedId)).toHaveLength(1);

      service.clearCrossSourceData(mockFeedId);
      expect(service.getCrossSourceData(mockFeedId)).toHaveLength(0);
    });
  });

  describe("consensus data management", () => {
    it("should set and get consensus median", () => {
      const consensusMedian = 50000;

      service.setConsensusMedian(mockFeedId, consensusMedian);

      const retrievedMedian = service.getConsensusMedian(mockFeedId);
      expect(retrievedMedian).toBe(consensusMedian);
    });

    it("should clear consensus data", () => {
      service.setConsensusMedian(mockFeedId, 50000);
      expect(service.getConsensusMedian(mockFeedId)).toBe(50000);

      service.clearConsensusData(mockFeedId);
      expect(service.getConsensusMedian(mockFeedId)).toBeUndefined();
    });
  });

  describe("validation statistics", () => {
    it("should track validation statistics", async () => {
      const updates: PriceUpdate[] = [
        {
          symbol: "BTC/USD",
          price: 50000,
          timestamp: Date.now(),
          source: "binance",
          confidence: 0.9,
        },
        {
          symbol: "BTC/USD",
          price: -100, // Invalid
          timestamp: Date.now() - 500,
          source: "coinbase",
          confidence: 0.85,
        },
      ];

      const mockBatchResults = new Map([
        [updates[0], { isValid: true, errors: [], confidence: 0.9 }],
        [updates[1], { isValid: false, errors: [{ type: "RANGE_ERROR", message: "Invalid price" }], confidence: 0 }],
      ]);

      dataValidator.validateBatch.mockResolvedValue(mockBatchResults);
      dataValidator.getValidationStats.mockReturnValue({
        total: 2,
        valid: 1,
        invalid: 1,
        validationRate: 0.5,
        averageConfidence: 0.45,
      });

      await service.validateBatch(mockFeedId, updates);

      const stats = service.getValidationStatistics(mockFeedId);

      expect(stats.total).toBe(2);
      expect(stats.valid).toBe(1);
      expect(stats.invalid).toBe(1);
      expect(stats.validationRate).toBe(0.5);
      expect(stats.averageConfidence).toBe(0.45);
    });

    it("should reset validation statistics", async () => {
      const update: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        source: "binance",
        confidence: 0.9,
      };

      dataValidator.validateUpdate.mockResolvedValue({
        isValid: true,
        errors: [],
        confidence: 0.9,
        adjustedUpdate: undefined,
      });

      await service.validatePriceUpdate(mockFeedId, update);

      service.resetValidationStatistics(mockFeedId);

      const stats = service.getValidationStatistics(mockFeedId);
      expect(stats.total).toBe(0);
      expect(stats.valid).toBe(0);
      expect(stats.invalid).toBe(0);
    });
  });

  describe("configuration management", () => {
    it("should update validation configuration", () => {
      const newConfig = {
        maxAge: 3000,
        historicalDataWindow: 10000,
        maxHistoricalSize: 200,
        crossSourceDataWindow: 8000,
      };

      service.updateConfig(newConfig);
      const currentConfig = service.getConfig();

      expect(currentConfig.maxAge).toBe(3000);
      expect(currentConfig.historicalDataWindow).toBe(10000);
      expect(currentConfig.maxHistoricalSize).toBe(200);
      expect(currentConfig.crossSourceDataWindow).toBe(8000);
    });

    it("should use default configuration values", () => {
      const config = service.getConfig();

      expect(config.maxAge).toBe(2000);
      expect(config.historicalDataWindow).toBe(5000);
      expect(config.maxHistoricalSize).toBe(100);
      expect(config.crossSourceDataWindow).toBe(5000);
    });
  });

  describe("performance", () => {
    it("should handle high-frequency validation", async () => {
      const updates: PriceUpdate[] = [];
      const now = Date.now();

      // Generate many updates
      for (let i = 0; i < 1000; i++) {
        updates.push({
          symbol: "BTC/USD",
          price: 50000 + Math.random() * 1000,
          timestamp: now - i,
          source: `source-${i % 10}`,
          confidence: 0.9,
        });
      }

      dataValidator.validateUpdate.mockResolvedValue({
        isValid: true,
        errors: [],
        confidence: 0.9,
        adjustedUpdate: undefined,
      });

      const startTime = performance.now();

      // Validate all updates
      const promises = updates.map(update => service.validatePriceUpdate(mockFeedId, update));
      await Promise.all(promises);

      const endTime = performance.now();
      const totalTime = endTime - startTime;

      // Should handle high frequency validation efficiently
      expect(totalTime).toBeLessThan(1000); // Less than 1 second for 1000 validations
    });

    it("should efficiently manage memory with large datasets", async () => {
      const updates: PriceUpdate[] = [];
      const now = Date.now();

      // Add many historical updates
      for (let i = 0; i < 10000; i++) {
        const update: PriceUpdate = {
          symbol: "BTC/USD",
          price: 50000 + i,
          timestamp: now - i * 10, // Spread over time
          source: "binance",
          confidence: 0.9,
        };
        await service.addHistoricalData(mockFeedId, update);
      }

      const historicalData = service.getHistoricalData(mockFeedId);

      // Should limit memory usage by capping historical data size
      expect(historicalData.length).toBeLessThanOrEqual(100);
    });
  });
});
