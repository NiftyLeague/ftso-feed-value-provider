import { ITimestamped } from "../core/common.types";

/**
 * Defines the severity levels for alerts.
 */
export enum AlertSeverity {
  INFO = "info",
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
  CRITICAL = "critical",
  WARNING = "warning",
  ERROR = "error",
}

/**
 * Defines the types of actions that can be triggered by an alert.
 */
export enum AlertAction {
  EMAIL = "email",
  WEBHOOK = "webhook",
  SLACK = "slack",
  LOG = "log",
}

/**
 * Defines an alert rule configuration
 */
export interface AlertRule {
  id: string;
  name: string;
  enabled: boolean;
  description?: string;
  condition: {
    metric: string;
    operator: ">" | "<" | "==" | "gt" | "gte" | "lt" | "lte" | "eq";
    threshold: number;
  };
  severity: AlertSeverity;
  actions: AlertAction[];
  cooldown?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Alert rule evaluation result
 */
export interface AlertRuleEvaluation {
  rule: AlertRule;
  triggered: boolean;
  value: number;
  threshold: number;
  timestamp: number;
}

/**
 * Metadata for alert evaluation events
 */
export interface AlertEvaluationMetadata extends Omit<ITimestamped, "timestamp"> {
  /** The alert rule that was evaluated */
  rule: AlertRule;
  /** The value that triggered the alert */
  value: number;
  /** The threshold that was exceeded */
  threshold: number;
  /** When the alert was triggered */
  timestamp: number;
  /** How long the evaluation took in milliseconds */
  evaluationTime?: number;
  /** Number of data points considered */
  dataPoints?: number;
  /** The actual value that triggered the alert */
  actualValue?: number;
  /** Source of the alert */
  source?: string;
  /** Component that triggered the alert */
  component?: string;
  /** Feed ID if applicable */
  feedId?: string;
  /** Additional context data */
  context?: Record<string, unknown>;
}

export interface AlertMetadata {
  ruleId: string;
  ruleName: string;
  severity: AlertSeverity;
  tags: string[];
  environment: string;
  source: string;
  component: string;
  timestamp: number;
  metric: string;
  feedId?: string;
  context?: Record<string, unknown>;
  [key: string]: unknown; // Add index signature
}

/**
 * Base interface for all alert data.
 */
export interface BaseAlertData extends ITimestamped {}

/**
 * Alert data for accuracy-related issues.
 */
export interface AccuracyAlertData {
  feedId: string;
  deviation: number;
  threshold: number;
}

/**
 * Alert data for performance-related issues.
 */
export interface PerformanceAlertData {
  component: string;
  metric: string;
  value: number;
  threshold: number;
  /** Optional timestamp when the alert was generated */
  timestamp?: number;
  /** Optional severity level for the alert */
  severity?: AlertSeverity;
  /** Optional additional metadata for context */
  metadata?: Record<string, unknown>;
}

/**
 * Union type for all possible alert data structures.
 */
export type AlertData = AccuracyAlertData | PerformanceAlertData;

/**
 * Represents an alert instance.
 */
export interface Alert {
  id: string;
  ruleId: string;
  type: string; // e.g., "metric", "system", "custom"
  title: string;
  description?: string;
  message: string;
  timestamp: number;
  status: "active" | "resolved" | "suppressed";
  resolved: boolean;
  resolvedAt?: number;
  metadata?: Record<string, unknown>;
  evaluationMetadata?: AlertEvaluationMetadata;
  severity: AlertSeverity;
}
