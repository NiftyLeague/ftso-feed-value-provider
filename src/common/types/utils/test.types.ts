export interface MockRequestBody {
  [key: string]: unknown;
}

export interface MockResponse {
  statusCode: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
  delay?: number;
}

export interface MockWebSocketTestMessage {
  type: string;
  data: Record<string, unknown>;
  delay?: number;
  shouldError?: boolean;
}

export interface MockAlertData {
  severity: "low" | "medium" | "high" | "critical";
  message: string;
  component: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface TestConfiguration {
  timeout: number;
  retries: number;
  parallel: boolean;
  verbose: boolean;
  coverage: boolean;
  environment: "test" | "integration" | "e2e";
}

export interface MockConfiguration {
  enabled: boolean;
  delay: number;
  errorRate: number;
  responseVariation: number;
}

export interface PerformanceTestConfig {
  duration: number; // milliseconds
  concurrency: number;
  rampUp: number; // milliseconds
  rampDown: number; // milliseconds
  targetRps: number; // requests per second
}

export interface PerformanceTestResult {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  minResponseTime: number;
  maxResponseTime: number;
  p50ResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  requestsPerSecond: number;
  errorRate: number;
  duration: number;
  resourceUsage: ResourceUsage;
}

export interface LoadTestConfig {
  scenarios: LoadTestScenario[];
  duration: number;
  maxUsers: number;
  rampUpTime: number;
  thinkTime: number;
}

export interface LoadTestScenario {
  name: string;
  weight: number; // percentage
  requests: Array<{
    method: string;
    url: string;
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
  }>;
}

export interface LoadTestResult {
  scenarios: ScenarioResult[];
  overall: PerformanceTestResult;
  errors: TestError[];
}

export interface ScenarioResult {
  name: string;
  executionCount: number;
  successRate: number;
  averageResponseTime: number;
  errors: TestError[];
}

export interface ResourceUsage {
  cpu: number; // percentage
  memory: number; // bytes
  network: {
    bytesIn: number;
    bytesOut: number;
  };
  disk: {
    readBytes: number;
    writeBytes: number;
  };
}

export interface TestError {
  message: string;
  stack?: string;
  code?: string;
  timestamp: number;
  context?: Record<string, unknown>;
}

export interface IntegrationTestRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
  timeout?: number;
}

export interface IntegrationTestResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  responseTime: number;
}

export interface IntegrationTestCase {
  name: string;
  description: string;
  request: IntegrationTestRequest;
  expectedResponse: Partial<IntegrationTestResponse>;
  setup?: () => Promise<void>;
  teardown?: () => Promise<void>;
}

export interface HealthCheckTestResult {
  endpoint: string;
  status: "pass" | "fail";
  responseTime: number;
  statusCode?: number;
  error?: string;
  timestamp: number;
}

export interface SystemHealthTest {
  name: string;
  checks: HealthCheckTestResult[];
  overall: "healthy" | "degraded" | "unhealthy";
  timestamp: number;
}

export interface MockServiceConfig {
  port: number;
  routes: MockRoute[];
  middleware: MockMiddleware[];
  globalDelay: number;
  errorRate: number;
}

export interface MockRoute {
  method: string;
  path: string;
  response: MockResponse;
  delay?: number;
  errorRate?: number;
}

export interface MockMiddleware {
  name: string;
  handler: (req: MockRequest, res: MockResponse, next: () => void) => void;
}

export interface MockRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  params: Record<string, string>;
  query: Record<string, string>;
}

export interface TestDataSet {
  name: string;
  description: string;
  data: TestDataItem[];
}

export interface TestDataItem {
  id: string;
  input: Record<string, unknown>;
  expectedOutput: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface TestAssertion {
  type: "equals" | "contains" | "matches" | "greaterThan" | "lessThan" | "exists";
  field: string;
  expected: unknown;
  actual?: unknown;
}

export interface TestAssertionResult {
  assertion: TestAssertion;
  passed: boolean;
  message?: string;
}

export interface TestSuite {
  name: string;
  description: string;
  tests: TestCase[];
  setup?: () => Promise<void>;
  teardown?: () => Promise<void>;
}

export interface TestCase {
  name: string;
  description: string;
  test: () => Promise<TestResult>;
  timeout?: number;
  retries?: number;
}

export interface TestResult {
  passed: boolean;
  duration: number;
  assertions: TestAssertionResult[];
  error?: TestError;
  metadata?: Record<string, unknown>;
}

export function isMockResponse(obj: unknown): obj is MockResponse {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "statusCode" in obj &&
    "body" in obj &&
    typeof obj.statusCode === "number"
  );
}

export function isTestError(obj: unknown): obj is TestError {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "message" in obj &&
    "timestamp" in obj &&
    typeof obj.message === "string" &&
    typeof obj.timestamp === "number"
  );
}

export function isPerformanceTestResult(obj: unknown): obj is PerformanceTestResult {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "totalRequests" in obj &&
    "successfulRequests" in obj &&
    "averageResponseTime" in obj &&
    "duration" in obj
  );
}
