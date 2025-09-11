import { Injectable } from "@nestjs/common";
import { EventDrivenService } from "@/common/base/composed.service";
import type { AccuracyMetrics, QualityScore, ConsensusData, ThresholdsConfig } from "@/common/types/monitoring";
import type { AggregatedPrice } from "@/common/types/services";
import type { AccuracyAlertData } from "@/common/types/monitoring";

@Injectable()
export class AccuracyMonitorService extends EventDrivenService {
  private accuracyHistory: Map<string, AccuracyMetrics[]> = new Map();
  private qualityScores: Map<string, QualityScore> = new Map();
  private consensusData: Map<string, ConsensusData> = new Map();

  constructor(config: ThresholdsConfig) {
    super({ ...config, useEnhancedLogging: true });
  }

  // Accuracy thresholds with adaptive adjustment
  private get thresholds(): ThresholdsConfig {
    return this.config as ThresholdsConfig;
  }

  public override async initialize(): Promise<void> {
    this.logInitialization("Accuracy monitoring service initialized");
  }

  /**
   * Track consensus deviation for a feed value
   * Requirement 4.2: Monitor consensus deviation for 0.5% requirement
   */
  trackConsensusDeviation(
    feedId: string,
    actualValue: number,
    consensusMedian: number,
    votingRound?: number
  ): AccuracyMetrics {
    const deviation = Math.abs((actualValue - consensusMedian) / consensusMedian) * 100;
    const isWithinThreshold = deviation <= this.thresholds.accuracy.maxConsensusDeviation;

    // Update accuracy rate calculation
    const currentRate = this.calculateAccuracyRate(feedId, isWithinThreshold);

    // Calculate quality score
    const qualityScore = this.calculateQualityScore(feedId, deviation, currentRate);

    const metrics: AccuracyMetrics = {
      // Fields required by AccuracyMetrics
      deviation, // simple mapping to overall deviation
      consensusAlignment: Math.max(0, 100 - deviation),
      outlierCount: 0,
      qualityScore: qualityScore.overall,
      consensusDeviation: deviation,
      accuracyRate: currentRate,
      feedId,
      timestamp: Date.now(),
      votingRound,
    };

    // Store metrics history
    this.storeAccuracyMetrics(feedId, metrics);

    // Update consensus data
    this.consensusData.set(feedId, {
      median: consensusMedian,
      mean: consensusMedian,
      standardDeviation: 0,
      participantCount: 1,
      consensusReached: true,
      deviation,
      sourceCount: 1, // optional
    });

    // Record metrics using monitoring mixin
    this.recordMetric(`${feedId}_consensus_deviation`, deviation);
    this.recordMetric(`${feedId}_accuracy_rate`, currentRate);

    // Track accuracy counters
    if (isWithinThreshold) {
      this.incrementCounter("accurate_measurements");
    } else {
      this.incrementCounter("inaccurate_measurements");
    }

    // Log accuracy issues
    if (deviation > this.thresholds.accuracy.maxConsensusDeviation) {
      this.logger.warn(
        `Consensus deviation exceeded threshold for ${feedId}: ${deviation.toFixed(4)}% > ${this.thresholds.accuracy.maxConsensusDeviation}%`
      );
    }

    return metrics;
  }

  /**
   * Calculate accuracy rate (percentage within consensus threshold)
   * Requirement 4.3: Target 80% accuracy rate within consensus
   */
  private calculateAccuracyRate(feedId: string, isCurrentWithinThreshold: boolean): number {
    const history = this.accuracyHistory.get(feedId) || [];

    // Add current measurement to calculation
    const recentMeasurements = history.slice(-100); // Last 100 measurements
    const withinThresholdCount =
      recentMeasurements.filter(m => m.consensusDeviation <= this.thresholds.accuracy.maxConsensusDeviation).length +
      (isCurrentWithinThreshold ? 1 : 0);

    const totalCount = recentMeasurements.length + 1;
    return (withinThresholdCount / totalCount) * 100;
  }

