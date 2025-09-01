import { Injectable } from "@nestjs/common";
import { DataSource } from "@/interfaces";
import { EnhancedFeedId } from "@/types";
import { BaseEventService } from "@/common";

export interface FailoverConfig {
  maxFailoverTime: number; // Maximum time to complete failover (ms)
  healthCheckInterval: number; // How often to check source health (ms)
  failureThreshold: number; // Number of failures before triggering failover
  recoveryThreshold: number; // Number of successful checks before considering recovered
}

export interface SourceHealth {
  sourceId: string;
  isHealthy: boolean;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastHealthCheck: number;
  lastFailure?: number;
  averageLatency: number;
}

export interface FailoverGroup {
  feedId: EnhancedFeedId;
  primarySources: string[];
  backupSources: string[];
  activeSources: string[];
  failedSources: string[];
}

@Injectable()
export class FailoverManager extends BaseEventService {
  private dataSources = new Map<string, DataSource>();
  private sourceHealth = new Map<string, SourceHealth>();
  private failoverGroups = new Map<string, FailoverGroup>();
  private healthCheckTimer?: NodeJS.Timeout;

  private readonly defaultConfig: FailoverConfig = {
    maxFailoverTime: 100, // 100ms requirement for FTSO
    healthCheckInterval: 5000, // 5 seconds
    failureThreshold: 3,
    recoveryThreshold: 5,
  };

  private config: FailoverConfig;

  constructor() {
    super(FailoverManager.name);
    this.config = { ...this.defaultConfig };
    this.startHealthMonitoring();
  }

  // Register data sources for failover management
  registerDataSource(source: DataSource): void {
    this.logger.log(`Registering data source for failover: ${source.id}`);

    this.dataSources.set(source.id, source);
    this.sourceHealth.set(source.id, {
      sourceId: source.id,
      isHealthy: true,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      lastHealthCheck: Date.now(),
      averageLatency: 0,
    });

    // Set up connection monitoring
    source.onConnectionChange((connected: boolean) => {
      this.handleConnectionChange(source.id, connected);
    });
  }

  // Unregister data source
  unregisterDataSource(sourceId: string): void {
    this.logger.log(`Unregistering data source: ${sourceId}`);

    this.dataSources.delete(sourceId);
    this.sourceHealth.delete(sourceId);

    // Remove from all failover groups
    for (const group of this.failoverGroups.values()) {
      group.primarySources = group.primarySources.filter(id => id !== sourceId);
      group.backupSources = group.backupSources.filter(id => id !== sourceId);
      group.activeSources = group.activeSources.filter(id => id !== sourceId);
      group.failedSources = group.failedSources.filter(id => id !== sourceId);
    }
  }

  // Configure failover group for a feed
  configureFailoverGroup(feedId: EnhancedFeedId, primarySources: string[], backupSources: string[]): void {
    const groupKey = this.getGroupKey(feedId);

    this.logger.log(
      `Configuring failover group for ${feedId.name}: primary=${primarySources.length}, backup=${backupSources.length}`
    );

    const group: FailoverGroup = {
      feedId,
      primarySources: [...primarySources],
      backupSources: [...backupSources],
      activeSources: [...primarySources], // Start with primary sources active
      failedSources: [],
    };

    this.failoverGroups.set(groupKey, group);
    this.emit("failoverGroupConfigured", feedId, group);
  }

  // Get active sources for a feed
  getActiveSources(feedId: EnhancedFeedId): DataSource[] {
    const groupKey = this.getGroupKey(feedId);
    const group = this.failoverGroups.get(groupKey);

    if (!group) {
      return [];
    }

    return group.activeSources
      .map(sourceId => this.dataSources.get(sourceId))
      .filter((source): source is DataSource => source !== undefined);
  }

  // Get healthy sources for a feed
  getHealthySources(feedId: EnhancedFeedId): DataSource[] {
    return this.getActiveSources(feedId).filter(source => {
      const health = this.sourceHealth.get(source.id);
      return health?.isHealthy && source.isConnected();
    });
  }

  // Trigger manual failover for a source
  async triggerFailover(sourceId: string, reason: string): Promise<void> {
    this.logger.warn(`Triggering manual failover for source ${sourceId}: ${reason}`);

    const startTime = Date.now();

    try {
      await this.performFailover(sourceId, reason);

      const failoverTime = Date.now() - startTime;
      this.logger.log(`Failover completed in ${failoverTime}ms`);

      if (failoverTime > this.config.maxFailoverTime) {
        this.logger.warn(`Failover time ${failoverTime}ms exceeded target ${this.config.maxFailoverTime}ms`);
      }
    } catch (error) {
      this.logger.error(`Failover failed for source ${sourceId}:`, error);
      throw error;
    }
  }

  // Get failover status for all groups
  getFailoverStatus(): Map<string, FailoverGroup> {
    return new Map(this.failoverGroups);
  }

  // Get health status for all sources
  getHealthStatus(): Map<string, SourceHealth> {
    return new Map(this.sourceHealth);
  }

  private async performFailover(failedSourceId: string, reason: string): Promise<void> {
    // Find all groups containing this source
    const affectedGroups = Array.from(this.failoverGroups.entries()).filter(
      ([, group]) => group.activeSources.includes(failedSourceId) || group.primarySources.includes(failedSourceId)
    );

    for (const [, group] of affectedGroups) {
      await this.performGroupFailover(group, failedSourceId, reason);
    }
  }

