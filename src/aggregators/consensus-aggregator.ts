import { Injectable } from "@nestjs/common";
import { BaseService } from "@/common/base/base.service";
import type { EnhancedFeedId, PriceUpdate } from "@/common/types/core";
import type { AggregatedPrice, QualityMetrics, PriceAggregator, AggregationConfig } from "@/common/types/services";
import type { DataValidatorConfig } from "@/common/types/data-manager";

export enum ExchangeTier {
  CUSTOM_ADAPTER = 1, // Top exchanges with custom adapters
  CCXT_INDIVIDUAL = 2, // CCXT exchanges returning individual prices
}

export interface ExchangePriceData {
  exchange: string;
  price: number;
  timestamp: number;
  confidence: number;
  volume?: number;
  tier: ExchangeTier;
  weight: number;
}

export interface WeightedPricePoint {
  price: number;
  weight: number;
  exchange: string;
  staleness: number;
  tier: ExchangeTier;
  confidence: number;
}

export interface ConsensusAggregatorConfig extends AggregationConfig {
  lambda: number; // Exponential decay parameter (default: 0.00005)
  tierWeights: Record<ExchangeTier, number>; // Weight multipliers by tier
  consensusThreshold: number; // Minimum consensus score (0.0-1.0)
  maxStalenessMs: number; // Maximum age for price data (default: 2000ms)
}

@Injectable()
export class ConsensusAggregator extends BaseService implements PriceAggregator {
  private readonly defaultConfig: ConsensusAggregatorConfig = {
    enabled: true,
    method: "consensus_optimized",
    timeDecayFactor: 0.00005, // LAMBDA parameter from existing CCXT implementation
    lambda: 0.00005,
    minSources: 3,
    maxStaleness: 2000, // 2 seconds
    maxDeviation: 0.1,
    timeout: 2000,
    maxStalenessMs: 2000,
    tierWeights: {
      [ExchangeTier.CUSTOM_ADAPTER]: 1.2, // 20% bonus for custom adapters
      [ExchangeTier.CCXT_INDIVIDUAL]: 1.0, // Base weight for CCXT exchanges
    },
    consensusThreshold: 0.7, // 70% consensus alignment required
  };

  private config: ConsensusAggregatorConfig;
  private DataValidatorConfig: DataValidatorConfig = {
    consensusWeight: 0.3, // 30% weight for consensus alignment
    crossSourceWindow: 3,
    enableBatchValidation: true,
    enableRealTimeValidation: true,
    historicalDataWindow: 50,
    maxAge: 2000, // 2 seconds
    maxBatchSize: 100,
    outlierThreshold: 0.1, // 10% deviation threshold
    priceRange: { min: 0.000001, max: 1000000 }, // Reasonable price range
    validationCacheSize: 1000,
    validationCacheTTL: 5000,
    validationTimeout: 1000,
  };

  constructor() {
    super("ConsensusAggregator");
    this.config = { ...this.defaultConfig };
  }

  /**
   * Aggregate prices from multiple sources using consensus-optimized weighted median
   * Adapts existing CCXT weighted median algorithm for all price sources
   */
  async aggregate(feedId: EnhancedFeedId, updates: PriceUpdate[]): Promise<AggregatedPrice> {
    if (updates.length === 0) {
      throw new Error(`No price updates available for feed ${feedId.name}`);
    }

    // Convert PriceUpdate[] to ExchangePriceData[] with tier information
    const exchangePrices = this.convertToExchangePriceData(updates);

    // Validate and filter price data
    const validPrices = this.validateAndFilterPrices(exchangePrices);

    if (validPrices.length < this.config.minSources) {
      this.logger.warn(
        `Insufficient valid sources for ${feedId.name}: ${validPrices.length} < ${this.config.minSources}`
      );
    }

    if (validPrices.length === 0) {
      throw new Error(`No valid price data available for feed ${feedId.name}`);
    }

    // Calculate unified weighted median using time-weighted decay
    const weightedMedian = this.calculateUnifiedWeightedMedian(validPrices);

    // Calculate consensus alignment score
    const consensusScore = this.calculateConsensusScore(validPrices, weightedMedian);

    // Calculate overall confidence
    const confidence = this.calculateAggregatedConfidence(validPrices, consensusScore);

    const result: AggregatedPrice = {
      symbol: feedId.name,
      price: weightedMedian,
      timestamp: Date.now(),
      sources: validPrices.map(p => p.exchange),
      confidence,
      consensusScore,
    };

    this.logger.debug(
      `Aggregated price for ${feedId.name}: ${weightedMedian} from ${validPrices.length} sources, consensus: ${consensusScore.toFixed(3)}`
    );

    return result;
  }

