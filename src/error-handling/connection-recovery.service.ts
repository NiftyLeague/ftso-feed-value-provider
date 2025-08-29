import { Injectable, Logger } from "@nestjs/common";
import { EventEmitter } from "events";
import { DataSource } from "@/interfaces";
import { EnhancedFeedId } from "@/types";
import { CircuitBreakerService, CircuitBreakerState } from "./circuit-breaker.service";
import { FailoverManager } from "@/data-manager/failover-manager";

export interface ConnectionRecoveryConfig {
  maxFailoverTime: number; // Maximum time to complete failover (ms) - Requirement 7.2
  healthCheckInterval: number; // How often to check connection health (ms)
  reconnectDelay: number; // Initial delay before reconnection attempt (ms)
  maxReconnectDelay: number; // Maximum delay between reconnection attempts (ms)
  backoffMultiplier: number; // Exponential backoff multiplier
  maxReconnectAttempts: number; // Maximum number of reconnection attempts
  gracefulDegradationThreshold: number; // Minimum sources needed to avoid degradation
}

export interface ConnectionHealth {
  sourceId: string;
  isConnected: boolean;
  isHealthy: boolean;
  lastConnected?: number;
  lastDisconnected?: number;
  reconnectAttempts: number;
  consecutiveFailures: number;
  averageLatency: number;
  circuitBreakerState: CircuitBreakerState;
}

export interface FailoverResult {
  success: boolean;
  failoverTime: number;
  activatedSources: string[];
  deactivatedSources: string[];
  degradationLevel: "none" | "partial" | "severe";
}

export interface RecoveryStrategy {
  sourceId: string;
  strategy: "reconnect" | "failover" | "circuit_breaker" | "graceful_degradation";
  priority: number;
  estimatedRecoveryTime: number;
}

@Injectable()
export class ConnectionRecoveryService extends EventEmitter {
  private readonly logger = new Logger(ConnectionRecoveryService.name);

  private dataSources = new Map<string, DataSource>();
  private connectionHealth = new Map<string, ConnectionHealth>();
  private reconnectTimers = new Map<string, NodeJS.Timeout>();
  private healthCheckTimer?: NodeJS.Timeout;
  private feedSourceMapping = new Map<string, string[]>(); // feedId -> sourceIds

  private readonly defaultConfig: ConnectionRecoveryConfig = {
    maxFailoverTime: 100, // 100ms requirement for FTSO (Requirement 7.2)
    healthCheckInterval: 5000, // 5 seconds
    reconnectDelay: 1000, // 1 second initial delay
    maxReconnectDelay: 30000, // 30 seconds max delay
    backoffMultiplier: 2,
    maxReconnectAttempts: 10,
    gracefulDegradationThreshold: 2, // Need at least 2 sources
  };

  private config: ConnectionRecoveryConfig;

  constructor(
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly failoverManager: FailoverManager,
    config?: Partial<ConnectionRecoveryConfig>
  ) {
    super();
    this.config = { ...this.defaultConfig, ...config };
    this.startHealthMonitoring();
    this.setupEventHandlers();
  }

  /**
   * Register a data source for connection recovery management
   */
  async registerDataSource(source: DataSource): Promise<void> {
    this.logger.log(`Registering data source for connection recovery: ${source.id}`);

    // Register with circuit breaker
    this.circuitBreaker.registerCircuit(source.id, {
      failureThreshold: 3,
      recoveryTimeout: 30000,
      successThreshold: 2,
      timeout: 5000,
    });

    // Initialize connection health
    this.connectionHealth.set(source.id, {
      sourceId: source.id,
      isConnected: source.isConnected(),
      isHealthy: true,
      reconnectAttempts: 0,
      consecutiveFailures: 0,
      averageLatency: 0,
      circuitBreakerState: CircuitBreakerState.CLOSED,
    });

    // Store data source
    this.dataSources.set(source.id, source);

    // Set up connection monitoring
    source.onConnectionChange((connected: boolean) => {
      this.handleConnectionChange(source.id, connected);
    });

    // Register with failover manager
    this.failoverManager.registerDataSource(source);

    this.emit("sourceRegistered", source.id);
  }

