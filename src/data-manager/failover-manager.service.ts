import { Injectable } from "@nestjs/common";
import { EventDrivenService } from "@/common/base/composed.service";
import type { DataSource, CoreFeedId } from "@/common/types/core";
import type { FailoverConfig, SourceHealth, FailoverGroup } from "@/common/types/data-manager";
import { ENV } from "@/common/constants";

@Injectable()
export class FailoverManager extends EventDrivenService {
  private dataSources = new Map<string, DataSource>();
  private sourceHealth = new Map<string, SourceHealth>();
  private failoverGroups = new Map<string, FailoverGroup>();
  private healthCheckTimer?: NodeJS.Timeout;

  constructor() {
    super({
      maxFailoverTime: ENV.FAILOVER.MAX_FAILOVER_TIME_MS,
      healthCheckInterval: ENV.HEALTH_CHECKS.FAILOVER_INTERVAL_MS,
      failureThreshold: ENV.FAILOVER.FAILURE_THRESHOLD,
      recoveryThreshold: ENV.FAILOVER.RECOVERY_THRESHOLD,
      minFailureInterval: ENV.FAILOVER.MIN_FAILURE_INTERVAL_MS,
    });
    this.startHealthMonitoring();
  }

  /**
   * Get the typed configuration for this service
   */
  private get failoverConfig(): FailoverConfig {
    return this.config as FailoverConfig;
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
  configureFailoverGroup(feedId: CoreFeedId, primarySources: string[], backupSources: string[]): void {
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
  getActiveSources(feedId: CoreFeedId): DataSource[] {
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
  getHealthySources(feedId: CoreFeedId): DataSource[] {
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

      if (failoverTime > this.failoverConfig.maxFailoverTime) {
        // Only warn if significantly over target (2x or more)
        if (failoverTime > this.failoverConfig.maxFailoverTime * 2) {
          this.logger.warn(
            `Failover time ${failoverTime}ms significantly exceeded target ${this.failoverConfig.maxFailoverTime}ms`
          );
        } else {
          this.logger.debug(
            `Failover time ${failoverTime}ms slightly exceeded target ${this.failoverConfig.maxFailoverTime}ms`
          );
        }
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
  getSourceHealthStatus(): Map<string, SourceHealth> {
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

    // Prevent infinite loops by checking if this source was already failed recently
    const now = Date.now();
    const lastFailoverTime = group.lastFailoverTime || 0;
    const failoverCooldown = ENV.FAILOVER.FAILOVER_COOLDOWN_MS;

    if (now - lastFailoverTime < failoverCooldown) {
      this.logger.warn(
        `Skipping failover for group ${group.feedId.name} - too recent (${now - lastFailoverTime}ms ago)`
      );
      return;
    }

    // Update last failover time
    group.lastFailoverTime = now;

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

    // Activate backup sources with improved error handling
    const successfullyActivated: string[] = [];
    const failedToActivate: string[] = [];

    for (const sourceId of healthyBackupSources) {
      if (!group.activeSources.includes(sourceId)) {
        try {
          // Subscribe backup source to the feed with timeout
          const source = this.dataSources.get(sourceId);
          if (source) {
            // Check if already subscribed to avoid duplicate subscriptions
            const adapterDataSource = source as { getSubscriptions?: () => string[] };
            const isAlreadySubscribed = adapterDataSource.getSubscriptions?.().includes(group.feedId.name) || false;
            if (isAlreadySubscribed) {
              this.logger.debug(`Source ${sourceId} already subscribed to ${group.feedId.name}, skipping subscription`);
              group.activeSources.push(sourceId);
              successfullyActivated.push(sourceId);
              continue;
            }

            await Promise.race([
              source.subscribe([group.feedId.name]),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Subscription timeout")), ENV.FAILOVER.SUBSCRIPTION_TIMEOUT_MS)
              ),
            ]);

            group.activeSources.push(sourceId);
            successfullyActivated.push(sourceId);
            this.logger.log(`Successfully activated backup source ${sourceId} for group ${group.feedId.name}`);
          }
        } catch (error) {
          failedToActivate.push(sourceId);
          this.logger.error(`Failed to activate backup source ${sourceId} for group ${group.feedId.name}:`, error);

          // Mark this source as failed to prevent repeated attempts
          if (!group.failedSources.includes(sourceId)) {
            group.failedSources.push(sourceId);
          }
        }
      }
    }

    // Only emit success if we have at least one active source
    if (successfullyActivated.length > 0) {
      this.emit("failoverCompleted", group.feedId, {
        failedSource: failedSourceId,
        activeSources: group.activeSources,
        backupSourcesActivated: successfullyActivated,
        failedToActivate,
        reason,
      });
    } else {
      this.logger.error(`Failed to activate any backup sources for group ${group.feedId.name}`);
      this.emit("failoverFailed", group.feedId, {
        failedSource: failedSourceId,
        reason: "All backup sources failed to activate",
        failedToActivate,
      });
    }
  }

  private handleConnectionChange(sourceId: string, connected: boolean): void {
    const health = this.sourceHealth.get(sourceId);
    if (!health) return;

    if (!connected) {
      health.consecutiveFailures++;
      health.consecutiveSuccesses = 0;

      // Add circuit breaker logic to prevent excessive failover attempts
      const timeSinceLastFailure = Date.now() - (health.lastFailure || 0);
      const minFailureInterval = this.failoverConfig.minFailureInterval;

      if (
        health.consecutiveFailures >= this.failoverConfig.failureThreshold &&
        timeSinceLastFailure > minFailureInterval
      ) {
        health.isHealthy = false;
        this.triggerFailover(sourceId, "Connection lost").catch(error => {
          this.logger.error(`Failed to trigger failover for ${sourceId}:`, error);
        });
      }

      // Update lastFailure after the calculation
      health.lastFailure = Date.now();
    } else {
      health.consecutiveSuccesses++;

      if (health.consecutiveSuccesses >= this.failoverConfig.recoveryThreshold) {
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
              this.executeWithErrorHandling(
                () => backupSource.unsubscribe([group.feedId.name]),
                `deactivate_backup_source_${backupId}_${group.feedId.name}`,
                {
                  retries: ENV.FAILOVER.RETRY_ATTEMPTS,
                  shouldThrow: false,
                }
              ).catch(error => {
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
    }, this.failoverConfig.healthCheckInterval);
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

  private getGroupKey(feedId: CoreFeedId): string {
    return `${feedId.category}-${feedId.name}`;
  }

  // Cleanup method
  destroy(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }

    // Clear all data structures to prevent memory leaks
    this.dataSources.clear();
    this.sourceHealth.clear();
    this.failoverGroups.clear();

    // Remove all event listeners
    this.removeAllListeners();
  }
}