  private async performGroupFailover(group: FailoverGroup, failedSourceId: string, reason: string): Promise<void> {
    this.logger.log(`Performing failover for group ${group.feedId.name}, failed source: ${failedSourceId}`);

    // Move failed source to failed list
    group.activeSources = group.activeSources.filter(id => id !== failedSourceId);
    if (!group.failedSources.includes(failedSourceId)) {
      group.failedSources.push(failedSourceId);
    }

    // If we still have healthy primary sources, we're done
    const healthyPrimarySources = group.primarySources.filter(sourceId => {
      const health = this.sourceHealth.get(sourceId);
      const source = this.dataSources.get(sourceId);
      return health?.isHealthy && source?.isConnected() && !group.failedSources.includes(sourceId);
    });

    if (healthyPrimarySources.length > 0) {
      // Ensure healthy primary sources are active
      for (const sourceId of healthyPrimarySources) {
        if (!group.activeSources.includes(sourceId)) {
          group.activeSources.push(sourceId);
        }
      }

      this.emit("failoverCompleted", group.feedId, {
        failedSource: failedSourceId,
        activeSources: group.activeSources,
        reason,
      });
      return;
    }

    // No healthy primary sources, activate backup sources
    const healthyBackupSources = group.backupSources.filter(sourceId => {
      const health = this.sourceHealth.get(sourceId);
      const source = this.dataSources.get(sourceId);
      return health?.isHealthy && source?.isConnected() && !group.failedSources.includes(sourceId);
    });

    if (healthyBackupSources.length === 0) {
      this.logger.error(`No healthy backup sources available for group ${group.feedId.name}`);
      this.emit("failoverFailed", group.feedId, {
        failedSource: failedSourceId,
        reason: "No healthy backup sources available",
      });
      return;
    }

    // Activate backup sources
    for (const sourceId of healthyBackupSources) {
      if (!group.activeSources.includes(sourceId)) {
        group.activeSources.push(sourceId);

        // Subscribe backup source to the feed
        const source = this.dataSources.get(sourceId);
        if (source) {
          try {
            await source.subscribe([group.feedId.name]);
            this.logger.log(`Activated backup source ${sourceId} for ${group.feedId.name}`);
          } catch (error) {
            this.logger.error(`Failed to activate backup source ${sourceId}:`, error);
          }
        }
      }
    }

    this.emit("failoverCompleted", group.feedId, {
      failedSource: failedSourceId,
      activeSources: group.activeSources,
      backupSourcesActivated: healthyBackupSources,
      reason,
    });
  }

  private handleConnectionChange(sourceId: string, connected: boolean): void {
    const health = this.sourceHealth.get(sourceId);
    if (!health) return;

    if (!connected) {
      health.consecutiveFailures++;
      health.consecutiveSuccesses = 0;
      health.lastFailure = Date.now();

      if (health.consecutiveFailures >= this.config.failureThreshold) {
        health.isHealthy = false;
        this.triggerFailover(sourceId, "Connection lost").catch(error => {
          this.logger.error(`Failed to trigger failover for ${sourceId}:`, error);
        });
      }
    } else {
      health.consecutiveSuccesses++;

      if (health.consecutiveSuccesses >= this.config.recoveryThreshold) {
        health.consecutiveFailures = 0;
        health.isHealthy = true;
        this.handleSourceRecovery(sourceId);
      }
    }
  }

  private handleSourceRecovery(sourceId: string): void {
    this.logger.log(`Source ${sourceId} has recovered`);

    // Find groups where this source should be restored
    for (const [, group] of this.failoverGroups.entries()) {
      if (group.failedSources.includes(sourceId)) {
        // Remove from failed sources
        group.failedSources = group.failedSources.filter(id => id !== sourceId);

        // If it's a primary source, restore it to active
        if (group.primarySources.includes(sourceId)) {
          if (!group.activeSources.includes(sourceId)) {
            group.activeSources.push(sourceId);
          }

          // Remove backup sources if primary is back
          const backupSourcesInActive = group.activeSources.filter(id => group.backupSources.includes(id));

          for (const backupId of backupSourcesInActive) {
            group.activeSources = group.activeSources.filter(id => id !== backupId);

            // Unsubscribe backup source
            const backupSource = this.dataSources.get(backupId);
            if (backupSource) {
              backupSource.unsubscribe([group.feedId.name]).catch(error => {
                this.logger.error(`Failed to unsubscribe backup source ${backupId}:`, error);
              });
            }
          }

          this.emit("sourceRecovered", group.feedId, {
            recoveredSource: sourceId,
            deactivatedBackups: backupSourcesInActive,
          });
        }
      }
    }
  }

  private startHealthMonitoring(): void {
    this.healthCheckTimer = setInterval(() => {
      this.performHealthChecks();
    }, this.config.healthCheckInterval);
  }

  private performHealthChecks(): void {
    const now = Date.now();

    for (const [sourceId, health] of this.sourceHealth.entries()) {
      const source = this.dataSources.get(sourceId);
      if (!source) continue;

      const isConnected = source.isConnected();
      const latency = source.getLatency();

      // Update health metrics
      health.lastHealthCheck = now;
      health.averageLatency = (health.averageLatency + latency) / 2;

      // Check for health changes
      if (!isConnected && health.isHealthy) {
        this.handleConnectionChange(sourceId, false);
      } else if (isConnected && !health.isHealthy) {
        health.consecutiveSuccesses++;
      }
    }
  }

  private getGroupKey(feedId: EnhancedFeedId): string {
    return `${feedId.category}-${feedId.name}`;
  }

  // Cleanup method
  destroy(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
  }
}
