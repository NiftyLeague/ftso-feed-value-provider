import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@/config/config.service";
import type { EnhancedFeedId } from "@/common/types/core";

import { DataSourceIntegrationService } from "../services/data-source-integration.service";
import { IntegrationService } from "../integration.service";
import { PriceAggregationCoordinatorService } from "../services/price-aggregation-coordinator.service";
import { SystemHealthService } from "../services/system-health.service";

describe("IntegrationService", () => {
  let service: IntegrationService;
  let dataSourceIntegration: jest.Mocked<DataSourceIntegrationService>;
  let priceAggregationCoordinator: jest.Mocked<PriceAggregationCoordinatorService>;
  let systemHealth: jest.Mocked<SystemHealthService>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    const mockDataSourceIntegration = {
      initialize: jest.fn(),
      shutdown: jest.fn(),
      subscribeToFeed: jest.fn(),
      on: jest.fn(),
      emit: jest.fn(),
    };

    const mockPriceAggregationCoordinator = {
      initialize: jest.fn(),
      shutdown: jest.fn(),
      getCurrentPrice: jest.fn(),
      getCurrentPrices: jest.fn(),
      configureFeed: jest.fn(),
      on: jest.fn(),
      emit: jest.fn(),
    };

    const mockSystemHealth = {
      initialize: jest.fn(),
      shutdown: jest.fn(),
      getOverallHealth: jest.fn(),
      recordSourceHealth: jest.fn(),
      recordPriceAggregation: jest.fn(),
      recordAggregationError: jest.fn(),
      on: jest.fn(),
      emit: jest.fn(),
    };

    const mockConfigService = {
      getFeedConfigurations: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntegrationService,
        {
          provide: DataSourceIntegrationService,
          useValue: mockDataSourceIntegration,
        },
        {
          provide: PriceAggregationCoordinatorService,
          useValue: mockPriceAggregationCoordinator,
        },
        {
          provide: SystemHealthService,
          useValue: mockSystemHealth,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<IntegrationService>(IntegrationService);
    dataSourceIntegration = module.get(DataSourceIntegrationService);
    priceAggregationCoordinator = module.get(PriceAggregationCoordinatorService);
    systemHealth = module.get(SystemHealthService);
    configService = module.get(ConfigService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("onModuleInit", () => {
    it("should initialize all services in correct order", async () => {
      // Arrange
      dataSourceIntegration.initialize.mockResolvedValue(undefined);
      priceAggregationCoordinator.initialize.mockResolvedValue(undefined);
      systemHealth.initialize.mockResolvedValue(undefined);
      configService.getFeedConfigurations.mockReturnValue([]);

      // Act
      await service.onModuleInit();

      // Assert
      expect(dataSourceIntegration.initialize).toHaveBeenCalled();
      expect(priceAggregationCoordinator.initialize).toHaveBeenCalled();
      expect(systemHealth.initialize).toHaveBeenCalled();
    });

    it("should wire service interactions", async () => {
      // Arrange
      dataSourceIntegration.initialize.mockResolvedValue(undefined);
      priceAggregationCoordinator.initialize.mockResolvedValue(undefined);
      systemHealth.initialize.mockResolvedValue(undefined);
      configService.getFeedConfigurations.mockReturnValue([]);

      // Act
      await service.onModuleInit();

      // Assert
      expect(dataSourceIntegration.on).toHaveBeenCalledWith("priceUpdate", expect.any(Function));
      expect(priceAggregationCoordinator.on).toHaveBeenCalledWith("aggregatedPrice", expect.any(Function));
      expect(dataSourceIntegration.on).toHaveBeenCalledWith("sourceHealthy", expect.any(Function));
      expect(dataSourceIntegration.on).toHaveBeenCalledWith("sourceUnhealthy", expect.any(Function));
    });

    it("should subscribe to configured feeds", async () => {
      // Arrange
      const mockFeedConfig = {
        feed: { category: 1, name: "BTC/USD" } as EnhancedFeedId,
        sources: [{ exchange: "binance", symbol: "BTCUSDT" }],
      };

      dataSourceIntegration.initialize.mockResolvedValue(undefined);
      priceAggregationCoordinator.initialize.mockResolvedValue(undefined);
      systemHealth.initialize.mockResolvedValue(undefined);
      configService.getFeedConfigurations.mockReturnValue([mockFeedConfig]);
      dataSourceIntegration.subscribeToFeed.mockResolvedValue(undefined);
      priceAggregationCoordinator.configureFeed.mockResolvedValue(undefined);

      // Act
      await service.onModuleInit();

      // Assert
      expect(dataSourceIntegration.subscribeToFeed).toHaveBeenCalledWith(mockFeedConfig.feed);
      expect(priceAggregationCoordinator.configureFeed).toHaveBeenCalledWith(mockFeedConfig);
    });

    it("should emit initialized event on successful initialization", async () => {
      // Arrange
      dataSourceIntegration.initialize.mockResolvedValue(undefined);
      priceAggregationCoordinator.initialize.mockResolvedValue(undefined);
      systemHealth.initialize.mockResolvedValue(undefined);
      configService.getFeedConfigurations.mockReturnValue([]);

      const emitSpy = jest.spyOn(service, "emit");

      // Act
      await service.onModuleInit();

      // Assert
      expect(emitSpy).toHaveBeenCalledWith("initialized");
    });

    it("should throw error if initialization fails", async () => {
      // Arrange
      const error = new Error("Initialization failed");
      dataSourceIntegration.initialize.mockRejectedValue(error);

      // Act & Assert
      await expect(service.onModuleInit()).rejects.toThrow("Initialization failed");
    });
  });

  describe("onModuleDestroy", () => {
    it("should shutdown all services in reverse order", async () => {
      // Arrange
      systemHealth.shutdown.mockResolvedValue(undefined);
      priceAggregationCoordinator.shutdown.mockResolvedValue(undefined);
      dataSourceIntegration.shutdown.mockResolvedValue(undefined);

      // Act
      await service.onModuleDestroy();

      // Assert
      expect(systemHealth.shutdown).toHaveBeenCalled();
      expect(priceAggregationCoordinator.shutdown).toHaveBeenCalled();
      expect(dataSourceIntegration.shutdown).toHaveBeenCalled();
    });
  });

  describe("getCurrentPrice", () => {
    it("should delegate to price aggregation coordinator", async () => {
      // Arrange
      const feedId: EnhancedFeedId = { category: 1, name: "BTC/USD" };
      const mockPrice = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        sources: [],
        confidence: 0.95,
        consensusScore: 0.9,
      };

      // Initialize the service first
      dataSourceIntegration.initialize.mockResolvedValue(undefined);
      priceAggregationCoordinator.initialize.mockResolvedValue(undefined);
      systemHealth.initialize.mockResolvedValue(undefined);
      configService.getFeedConfigurations.mockReturnValue([]);
      await service.onModuleInit();

      priceAggregationCoordinator.getCurrentPrice.mockResolvedValue(mockPrice);

      // Act
      const result = await service.getCurrentPrice(feedId);

      // Assert
      expect(priceAggregationCoordinator.getCurrentPrice).toHaveBeenCalledWith(feedId);
      expect(result).toEqual(mockPrice);
    });

    it("should throw error if not initialized", async () => {
      // Arrange
      const feedId: EnhancedFeedId = { category: 1, name: "BTC/USD" };

      // Act & Assert
      await expect(service.getCurrentPrice(feedId)).rejects.toThrow("Integration orchestrator not initialized");
    });
  });

  describe("getCurrentPrices", () => {
    it("should delegate to price aggregation coordinator", async () => {
      // Arrange
      const feedIds: EnhancedFeedId[] = [
        { category: 1, name: "BTC/USD" },
        { category: 1, name: "ETH/USD" },
      ];
      const mockPrices = [
        {
          symbol: "BTC/USD",
          price: 50000,
          timestamp: Date.now(),
          sources: [],
          confidence: 0.95,
          consensusScore: 0.9,
        },
        {
          symbol: "ETH/USD",
          price: 3000,
          timestamp: Date.now(),
          sources: [],
          confidence: 0.93,
          consensusScore: 0.88,
        },
      ];

      // Initialize the service first
      dataSourceIntegration.initialize.mockResolvedValue(undefined);
      priceAggregationCoordinator.initialize.mockResolvedValue(undefined);
      systemHealth.initialize.mockResolvedValue(undefined);
      configService.getFeedConfigurations.mockReturnValue([]);
      await service.onModuleInit();

      priceAggregationCoordinator.getCurrentPrices.mockResolvedValue(mockPrices);

      // Act
      const result = await service.getCurrentPrices(feedIds);

      // Assert
      expect(priceAggregationCoordinator.getCurrentPrices).toHaveBeenCalledWith(feedIds);
      expect(result).toEqual(mockPrices);
    });
  });

  describe("getSystemHealth", () => {
    it("should delegate to system health service", async () => {
      // Arrange
      const mockHealth = {
        status: "healthy" as const,
        timestamp: Date.now(),
        sources: [],
        aggregation: { successRate: 100, errorCount: 0 },
        performance: { averageResponseTime: 50, errorRate: 0 },
        accuracy: { averageConfidence: 0.95, outlierRate: 0.01 },
      };

      // Initialize the service first
      dataSourceIntegration.initialize.mockResolvedValue(undefined);
      priceAggregationCoordinator.initialize.mockResolvedValue(undefined);
      systemHealth.initialize.mockResolvedValue(undefined);
      configService.getFeedConfigurations.mockReturnValue([]);
      await service.onModuleInit();

      systemHealth.getOverallHealth.mockReturnValue(mockHealth);

      // Act
      const result = await service.getSystemHealth();

      // Assert
      expect(systemHealth.getOverallHealth).toHaveBeenCalled();
      expect(result).toEqual(mockHealth);
    });
  });
});
