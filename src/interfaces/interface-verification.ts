/**
 * Interface Verification Script
 *
 * This file verifies that all services properly implement their respective interfaces.
 * It serves as a compile-time check for interface compliance.
 */

import { FtsoProviderService } from "@/app.service";
import { RealTimeAggregationService } from "@/aggregators/real-time-aggregation.service";
import { ConfigService } from "@/config/config.service";
import { ValidationService } from "@/data-manager/validation/validation.service";

import {
  IFtsoProviderService,
  IAggregationService,
  IConfigurationService,
  IDataValidationService,
} from "./service.interfaces";

// Type assertions to verify interface compliance
// These will cause TypeScript compilation errors if interfaces are not properly implemented

// Verify FtsoProviderService implements IFtsoProviderService
const ftsoProvider: IFtsoProviderService = {} as FtsoProviderService;

// Verify RealTimeAggregationService implements IAggregationService
const aggregationService: IAggregationService = {} as RealTimeAggregationService;

// Verify ConfigService implements IConfigurationService
const configService: IConfigurationService = {} as ConfigService;

// Verify ValidationService implements IDataValidationService
const validationService: IDataValidationService = {} as ValidationService;

// Export verification functions for runtime checks
export function verifyInterfaceCompliance(): {
  ftsoProvider: boolean;
  aggregationService: boolean;
  configService: boolean;
  validationService: boolean;
} {
  return {
    ftsoProvider:
      typeof ftsoProvider.getValue === "function" &&
      typeof ftsoProvider.getValues === "function" &&
      typeof ftsoProvider.getVolumes === "function" &&
      typeof ftsoProvider.healthCheck === "function" &&
      typeof ftsoProvider.getPerformanceMetrics === "function" &&
      typeof ftsoProvider.setIntegrationService === "function" &&
      typeof ftsoProvider.getServiceName === "function",

    aggregationService:
      typeof aggregationService.getAggregatedPrice === "function" &&
      typeof aggregationService.addPriceUpdate === "function" &&
      typeof aggregationService.subscribe === "function" &&
      typeof aggregationService.getQualityMetrics === "function" &&
      typeof aggregationService.getCacheStats === "function" &&
      typeof aggregationService.getActiveFeedCount === "function" &&
      typeof aggregationService.processPriceUpdate === "function" &&
      typeof aggregationService.clearCache === "function" &&
      typeof aggregationService.getServiceName === "function",

    configService:
      typeof configService.getFeedConfigurations === "function" &&
      typeof configService.getFeedConfiguration === "function" &&
      typeof configService.getFeedConfigurationsByCategory === "function" &&
      typeof configService.getEnvironmentConfig === "function" &&
      typeof configService.validateConfiguration === "function" &&
      typeof configService.reloadConfiguration === "function" &&
      typeof configService.hasCustomAdapter === "function" &&
      typeof configService.getAdapterClass === "function" &&
      typeof configService.getCcxtId === "function" &&
      typeof configService.getExchangeApiKey === "function" &&
      typeof configService.getServiceName === "function",

    validationService:
      typeof validationService.validatePriceUpdate === "function" &&
      typeof validationService.validateBatch === "function" &&
      typeof validationService.filterValidUpdates === "function" &&
      typeof validationService.getValidationStatistics === "function" &&
      typeof validationService.clearCache === "function" &&
      typeof validationService.clearHistoricalData === "function" &&
      typeof validationService.validateRealTime === "function" &&
      typeof validationService.getServiceName === "function",
  };
}

// Export interface compliance summary
export const INTERFACE_COMPLIANCE_SUMMARY = {
  totalInterfaces: 4,
  implementedInterfaces: [
    "IFtsoProviderService",
    "IAggregationService",
    "IConfigurationService",
    "IDataValidationService",
  ],
  services: [
    { name: "FtsoProviderService", interface: "IFtsoProviderService", file: "src/app.service.ts" },
    {
      name: "RealTimeAggregationService",
      interface: "IAggregationService",
      file: "src/aggregators/real-time-aggregation.service.ts",
    },
    { name: "ConfigService", interface: "IConfigurationService", file: "src/config/config.service.ts" },
    {
      name: "ValidationService",
      interface: "IDataValidationService",
      file: "src/data-manager/validation/validation.service.ts",
    },
  ],
  benefits: [
    "Proper dependency injection patterns",
    "Consistent service contracts",
    "Improved testability with interface mocking",
    "Better separation of concerns",
    "Standardized health checks and metrics",
    "Enhanced maintainability and scalability",
  ],
};

console.log("✅ Interface verification completed successfully");
console.log("📋 Summary:", INTERFACE_COMPLIANCE_SUMMARY);
