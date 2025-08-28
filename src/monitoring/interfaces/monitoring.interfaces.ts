export interface MetricsCollector {
  recordLatency(operation: string, duration: number): void;
  recordAccuracy(feedId: string, deviation: number): void;
  recordError(component: string, error: Error): void;
  recordConnectionStatus(source: string, connected: boolean): void;
  getMetrics(): Promise<SystemMetrics>;
}

export interface SystemMetrics {
  accuracy: AccuracyMetrics;
  performance: PerformanceMetrics;
  health: HealthMetrics;
  operational: OperationalMetrics;
}

export interface AccuracyMetrics {
  consensusDeviation: number;
  accuracyRate: number;
  qualityScore: number;
  sourceReliability: Map<string, number>;
}

export interface PerformanceMetrics {
  responseLatency: number;
  dataFreshness: number;
  throughput: number;
  cacheHitRate: number;
}

export interface HealthMetrics {
  connectionStatus: Map<string, boolean>;
  errorRates: Map<string, number>;
  resourceUsage: ResourceUsage;
  uptime: number;
}

export interface OperationalMetrics {
  criticalOperations: number;
  providerLatency: Map<string, number>;
  componentHealth: Map<string, boolean>;
  troubleshootingInfo: TroubleshootingInfo[];
}

export interface ResourceUsage {
  cpu: number;
  memory: number;
  network: number;
}

export interface TroubleshootingInfo {
  timestamp: number;
  component: string;
  error: string;
  context: Record<string, any>;
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
  SLACK = "slack",
  PAGERDUTY = "pagerduty",
}

export interface AlertRule {
  metric: string;
  threshold: number;
  severity: AlertSeverity;
  duration: number;
  action: AlertAction;
}

export interface AlertManager {
  addRule(rule: AlertRule): void;
  removeRule(ruleId: string): void;
  checkRules(metrics: SystemMetrics): void;
  sendAlert(severity: AlertSeverity, message: string, action: AlertAction): void;
}
