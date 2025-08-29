import { Injectable, Logger } from "@nestjs/common";
import { EventEmitter } from "events";
import { EnhancedLoggerService, LogContext } from "@/utils/enhanced-logger.service";
import { EnhancedFeedId } from "@/types";
import { FeedCategory } from "@/types/feed-category.enum";
import { PriceUpdate } from "@/interfaces";
import { CircuitBreakerService } from "./circuit-breaker.service";
import { ConnectionRecoveryService } from "./connection-recovery.service";
import { CcxtMultiExchangeAdapter, ExchangePriceData } from "@/adapters/crypto/ccxt.adapter";

export enum DataSourceTier {
  TIER_1_CUSTOM = 1, // Custom adapters (Binance, Coinbase, Kraken, OKX, Crypto.com)
  TIER_2_CCXT = 2, // CCXT individual exchanges (Bitmart, Bybit, Gate, Kucoin, etc.)
}

export enum ErrorClassification {
  CONNECTION_ERROR = "connection_error",
  DATA_VALIDATION_ERROR = "data_validation_error",
  TIMEOUT_ERROR = "timeout_error",
  RATE_LIMIT_ERROR = "rate_limit_error",
  AUTHENTICATION_ERROR = "authentication_error",
  EXCHANGE_ERROR = "exchange_error",
  PARSING_ERROR = "parsing_error",
  STALE_DATA_ERROR = "stale_data_error",
}

export interface DataSourceError {
  sourceId: string;
  tier: DataSourceTier;
  classification: ErrorClassification;
  error: Error;
  timestamp: number;
  feedId?: EnhancedFeedId;
  severity: "low" | "medium" | "high" | "critical";
  recoverable: boolean;
}

export interface ErrorResponse {
  strategy: "retry" | "failover" | "ccxt_backup" | "tier_fallback" | "graceful_degradation";
  action: string;
  estimatedRecoveryTime: number;
  fallbackSources: string[];
  degradationLevel: "none" | "partial" | "severe";
}

export interface HybridErrorStats {
  tier1Errors: number;
  tier2Errors: number;
  totalErrors: number;
  errorsByClassification: Record<ErrorClassification, number>;
  recoveryAttempts: number;
  successfulRecoveries: number;
  failoverEvents: number;
  ccxtBackupActivations: number;
}

export interface TierFailoverConfig {
  tier1ToTier2Delay: number; // Delay before falling back to Tier 2 (ms)
  tier2ToCcxtDelay: number; // Delay before using CCXT backup (ms)
  maxTier1Failures: number; // Max failures before tier failover
  maxTier2Failures: number; // Max failures before CCXT backup
  recoveryCheckInterval: number; // How often to check for recovery (ms)
}

@Injectable()
export class HybridErrorHandlerService extends EventEmitter {
  private readonly logger = new Logger(HybridErrorHandlerService.name);
  private readonly enhancedLogger = new EnhancedLoggerService("HybridErrorHandler");

  private errorHistory = new Map<string, DataSourceError[]>();
  private tierStatus = new Map<string, { tier: DataSourceTier; isHealthy: boolean; lastError?: number }>();
  private ccxtBackupActive = new Map<string, boolean>(); // feedId -> backup active
  private recoveryTimers = new Map<string, NodeJS.Timeout>();

  private stats: HybridErrorStats = {
    tier1Errors: 0,
    tier2Errors: 0,
    totalErrors: 0,
    errorsByClassification: {} as Record<ErrorClassification, number>,
    recoveryAttempts: 0,
    successfulRecoveries: 0,
    failoverEvents: 0,
    ccxtBackupActivations: 0,
  };

  private readonly defaultConfig: TierFailoverConfig = {
    tier1ToTier2Delay: 50, // 50ms for FTSO requirements
    tier2ToCcxtDelay: 100, // 100ms total failover time
    maxTier1Failures: 3,
    maxTier2Failures: 5,
    recoveryCheckInterval: 30000, // 30 seconds
  };

  private config: TierFailoverConfig;

