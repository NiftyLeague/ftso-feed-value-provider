module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: "src",
  testRegex: ".*\\.spec\\.ts$",
  transform: {
    "^.+\\.(t|j)s$": "ts-jest",
  },
  collectCoverageFrom: ["**/*.(t|j)s"],
  coverageDirectory: "../coverage",
  testEnvironment: "node",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
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
  detectOpenHandles: true, // Enable to help identify hanging processes
  forceExit: false, // Allow proper cleanup unless forced via CLI
  // Timeout configuration - optimized per test type
  testTimeout: process.env.npm_lifecycle_event?.includes("endurance") ? 60000 : 15000, // Reduced timeout for faster failure
  // Parallel execution for faster tests, sequential for complex ones
  maxWorkers:
    process.env.npm_lifecycle_event?.includes("endurance") ||
    process.env.npm_lifecycle_event?.includes("integration") ||
    process.env.npm_lifecycle_event?.includes("performance")
      ? 1
      : 2, // Reduced from 50% to prevent resource contention
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
