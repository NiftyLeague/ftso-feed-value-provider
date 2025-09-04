const baseConfig = require("./jest.config.js");

module.exports = {
  ...baseConfig,
  // Remove testRegex to avoid conflict with testMatch
  testRegex: undefined,
  // Specific configuration for endurance tests
  testTimeout: 60000, // 1 minute timeout for endurance tests
  testMatch: ["<rootDir>/__tests__/endurance/**/*.spec.ts"],
  // Memory optimization for endurance tests
  maxWorkers: 1,
  // Enable garbage collection
  setupFilesAfterEnv: ["<rootDir>/__tests__/test-setup.ts", "<rootDir>/__tests__/endurance/endurance-test-setup.ts"],
  // Reduce output verbosity for long-running tests
  verbose: false,
  silent: false,
  // Force exit after tests complete to prevent hanging
  forceExit: true,
  // Detect open handles but don't fail on them for endurance tests
  detectOpenHandles: false,
};
