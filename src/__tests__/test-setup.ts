/**
 * Jest Test Setup
 *
 * This file configures the test environment to suppress expected error/debug logs
 * that clutter the test output while still allowing actual test failures to show.
 *
 * Environment Variables:
 * - SUPPRESS_TEST_LOGS=false: Disable log suppression (default: true)
 * - VERBOSE_TEST_LOGS=true: Enable verbose logging (overrides suppression)
 *
 * The log suppression system filters out:
 * - Expected error messages from tests (connection failures, validation errors, etc.)
 * - NestJS framework debug/info messages
 * - WebSocket connection noise
 * - HTTP error responses from test endpoints
 * - Stack traces from expected test errors
 * - Performance monitoring messages
 *
 * Only unexpected errors and actual test failures will be displayed.
 */

// Set NODE_ENV to test to suppress some logs
process.env.NODE_ENV = "test";

// Configure test logging behavior
const SUPPRESS_TEST_LOGS = process.env.SUPPRESS_TEST_LOGS !== "false"; // Default to true
const VERBOSE_TEST_LOGS = process.env.VERBOSE_TEST_LOGS === "true"; // Default to false

// Store original console methods
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
const originalConsoleLog = console.log;
const originalConsoleDebug = console.debug;

// Patterns of expected log messages that should be suppressed during tests
const SUPPRESSED_LOG_PATTERNS = [
  // NestJS Logger patterns - match the exact format
  /^\[Nest\] \d+ - \d{2}\/\d{2}\/\d{4}, \d{1,2}:\d{2}:\d{2} [AP]M\s+(ERROR|WARN|DEBUG|LOG) \[.*\]/,

  // Expected error messages from tests
  /Error: Connection failed/,
  /Error: Invalid type/,
  /Error: Test error/,
  /Error: Test$/,
  /Error in test: Test error/,
  /Error in test: Test$/,
  /Error: Validation failed/,
  /Error: Batch validation failed/,
  /Error: Aggregation failed/,
  /Error: Cache operation failed/,
  /Error: Internal server error/,
  /Error: Provider service error/,
  /Error: Cache error/,
  /Error: CCXT adapter error/,
  /Error: CCXT also failed/,
  /Error: Unsubscribe failed/,
  /Error: Failover failed/,
  /Error: Subscribe failed/,

  // HTTP Exception patterns
  /HttpException: Invalid feed ID/,
  /HttpException: Request must contain a non-empty feeds array/,
  /HttpException: Voting round ID must be non-negative/,
  /HttpException: Time window must be between/,
  /HttpException: Unable to retrieve data for feed/,

  // Service-specific expected messages
  /Real-time validation failed for/,
  /Batch validation failed:/,
  /No healthy backup sources available/,
  /Failed to unsubscribe backup source/,
  /Complete service degradation for feed/,
  /Failover failed for source/,
  /Cache performance degraded/,
  /CCXT retry failed for/,
  /Failed to warm cache for feed/,

  // Stack trace lines that are part of expected errors
  /at Object\.<anonymous>/,
  /at Promise\.finally\.completed/,
  /at new Promise/,
  /at callAsyncCircusFn/,
  /at _callCircusTest/,
  /at processTicksAndRejections/,
  /at _runTest/,
  /at _runTestsForDescribeBlock/,
  /at run/,
  /at runAndTransformResultsToJestFormat/,
  /at jestAdapter/,
  /at runTestInternal/,
  /at runTest/,
  /at Object\.worker/,

  // Additional patterns for test output suppression
  /TypeError: Invalid type/,
  /Object\(\d+\) \{/,
  /requestId: 'test-request-id'/,
  /\}/,
  /alertId: /,
  /severity: /,
  /metadata: /,
  /value: /,
  /threshold: /,
  /feedId: /,
  /exchange: /,
  /hitRate: /,
  /memoryUsage: /,
  /responseTime: /,
  /Network error/,
  /Consensus Deviation Alert/,
  /is above threshold/,
  /for feed/,
  /on exchange/,

  // Common test error patterns that should be suppressed
  /Cannot read properties of undefined \(reading/,
  /Cannot read property .* of undefined/,
  /Cannot set property .* of undefined/,
  /TypeError: Cannot read properties of undefined/,
  /TypeError: Cannot read property/,
  /TypeError: Cannot set property/,

  // Test-specific error messages
  /TEST: Starting .* test/,
  /Feed values endpoint error:/,
  /Metrics endpoint error:/,
  /Health endpoint error:/,
  /Controller test error:/,
  /Integration test error:/,

  // HTTP status and error response patterns
  /status: 'error'/,
  /timestamp: \d+/,
  /error: 'Internal Server Error'/,
  /message: "Cannot read properties/,
  /requestId: '[a-f0-9-]+'/,

  // WebSocket connection messages
  /WebSocket connection closed:/,
  /WebSocket connection failed:/,
  /WebSocket error:/,
  /Connection timeout/,
  /Connection refused/,
  /ECONNREFUSED/,
  /ENOTFOUND/,
  /ETIMEDOUT/,

  // Adapter-specific messages
  /binance-ws, code:/,
  /kraken-ws, code:/,
  /okx-ws, code:/,
  /coinbase-ws, code:/,
  /cryptocom-ws, code:/,
  /reason:$/,
  /WebSocket connection closed: .*-ws, code:/,
  /WebSocket connection closed for/,

  // Performance and monitoring messages
  /Performance degradation detected/,
  /Cache miss rate high/,
  /Response time exceeded/,
  /Memory usage high/,

  // Generic test noise patterns
  /^\s*$/, // Empty lines
  /^[\s\{\}]*$/, // Lines with only whitespace and braces
  /^\s*\d+\s*$/, // Lines with only numbers
];

// Function to check if a log message should be suppressed
function shouldSuppressLog(message: string): boolean {
  // First check if it's a NestJS log message
  if (
    message.includes("[Nest]") &&
    (message.includes("DEBUG") || message.includes("ERROR") || message.includes("WARN") || message.includes("LOG"))
  ) {
    return true;
  }

  // Check for common test noise patterns first (most frequent)
  if (
    message.trim() === "" ||
    /^\s*[\{\}]\s*$/.test(message) ||
    /^\s*\d+\s*$/.test(message) ||
    message.includes("Cannot read properties of undefined") ||
    message.includes("TEST: Starting") ||
    message.includes("endpoint error:")
  ) {
    return true;
  }

  // Then check other patterns
  return SUPPRESSED_LOG_PATTERNS.some(pattern => pattern.test(message));
}

// Helper function to safely stringify arguments for log filtering
function stringifyLogArgs(args: unknown[]): string {
  return args
    .map(arg => {
      if (typeof arg === "string") return arg;
      if (typeof arg === "number" || typeof arg === "boolean") return String(arg);
      if (arg === null || arg === undefined) return String(arg);
      try {
        return JSON.stringify(arg, null, 2);
      } catch {
        return String(arg);
      }
    })
    .join(" ");
}

// Override console methods to suppress expected test logs
console.error = (...args: unknown[]) => {
  if (!SUPPRESS_TEST_LOGS || VERBOSE_TEST_LOGS) {
    originalConsoleError(...args);
    return;
  }

  const message = stringifyLogArgs(args);
  if (!shouldSuppressLog(message)) {
    originalConsoleError(...args);
  }
};

console.warn = (...args: unknown[]) => {
  if (!SUPPRESS_TEST_LOGS || VERBOSE_TEST_LOGS) {
    originalConsoleWarn(...args);
    return;
  }

  const message = stringifyLogArgs(args);
  if (!shouldSuppressLog(message)) {
    originalConsoleWarn(...args);
  }
};

console.log = (...args: unknown[]) => {
  if (!SUPPRESS_TEST_LOGS || VERBOSE_TEST_LOGS) {
    originalConsoleLog(...args);
    return;
  }

  const message = stringifyLogArgs(args);
  if (!shouldSuppressLog(message)) {
    originalConsoleLog(...args);
  }
};

console.debug = (...args: unknown[]) => {
  if (!SUPPRESS_TEST_LOGS || VERBOSE_TEST_LOGS) {
    originalConsoleDebug(...args);
    return;
  }

  const message = stringifyLogArgs(args);
  if (!shouldSuppressLog(message)) {
    originalConsoleDebug(...args);
  }
};

// Some loggers (including Nest's internals) may write directly to stdout/stderr.
// Patch process.stdout.write and process.stderr.write to filter expected noise.
const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalStderrWrite = process.stderr.write.bind(process.stderr);

function safeStringifyChunk(chunk: unknown): string {
  if (typeof chunk === "string") return chunk;
  if (Buffer.isBuffer(chunk)) return chunk.toString("utf8");
  try {
    return String(chunk);
  } catch {
    return "";
  }
}

process.stdout.write = ((
  chunk: unknown,
  encoding?: BufferEncoding | ((err?: Error) => void),
  cb?: (err?: Error) => void
) => {
  if (!SUPPRESS_TEST_LOGS || VERBOSE_TEST_LOGS) {
    return originalStdoutWrite(chunk as never, encoding as never, cb as never);
  }

  const message = safeStringifyChunk(chunk);
  if (shouldSuppressLog(message)) {
    // Swallow expected noisy output
    if (typeof encoding === "function") encoding();
    else if (cb) cb();
    return true;
  }
  return originalStdoutWrite(chunk as never, encoding as never, cb as never);
}) as typeof process.stdout.write;

process.stderr.write = ((
  chunk: unknown,
  encoding?: BufferEncoding | ((err?: Error) => void),
  cb?: (err?: Error) => void
) => {
  if (!SUPPRESS_TEST_LOGS || VERBOSE_TEST_LOGS) {
    return originalStderrWrite(chunk as never, encoding as never, cb as never);
  }

  const message = safeStringifyChunk(chunk);
  if (shouldSuppressLog(message)) {
    // Swallow expected noisy output
    if (typeof encoding === "function") encoding();
    else if (cb) cb();
    return true;
  }
  return originalStderrWrite(chunk as never, encoding as never, cb as never);
}) as typeof process.stderr.write;

// Track active timers and intervals for cleanup
const activeTimers = new Set<ReturnType<typeof setTimeout>>();
const activeIntervals = new Set<ReturnType<typeof setInterval>>();

// Store original timer functions
const originalSetTimeout = global.setTimeout;
const originalSetInterval = global.setInterval;
const originalClearTimeout = global.clearTimeout;
const originalClearInterval = global.clearInterval;

// Override setTimeout to track active timers
global.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
  const timer = originalSetTimeout(...args);
  activeTimers.add(timer);
  return timer;
}) as typeof setTimeout;

