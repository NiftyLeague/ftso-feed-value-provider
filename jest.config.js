module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: "src",
  testRegex: ".*\\.spec\\.ts$",
  transform: {
    "^.+\\.(t|j)s$": "ts-jest",
  },
  collectCoverageFrom: [
    "**/*.{ts,js}",
    // Exclude test files
    "!**/*.spec.ts",
    "!**/__tests__/**",
    // Exclude type files
    "!**/*.d.ts",
    "!**/*.types.ts",
    "!common/types/**",
    // Barrel re-exports are not meaningful for runtime coverage
    "!**/index.ts",
    // Very large vendor-integration wrapper; covered primarily by integration tests
    "!adapters/crypto/ccxt.adapter.ts",
    // Bootstrap is intentionally not unit-tested (wiring + side-effects)
    "!main.ts",
  ],
  coverageDirectory: "../coverage",
  // Ensure `collectCoverageFrom` can include files not executed by tests.
  // (V8 coverage only reports executed files, which can hide untested modules.)
  coverageProvider: "babel",
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 85,
      lines: 85,
      statements: 85,
    },
  },
  testEnvironment: "node",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
    "^ws$": "<rootDir>/__tests__/utils/mock.ws.ts",
  },
  setupFilesAfterEnv: [
    "<rootDir>/__tests__/test-setup.ts",
    // Conditionally include endurance setup for endurance tests
    ...(process.env.npm_lifecycle_event === "test:endurance" || process.argv.includes("endurance")
      ? ["<rootDir>/__tests__/endurance/endurance-test-setup.ts"]
      : []),
  ],
  globalTeardown: "<rootDir>/__tests__/global-teardown.ts",
  // Test ordering will be handled by file naming conventions
  // Test execution settings - optimized to prevent hanging
  // Default to clean shutdowns; opt into these via env vars when troubleshooting.
  detectOpenHandles: process.env.JEST_DETECT_OPEN_HANDLES === "true",
  forceExit: process.env.JEST_FORCE_EXIT === "true",
  // Timeout configuration - optimized per test type
  testTimeout: process.env.npm_lifecycle_event?.includes("endurance") ? 60000 : 15000, // Reduced timeout for faster failure
  // Parallel execution for faster tests, sequential for complex ones
  maxWorkers: (() => {
    const lifecycle = process.env.npm_lifecycle_event ?? "";
    const isCoverageRun = lifecycle.includes("cov") || process.argv.includes("--coverage");

    if (
      isCoverageRun ||
      lifecycle.includes("endurance") ||
      lifecycle.includes("integration") ||
      lifecycle.includes("performance")
    ) {
      return 1;
    }

    return 2; // Reduced from 50% to prevent resource contention
  })(),
  // Cleanup configuration
  clearMocks: true,
  restoreMocks: true,
  resetMocks: true,
  // Test environment settings
  testEnvironmentOptions: {
    node: {
      options: ["--expose-gc", "--max-old-space-size=2048"],
    },
  },
  // Optimized output settings
  verbose: false,
  silent: false,
  // Use default reporter for stability
  reporters: ["default"],
};
