#!/usr/bin/env node

/**
 * Comprehensive Test Runner for FTSO Provider
 *
 * This script runs all test suites in the correct order and generates
 * comprehensive reports for accuracy and performance validation.
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

interface TestSuite {
  name: string;
  pattern: string;
  timeout: number;
  description: string;
  category: "unit" | "integration" | "performance" | "accuracy";
}

const TEST_SUITES: TestSuite[] = [
  // Unit Tests
  {
    name: "Exchange Adapters",
    pattern: "src/adapters/**/*.spec.ts",
    timeout: 30000,
    description: "Tests for individual exchange adapter implementations",
    category: "unit",
  },
  {
    name: "Aggregation Logic",
    pattern: "src/aggregators/**/*.spec.ts",
    timeout: 30000,
    description: "Tests for consensus aggregation algorithms",
    category: "unit",
  },
  {
    name: "Data Validation",
    pattern: "src/data-manager/validation/**/*.spec.ts",
    timeout: 30000,
    description: "Tests for data validation and quality checks",
    category: "unit",
  },

  // Integration Tests
  {
    name: "WebSocket Integration",
    pattern: "src/adapters/__tests__/websocket-integration.spec.ts",
    timeout: 120000,
    description: "Tests for real-time WebSocket connections and data flow",
    category: "integration",
  },
  {
    name: "API Integration",
    pattern: "src/api/__tests__/api-integration.spec.ts",
    timeout: 120000,
    description: "Tests for API endpoints with real data sources",
    category: "integration",
  },

  // Performance Tests
  {
    name: "Load Testing",
    pattern: "src/__tests__/performance/load-testing.spec.ts",
    timeout: 300000,
    description: "High-volume load tests for scalability validation",
    category: "performance",
  },
  {
    name: "Latency Testing",
    pattern: "src/__tests__/performance/latency-testing.spec.ts",
    timeout: 180000,
    description: "Response time tests to ensure <100ms performance",
    category: "performance",
  },
  {
    name: "Endurance Testing",
    pattern: "src/__tests__/performance/endurance-testing.spec.ts",
    timeout: 1800000, // 30 minutes
    description: "Long-term stability and resource usage tests",
    category: "performance",
  },

  // Accuracy Tests
  {
    name: "Backtesting Framework",
    pattern: "src/__tests__/accuracy/backtesting-framework.spec.ts",
    timeout: 300000,
    description: "Historical accuracy validation using backtesting",
    category: "accuracy",
  },
];

interface TestResult {
  suite: TestSuite;
  success: boolean;
  duration: number;
  output: string;
  error?: string;
  stats?: {
    passed: number;
    failed: number;
    total: number;
  };
}

class TestRunner {
  private results: TestResult[] = [];
  private startTime: number = 0;

  async runAllTests(): Promise<void> {
    console.log("🚀 Starting Comprehensive Test Suite for FTSO Provider\n");
    this.startTime = Date.now();

    // Run tests by category
    await this.runTestCategory("unit", "Unit Tests");
    await this.runTestCategory("integration", "Integration Tests");
    await this.runTestCategory("performance", "Performance Tests");
    await this.runTestCategory("accuracy", "Accuracy Tests");

    this.generateReport();
  }

  public async runTestCategory(category: string, categoryName: string): Promise<void> {
    const categoryTests = TEST_SUITES.filter(suite => suite.category === category);

    console.log(`\n📋 ${categoryName} (${categoryTests.length} suites)`);
    console.log("=".repeat(50));

    for (const suite of categoryTests) {
      await this.runTestSuite(suite);
    }
  }

  public async runTestSuite(suite: TestSuite): Promise<void> {
    console.log(`\n🧪 Running: ${suite.name}`);
    console.log(`   ${suite.description}`);
    console.log(`   Pattern: ${suite.pattern}`);
    console.log(`   Timeout: ${suite.timeout / 1000}s`);

    const startTime = Date.now();

    try {
      // Construct Jest command
      const jestCommand = [
        "npx jest",
        `--testPathPattern="${suite.pattern}"`,
        `--testTimeout=${suite.timeout}`,
        "--verbose",
        "--detectOpenHandles",
        "--forceExit",
        "--maxWorkers=1", // Run tests sequentially for performance tests
      ].join(" ");

      console.log(`   Command: ${jestCommand}`);

      const output = execSync(jestCommand, {
        encoding: "utf8",
        stdio: "pipe",
        timeout: suite.timeout + 30000, // Add buffer to Jest timeout
      });

      const duration = Date.now() - startTime;
      const stats = this.parseJestOutput(output);

      this.results.push({
        suite,
        success: true,
        duration,
        output,
        stats,
      });

      console.log(`   ✅ PASSED (${duration}ms)`);
      if (stats) {
        console.log(`   📊 ${stats.passed}/${stats.total} tests passed`);
      }
    } catch (error: any) {
      const duration = Date.now() - startTime;
      const output = error.stdout || "";
      const errorOutput = error.stderr || error.message;

      this.results.push({
        suite,
        success: false,
        duration,
        output,
        error: errorOutput,
        stats: this.parseJestOutput(output),
      });

      console.log(`   ❌ FAILED (${duration}ms)`);
      console.log(`   Error: ${errorOutput.split("\n")[0]}`);
    }
  }

