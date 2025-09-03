/**
 * Global Jest Teardown
 *
 * This file ensures all resources are properly cleaned up after all tests complete.
 */

export default async function globalTeardown() {
  // Force garbage collection if available
  if (global.gc) {
    global.gc();
  }

  // Clear any remaining timers - use a safer approach
  try {
    const highestTimeoutId = setTimeout(() => {}, 0) as unknown as number;
    clearTimeout(highestTimeoutId);

    // Clear a range of potential timer IDs
    for (let i = 1; i <= (highestTimeoutId as number); i++) {
      try {
        clearTimeout(i as unknown as NodeJS.Timeout);
      } catch {
        // Ignore errors for invalid timer IDs
      }
    }

    // Clear any remaining intervals
    const highestIntervalId = setInterval(() => {}, 1000) as unknown as number;
    clearInterval(highestIntervalId);

    for (let i = 1; i <= (highestIntervalId as number); i++) {
      try {
        clearInterval(i as unknown as NodeJS.Timeout);
      } catch {
        // Ignore errors for invalid interval IDs
      }
    }
  } catch {
    // Ignore any errors during cleanup
  }

  // Wait a bit to ensure all async operations complete
  await new Promise(resolve => setTimeout(resolve, 100));
}