  /**
   * Unregister a data source
   */
  async unregisterDataSource(sourceId: string): Promise<void> {
    this.logger.log(`Unregistering data source: ${sourceId}`);

    // Cancel any pending reconnection
    const timer = this.reconnectTimers.get(sourceId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(sourceId);
    }

    // Unregister from circuit breaker
    this.circuitBreaker.unregisterCircuit(sourceId);

    // Unregister from failover manager
    this.failoverManager.unregisterDataSource(sourceId);

    // Clean up
    this.dataSources.delete(sourceId);
    this.connectionHealth.delete(sourceId);

    // Remove from feed mappings
    for (const [feedId, sourceIds] of this.feedSourceMapping.entries()) {
      const updatedSources = sourceIds.filter(id => id !== sourceId);
      if (updatedSources.length === 0) {
        this.feedSourceMapping.delete(feedId);
      } else {
        this.feedSourceMapping.set(feedId, updatedSources);
      }
    }

    this.emit("sourceUnregistered", sourceId);
  }

  /**
   * Configure feed-to-source mapping for intelligent failover
   */
  configureFeedSources(feedId: EnhancedFeedId, primarySources: string[], backupSources: string[]): void {
    const feedKey = this.getFeedKey(feedId);
    const allSources = [...primarySources, ...backupSources];

    this.feedSourceMapping.set(feedKey, allSources);
    this.failoverManager.configureFailoverGroup(feedId, primarySources, backupSources);

    this.logger.log(`Configured sources for feed ${feedId.name}: ${allSources.length} total sources`);
  }

  /**
   * Trigger immediate failover for a failed source (Requirement 7.2: within 100ms)
   */
  async triggerFailover(sourceId: string, reason: string): Promise<FailoverResult> {
    const startTime = Date.now();
    this.logger.warn(`Triggering failover for source ${sourceId}: ${reason}`);

    try {
      // Update connection health
      const health = this.connectionHealth.get(sourceId);
      if (health) {
        health.isHealthy = false;
        health.consecutiveFailures++;
        health.lastDisconnected = Date.now();
      }

      // Open circuit breaker
      this.circuitBreaker.openCircuit(sourceId, reason);

      // Perform failover through failover manager
      await this.failoverManager.triggerFailover(sourceId, reason);

      // Assess degradation level
      const degradationLevel = this.assessDegradationLevel();

      // Schedule recovery attempt
      this.scheduleRecovery(sourceId);

      const failoverTime = Date.now() - startTime;
      const result: FailoverResult = {
        success: true,
        failoverTime,
        activatedSources: this.getActivatedBackupSources(sourceId),
        deactivatedSources: [sourceId],
        degradationLevel,
      };

      // Check if failover time exceeds target
      if (failoverTime > this.config.maxFailoverTime) {
        this.logger.warn(
          `Failover time ${failoverTime}ms exceeded target ${this.config.maxFailoverTime}ms for source ${sourceId}`
        );
      }

      this.emit("failoverCompleted", sourceId, result);
      return result;
    } catch (error) {
      const failoverTime = Date.now() - startTime;
      this.logger.error(`Failover failed for source ${sourceId} after ${failoverTime}ms:`, error);

      const result: FailoverResult = {
        success: false,
        failoverTime,
        activatedSources: [],
        deactivatedSources: [sourceId],
        degradationLevel: "severe",
      };

      this.emit("failoverFailed", sourceId, result);
      return result;
    }
  }

  /**
   * Implement graceful degradation when sources become unavailable (Requirement 7.3)
   */
  async implementGracefulDegradation(feedId: EnhancedFeedId): Promise<void> {
    const feedKey = this.getFeedKey(feedId);
    const sourceIds = this.feedSourceMapping.get(feedKey) || [];
    const healthySources = sourceIds.filter(sourceId => {
      const health = this.connectionHealth.get(sourceId);
      return health?.isHealthy && health?.isConnected;
    });

    this.logger.log(
      `Implementing graceful degradation for ${feedId.name}: ${healthySources.length}/${sourceIds.length} sources healthy`
    );

    if (healthySources.length === 0) {
      // Complete service degradation
      this.logger.error(`Complete service degradation for feed ${feedId.name}: no healthy sources available`);
      this.emit("completeServiceDegradation", feedId);
      return;
    }

    if (healthySources.length < this.config.gracefulDegradationThreshold) {
      // Partial degradation - reduce quality requirements
      this.logger.warn(
        `Partial service degradation for feed ${feedId.name}: only ${healthySources.length} sources available`
      );
      this.emit("partialServiceDegradation", feedId, {
        availableSources: healthySources.length,
        requiredSources: this.config.gracefulDegradationThreshold,
      });
    }

    // Continue operating with available sources
    this.emit("gracefulDegradationImplemented", feedId, {
      healthySources: healthySources.length,
      totalSources: sourceIds.length,
    });
  }