  constructor(
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly connectionRecovery: ConnectionRecoveryService,
    private readonly ccxtAdapter: CcxtMultiExchangeAdapter
  ) {
    super();
    this.config = { ...this.defaultConfig };
    this.initializeErrorClassifications();
    this.startRecoveryMonitoring();
  }

  /**
   * Handle error from custom adapter (Tier 1) with CCXT exchange backup (Requirement 7.3)
   */
  async handleCustomAdapterError(
    sourceId: string,
    error: Error,
    feedId: EnhancedFeedId,
    context?: any
  ): Promise<ErrorResponse> {
    const operationId = `handle_tier1_error_${sourceId}_${Date.now()}`;
    this.enhancedLogger.startPerformanceTimer(operationId, "handle_custom_adapter_error", "HybridErrorHandler", {
      sourceId,
      feedId: feedId.name,
      errorType: error.constructor.name,
    });

    const classification = this.classifyError(error, context);

    // Create initial error record
    const dataSourceError: DataSourceError = {
      sourceId,
      tier: DataSourceTier.TIER_1_CUSTOM,
      classification,
      error,
      timestamp: Date.now(),
      feedId,
      severity: "low", // Will be updated after recording
      recoverable: this.isRecoverable(classification),
    };

    try {
      // Enhanced error logging with detailed context
      this.enhancedLogger.error(error, {
        component: "HybridErrorHandler",
        operation: "handle_custom_adapter_error",
        sourceId,
        feedId: feedId.name,
        errorType: classification,
        severity: "high",
        metadata: {
          tier: "TIER_1_CUSTOM",
          classification,
          recoverable: dataSourceError.recoverable,
          context,
        },
      });

      // Record error first
      this.recordError(dataSourceError);

      // Now determine severity based on updated history
      dataSourceError.severity = this.determineSeverity(classification, sourceId);

      // Update the recorded error with correct severity
      const history = this.errorHistory.get(sourceId) || [];
      if (history.length > 0) {
        history[history.length - 1].severity = dataSourceError.severity;
      }

      // Log error classification and severity determination
      this.enhancedLogger.log(`Error classified and severity determined`, {
        component: "HybridErrorHandler",
        operation: "error_classification",
        sourceId,
        feedId: feedId.name,
        metadata: {
          classification,
          severity: dataSourceError.severity,
          recoverable: dataSourceError.recoverable,
          errorHistoryCount: history.length,
        },
      });

      // Determine response strategy
      const response = await this.determineErrorResponse(dataSourceError);

      // Log the chosen response strategy
      this.enhancedLogger.log(`Error response strategy determined`, {
        component: "HybridErrorHandler",
        operation: "response_strategy",
        sourceId,
        feedId: feedId.name,
        metadata: {
          strategy: response.strategy,
          action: response.action,
          estimatedRecoveryTime: response.estimatedRecoveryTime,
          fallbackSources: response.fallbackSources.length,
          degradationLevel: response.degradationLevel,
        },
      });

      // Execute response strategy
      await this.executeErrorResponse(response, dataSourceError);

      // Log successful error handling
      this.enhancedLogger.logErrorRecovery(sourceId, classification, response.strategy, true, {
        feedId: feedId.name,
        tier: "TIER_1_CUSTOM",
        responseAction: response.action,
        fallbackSourceCount: response.fallbackSources.length,
      });

      this.enhancedLogger.endPerformanceTimer(operationId, true, {
        strategy: response.strategy,
        severity: dataSourceError.severity,
        recoverable: dataSourceError.recoverable,
      });

      this.emit("tier1ErrorHandled", sourceId, dataSourceError, response);
      return response;
    } catch (handlingError) {
      this.enhancedLogger.error(handlingError, {
        component: "HybridErrorHandler",
        operation: "handle_custom_adapter_error",
        sourceId,
        feedId: feedId.name,
        severity: "critical",
        metadata: {
          originalError: error.message,
          originalClassification: classification,
        },
      });

      this.enhancedLogger.endPerformanceTimer(operationId, false, {
        error: handlingError.message,
        originalError: error.message,
      });

      throw handlingError;
    }
  }

