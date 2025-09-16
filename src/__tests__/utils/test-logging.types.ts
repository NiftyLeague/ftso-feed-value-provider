/**
 * Test Logging Types
 *
 * Shared type definitions for test logging control system
 */

export interface GlobalTestLogging {
  enableTestLogging: () => void;
  disableTestLogging: () => void;
}

export interface ConsoleOverride {
  error: typeof console.error;
  warn: typeof console.warn;
  log: typeof console.log;
  debug: typeof console.debug;
}
