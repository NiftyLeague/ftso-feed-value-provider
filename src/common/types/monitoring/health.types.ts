/**
 * Health monitoring type definitions
 */

export type HealthStatusType = "healthy" | "degraded" | "unhealthy";

export interface HealthCheckDetails {
  component: string;
  status: HealthStatusType;
  timestamp: number;
  connections?: number;
  adapters?: number;
  metrics?: {
    uptime: number;
    memoryUsage: number;
    cpuUsage: number;
    connectionCount: number;
  };
}

export interface HealthCheckResult {
  isHealthy: boolean;
  details: HealthCheckDetails;
  timestamp: number;
}

export interface SystemHealthMetrics {
  status: HealthStatusType;
  connections: number;
  adapters: number;
  cache: {
    hitRate: number;
    entries: number;
  };
  timestamp: number;
}

export interface HealthStatus {
  status: HealthStatusType;
  timestamp: number;
  uptime: number;
  connections: number;
  adapters: number;
  cache: {
    hitRate: number;
    entries: number;
  };
  details?: HealthCheckResult[];
  version?: string;
  memory?: NodeJS.MemoryUsage;
  startup?: {
    initialized: boolean;
    startTime: number;
    readyTime?: number | null;
  };
  sources?: {
    healthy: string[];
    unhealthy: Array<{
      id: string;
      errorCount: number;
      lastUpdate: number;
      lastError?: string;
    }>;
    total: number;
  };
}

export interface HealthCheckResponse {
  status: HealthStatusType;
  timestamp: number;
  uptime: number;
  version?: string;
}

export interface DetailedHealthResponse {
  status: HealthStatusType;
  timestamp: number;
  uptime: number;
  version?: string;
  memory?: Record<string, number>;
  details?: Record<string, unknown>;
  components: {
    [key: string]: {
      status: HealthStatusType | string;
      details: unknown;
    };
  };
  startup?: {
    initialized: boolean;
    startTime: number;
    readyTime?: number | null;
  };
  probes?: {
    liveness: LivenessChecks;
    readiness: ReadinessChecks;
  };
  readinessDiagnostics?: ReadinessDiagnostics;
}

export interface ReadinessChecks {
  integration: { ready: boolean; status: string; error: null | string };
  provider: { ready: boolean; status: string; error: null | string };
  startup: { ready: boolean };
}

export interface LivenessChecks {
  integration: boolean;
  provider: boolean;
  memory: boolean;
  responseTime: number;
}

export interface ReadinessResponse {
  ready: boolean;
  status: string;
  timestamp: number;
  responseTime: number;
  uptime?: number;
  checks: {
    integration: { ready: boolean; status: string; error: string | null };
    provider: { ready: boolean; status: string; error: string | null };
    startup: { ready: boolean };
  };
  diagnostics?: ReadinessDiagnostics;
  startup: {
    startTime: number;
    readyTime: number | null;
  };
}

export interface ReadinessDiagnostics {
  healthySources?: number;
  totalSources?: number;
  aggregationSuccessRate?: number;
  canServeFeedData?: boolean;
  state?: "not_ready" | "warming_up" | "ready";
  validFeedCount?: number;
  totalTestFeeds?: number;
}

export interface LivenessResponse {
  alive: boolean;
  status: string;
  timestamp: number;
  uptime: number;
  checks: LivenessChecks;
}

export interface HealthAlert {
  type: string;
  sourceId?: string;
  reason?: string;
  timestamp: number;
  severity: "log" | "warning" | "error" | "critical";
  message: string;
}

export interface SourceHealthStatus {
  sourceId: string;
  status: "healthy" | "unhealthy" | "recovered";
  lastUpdate: number;
  errorCount: number;
  recoveryCount: number;
}

export interface DetailedSystemHealthMetrics {
  status: HealthStatusType;
  timestamp: number;
  sources: SourceHealthStatus[];
  aggregation: {
    successRate: number;
    errorCount: number;
    lastError?: string;
  };
  performance: {
    averageResponseTime: number;
    errorRate: number;
  };
  accuracy: {
    averageConfidence: number;
    outlierRate: number;
  };
}

export interface AdapterStats {
  total: number;
  active: number;
  byCategory: Record<string, number>;
  byHealth: Record<string, number>;
}

export interface HealthCacheStats {
  hitRate: number;
  entries: number;
  memoryUsage?: number;
  totalHits?: number;
  totalMisses?: number;
}