  /**
   * Handle error from CCXT individual exchange (Tier 2) (Requirement 7.5)
   */
  async handleCcxtExchangeError(
    exchangeId: string,
    error: Error,
    feedId: EnhancedFeedId,
    context?: any
  ): Promise<ErrorResponse> {
    const startTime = Date.now();
    this.logger.warn(`Handling Tier 2 CCXT exchange error for ${exchangeId}:`, error.message);

    const classification = this.classifyError(error, context);

    // Create initial error record
    const dataSourceError: DataSourceError = {
      sourceId: exchangeId,
      tier: DataSourceTier.TIER_2_CCXT,
      classification,
      error,
      timestamp: Date.now(),
      feedId,
      severity: "low", // Will be updated after recording
      recoverable: this.isRecoverable(classification),
    };

    // Record error first
    this.recordError(dataSourceError);

    // Now determine severity based on updated history
    dataSourceError.severity = this.determineSeverity(classification, exchangeId);

    // Update the recorded error with correct severity
    const history = this.errorHistory.get(exchangeId) || [];
    if (history.length > 0) {
      history[history.length - 1].severity = dataSourceError.severity;
    }

    // Determine response strategy (different for Tier 2)
    const response = await this.determineTier2ErrorResponse(dataSourceError);

    // Execute response strategy
    await this.executeErrorResponse(response, dataSourceError);

    const responseTime = Date.now() - startTime;
    this.logger.log(`Tier 2 error handling completed in ${responseTime}ms for ${exchangeId}`);

    this.emit("tier2ErrorHandled", exchangeId, dataSourceError, response);
    return response;
  }

  /**
   * Implement graceful degradation when custom adapters fail (fallback to CCXT for same exchanges)
   */
  async implementTierFailover(feedId: EnhancedFeedId, failedTier1Sources: string[]): Promise<ErrorResponse> {
    const startTime = Date.now();
    this.logger.warn(`Implementing tier failover for ${feedId.name}: failed sources ${failedTier1Sources.join(", ")}`);

    try {
      // Check if CCXT can provide backup data for the same exchanges
      const ccxtBackupSources = await this.getCcxtBackupSources(feedId, failedTier1Sources);

      if (ccxtBackupSources.length === 0) {
        // No CCXT backup available, implement graceful degradation
        return await this.implementGracefulDegradation(feedId, failedTier1Sources);
      }

      // Activate CCXT backup for failed Tier 1 sources
      await this.activateCcxtBackup(feedId, failedTier1Sources, ccxtBackupSources);

      const failoverTime = Date.now() - startTime;
      this.stats.failoverEvents++;

      const response: ErrorResponse = {
        strategy: "ccxt_backup",
        action: `Activated CCXT backup for ${failedTier1Sources.length} failed Tier 1 sources`,
        estimatedRecoveryTime: failoverTime,
        fallbackSources: ccxtBackupSources,
        degradationLevel: "none",
      };

      this.logger.log(`Tier failover completed in ${failoverTime}ms for ${feedId.name}`);
      this.emit("tierFailoverCompleted", feedId, response);

      return response;
    } catch (error) {
      this.logger.error(`Tier failover failed for ${feedId.name}:`, error);
      return await this.implementGracefulDegradation(feedId, failedTier1Sources);
    }
  }

  /**
   * Leverage existing CCXT retry logic for error recovery (Requirement 1.4)
   */
  async leverageCcxtRetryLogic(feedId: EnhancedFeedId, originalError: Error): Promise<PriceUpdate | null> {
    this.logger.log(`Leveraging CCXT retry logic for ${feedId.name} after error: ${originalError.message}`);

    try {
      // Use CCXT's built-in retry mechanism
      const priceUpdate = await this.ccxtAdapter.getCcxtPrice(feedId);

      this.logger.log(`CCXT retry successful for ${feedId.name}: ${priceUpdate.price}`);
      this.stats.successfulRecoveries++;

      return priceUpdate;
    } catch (ccxtError) {
      this.logger.error(`CCXT retry failed for ${feedId.name}:`, ccxtError);
      return null;
    }
  }

