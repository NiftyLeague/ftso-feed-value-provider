import { FeedCategory, EnhancedFeedId, PriceUpdate } from "@/common/types/core";
import { AggregatedPrice } from "@/common/types/services";
import { ValidationContext, DataValidatorResult } from "@/common/types/data-manager";
import { FeedId } from "@/common/types/http";

/**
 * Builder pattern for creating test data objects
 */
export class TestDataBuilder {
  /**
   * Create a valid EnhancedFeedId for testing
   */
  static createFeedId(overrides: Partial<EnhancedFeedId> = {}): EnhancedFeedId {
    return {
      category: FeedCategory.Crypto,
      name: "BTC/USD",
      ...overrides,
    };
  }

  /**
   * Create a valid FeedId for HTTP API testing (with numeric category)
   */
  static createHttpFeedId(overrides: Partial<FeedId> = {}): FeedId {
    return {
      category: 1, // FeedCategory.Crypto as number
      name: "BTC/USD",
      ...overrides,
    };
  }

  /**
   * Create a valid PriceUpdate for testing
   */
  static createPriceUpdate(overrides: Partial<PriceUpdate> = {}): PriceUpdate {
    return {
      symbol: "BTC/USD",
      price: 50000,
      timestamp: Date.now(),
      source: "binance",
      volume: 1000,
      confidence: 0.95,
      ...overrides,
    };
  }

  /**
   * Create multiple PriceUpdates with different sources
   */
  static createPriceUpdates(count: number, basePrice: number = 50000): PriceUpdate[] {
    const sources = ["binance", "coinbase", "kraken", "okx", "cryptocom"];
    return Array.from({ length: count }, (_, index) => ({
      symbol: "BTC/USD",
      price: basePrice + (Math.random() - 0.5) * 100, // Add some variance
      timestamp: Date.now() + index * 1000,
      source: sources[index % sources.length],
      volume: 1000 + Math.random() * 500,
      confidence: 0.9 + Math.random() * 0.1, // 0.9 to 1.0
    }));
  }

  /**
   * Create a valid AggregatedPrice for testing
   */
  static createAggregatedPrice(overrides: Partial<AggregatedPrice> = {}): AggregatedPrice {
    return {
      symbol: "BTC/USD",
      price: 50000,
      timestamp: Date.now(),
      sources: ["binance"],
      confidence: 0.95,
      consensusScore: 0.85,
      ...overrides,
    };
  }

  /**
   * Create a ValidationContext for testing
   */
  static createValidationContext(overrides: Partial<ValidationContext> = {}): ValidationContext {
    return {
      feedId: this.createFeedId(),
      timestamp: Date.now(),
      source: "binance",
      ...overrides,
    };
  }

  /**
   * Create a DataValidatorResult for testing
   */
  static createValidatorResult(overrides: Partial<DataValidatorResult> = {}): DataValidatorResult {
    return {
      isValid: true,
      errors: [],
      warnings: [],
      timestamp: Date.now(),
      ...overrides,
    };
  }

  /**
   * Create mock WebSocket message data
   */
  static createWebSocketMessage(type: string, data: unknown) {
    return {
      id: Math.random().toString(36).substr(2, 9),
      method: type,
      params: data,
      timestamp: Date.now(),
    };
  }

  /**
   * Create mock HTTP response data
   */
  static createHttpResponse<T>(data: T, status: number = 200) {
    return {
      data,
      status,
      statusText: status === 200 ? "OK" : "Error",
      headers: {} as Record<string, string>,
      config: {} as Record<string, unknown>,
    };
  }

  /**
   * Create mock error objects
   */
  static createError(message: string, code?: string, statusCode?: number): Error {
    const error = new Error(message) as Error & { code?: string; statusCode?: number };
    if (code) error.code = code;
    if (statusCode) error.statusCode = statusCode;
    return error;
  }
}

/**
 * Utility functions for common test scenarios
 */
export class TestScenarios {
  /**
   * Create a scenario with multiple price sources
   */
  static multiSourcePricing(feedId: EnhancedFeedId, sourceCount: number = 5) {
    const updates = TestDataBuilder.createPriceUpdates(sourceCount);
    const context = TestDataBuilder.createValidationContext({ feedId });
    return { feedId, updates, context };
  }

  /**
   * Create a scenario with validation errors
   */
  static validationErrors(feedId: EnhancedFeedId) {
    const invalidUpdate = TestDataBuilder.createPriceUpdate({
      price: -1, // Invalid negative price
      timestamp: Date.now() - 3600000, // Old timestamp
    });
    const context = TestDataBuilder.createValidationContext({ feedId });
    const result = TestDataBuilder.createValidatorResult({
      isValid: false,
      errors: [],
      warnings: ["Invalid price", "Stale data"],
    });
    return { feedId, update: invalidUpdate, context, result };
  }

  /**
   * Create a scenario with network failures
   */
  static networkFailure(exchangeName: string) {
    const error = TestDataBuilder.createError(`Network timeout for ${exchangeName}`, "NETWORK_TIMEOUT", 408);
    return { exchangeName, error };
  }
}