  /**
   * Get recovery strategies for failed sources (Requirement 7.4)
   */
  getRecoveryStrategies(sourceId: string): RecoveryStrategy[] {
    const health = this.connectionHealth.get(sourceId);
    const source = this.dataSources.get(sourceId);

    if (!health || !source) {
      return [];
    }

    const strategies: RecoveryStrategy[] = [];

    // Strategy 1: Reconnection (for WebSocket sources)
    if (source.type === "websocket" && health.reconnectAttempts < this.config.maxReconnectAttempts) {
      strategies.push({
        sourceId,
        strategy: "reconnect",
        priority: 1,
        estimatedRecoveryTime: this.calculateReconnectDelay(health.reconnectAttempts),
      });
    }

    // Strategy 2: Circuit breaker recovery
    if (health.circuitBreakerState === CircuitBreakerState.OPEN) {
      strategies.push({
        sourceId,
        strategy: "circuit_breaker",
        priority: 2,
        estimatedRecoveryTime: 30000, // Circuit breaker recovery timeout
      });
    }

    // Strategy 3: Failover to backup sources
    strategies.push({
      sourceId,
      strategy: "failover",
      priority: 3,
      estimatedRecoveryTime: this.config.maxFailoverTime,
    });

    // Strategy 4: Graceful degradation
    strategies.push({
      sourceId,
      strategy: "graceful_degradation",
      priority: 4,
      estimatedRecoveryTime: 0, // Immediate
    });

    return strategies.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Get connection health for all sources
   */
  getConnectionHealth(): Map<string, ConnectionHealth> {
    // Update circuit breaker states
    for (const [sourceId, health] of this.connectionHealth.entries()) {
      health.circuitBreakerState = this.circuitBreaker.getState(sourceId) || CircuitBreakerState.CLOSED;
    }

    return new Map(this.connectionHealth);
  }

  /**
   * Get overall system health status
   */
  getSystemHealth(): {
    totalSources: number;
    healthySources: number;
    connectedSources: number;
    degradedSources: number;
    failedSources: number;
    overallHealth: "healthy" | "degraded" | "critical";
  } {
    const totalSources = this.connectionHealth.size;
    let healthySources = 0;
    let connectedSources = 0;
    let degradedSources = 0;
    let failedSources = 0;

    for (const health of this.connectionHealth.values()) {
      if (health.isConnected) {
        connectedSources++;
      }

      if (health.isHealthy && health.isConnected) {
        healthySources++;
      } else if (health.isConnected && !health.isHealthy) {
        degradedSources++;
      } else {
        failedSources++;
      }
    }

    let overallHealth: "healthy" | "degraded" | "critical";
    const healthyPercentage = totalSources > 0 ? (healthySources / totalSources) * 100 : 0;

    if (healthyPercentage >= 80) {
      overallHealth = "healthy";
    } else if (healthyPercentage >= 50) {
      overallHealth = "degraded";
    } else {
      overallHealth = "critical";
    }

    return {
      totalSources,
      healthySources,
      connectedSources,
      degradedSources,
      failedSources,
      overallHealth,
    };
  }

  private handleConnectionChange(sourceId: string, connected: boolean): void {
    const health = this.connectionHealth.get(sourceId);
    if (!health) return;

    const previousState = health.isConnected;
    health.isConnected = connected;

    if (connected && !previousState) {
      // Connection restored
      this.handleConnectionRestored(sourceId);
    } else if (!connected && previousState) {
      // Connection lost
      this.handleConnectionLost(sourceId);
    }
  }

  private async handleConnectionLost(sourceId: string): Promise<void> {
    this.logger.warn(`Connection lost for source: ${sourceId}`);

    const health = this.connectionHealth.get(sourceId);
    if (health) {
      health.lastDisconnected = Date.now();
      health.consecutiveFailures++;
    }

    // Trigger failover
    await this.triggerFailover(sourceId, "Connection lost");
  }

  private handleConnectionRestored(sourceId: string): void {
    this.logger.log(`Connection restored for source: ${sourceId}`);

    const health = this.connectionHealth.get(sourceId);
    if (health) {
      health.lastConnected = Date.now();
      health.consecutiveFailures = 0;
      health.reconnectAttempts = 0;
      health.isHealthy = true;
    }

    // Cancel any pending reconnection
    const timer = this.reconnectTimers.get(sourceId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(sourceId);
    }

    // Close circuit breaker
    this.circuitBreaker.closeCircuit(sourceId, "Connection restored");

    this.emit("connectionRestored", sourceId);
  }

  private scheduleRecovery(sourceId: string): void {
    const health = this.connectionHealth.get(sourceId);
    const source = this.dataSources.get(sourceId);

    if (!health || !source) return;

    // Only schedule reconnection for WebSocket sources
    if (source.type !== "websocket") return;

    if (health.reconnectAttempts >= this.config.maxReconnectAttempts) {
      this.logger.error(`Max reconnection attempts reached for source ${sourceId}`);
      return;
    }

    const delay = this.calculateReconnectDelay(health.reconnectAttempts);
    health.reconnectAttempts++;

    this.logger.log(`Scheduling reconnection for ${sourceId} in ${delay}ms (attempt ${health.reconnectAttempts})`);

    const timer = setTimeout(async () => {
      await this.attemptReconnection(sourceId);
    }, delay);

    this.reconnectTimers.set(sourceId, timer);
  }

  private async attemptReconnection(sourceId: string): Promise<void> {
    this.logger.log(`Attempting reconnection for source: ${sourceId}`);

    const source = this.dataSources.get(sourceId);
    if (!source) return;

    try {
      // Use circuit breaker for reconnection attempt
      await this.circuitBreaker.execute(sourceId, async () => {
        // This would trigger the actual reconnection logic in the DataSource
        // For now, we'll simulate the reconnection attempt
        if (!source.isConnected()) {
          throw new Error("Reconnection failed");
        }
      });

      this.logger.log(`Reconnection successful for source: ${sourceId}`);
    } catch (error) {
      this.logger.error(`Reconnection failed for source ${sourceId}:`, error);
      // Schedule next attempt
      this.scheduleRecovery(sourceId);
    }
  }

  private calculateReconnectDelay(attemptNumber: number): number {
    const delay = Math.min(
      this.config.reconnectDelay * Math.pow(this.config.backoffMultiplier, attemptNumber),
      this.config.maxReconnectDelay
    );
    return delay;
  }

  private assessDegradationLevel(): "none" | "partial" | "severe" {
    const systemHealth = this.getSystemHealth();
    const healthyPercentage = (systemHealth.healthySources / systemHealth.totalSources) * 100;

    if (healthyPercentage >= 80) {
      return "none";
    } else if (healthyPercentage >= 50) {
      return "partial";
    } else {
      return "severe";
    }
  }

  private getActivatedBackupSources(failedSourceId: string): string[] {
    // This would be implemented based on the failover manager's response
    // For now, return empty array as placeholder
    return [];
  }

  private getFeedKey(feedId: EnhancedFeedId): string {
    return `${feedId.category}-${feedId.name}`;
  }

  private setupEventHandlers(): void {
    // Listen to failover manager events
    this.failoverManager.on("failoverCompleted", (feedId, details) => {
      this.emit("feedFailoverCompleted", feedId, details);
    });

    this.failoverManager.on("failoverFailed", (feedId, details) => {
      this.emit("feedFailoverFailed", feedId, details);
    });

    this.failoverManager.on("sourceRecovered", (feedId, details) => {
      this.emit("feedSourceRecovered", feedId, details);
    });
  }

  private startHealthMonitoring(): void {
    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck();
    }, this.config.healthCheckInterval);
  }

  private performHealthCheck(): void {
    const now = Date.now();

    for (const [sourceId, health] of this.connectionHealth.entries()) {
      const source = this.dataSources.get(sourceId);
      if (!source) continue;

      // Update connection status
      const isConnected = source.isConnected();
      if (health.isConnected !== isConnected) {
        this.handleConnectionChange(sourceId, isConnected);
      }

      // Update latency
      health.averageLatency = source.getLatency();

      // Check for stale connections
      if (health.lastConnected && now - health.lastConnected > 300000) {
        // No activity for 5 minutes
        if (health.isHealthy) {
          this.logger.warn(`Source ${sourceId} marked as unhealthy due to inactivity`);
          health.isHealthy = false;
          this.emit("sourceUnhealthy", sourceId);
        }
      }
    }
  }

  /**
   * Cleanup method
   */
  destroy(): void {
    // Clear health check timer
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    // Clear all reconnection timers
    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }

    this.reconnectTimers.clear();
    this.connectionHealth.clear();
    this.dataSources.clear();
    this.feedSourceMapping.clear();
  }
}