  /**
   * Get comprehensive error response strategies (Requirement 7.3)
   */
  async getErrorResponseStrategies(sourceId: string, feedId: EnhancedFeedId, error: Error): Promise<ErrorResponse[]> {
    const classification = this.classifyError(error);
    const tier = this.getTierForSource(sourceId);
    const strategies: ErrorResponse[] = [];

    // Strategy 1: Immediate retry with exponential backoff
    if (this.isRecoverable(classification)) {
      strategies.push({
        strategy: "retry",
        action: "Retry with exponential backoff",
        estimatedRecoveryTime: this.calculateRetryDelay(sourceId),
        fallbackSources: [],
        degradationLevel: "none",
      });
    }

    // Strategy 2: Failover to other sources in same tier
    const sameTierSources = await this.getSameTierHealthySources(feedId, tier, sourceId);
    if (sameTierSources.length > 0) {
      strategies.push({
        strategy: "failover",
        action: `Failover to ${sameTierSources.length} healthy sources in same tier`,
        estimatedRecoveryTime: this.config.tier1ToTier2Delay,
        fallbackSources: sameTierSources,
        degradationLevel: "none",
      });
    }

    // Strategy 3: Tier fallback (Tier 1 -> Tier 2, Tier 2 -> CCXT backup)
    if (tier === DataSourceTier.TIER_1_CUSTOM) {
      const tier2Sources = await this.getTier2Sources(feedId);
      if (tier2Sources.length > 0) {
        strategies.push({
          strategy: "tier_fallback",
          action: `Fallback to ${tier2Sources.length} Tier 2 sources`,
          estimatedRecoveryTime: this.config.tier1ToTier2Delay,
          fallbackSources: tier2Sources,
          degradationLevel: "partial",
        });
      }

      // CCXT backup for same exchange
      const ccxtBackup = await this.getCcxtBackupSources(feedId, [sourceId]);
      if (ccxtBackup.length > 0) {
        strategies.push({
          strategy: "ccxt_backup",
          action: `Use CCXT backup for same exchange`,
          estimatedRecoveryTime: this.config.tier2ToCcxtDelay,
          fallbackSources: ccxtBackup,
          degradationLevel: "partial",
        });
      }
    }

    // Strategy 4: Graceful degradation
    strategies.push({
      strategy: "graceful_degradation",
      action: "Continue with reduced quality requirements",
      estimatedRecoveryTime: 0,
      fallbackSources: [],
      degradationLevel: "severe",
    });

    return strategies;
  }

  /**
   * Get error statistics and metrics
   */
  getErrorStats(): HybridErrorStats {
    return { ...this.stats };
  }

  /**
   * Get error history for a source
   */
  getErrorHistory(sourceId: string): DataSourceError[] {
    return this.errorHistory.get(sourceId) || [];
  }

  /**
   * Get tier health status
   */
  getTierHealthStatus(): Map<string, { tier: DataSourceTier; isHealthy: boolean; lastError?: number }> {
    return new Map(this.tierStatus);
  }

  /**
   * Check if CCXT backup is active for a feed
   */
  isCcxtBackupActive(feedId: EnhancedFeedId): boolean {
    const feedKey = this.getFeedKey(feedId);
    return this.ccxtBackupActive.get(feedKey) || false;
  }

  /**
   * Reset error statistics
   */
  resetStats(): void {
    this.stats = {
      tier1Errors: 0,
      tier2Errors: 0,
      totalErrors: 0,
      errorsByClassification: {} as Record<ErrorClassification, number>,
      recoveryAttempts: 0,
      successfulRecoveries: 0,
      failoverEvents: 0,
      ccxtBackupActivations: 0,
    };
    this.initializeErrorClassifications();
  }

  // Private helper methods