  /**
   * Implement unified weighted median calculation with exponential decay
   * Adapts existing CCXT algorithm for all price sources (custom + CCXT individual)
   */
  private calculateUnifiedWeightedMedian(prices: ExchangePriceData[]): number {
    if (prices.length === 0) {
      throw new Error("Price list cannot be empty");
    }

    // Sort by timestamp for time-weighted calculation
    prices.sort((a, b) => a.timestamp - b.timestamp);

    const now = Date.now();

    // Calculate time-weighted values with exponential decay (LAMBDA parameter)
    const weightedPrices: WeightedPricePoint[] = prices.map(data => {
      const timeDifference = now - data.timestamp;

      // Apply exponential time decay
      const timeWeight = Math.exp(-this.config.lambda * timeDifference);

      // Apply tier-based weight adjustment
      const tierWeight = this.config.tierWeights[data.tier] || 1.0;

      // Apply confidence-based weight adjustment
      const confidenceWeight = data.confidence;

      // Combine all weight factors
      const combinedWeight = timeWeight * tierWeight * confidenceWeight * data.weight;

      return {
        price: data.price,
        weight: combinedWeight,
        exchange: data.exchange,
        staleness: timeDifference,
        tier: data.tier,
        confidence: data.confidence,
      };
    });

    // Normalize weights to sum to 1
    const totalWeight = weightedPrices.reduce((sum, wp) => sum + wp.weight, 0);

    if (totalWeight === 0) {
      // All prices extremely stale or low confidence, return simple median
      this.logger.warn("All weights are zero, falling back to simple median");
      const sortedPrices = prices.map(p => p.price).sort((a, b) => a - b);
      const mid = Math.floor(sortedPrices.length / 2);
      return sortedPrices.length % 2 === 0 ? (sortedPrices[mid - 1] + sortedPrices[mid]) / 2 : sortedPrices[mid];
    }

    const normalizedWeights = weightedPrices.map(wp => ({
      ...wp,
      weight: wp.weight / totalWeight,
    }));

    // Sort by price for median calculation
    normalizedWeights.sort((a, b) => a.price - b.price);

    this.logger.debug("Weighted prices for median calculation:");
    normalizedWeights.forEach(wp => {
      this.logger.debug(
        `Price: ${wp.price}, Weight: ${wp.weight.toFixed(4)}, Exchange: ${wp.exchange}, ` +
          `Staleness: ${wp.staleness}ms, Tier: ${wp.tier}, Confidence: ${wp.confidence.toFixed(3)}`
      );
    });

    // Find the weighted median
    let cumulativeWeight = 0;
    for (const weightedPrice of normalizedWeights) {
      cumulativeWeight += weightedPrice.weight;
      if (cumulativeWeight >= 0.5) {
        this.logger.debug(`Weighted median selected: ${weightedPrice.price} from ${weightedPrice.exchange}`);
        return weightedPrice.price;
      }
    }

    // Fallback (should not reach here with proper weights)
    this.logger.warn("Unable to calculate weighted median, using last price");
    return normalizedWeights[normalizedWeights.length - 1].price;
  }

  /**
   * Convert PriceUpdate array to ExchangePriceData with tier information
   */
  private convertToExchangePriceData(updates: PriceUpdate[]): ExchangePriceData[] {
    return updates.map(update => ({
      exchange: update.source,
      price: update.price,
      timestamp: update.timestamp,
      confidence: update.confidence,
      volume: update.volume,
      tier: this.determineTier(update.source),
      weight: this.calculateBaseWeight(update.source),
    }));
  }

  /**
   * Determine exchange tier based on source name
   */
  private determineTier(source: string): ExchangeTier {
    // Tier 1: Custom adapters for top exchanges
    const tier1Exchanges = ["binance", "coinbase", "kraken", "okx", "cryptocom"];

    if (tier1Exchanges.includes(source.toLowerCase())) {
      return ExchangeTier.CUSTOM_ADAPTER;
    }

    // Tier 2: CCXT individual exchanges
    return ExchangeTier.CCXT_INDIVIDUAL;
  }

  /**
   * Calculate base weight for exchange based on reliability and tier
   */
  private calculateBaseWeight(source: string): number {
    // Dynamic weight adjustment based on exchange tier and reliability
    const exchangeWeights: Record<string, number> = {
      // Tier 1 exchanges (custom adapters)
      binance: 0.25,
      coinbase: 0.25,
      kraken: 0.2,
      okx: 0.15,
      cryptocom: 0.15,

      // Tier 2 exchanges (CCXT individual) - lower base weights
      bitmart: 0.1,
      bybit: 0.1,
      gate: 0.08,
      kucoin: 0.08,
      probit: 0.06,
    };

    return exchangeWeights[source.toLowerCase()] || 0.05; // Default weight for unknown exchanges
  }

