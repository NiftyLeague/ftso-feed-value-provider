#!/usr/bin/env node

/**
 * Configuration Validation CLI Tool
 *
 * This tool validates the current configuration and provides detailed reports
 * about any issues or warnings.
 *
 * Usage:
 *   pnpm exec ts-node src/config/validate-config.ts
 *   pnpm validate-config
 *
 * Requirements: 5.1, 5.2
 */

import { ConfigService } from "./config.service";

function formatValidationResult(title: string, result: any): string {
  let output = `\n=== ${title} ===\n`;

  if (result.isValid) {
    output += "✅ Valid\n";
  } else {
    output += "❌ Invalid\n";
  }

  if (result.errors && result.errors.length > 0) {
    output += "\n🚨 Errors:\n";
    result.errors.forEach((error: string) => {
      output += `  - ${error}\n`;
    });
  }

  if (result.missingRequired && result.missingRequired.length > 0) {
    output += "\n❗ Missing Required:\n";
    result.missingRequired.forEach((missing: string) => {
      output += `  - ${missing}\n`;
    });
  }

  if (result.invalidValues && result.invalidValues.length > 0) {
    output += "\n⚠️  Invalid Values:\n";
    result.invalidValues.forEach((invalid: string) => {
      output += `  - ${invalid}\n`;
    });
  }

  if (result.warnings && result.warnings.length > 0) {
    output += "\n⚠️  Warnings:\n";
    result.warnings.forEach((warning: string) => {
      output += `  - ${warning}\n`;
    });
  }

  return output;
}

function formatConfigurationStatus(status: any): string {
  let output = "\n=== Configuration Status ===\n";

  output += `\n📊 Environment Configuration:\n`;
  output += `  - Valid: ${status.environment.isValid ? "✅" : "❌"}\n`;
  output += `  - Loaded At: ${status.environment.loadedAt}\n`;

  output += `\n📋 Feed Configuration:\n`;
  output += `  - Total Feeds: ${status.feeds.count}\n`;
  output += `  - Hot Reload: ${status.feeds.hotReloadEnabled ? "✅ Enabled" : "❌ Disabled"}\n`;
  output += `  - File Path: ${status.feeds.filePath}\n`;
  output += `  - Loaded At: ${status.feeds.loadedAt}\n`;

  output += `\n🔌 Adapter Configuration:\n`;
  output += `  - Custom Adapters: ${status.adapters.customAdapterCount}\n`;
  output += `  - CCXT Adapters: ${status.adapters.ccxtAdapterCount}\n`;
  output += `  - Total Exchanges: ${status.adapters.totalExchanges}\n`;

  return output;
}

function formatDetailedValidation(validation: any): string {
  let output = "\n=== Detailed Validation Report ===\n";

  output += `\n📈 Overall Status:\n`;
  output += `  - Valid: ${validation.overall.isValid ? "✅" : "❌"}\n`;
  output += `  - Critical Errors: ${validation.overall.criticalErrors}\n`;
  output += `  - Warnings: ${validation.overall.warnings}\n`;

  output += formatValidationResult("Environment Configuration", validation.environment);

  output += `\n📋 Feed Configuration Summary:\n`;
  output += `  - Total Feeds: ${validation.feeds.totalFeeds}\n`;
  output += `  - Total Sources: ${validation.feeds.totalSources}\n`;

  const invalidFeeds = validation.feeds.validationResults.filter((f: any) => !f.isValid);
  if (invalidFeeds.length > 0) {
    output += `\n❌ Invalid Feeds (${invalidFeeds.length}):\n`;
    invalidFeeds.forEach((feed: any) => {
      output += `  - ${feed.feedName}:\n`;
      feed.errors.forEach((error: string) => {
        output += `    • ${error}\n`;
      });
    });
  }

  const feedsWithWarnings = validation.feeds.validationResults.filter((f: any) => f.warnings.length > 0);
  if (feedsWithWarnings.length > 0) {
    output += `\n⚠️  Feeds with Warnings (${feedsWithWarnings.length}):\n`;
    feedsWithWarnings.forEach((feed: any) => {
      output += `  - ${feed.feedName}:\n`;
      feed.warnings.forEach((warning: string) => {
        output += `    • ${warning}\n`;
      });
    });
  }

  return output;
}

async function main() {
  console.log("🔍 FTSO Feed Value Provider - Configuration Validation");
  console.log("======================================================");

  try {
    // Initialize configuration service
    console.log("\n📥 Loading configuration...");
    const configService = new ConfigService();

    // Get configuration status
    const status = configService.getConfigurationStatus();
    console.log(formatConfigurationStatus(status));

    // Perform detailed validation
    console.log("\n🔍 Performing detailed validation...");
    const validation = configService.validateCurrentConfiguration();
    console.log(formatDetailedValidation(validation));

    // Summary
    console.log("\n=== Summary ===");
    if (validation.overall.isValid) {
      console.log("✅ Configuration is valid and ready for production use.");
    } else {
      console.log("❌ Configuration has issues that need to be addressed.");
      console.log(`   Critical Errors: ${validation.overall.criticalErrors}`);
      console.log(`   Warnings: ${validation.overall.warnings}`);
    }

    // Exit with appropriate code
    process.exit(validation.overall.isValid ? 0 : 1);
  } catch (error) {
    console.error("\n💥 Configuration validation failed:");
    console.error(error.message);

    if (error.stack) {
      console.error("\nStack trace:");
      console.error(error.stack);
    }

    console.log("\n💡 Tips:");
    console.log("  - Check that all required environment variables are set");
    console.log("  - Verify that feeds.json exists and has valid JSON syntax");
    console.log("  - Review the environment variables documentation in src/config/environment-variables.md");

    process.exit(1);
  }
}

// Run the validation if this script is executed directly
if (require.main === module) {
  main().catch(error => {
    console.error("Unexpected error:", error);
    process.exit(1);
  });
}

export { main as validateConfiguration };