  private classifyError(error: Error, context?: any): ErrorClassification {
    const message = (error?.message || error?.toString() || "unknown error").toLowerCase();

    if (message.includes("timeout") || message.includes("timed out")) {
      return ErrorClassification.TIMEOUT_ERROR;
    }

    if (
      message.includes("connection") ||
      message.includes("network") ||
      message.includes("econnrefused") ||
      message.includes("disconnected") ||
      message.includes("websocket")
    ) {
      return ErrorClassification.CONNECTION_ERROR;
    }

    if (message.includes("rate limit") || message.includes("too many requests")) {
      return ErrorClassification.RATE_LIMIT_ERROR;
    }

    if (message.includes("auth") || message.includes("unauthorized") || message.includes("forbidden")) {
      return ErrorClassification.AUTHENTICATION_ERROR;
    }

    if (message.includes("parse") || message.includes("json") || message.includes("invalid format")) {
      return ErrorClassification.PARSING_ERROR;
    }

    if (message.includes("stale") || message.includes("old data") || context?.dataAge > 2000) {
      return ErrorClassification.STALE_DATA_ERROR;
    }

    if (message.includes("validation") || message.includes("invalid data")) {
      return ErrorClassification.DATA_VALIDATION_ERROR;
    }

    return ErrorClassification.EXCHANGE_ERROR;
  }

  private determineSeverity(
    classification: ErrorClassification,
    sourceId: string
  ): "low" | "medium" | "high" | "critical" {
    const errorHistory = this.getErrorHistory(sourceId);
    const recentErrors = errorHistory.filter(e => Date.now() - e.timestamp < 300000); // Last 5 minutes

    // Base severity by classification
    let baseSeverity: "low" | "medium" | "high" | "critical";
    switch (classification) {
      case ErrorClassification.CONNECTION_ERROR:
      case ErrorClassification.TIMEOUT_ERROR:
        baseSeverity = "high";
        break;
      case ErrorClassification.AUTHENTICATION_ERROR:
        baseSeverity = "critical";
        break;
      case ErrorClassification.RATE_LIMIT_ERROR:
        baseSeverity = "medium";
        break;
      case ErrorClassification.STALE_DATA_ERROR:
      case ErrorClassification.DATA_VALIDATION_ERROR:
        baseSeverity = "medium";
        break;
      default:
        baseSeverity = "low";
    }

    // Escalate severity based on frequency
    if (recentErrors.length >= 5) {
      return "critical";
    } else if (recentErrors.length >= 3) {
      return baseSeverity === "low" ? "medium" : "high";
    }

    return baseSeverity;
  }

  private isRecoverable(classification: ErrorClassification): boolean {
    const nonRecoverableErrors = [ErrorClassification.AUTHENTICATION_ERROR, ErrorClassification.PARSING_ERROR];

    return !nonRecoverableErrors.includes(classification);
  }

  private recordError(error: DataSourceError): void {
    // Add to error history
    const history = this.errorHistory.get(error.sourceId) || [];
    history.push(error);

    // Keep only recent errors (last 1000 or last 24 hours)
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const filteredHistory = history.filter(e => e.timestamp >= cutoff).slice(-1000);
    this.errorHistory.set(error.sourceId, filteredHistory);

    // Update statistics
    this.stats.totalErrors++;
    if (error.tier === DataSourceTier.TIER_1_CUSTOM) {
      this.stats.tier1Errors++;
    } else {
      this.stats.tier2Errors++;
    }

    this.stats.errorsByClassification[error.classification] =
      (this.stats.errorsByClassification[error.classification] || 0) + 1;

    // Update tier status
    this.tierStatus.set(error.sourceId, {
      tier: error.tier,
      isHealthy: false,
      lastError: error.timestamp,
    });

    this.emit("errorRecorded", error);
  }