  /**
   * Calculate comprehensive quality score
   * Requirement 2.6: Quality score calculation and tracking
   */
  calculateQualityScore(
    feedId: string,
    consensusDeviation: number,
    _accuracyRate: number,
    additionalMetrics?: {
      latency?: number;
      sourceCount?: number;
      uptime?: number;
    }
  ): QualityScore {
    // Accuracy component (0-100, higher is better)
    const maxDeviation = this.thresholds.accuracy.maxConsensusDeviation;
    const accuracy = Math.max(0, 100 - (consensusDeviation / maxDeviation) * 100);

    // Latency component (0-100, lower latency is better)
    const latency = additionalMetrics?.latency
      ? Math.max(0, 100 - (additionalMetrics.latency / this.thresholds.performance.maxResponseLatency) * 100)
      : 100;

    // Coverage component (0-100, more sources is better)
    const coverage = additionalMetrics?.sourceCount
      ? Math.min(100, (additionalMetrics.sourceCount / 5) * 100) // Assume 5 sources is optimal
      : 100;

    // Reliability component (0-100, higher uptime is better)
    const reliability = additionalMetrics?.uptime ? Math.min(100, additionalMetrics.uptime) : 100;

    // Weighted overall score
    const weights = { accuracy: 0.4, latency: 0.2, coverage: 0.2, reliability: 0.2 };
    const overall =
      accuracy * weights.accuracy +
      latency * weights.latency +
      coverage * weights.coverage +
      reliability * weights.reliability;

    const qualityScore: QualityScore = {
      overall,
      accuracy,
      timeliness: latency, // map latency metric to timeliness score
      completeness: coverage, // use coverage as completeness proxy
      consistency: reliability, // simple mapping
      latency,
      coverage,
      reliability,
    };

    this.qualityScores.set(feedId, qualityScore);
    return qualityScore;
  }

  /**
   * Get current accuracy metrics for a feed
   */
  getAccuracyMetrics(feedId: string): AccuracyMetrics | null {
    const history = this.accuracyHistory.get(feedId);
    return history && history.length > 0 ? history[history.length - 1] : null;
  }

  /**
   * Get quality score for a feed
   */
  getQualityScore(feedId: string): QualityScore | null {
    return this.qualityScores.get(feedId) || null;
  }

  /**
   * Get accuracy history for a feed
   */
  getAccuracyHistory(feedId: string, limit: number = 100): AccuracyMetrics[] {
    const history = this.accuracyHistory.get(feedId) || [];
    return history.slice(-limit);
  }

  /**
   * Get overall system accuracy statistics
   */
  getSystemAccuracyStats(): {
    averageDeviation: number;
    averageAccuracyRate: number;
    averageQualityScore: number;
    feedsWithinThreshold: number;
    totalFeeds: number;
  } {
    const allMetrics = Array.from(this.accuracyHistory.values()).flat();

    if (allMetrics.length === 0) {
      return {
        averageDeviation: 0,
        averageAccuracyRate: 0,
        averageQualityScore: 0,
        feedsWithinThreshold: 0,
        totalFeeds: 0,
      };
    }

    const recentMetrics = allMetrics.filter(
      m => Date.now() - m.timestamp < 300000 // Last 5 minutes
    );

    const averageDeviation = recentMetrics.reduce((sum, m) => sum + m.consensusDeviation, 0) / recentMetrics.length;
    const averageAccuracyRate = recentMetrics.reduce((sum, m) => sum + m.accuracyRate, 0) / recentMetrics.length;
    const averageQualityScore = recentMetrics.reduce((sum, m) => sum + m.qualityScore, 0) / recentMetrics.length;

    const feedsWithinThreshold = Array.from(this.accuracyHistory.keys()).filter(feedId => {
      const latest = this.getAccuracyMetrics(feedId);
      return latest && latest.consensusDeviation <= this.thresholds.accuracy.maxConsensusDeviation;
    }).length;

    return {
      averageDeviation,
      averageAccuracyRate,
      averageQualityScore,
      feedsWithinThreshold,
      totalFeeds: this.accuracyHistory.size,
    };
  }

