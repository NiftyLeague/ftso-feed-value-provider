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
  setupFilesAfterEnv: ["<rootDir>/__tests__/test-setup.ts"],
  globalTeardown: "<rootDir>/__tests__/global-teardown.ts",
  // Ensure tests exit cleanly
  detectOpenHandles: true,
  forceExit: false, // Let Jest exit naturally after cleanup
  // Timeout configuration - increased for endurance tests
  testTimeout: 30000,
  // Memory and performance settings for endurance tests
  maxWorkers: 1, // Run tests sequentially to avoid resource conflicts
  // Cleanup configuration
  clearMocks: true,
  restoreMocks: true,
  resetMocks: true,
  // Endurance test specific settings
  testEnvironmentOptions: {
    // Enable garbage collection for memory tests
    node: {
      options: ["--expose-gc", "--max-old-space-size=2048"],
    },
  },
  // Improved error handling for long-running tests
  verbose: false, // Reduce verbose output
  silent: false, // Keep false to allow our custom log filtering
};
