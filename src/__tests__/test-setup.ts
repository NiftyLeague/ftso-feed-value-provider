/**
 * Jest Test Setup
 *
 * This file configures the test environment for optimal test execution.
 */

import type { GlobalTestLogging, ConsoleOverride } from "./utils/test-logging.types";
import { setupTestPort } from "./utils/port-utils";

// Set NODE_ENV to test
process.env.NODE_ENV = "test";

// Set up dynamic port allocation to prevent EADDRINUSE errors
beforeAll(async () => {
  try {
    const testPort = await setupTestPort();
    console.log(`Test environment using port: ${testPort}`);
  } catch (error) {
    console.error("Failed to setup test port:", error);
    // Fall back to default port with random offset
    const fallbackPort = 3101 + Math.floor(Math.random() * 1000);
    process.env.APP_PORT = fallbackPort.toString();
    process.env.VALUE_PROVIDER_CLIENT_PORT = fallbackPort.toString();
  }
});

// Global log suppression for cleaner test output
const originalConsole: ConsoleOverride = {
  error: console.error,
  warn: console.warn,
  log: console.log,
  debug: console.debug,
};

// Global flag to control test logging
let testLoggingEnabled = false;

// Function to enable logging for specific tests
(global as unknown as GlobalTestLogging).enableTestLogging = () => {
  testLoggingEnabled = true;
};

// Function to disable logging for specific tests
(global as unknown as GlobalTestLogging).disableTestLogging = () => {
  testLoggingEnabled = false;
};

// Suppress all console output during tests by default
const createConsoleOverride =
  (originalMethod: typeof console.error) =>
  (...args: unknown[]) => {
    if (testLoggingEnabled) {
      originalMethod(...args);
    }
  };

console.error = createConsoleOverride(originalConsole.error);
console.warn = createConsoleOverride(originalConsole.warn);
console.log = createConsoleOverride(originalConsole.log);
console.debug = createConsoleOverride(originalConsole.debug);

// Also suppress process.stdout.write and process.stderr.write for NestJS logs
const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalStderrWrite = process.stderr.write.bind(process.stderr);

const createStreamOverride = (originalWrite: typeof process.stdout.write) =>
  ((chunk: unknown, encoding?: BufferEncoding | ((err?: Error) => void), cb?: (err?: Error) => void) => {
    if (!testLoggingEnabled) {
      // Swallow output when logging is disabled
      if (typeof encoding === "function") encoding();
      else if (cb) cb();
      return true;
    }
    return originalWrite(chunk as never, encoding as never, cb as never);
  }) as typeof process.stdout.write;

process.stdout.write = createStreamOverride(originalStdoutWrite);
process.stderr.write = createStreamOverride(originalStderrWrite);

// Track active timers and intervals for cleanup
const activeTimers = new Set<ReturnType<typeof setTimeout>>();
const activeIntervals = new Set<ReturnType<typeof setInterval>>();

// Store original timer functions
const originalTimers = {
  setTimeout: global.setTimeout,
  setInterval: global.setInterval,
  clearTimeout: global.clearTimeout,
  clearInterval: global.clearInterval,
};

// Override timers to track active ones
global.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
  const timer = originalTimers.setTimeout(...args);
  activeTimers.add(timer);
  return timer;
}) as typeof setTimeout;

global.setInterval = ((...args: Parameters<typeof setInterval>) => {
  const interval = originalTimers.setInterval(...args);
  activeIntervals.add(interval);
  return interval;
}) as typeof setInterval;

global.clearTimeout = ((timer: NodeJS.Timeout) => {
  activeTimers.delete(timer);
  return originalTimers.clearTimeout(timer);
}) as typeof clearTimeout;

global.clearInterval = ((interval: NodeJS.Timeout) => {
  activeIntervals.delete(interval);
  return originalTimers.clearInterval(interval);
}) as typeof clearInterval;

// Clean up all active timers and intervals after each test
afterEach(async () => {
  const cleanupTimers = () => {
    activeTimers.forEach(timer => originalTimers.clearTimeout(timer));
    activeTimers.clear();
  };

  const cleanupIntervals = () => {
    activeIntervals.forEach(interval => originalTimers.clearInterval(interval));
    activeIntervals.clear();
  };

  cleanupTimers();
  cleanupIntervals();

  // Additional aggressive cleanup for any remaining timers
  try {
    // Clear Jest timers
    jest.clearAllTimers();
    jest.runOnlyPendingTimers();
    jest.useRealTimers();

    // Clear any remaining Node.js timers in a range
    for (let i = 1; i <= 1000; i++) {
      try {
        originalTimers.clearTimeout(i as unknown as NodeJS.Timeout);
        originalTimers.clearInterval(i as unknown as NodeJS.Timeout);
      } catch {
        // Ignore errors for invalid timer IDs
      }
    }

    // Force immediate execution of any pending microtasks
    await new Promise(resolve => setImmediate(resolve));
  } catch {
    // Ignore cleanup errors
  }
});

// Restore original methods and cleanup after all tests
afterAll(() => {
  // Restore console methods
  console.error = originalConsole.error;
  console.warn = originalConsole.warn;
  console.log = originalConsole.log;
  console.debug = originalConsole.debug;

  // Restore stdout/stderr writers
  process.stdout.write = originalStdoutWrite;
  process.stderr.write = originalStderrWrite;

  // Restore timer functions
  global.setTimeout = originalTimers.setTimeout;
  global.setInterval = originalTimers.setInterval;
  global.clearTimeout = originalTimers.clearTimeout;
  global.clearInterval = originalTimers.clearInterval;

  // Final cleanup of any remaining timers
  activeTimers.forEach(timer => originalTimers.clearTimeout(timer));
  activeTimers.clear();
  activeIntervals.forEach(interval => originalTimers.clearInterval(interval));
  activeIntervals.clear();
});
