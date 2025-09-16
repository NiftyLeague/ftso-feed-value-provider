#!/usr/bin/env node

/**
 * Ordered Test Runner
 *
 * Runs tests in optimal order: unit tests first, then integration, performance, and endurance
 */

import { spawn, ChildProcess } from "child_process";

// Define test categories in execution order
interface TestCategory {
  name: string;
  pattern: string;
  description: string;
}

const testCategories: TestCategory[] = [
  {
    name: "Unit Tests",
    pattern: "--testPathIgnorePatterns=/(accuracy|endurance|integration|performance)/",
    description: "Fast unit tests for utilities, services, and components",
  },
  {
    name: "Integration Tests",
    pattern: "--testPathPatterns=integration",
    description: "Integration tests for service interactions",
  },
  {
    name: "Accuracy Tests",
    pattern: "--testPathPatterns=accuracy",
    description: "Accuracy and backtesting",
  },
  {
    name: "Performance Tests",
    pattern: "--testPathPatterns=performance",
    description: "Performance and load testing",
  },
  {
    name: "Endurance Tests",
    pattern: "--testPathPatterns=endurance",
    description: "Long-running endurance tests",
  },
];

// Track overall results
interface TestResults {
  totalPassed: number;
  totalFailed: number;
  totalDuration: number;
}

const results: TestResults = {
  totalPassed: 0,
  totalFailed: 0,
  totalDuration: 0,
};

const startTime = Date.now();

/**
 * Run a test category
 */
function runTestCategory(category: TestCategory, index: number): Promise<number> {
  return new Promise<number>(resolve => {
    console.log(`\n${"=".repeat(80)}`);
    console.log(`🧪 ${category.name} (${index + 1}/${testCategories.length})`);
    console.log(`📝 ${category.description}`);
    console.log(`${"=".repeat(80)}\n`);

    const jestProcess: ChildProcess = spawn("npx", ["jest", category.pattern], {
      stdio: "inherit",
      cwd: process.cwd(),
      detached: false,
    });

    jestProcess.on("close", (code: number | null) => {
      const duration = Date.now() - startTime;
      results.totalDuration = duration;

      if (code === 0) {
        console.log(`\n✅ ${category.name} completed successfully`);
        results.totalPassed++;
      } else {
        console.log(`\n❌ ${category.name} failed`);
        results.totalFailed++;
      }

      resolve(code ?? 1);
    });

    jestProcess.on("error", (error: NodeJS.ErrnoException) => {
      // Ignore EPIPE errors which are common when output is redirected
      if (error.code !== "EPIPE") {
        console.error(`\n❌ Error running ${category.name}:`, error.message);
        results.totalFailed++;
        resolve(1);
      } else {
        resolve(0);
      }
    });
  });
}

/**
 * Main execution function
 */
async function runAllTests(): Promise<void> {
  console.log("🚀 Starting Ordered Test Execution");
  console.log("📊 Running tests in optimal order for faster feedback\n");

  let allPassed = true;

  for (let i = 0; i < testCategories.length; i++) {
    const category = testCategories[i];
    const exitCode = await runTestCategory(category, i);

    if (exitCode !== 0) {
      allPassed = false;
      // Continue with remaining tests even if one category fails
    }
  }

  // Print final summary
  const totalDuration = Date.now() - startTime;
  console.log(`\n${"=".repeat(80)}`);
  console.log("📊 FINAL TEST SUMMARY");
  console.log(`${"=".repeat(80)}`);
  console.log(`Total Categories: ${testCategories.length}`);
  console.log(`Passed: ${results.totalPassed}`);
  console.log(`Failed: ${results.totalFailed}`);
  console.log(`Total Duration: ${formatDuration(totalDuration)}`);

  if (allPassed) {
    console.log("\n🎉 All test categories passed successfully!");
  } else {
    console.log("\n❌ Some test categories failed. Check output above for details.");
  }

  console.log(`${"=".repeat(80)}\n`);

  process.exit(allPassed ? 0 : 1);
}

/**
 * Format duration in a human-readable way
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  return `${(ms / 60000).toFixed(1)}m`;
}

// Run the tests
runAllTests().catch((error: Error) => {
  console.error("❌ Test runner error:", error);
  process.exit(1);
});
