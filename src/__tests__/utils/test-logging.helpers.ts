/**
 * Test Logging Helpers
 *
 * Utilities for controlling logging in specific tests
 */

import type { GlobalTestLogging } from "./test-logging.types";

/**
 * Enable logging for the current test
 * Call this at the beginning of a test that needs to see logs
 */
export function enableLoggingForTest(): void {
  if (typeof (global as unknown as GlobalTestLogging).enableTestLogging === "function") {
    (global as unknown as GlobalTestLogging).enableTestLogging();
  }
}

/**
 * Disable logging for the current test
 * Call this at the end of a test to clean up
 */
export function disableLoggingForTest(): void {
  if (typeof (global as unknown as GlobalTestLogging).disableTestLogging === "function") {
    (global as unknown as GlobalTestLogging).disableTestLogging();
  }
}

/**
 * Run a test with logging enabled
 * Wrapper function that automatically enables/disables logging
 */
export function withLogging<T>(testFn: () => T): T {
  enableLoggingForTest();
  try {
    return testFn();
  } finally {
    disableLoggingForTest();
  }
}

/**
 * Run an async test with logging enabled
 * Wrapper function that automatically enables/disables logging
 */
export async function withLoggingAsync<T>(testFn: () => Promise<T>): Promise<T> {
  enableLoggingForTest();
  try {
    return await testFn();
  } finally {
    disableLoggingForTest();
  }
}