  private async determineErrorResponse(error: DataSourceError): Promise<ErrorResponse> {
    const strategies = await this.getErrorResponseStrategies(error.sourceId, error.feedId!, error.error);

    // Select the best strategy based on error severity and context
    if (error.severity === "critical") {
      // For critical errors, prefer immediate failover
      const failoverStrategy = strategies.find(s => s.strategy === "failover");
      if (failoverStrategy) return failoverStrategy;
    }

    if (error.recoverable && error.severity !== "critical") {
      // For recoverable errors, try retry first
      const retryStrategy = strategies.find(s => s.strategy === "retry");
      if (retryStrategy) return retryStrategy;
    }

    // Default to first available strategy
    return (
      strategies[0] || {
        strategy: "graceful_degradation",
        action: "No recovery strategy available",
        estimatedRecoveryTime: 0,
        fallbackSources: [],
        degradationLevel: "severe",
      }
    );
  }

  private async determineTier2ErrorResponse(error: DataSourceError): Promise<ErrorResponse> {
    // Tier 2 errors have different response strategies
    if (error.classification === ErrorClassification.RATE_LIMIT_ERROR) {
      return {
        strategy: "retry",
        action: "Wait for rate limit reset",
        estimatedRecoveryTime: 60000, // 1 minute
        fallbackSources: [],
        degradationLevel: "none",
      };
    }

    // For other Tier 2 errors, rely on other Tier 2 sources
    const otherTier2Sources = await this.getTier2Sources(error.feedId!);
    const healthySources = otherTier2Sources.filter(s => s !== error.sourceId);

    if (healthySources.length > 0) {
      return {
        strategy: "failover",
        action: `Use other Tier 2 sources`,
        estimatedRecoveryTime: this.config.tier2ToCcxtDelay,
        fallbackSources: healthySources,
        degradationLevel: "partial",
      };
    }

    return {
      strategy: "graceful_degradation",
      action: "Continue with reduced Tier 2 coverage",
      estimatedRecoveryTime: 0,
      fallbackSources: [],
      degradationLevel: "partial",
    };
  }

  private async executeErrorResponse(response: ErrorResponse, error: DataSourceError): Promise<void> {
    this.stats.recoveryAttempts++;

    switch (response.strategy) {
      case "retry":
        await this.executeRetryStrategy(error, response);
        break;
      case "failover":
        await this.executeFailoverStrategy(error, response);
        break;
      case "ccxt_backup":
        await this.executeCcxtBackupStrategy(error, response);
        break;
      case "tier_fallback":
        await this.executeTierFallbackStrategy(error, response);
        break;
      case "graceful_degradation":
        await this.executeGracefulDegradationStrategy(error, response);
        break;
    }
  }

  private async executeRetryStrategy(error: DataSourceError, response: ErrorResponse): Promise<void> {
    const delay = response.estimatedRecoveryTime;

    this.logger.log(`Scheduling retry for ${error.sourceId} in ${delay}ms`);

    const timer = setTimeout(async () => {
      try {
        // Attempt recovery through circuit breaker
        await this.circuitBreaker.execute(error.sourceId, async () => {
          // This would trigger the actual retry logic
          return true;
        });

        this.stats.successfulRecoveries++;
        this.emit("retrySuccessful", error.sourceId);
      } catch (retryError) {
        this.logger.error(`Retry failed for ${error.sourceId}:`, retryError);
        this.emit("retryFailed", error.sourceId, retryError);
      }
    }, delay);

    this.recoveryTimers.set(error.sourceId, timer);
  }

  private async executeFailoverStrategy(error: DataSourceError, response: ErrorResponse): Promise<void> {
    this.logger.log(`Executing failover for ${error.sourceId} to sources: ${response.fallbackSources.join(", ")}`);

    // Trigger connection recovery service failover
    await this.connectionRecovery.triggerFailover(error.sourceId, `Error: ${error.classification}`);

    this.stats.failoverEvents++;
    this.emit("failoverExecuted", error.sourceId, response.fallbackSources);
  }

  private async executeCcxtBackupStrategy(error: DataSourceError, response: ErrorResponse): Promise<void> {
    if (!error.feedId) return;

    this.logger.log(`Activating CCXT backup for ${error.sourceId} on feed ${error.feedId.name}`);

    await this.activateCcxtBackup(error.feedId, [error.sourceId], response.fallbackSources);

    this.stats.ccxtBackupActivations++;
    this.emit("ccxtBackupActivated", error.feedId, error.sourceId);
  }

