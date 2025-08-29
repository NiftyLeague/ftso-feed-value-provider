export interface AccuracyMetrics {
  consensusDeviation: number; // Percentage deviation from consensus median
  accuracyRate: number; // Percentage of values within 0.5% of consensus
  qualityScore: number; // Overall quality score (0-100)
  timestamp: number;
  feedId: string;
  votingRound?: number;
}

export interface PerformanceMetrics {
  responseLatency: number; // Response time in milliseconds
  dataFreshness: number; // Age of data in milliseconds
  throughput: number; // Requests per second
  cacheHitRate: number; // Cache hit percentage
  timestamp: number;
}

export interface HealthMetrics {
  connectionStatus: Map<string, boolean>; // Exchange connection status
  errorRate: number; // Errors per minute
  cpuUsage: number; // CPU usage percentage
  memoryUsage: number; // Memory usage percentage
  uptime: number; // Uptime in milliseconds
  timestamp: number;
}

export interface QualityScore {
  accuracy: number; // 0-100 based on consensus alignment
  latency: number; // 0-100 based on response time
  coverage: number; // 0-100 based on source availability
  reliability: number; // 0-100 based on historical uptime
  overall: number; // Weighted average of all components
}

export interface ConsensusData {
  median: number;
  deviation: number;
  sourceCount: number;
  timestamp: number;
}

export interface AccuracyThresholds {
  maxConsensusDeviation: number; // 0.5% for FTSO requirement
  minAccuracyRate: number; // 80% target
  minQualityScore: number; // Minimum acceptable quality
}

export interface MonitoringConfig {
  accuracyThresholds: AccuracyThresholds;
  performanceThresholds: {
    maxResponseLatency: number; // 100ms target
    maxDataAge: number; // 2000ms target
    minThroughput: number;
    minCacheHitRate: number;
  };
  healthThresholds: {
    maxErrorRate: number;
    maxCpuUsage: number;
    maxMemoryUsage: number;
    minConnectionRate: number;
  };
  monitoringInterval: number; // Monitoring frequency in ms
  alerting: AlertingConfig;
}

export enum AlertSeverity {
  INFO = "info",
  WARNING = "warning",
  ERROR = "error",
  CRITICAL = "critical",
}

export enum AlertAction {
  LOG = "log",
  EMAIL = "email",
  WEBHOOK = "webhook",
}

export interface AlertRule {
  id: string;
  name: string;
  description: string;
  metric: string;
  threshold: number;
  operator: "gt" | "lt" | "eq" | "gte" | "lte";
  severity: AlertSeverity;
  duration: number; // Duration in ms before triggering
  actions: AlertAction[];
  enabled: boolean;
  cooldown: number; // Cooldown period in ms
}

export interface Alert {
  id: string;
  ruleId: string;
  severity: AlertSeverity;
  message: string;
  timestamp: number;
  resolved: boolean;
  resolvedAt?: number;
  metadata: Record<string, any>;
}

export interface AlertingConfig {
  rules: AlertRule[];
  deliveryConfig: {
    email?: {
      enabled: boolean;
      smtpHost: string;
      smtpPort: number;
      username: string;
      password: string;
      from: string;
      to: string[];
    };
    webhook?: {
      enabled: boolean;
      url: string;
      headers?: Record<string, string>;
      timeout: number;
    };
  };
  maxAlertsPerHour: number;
  alertRetention: number; // Days to keep alerts
}