  /**
   * Store accuracy metrics with history management
   */
  private storeAccuracyMetrics(feedId: string, metrics: AccuracyMetrics): void {
    const history = this.accuracyHistory.get(feedId) || [];
    history.push(metrics);

    // Keep only last 1000 entries per feed
    if (history.length > 1000) {
      history.splice(0, history.length - 1000);
    }

    this.accuracyHistory.set(feedId, history);
  }

  /**
   * Check if accuracy thresholds are met
   */
  checkAccuracyThresholds(feedId: string): {
    consensusDeviationOk: boolean;
    accuracyRateOk: boolean;
    qualityScoreOk: boolean;
    overallOk: boolean;
  } {
    const metrics = this.getAccuracyMetrics(feedId);

    if (!metrics) {
      return {
        consensusDeviationOk: false,
        accuracyRateOk: false,
        qualityScoreOk: false,
        overallOk: false,
      };
    }

    const consensusDeviationOk = metrics.consensusDeviation <= this.thresholds.accuracy.maxConsensusDeviation;
    const accuracyRateOk = metrics.accuracyRate >= this.thresholds.accuracy.minAccuracyRate;
    const qualityScoreOk = metrics.qualityScore >= this.thresholds.accuracy.minQualityScore;

    return {
      consensusDeviationOk,
      accuracyRateOk,
      qualityScoreOk,
      overallOk: consensusDeviationOk && accuracyRateOk && qualityScoreOk,
    };
  }

  /**
   * Reset metrics for a feed (useful for testing)
   */
  resetMetrics(feedId?: string): void {
    if (feedId) {
      this.accuracyHistory.delete(feedId);
      this.qualityScores.delete(feedId);
      this.consensusData.delete(feedId);
    } else {
      this.accuracyHistory.clear();
      this.qualityScores.clear();
      this.consensusData.clear();
    }
  }

  /**
   * Record aggregated price for accuracy monitoring
   */
  recordPrice(aggregatedPrice: AggregatedPrice): void {
    try {
      const feedId = aggregatedPrice.symbol || "unknown";

      // For now, we'll use a mock consensus median since we don't have historical data
      // In a real implementation, this would compare against actual consensus
      const mockConsensusMedian = aggregatedPrice.price * (1 + (Math.random() - 0.5) * 0.01); // ±0.5% variation

      const metrics = this.trackConsensusDeviation(
        feedId,
        aggregatedPrice.price,
        mockConsensusMedian,
        aggregatedPrice.votingRound
      );

      // Check if we should emit an accuracy alert
      if (metrics.consensusDeviation > this.thresholds.accuracy.maxConsensusDeviation) {
        const alert: AccuracyAlertData = {
          feedId,
          deviation: metrics.consensusDeviation,
          threshold: this.thresholds.accuracy.maxConsensusDeviation,
        };

        this.emit("accuracyAlert", alert);
      }

      this.logger.debug(`Recorded price for accuracy monitoring: ${feedId} = ${aggregatedPrice.price}`);
    } catch (error) {
      this.logger.error("Error recording price for accuracy monitoring:", error);
    }
  }

  /**
   * Emit accuracy alert event
   */
  override emit(event: "accuracyAlert", alert: AccuracyAlertData): boolean;
  override emit(event: string | symbol, ...args: unknown[]): boolean {
    return super.emit(event, ...args);
  }

  /**
   * Listen for accuracy alert events
   */
  onAccuracyAlert(callback: (...args: unknown[]) => void): this {
    return this.on("accuracyAlert", callback);
  }

  public override async cleanup(): Promise<void> {
    this.logShutdown("Stopping accuracy monitoring service...");

    // Clear all monitoring data
    this.accuracyHistory.clear();
    this.qualityScores.clear();
    this.consensusData.clear();

    // Remove all event listeners
    this.removeAllListeners();
  }
}
