import { Test, TestingModule } from "@nestjs/testing";
import { FtsoProviderService } from "../../app.service";
import { RealTimeAggregationService } from "../../aggregators/real-time-aggregation.service";
import { ConfigService } from "../../config/config.service";
import { ValidationService } from "../../data-manager/validation/validation.service";
import type { IFtsoProviderService, IAggregationService, IConfigurationService, IDataValidatorService } from "../types";

describe("Service Interface Implementation", () => {
  let ftsoProviderService: IFtsoProviderService;
  let aggregationService: IAggregationService;
  let configService: IConfigurationService;
  let validationService: IDataValidatorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: FtsoProviderService,
          useValue: {
            getValue: jest.fn(),
            getValues: jest.fn(),
            getVolumes: jest.fn(),
            healthCheck: jest.fn(),
            getPerformanceMetrics: jest.fn(),
            setIntegrationService: jest.fn(),
            getHealthStatus: jest.fn(),
            getServicePerformanceMetrics: jest.fn(),
            getServiceName: jest.fn().mockReturnValue("FtsoProviderService"),
          },
        },
        {
          provide: RealTimeAggregationService,
          useValue: {
            getAggregatedPrice: jest.fn(),
            addPriceUpdate: jest.fn(),
            subscribe: jest.fn(),
            getQualityMetrics: jest.fn(),
            getCacheStats: jest.fn(),
            getActiveFeedCount: jest.fn(),
            processPriceUpdate: jest.fn(),
            clearCache: jest.fn(),
            getHealthStatus: jest.fn(),
            getServicePerformanceMetrics: jest.fn(),
            getServiceName: jest.fn().mockReturnValue("RealTimeAggregationService"),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            getFeedConfigurations: jest.fn(),
            getFeedConfiguration: jest.fn(),
            getFeedConfigurationsByCategory: jest.fn(),
            getEnvironmentConfig: jest.fn(),
            validateConfiguration: jest.fn(),
            reloadConfiguration: jest.fn(),
            hasCustomAdapter: jest.fn(),
            getAdapterClass: jest.fn(),
            getCcxtId: jest.fn(),
            getExchangeApiKey: jest.fn(),
            getHealthStatus: jest.fn(),
            getServicePerformanceMetrics: jest.fn(),
            getServiceName: jest.fn().mockReturnValue("ConfigService"),
          },
        },
        {
          provide: ValidationService,
          useValue: {
            validatePriceUpdate: jest.fn(),
            validateBatch: jest.fn(),
            filterValidUpdates: jest.fn(),
            getValidationStats: jest.fn(),
            clearCache: jest.fn(),
            clearHistoricalData: jest.fn(),
            validateRealTime: jest.fn(),
            getHealthStatus: jest.fn(),
            getServicePerformanceMetrics: jest.fn(),
            getServiceName: jest.fn().mockReturnValue("ValidationService"),
          },
        },
      ],
    }).compile();

    ftsoProviderService = module.get<IFtsoProviderService>(FtsoProviderService);
    aggregationService = module.get<IAggregationService>(RealTimeAggregationService);
    configService = module.get<IConfigurationService>(ConfigService);
    validationService = module.get<IDataValidatorService>(ValidationService);
  });

  describe("IFtsoProviderService", () => {
    it("should implement all required methods", () => {
      expect(ftsoProviderService.getValue).toBeDefined();
      expect(ftsoProviderService.getValues).toBeDefined();
      expect(ftsoProviderService.getVolumes).toBeDefined();
      expect(ftsoProviderService.healthCheck).toBeDefined();
      expect(ftsoProviderService.getPerformanceMetrics).toBeDefined();
      expect(ftsoProviderService.setIntegrationService).toBeDefined();
      expect(ftsoProviderService.getServiceName()).toBe("FtsoProviderService");
    });
  });

  describe("IAggregationService", () => {
    it("should implement all required methods", () => {
      expect(aggregationService.getAggregatedPrice).toBeDefined();
      expect(aggregationService.addPriceUpdate).toBeDefined();
      expect(aggregationService.subscribe).toBeDefined();
      expect(aggregationService.getQualityMetrics).toBeDefined();
      expect(aggregationService.getCacheStats).toBeDefined();
      expect(aggregationService.getActiveFeedCount).toBeDefined();
      expect(aggregationService.processPriceUpdate).toBeDefined();
      expect(aggregationService.clearCache).toBeDefined();
      expect(aggregationService.getServiceName()).toBe("RealTimeAggregationService");
    });
  });

  describe("IConfigurationService", () => {
    it("should implement all required methods", () => {
      expect(configService.getFeedConfigurations).toBeDefined();
      expect(configService.getFeedConfiguration).toBeDefined();
      expect(configService.getFeedConfigurationsByCategory).toBeDefined();
      expect(configService.getEnvironmentConfig).toBeDefined();
      expect(configService.validateConfiguration).toBeDefined();
      expect(configService.reloadConfiguration).toBeDefined();
      expect(configService.hasCustomAdapter).toBeDefined();
      expect(configService.getAdapterClass).toBeDefined();
      expect(configService.getCcxtId).toBeDefined();
      expect(configService.getExchangeApiKey).toBeDefined();
      expect(configService.getServiceName()).toBe("ConfigService");
    });
  });

  describe("IDataValidatorService", () => {
    it("should implement all required methods", () => {
      expect(validationService.validatePriceUpdate).toBeDefined();
      expect(validationService.validateBatch).toBeDefined();
      expect(validationService.filterValidUpdates).toBeDefined();
      expect(validationService.getValidationStats).toBeDefined();
      expect(validationService.clearCache).toBeDefined();
      expect(validationService.clearHistoricalData).toBeDefined();
      expect(validationService.validateRealTime).toBeDefined();
      expect(validationService.getServiceName()).toBe("ValidationService");
    });
  });
});
