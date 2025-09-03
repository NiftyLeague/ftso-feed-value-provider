/**
 * Jest Test Setup
 *
 * This file configures the test environment to suppress expected error/debug logs
 * that clutter the test output while still allowing actual test failures to show.
 */

// Set NODE_ENV to test to suppress some logs
process.env.NODE_ENV = "test";

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

  // Then check other patterns
  return SUPPRESSED_LOG_PATTERNS.some(pattern => pattern.test(message));
}

// Override console methods to suppress expected test logs
console.error = (...args: unknown[]) => {
  const message = args.join(" ");
  if (!shouldSuppressLog(message)) {
    originalConsoleError(...args);
  }
};

console.warn = (...args: unknown[]) => {
  const message = args.join(" ");
  if (!shouldSuppressLog(message)) {
    originalConsoleWarn(...args);
  }
};

console.log = (...args: unknown[]) => {
  const message = args.join(" ");
  if (!shouldSuppressLog(message)) {
    originalConsoleLog(...args);
  }
};

console.debug = (...args: unknown[]) => {
  const message = args.join(" ");
  if (!shouldSuppressLog(message)) {
    originalConsoleDebug(...args);
  }
};

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