  private async executeTierFallbackStrategy(error: DataSourceError, response: ErrorResponse): Promise<void> {
    if (!error.feedId) return;

    this.logger.log(`Executing tier fallback for ${error.sourceId} on feed ${error.feedId.name}`);

    await this.implementTierFailover(error.feedId, [error.sourceId]);

    this.emit("tierFallbackExecuted", error.feedId, error.sourceId);
  }

  private async executeGracefulDegradationStrategy(error: DataSourceError, response: ErrorResponse): Promise<void> {
    if (!error.feedId) return;

    this.logger.warn(`Implementing graceful degradation for ${error.sourceId} on feed ${error.feedId.name}`);

    await this.implementGracefulDegradation(error.feedId, [error.sourceId]);

    this.emit("gracefulDegradationImplemented", error.feedId, error.sourceId);
  }

  private async getCcxtBackupSources(feedId: EnhancedFeedId, failedSources: string[]): Promise<string[]> {
    try {
      // Check if CCXT can provide individual prices for the same exchanges
      const availableTier2Exchanges = this.ccxtAdapter.getAvailableTier2Exchanges(feedId);

      // Ensure we have a valid array
      if (!Array.isArray(availableTier2Exchanges)) {
        this.logger.warn(`No available Tier 2 exchanges for ${feedId.name}`);
        return [];
      }

      // Map failed Tier 1 sources to their CCXT equivalents
      const ccxtBackupSources: string[] = [];

      for (const failedSource of failedSources) {
        const exchangeName = this.extractExchangeName(failedSource);
        if (availableTier2Exchanges.includes(exchangeName)) {
          ccxtBackupSources.push(`ccxt-${exchangeName}`);
        }
      }

      return ccxtBackupSources;
    } catch (error) {
      this.logger.error(`Failed to get CCXT backup sources for ${feedId.name}:`, error);
      return [];
    }
  }

  private async activateCcxtBackup(
    feedId: EnhancedFeedId,
    failedSources: string[],
    backupSources: string[]
  ): Promise<void> {
    const feedKey = this.getFeedKey(feedId);

    this.ccxtBackupActive.set(feedKey, true);

    // Increment the backup activation counter
    this.stats.ccxtBackupActivations++;

    this.logger.log(
      `CCXT backup activated for ${feedId.name}: ${backupSources.join(", ")} replacing ${failedSources.join(", ")}`
    );

    // The actual backup activation would be handled by the aggregation service
    this.emit("ccxtBackupActivated", feedId, failedSources, backupSources);
  }

  private async implementGracefulDegradation(feedId: EnhancedFeedId, failedSources: string[]): Promise<ErrorResponse> {
    this.logger.warn(`Implementing graceful degradation for ${feedId.name}: ${failedSources.length} sources failed`);

    // Use connection recovery service for graceful degradation
    await this.connectionRecovery.implementGracefulDegradation(feedId);

    return {
      strategy: "graceful_degradation",
      action: `Continue with reduced quality for ${failedSources.length} failed sources`,
      estimatedRecoveryTime: 0,
      fallbackSources: [],
      degradationLevel: "severe",
    };
  }

  private getTierForSource(sourceId: string): DataSourceTier {
    // Determine tier based on source ID pattern
    if (sourceId.startsWith("ccxt-") || sourceId.includes("ccxt")) {
      return DataSourceTier.TIER_2_CCXT;
    }

    // Check if it's a known Tier 1 exchange
    const tier1Exchanges = ["binance", "coinbase", "kraken", "okx", "cryptocom"];
    const exchangeName = this.extractExchangeName(sourceId);

    if (tier1Exchanges.includes(exchangeName)) {
      return DataSourceTier.TIER_1_CUSTOM;
    }

    return DataSourceTier.TIER_2_CCXT;
  }

  private async getSameTierHealthySources(
    feedId: EnhancedFeedId,
    tier: DataSourceTier,
    excludeSource: string
  ): Promise<string[]> {
    // This would be implemented based on the actual source registry
    // For now, return empty array as placeholder
    return [];
  }