  private parseJestOutput(output: string): { passed: number; failed: number; total: number } | undefined {
    // Parse Jest output for test statistics
    const testResultMatch = output.match(/Tests:\s+(\d+)\s+failed,\s+(\d+)\s+passed,\s+(\d+)\s+total/);
    if (testResultMatch) {
      return {
        failed: parseInt(testResultMatch[1]),
        passed: parseInt(testResultMatch[2]),
        total: parseInt(testResultMatch[3]),
      };
    }

    const passedOnlyMatch = output.match(/Tests:\s+(\d+)\s+passed,\s+(\d+)\s+total/);
    if (passedOnlyMatch) {
      return {
        failed: 0,
        passed: parseInt(passedOnlyMatch[1]),
        total: parseInt(passedOnlyMatch[2]),
      };
    }

    return undefined;
  }

  private generateReport(): void {
    const totalDuration = Date.now() - this.startTime;
    const successfulSuites = this.results.filter(r => r.success);
    const failedSuites = this.results.filter(r => !r.success);

    console.log("\n" + "=".repeat(80));
    console.log("📊 COMPREHENSIVE TEST REPORT");
    console.log("=".repeat(80));

    console.log(`\n⏱️  Total Duration: ${(totalDuration / 1000 / 60).toFixed(2)} minutes`);
    console.log(`✅ Successful Suites: ${successfulSuites.length}/${this.results.length}`);
    console.log(`❌ Failed Suites: ${failedSuites.length}/${this.results.length}`);

    // Category breakdown
    const categories = ["unit", "integration", "performance", "accuracy"];
    categories.forEach(category => {
      const categoryResults = this.results.filter(r => r.suite.category === category);
      const categorySuccess = categoryResults.filter(r => r.success).length;

      console.log(`\n📋 ${category.toUpperCase()} TESTS: ${categorySuccess}/${categoryResults.length} passed`);

      categoryResults.forEach(result => {
        const status = result.success ? "✅" : "❌";
        const duration = (result.duration / 1000).toFixed(2);
        const stats = result.stats ? ` (${result.stats.passed}/${result.stats.total})` : "";

        console.log(`   ${status} ${result.suite.name}: ${duration}s${stats}`);

        if (!result.success && result.error) {
          console.log(`      Error: ${result.error.split("\n")[0]}`);
        }
      });
    });

    // Generate detailed report file
    this.generateDetailedReport();

    // Final verdict
    console.log("\n" + "=".repeat(80));
    if (failedSuites.length === 0) {
      console.log("🎉 ALL TESTS PASSED - SYSTEM READY FOR PRODUCTION");
    } else {
      console.log("⚠️  SOME TESTS FAILED - REVIEW REQUIRED BEFORE PRODUCTION");
    }
    console.log("=".repeat(80));
  }

  private generateDetailedReport(): void {
    const reportDir = path.join(process.cwd(), "test-reports");
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const reportFile = path.join(reportDir, `test-report-${timestamp}.json`);

    const report = {
      timestamp: new Date().toISOString(),
      totalDuration: Date.now() - this.startTime,
      summary: {
        total: this.results.length,
        passed: this.results.filter(r => r.success).length,
        failed: this.results.filter(r => !r.success).length,
      },
      results: this.results.map(result => ({
        suite: result.suite.name,
        category: result.suite.category,
        success: result.success,
        duration: result.duration,
        stats: result.stats,
        error: result.error,
      })),
    };

    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    console.log(`\n📄 Detailed report saved to: ${reportFile}`);
  }
}

// CLI interface
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
FTSO Provider Test Runner

Usage: npm run test:comprehensive [options]

Options:
  --help, -h     Show this help message
  --category     Run only tests from specific category (unit|integration|performance|accuracy)
  --suite        Run only specific test suite by name

Examples:
  npm run test:comprehensive
  npm run test:comprehensive -- --category performance
  npm run test:comprehensive -- --suite "Load Testing"
    `);
    return;
  }

  const runner = new TestRunner();

  if (args.includes("--category")) {
    const categoryIndex = args.indexOf("--category");
    const category = args[categoryIndex + 1];

    if (!["unit", "integration", "performance", "accuracy"].includes(category)) {
      console.error("Invalid category. Must be one of: unit, integration, performance, accuracy");
      process.exit(1);
    }

    console.log(`Running only ${category} tests...`);
    await runner.runTestCategory(category, `${category.charAt(0).toUpperCase() + category.slice(1)} Tests`);
  } else if (args.includes("--suite")) {
    const suiteIndex = args.indexOf("--suite");
    const suiteName = args[suiteIndex + 1];

    const suite = TEST_SUITES.find(s => s.name === suiteName);
    if (!suite) {
      console.error(`Suite "${suiteName}" not found. Available suites:`);
      TEST_SUITES.forEach(s => console.log(`  - ${s.name}`));
      process.exit(1);
    }

    console.log(`Running only "${suiteName}" suite...`);
    await runner.runTestSuite(suite);
  } else {
    await runner.runAllTests();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error("Test runner failed:", error);
    process.exit(1);
  });
}

export { TestRunner, TEST_SUITES };
