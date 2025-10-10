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

  // Clear any remaining timers - use a more aggressive approach
  try {
    // Clear a wide range of potential timer IDs
    for (let i = 1; i <= 10000; i++) {
      try {
        clearTimeout(i as unknown as NodeJS.Timeout);
        clearInterval(i as unknown as NodeJS.Timeout);
      } catch {
        // Ignore errors for invalid timer IDs
      }
    }
  } catch {
    // Ignore any errors during cleanup
  }

  // Force immediate execution of any pending microtasks
  await new Promise(resolve => setImmediate(resolve));

  // Wait a bit to ensure all async operations complete
  await new Promise(resolve => setTimeout(resolve, 50));
}