  /**
   * Validate and filter price data based on staleness and quality
   */
  private validateAndFilterPrices(prices: ExchangePriceData[]): ExchangePriceData[] {
    const now = Date.now();

    return prices.filter(price => {
      // Check staleness
      const age = now - price.timestamp;
      if (age > this.config.maxStalenessMs) {
        this.logger.debug(`Rejecting stale price from ${price.exchange}: ${age}ms old`);
        return false;
      }

      // Check price range
      if (
        price.price <= this.DataValidatorConfig.priceRange.min ||
        price.price >= this.DataValidatorConfig.priceRange.max
      ) {
        this.logger.debug(`Rejecting out-of-range price from ${price.exchange}: ${price.price}`);
        return false;
      }

      // Check confidence threshold
      if (price.confidence < 0.1) {
        // Minimum 10% confidence
        this.logger.debug(`Rejecting low-confidence price from ${price.exchange}: ${price.confidence}`);
        return false;
      }

      return true;
    });
  }

  /**
   * Calculate consensus alignment score for unified price calculations
   */
  private calculateConsensusScore(prices: ExchangePriceData[], medianPrice: number): number {
    if (prices.length === 0) return 0;

    // Calculate how well the median aligns with individual prices
    const deviations = prices.map(price => {
      const deviation = Math.abs(price.price - medianPrice) / medianPrice;
      return deviation;
    });

    // Weight deviations by exchange confidence and tier
    const weightedDeviations = deviations.map((deviation, index) => {
      const price = prices[index];
      const tierWeight = this.config.tierWeights[price.tier];
      const weight = price.confidence * tierWeight;
      return deviation * weight;
    });

    const totalWeight = prices.reduce((sum, price) => {
      const tierWeight = this.config.tierWeights[price.tier];
      return sum + price.confidence * tierWeight;
    }, 0);

    const avgWeightedDeviation =
      totalWeight > 0
        ? weightedDeviations.reduce((sum, dev) => sum + dev, 0) / totalWeight
        : deviations.reduce((sum, dev) => sum + dev, 0) / deviations.length;

    // Convert deviation to consensus score (lower deviation = higher consensus)
    const consensusScore = Math.max(0, 1 - avgWeightedDeviation / this.DataValidatorConfig.outlierThreshold);

    return Math.min(1, consensusScore);
  }

  /**
   * Calculate aggregated confidence based on source confidence and consensus
   */
  private calculateAggregatedConfidence(prices: ExchangePriceData[], consensusScore: number): number {
    if (prices.length === 0) return 0;

    // Calculate weighted average confidence
    const totalWeight = prices.reduce((sum, price) => sum + price.weight, 0);
    const weightedConfidence =
      totalWeight > 0
        ? prices.reduce((sum, price) => sum + price.confidence * price.weight, 0) / totalWeight
        : prices.reduce((sum, price) => sum + price.confidence, 0) / prices.length;

    // Combine source confidence with consensus alignment
    const combinedConfidence =
      weightedConfidence * (1 - this.DataValidatorConfig.consensusWeight) +
      consensusScore * this.DataValidatorConfig.consensusWeight;

    // Apply source count bonus (more sources = higher confidence)
    const sourceCountBonus = Math.min(0.2, prices.length * 0.05); // Max 20% bonus

    return Math.min(1, combinedConfidence + sourceCountBonus);
  }

  /**
   * Validate individual price update
   */
  validateUpdate(update: PriceUpdate): boolean {
    const now = Date.now();
    const age = now - update.timestamp;

    // Check staleness
    if (age > this.DataValidatorConfig.maxAge) {
      return false;
    }

    // Check price validity
    if (!update.price || update.price <= 0 || !isFinite(update.price)) {
      return false;
    }

    // Check confidence
    if (update.confidence < 0 || update.confidence > 1) {
      return false;
    }

    return true;
  }

  /**
   * Get quality metrics for aggregated price
   */
  async getQualityMetrics(_feedId: EnhancedFeedId): Promise<QualityMetrics> {
    // This would typically be implemented with historical data tracking
    // For now, return basic metrics structure
    return {
      accuracy: 0.95, // Placeholder - would be calculated from historical consensus alignment
      latency: 500, // Placeholder - would be measured from actual data freshness
      coverage: 0.8, // Placeholder - would be calculated from active sources
      reliability: 0.9, // Placeholder - would be calculated from uptime metrics
      consensusAlignment: 0.85, // Placeholder - would be calculated from recent consensus scores
    };
  }

  /**
   * Update aggregator configuration
   */
  updateConfig(config: Partial<ConsensusAggregatorConfig>): void {
    this.config = { ...this.config, ...config };
    this.logger.log(`Updated aggregator configuration: ${JSON.stringify(config)}`);
  }

  /**
   * Get current configuration
   */
  getConfig(): ConsensusAggregatorConfig {
    return { ...this.config };
  }
}