// Override setInterval to track active intervals
global.setInterval = ((...args: Parameters<typeof setInterval>) => {
  const interval = originalSetInterval(...args);
  activeIntervals.add(interval);
  return interval;
}) as typeof setInterval;

global.clearTimeout = ((timer: NodeJS.Timeout) => {
  activeTimers.delete(timer);
  return originalClearTimeout(timer);
}) as typeof clearTimeout;

global.clearInterval = ((interval: NodeJS.Timeout) => {
  activeIntervals.delete(interval);
  return originalClearInterval(interval);
}) as typeof clearInterval;

// Clean up all active timers and intervals after each test
afterEach(() => {
  // Clear all active timers
  activeTimers.forEach(timer => {
    originalClearTimeout(timer);
  });
  activeTimers.clear();

  // Clear all active intervals
  activeIntervals.forEach(interval => {
    originalClearInterval(interval);
  });
  activeIntervals.clear();
});

// Restore original console methods and timer functions after all tests
afterAll(() => {
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
  console.log = originalConsoleLog;
  console.debug = originalConsoleDebug;

  // Restore stdio writers
  process.stdout.write = originalStdoutWrite;
  process.stderr.write = originalStderrWrite;

  // Restore original timer functions
  global.setTimeout = originalSetTimeout;
  global.setInterval = originalSetInterval;
  global.clearTimeout = originalClearTimeout;
  global.clearInterval = originalClearInterval;

  // Final cleanup of any remaining timers
  activeTimers.forEach(timer => {
    originalClearTimeout(timer);
  });
  activeTimers.clear();

  activeIntervals.forEach(interval => {
    originalClearInterval(interval);
  });
  activeIntervals.clear();
});