  private async getTier2Sources(feedId: EnhancedFeedId): Promise<string[]> {
    try {
      const sources = this.ccxtAdapter.getAvailableTier2Exchanges(feedId);
      return sources || [];
    } catch {
      return [];
    }
  }

  private calculateRetryDelay(sourceId: string): number {
    const errorHistory = this.getErrorHistory(sourceId);
    const recentErrors = errorHistory.filter(e => Date.now() - e.timestamp < 300000); // Last 5 minutes

    // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
    const attempt = recentErrors.length;
    return Math.min(1000 * Math.pow(2, attempt), 30000);
  }

  private extractExchangeName(sourceId: string): string {
    // Extract exchange name from source ID (e.g., "binance-adapter" -> "binance")
    return sourceId.split("-")[0].toLowerCase();
  }

  private getFeedKey(feedId: EnhancedFeedId): string {
    return `${feedId.category}-${feedId.name}`;
  }

  private initializeErrorClassifications(): void {
    // Initialize all error classifications with 0 count
    Object.values(ErrorClassification).forEach(classification => {
      this.stats.errorsByClassification[classification] = 0;
    });
  }

  private startRecoveryMonitoring(): void {
    setInterval(() => {
      this.performRecoveryCheck();
    }, this.config.recoveryCheckInterval);
  }

  private performRecoveryCheck(): void {
    // Check for sources that might have recovered
    for (const [sourceId, status] of this.tierStatus.entries()) {
      if (!status.isHealthy && status.lastError) {
        const timeSinceError = Date.now() - status.lastError;

        // If enough time has passed, attempt to check if source has recovered
        if (timeSinceError > this.config.recoveryCheckInterval) {
          this.checkSourceRecovery(sourceId);
        }
      }
    }
  }

  private async checkSourceRecovery(sourceId: string): Promise<void> {
    try {
      // Use circuit breaker to test source recovery
      await this.circuitBreaker.execute(sourceId, async () => {
        // This would be a lightweight health check
        return true;
      });

      // If successful, mark as recovered
      const status = this.tierStatus.get(sourceId);
      if (status) {
        status.isHealthy = true;
        status.lastError = undefined;
        this.stats.successfulRecoveries++;
        this.emit("sourceRecovered", sourceId);
      }
    } catch (error) {
      // Source still not recovered
      this.logger.debug(`Source ${sourceId} recovery check failed:`, error.message);
    }
  }

  /**
   * Handle generic error with context
   */
  handleError(error: Error, context?: { sourceId?: string; component?: string }): void {
    try {
      const sourceId = context?.sourceId || "unknown";
      const component = context?.component || "unknown";

      this.logger.error(`Handling error from ${component}:${sourceId}:`, error);

      // Classify the error
      const classification = this.classifyError(error, context);

      // Create error record
      const dataSourceError: DataSourceError = {
        sourceId,
        tier: this.getTierForSource(sourceId),
        classification,
        error,
        timestamp: Date.now(),
        severity: "medium",
        recoverable: this.isRecoverable(classification),
      };

      // Record the error
      this.recordError(dataSourceError);

      this.emit("errorHandled", sourceId, dataSourceError);
    } catch (handlingError) {
      this.logger.error("Error in error handling:", handlingError);
    }
  }

  /**
   * Record failure for circuit breaker integration
   */
  recordFailure(sourceId: string): void {
    try {
      this.circuitBreaker
        .execute(sourceId, async () => {
          throw new Error("Simulated failure for circuit breaker");
        })
        .catch(() => {
          // Expected to fail - this is just to record the failure
        });
    } catch (error) {
      this.logger.debug(`Recorded failure for ${sourceId}`);
    }
  }

  /**
   * Cleanup method
   */
  destroy(): void {
    // Clear all recovery timers
    for (const timer of this.recoveryTimers.values()) {
      clearTimeout(timer);
    }

    this.recoveryTimers.clear();
    this.errorHistory.clear();
    this.tierStatus.clear();
    this.ccxtBackupActive.clear();
  }
}
