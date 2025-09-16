/**
 * Endurance Test Setup
 *
 * Additional setup for endurance tests to optimize resource usage
 * and prevent memory leaks during long-running tests.
 */

import type { GlobalTestLogging } from "../utils/test-logging.types";

// Enable garbage collection for endurance tests
if (typeof global.gc === "undefined") {
  // Try to enable garbage collection
  try {
    require("v8").setFlagsFromString("--expose_gc");
    global.gc = require("vm").runInNewContext("gc");
  } catch {
    // Garbage collection not available - create a no-op function
    (global as typeof globalThis).gc = async () => {
      // No-op if gc is not available
    };
  }
}

// Resource cleanup utilities
let resourceCleanupInterval: NodeJS.Timeout | null = null;

// Start periodic resource cleanup for endurance tests
beforeAll(() => {
  // Clean up resources every 5 seconds during endurance tests
  resourceCleanupInterval = setInterval(() => {
    if (global.gc) {
      global.gc();
    }
  }, 5000);
});

// Stop resource cleanup after tests
afterAll(() => {
  if (resourceCleanupInterval) {
    clearInterval(resourceCleanupInterval);
    resourceCleanupInterval = null;
  }

  // Final cleanup
  if (global.gc) {
    global.gc();
  }
});

// Enhanced cleanup after each endurance test
afterEach(() => {
  // Force garbage collection after each test
  if (global.gc) {
    global.gc();
  }

  // Clear any remaining timers more aggressively
  const maxTimerId = setTimeout(() => {}, 0) as unknown as number;
  clearTimeout(maxTimerId);

  for (let i = 1; i <= maxTimerId; i++) {
    try {
      clearTimeout(i as unknown as NodeJS.Timeout);
      clearInterval(i as unknown as NodeJS.Timeout);
    } catch {
      // Ignore errors for invalid timer IDs
    }
  }
});

// Set process limits for endurance tests
process.setMaxListeners(50); // Increase max listeners for endurance tests

// Handle unhandled rejections gracefully in endurance tests
process.on("unhandledRejection", (reason, _promise) => {
  // Log but don't crash during endurance tests
  // Enable logging for endurance test error handling
  if (typeof (global as unknown as GlobalTestLogging).enableTestLogging === "function") {
    (global as unknown as GlobalTestLogging).enableTestLogging();
  }
  console.warn("Unhandled Rejection in endurance test:", reason);
});

// Handle uncaught exceptions gracefully in endurance tests
process.on("uncaughtException", error => {
  // Log but don't crash during endurance tests
  // Enable logging for endurance test error handling
  if (typeof (global as unknown as GlobalTestLogging).enableTestLogging === "function") {
    (global as unknown as GlobalTestLogging).enableTestLogging();
  }
  console.warn("Uncaught Exception in endurance test:", error.message);
});
