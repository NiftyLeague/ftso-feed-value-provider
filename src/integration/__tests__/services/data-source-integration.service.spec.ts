import { Test, TestingModule } from "@nestjs/testing";
import { DataSourceIntegrationService } from "../../services/data-source-integration.service";
import { ProductionDataManagerService } from "@/data-manager/production-data-manager";
import { ExchangeAdapterRegistry } from "@/adapters/base/exchange-adapter.registry";
import { HybridErrorHandlerService } from "@/error-handling/hybrid-error-handler.service";
import { CircuitBreakerService } from "@/error-handling/circuit-breaker.service";
import { ConnectionRecoveryService } from "@/error-handling/connection-recovery.service";
import { DataSourceFactory } from "../../services/data-source.factory";
import { EnhancedFeedId } from "@/common/types/feed.types";
import { PriceUpdate } from "@/common/interfaces/core/data-source.interface";

describe("DataSourceIntegrationService", () => {
  let service: DataSourceIntegrationService;
  let dataManager: jest.Mocked<ProductionDataManagerService>;
  let adapterRegistry: jest.Mocked<ExchangeAdapterRegistry>;
  let errorHandler: jest.Mocked<HybridErrorHandlerService>;
  let circuitBreaker: jest.Mocked<CircuitBreakerService>;
  let connectionRecovery: jest.Mocked<ConnectionRecoveryService>;
  let dataSourceFactory: jest.Mocked<DataSourceFactory>;

  beforeEach(async () => {
    const mockDataManager = {
      subscribeToFeed: jest.fn(),
      getConnectionHealth: jest.fn(),
      getConnectedSources: jest.fn(),
      addDataSource: jest.fn(),
      removeDataSource: jest.fn(),
      cleanup: jest.fn(),
      on: jest.fn(),
      emit: jest.fn(),
    };

    const mockAdapterRegistry = {
      register: jest.fn(),
      getFiltered: jest.fn(),
      getStats: jest.fn(),
      updateHealthStatus: jest.fn(),
    };

    const mockErrorHandler = {
      handleError: jest.fn(),
      on: jest.fn(),
    };

    const mockCircuitBreaker = {
      registerCircuit: jest.fn(),
      unregisterCircuit: jest.fn(),
      openCircuit: jest.fn(),
      closeCircuit: jest.fn(),
      on: jest.fn(),
    };

    const mockConnectionRecovery = {
      registerDataSource: jest.fn(),
      unregisterDataSource: jest.fn(),
      configureFeedSources: jest.fn(),
      handleDisconnection: jest.fn(),
      on: jest.fn(),
    };

    const mockDataSourceFactory = {
      createFromAdapter: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataSourceIntegrationService,
        {
          provide: ProductionDataManagerService,
          useValue: mockDataManager,
        },
        {
          provide: ExchangeAdapterRegistry,
          useValue: mockAdapterRegistry,
        },
        {
          provide: HybridErrorHandlerService,
          useValue: mockErrorHandler,
        },
        {
          provide: CircuitBreakerService,
          useValue: mockCircuitBreaker,
        },
        {
          provide: ConnectionRecoveryService,
          useValue: mockConnectionRecovery,
        },
        {
          provide: DataSourceFactory,
          useValue: mockDataSourceFactory,
        },
      ],
    }).compile();

    service = module.get<DataSourceIntegrationService>(DataSourceIntegrationService);
    dataManager = module.get(ProductionDataManagerService);
    adapterRegistry = module.get(ExchangeAdapterRegistry);
    errorHandler = module.get(HybridErrorHandlerService);
    circuitBreaker = module.get(CircuitBreakerService);
    connectionRecovery = module.get(ConnectionRecoveryService);
    dataSourceFactory = module.get(DataSourceFactory);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("initialize", () => {
    it("should register exchange adapters", async () => {
      // Arrange
      adapterRegistry.getFiltered.mockReturnValue([]);

      // Act
      await service.initialize();

      // Assert
      expect(adapterRegistry.register).toHaveBeenCalledWith("binance", expect.any(Object));
      expect(adapterRegistry.register).toHaveBeenCalledWith("coinbase", expect.any(Object));
      expect(adapterRegistry.register).toHaveBeenCalledWith("kraken", expect.any(Object));
      expect(adapterRegistry.register).toHaveBeenCalledWith("okx", expect.any(Object));
      expect(adapterRegistry.register).toHaveBeenCalledWith("cryptocom", expect.any(Object));
    });

    it("should skip already registered adapters", async () => {
      // Arrange
      const alreadyRegisteredError = new Error("Adapter binance already registered");
      adapterRegistry.register.mockImplementation(name => {
        if (name === "binance") {
          throw alreadyRegisteredError;
        }
      });
      adapterRegistry.getFiltered.mockReturnValue([]);

      // Act
      await service.initialize();

      // Assert - should not throw error and continue with other adapters
      expect(adapterRegistry.register).toHaveBeenCalledTimes(5);
    });

    it("should wire data manager events", async () => {
      // Arrange
      adapterRegistry.getFiltered.mockReturnValue([]);

      // Act
      await service.initialize();

      // Assert
      expect(dataManager.on).toHaveBeenCalledWith("sourceError", expect.any(Function));
      expect(dataManager.on).toHaveBeenCalledWith("sourceDisconnected", expect.any(Function));
      expect(dataManager.on).toHaveBeenCalledWith("sourceUnhealthy", expect.any(Function));
      expect(dataManager.on).toHaveBeenCalledWith("sourceHealthy", expect.any(Function));
      expect(dataManager.on).toHaveBeenCalledWith("priceUpdate", expect.any(Function));
    });

    it("should start data sources from active adapters", async () => {
      // Arrange
      const mockAdapter = {
        exchangeName: "binance",
        isActive: true,
        category: 1,
        capabilities: {
          supportsWebSocket: true,
          supportsREST: true,
          supportsVolume: true,
          supportsOrderBook: false,
          supportedCategories: [1],
        },
        normalizePriceData: jest.fn(),
        normalizeVolumeData: jest.fn(),
        validateResponse: jest.fn(),
        connect: jest.fn(),
        disconnect: jest.fn(),
        isConnected: jest.fn(),
        subscribe: jest.fn(),
        unsubscribe: jest.fn(),
        onPriceUpdate: jest.fn(),
        onConnectionChange: jest.fn(),
        onError: jest.fn(),
        getSymbolMapping: jest.fn(),
        validateSymbol: jest.fn(),
        calculateConfidence: jest.fn(),
        normalizeTimestamp: jest.fn(),
        parseNumber: jest.fn(),
        getConfig: jest.fn(),
        updateConfig: jest.fn(),
      } as any;
      const mockDataSource = {
        id: "binance",
        priority: 1,
        type: "websocket" as const,
        category: 1,
        isConnected: jest.fn().mockReturnValue(true),
        getLatency: jest.fn(),
        subscribe: jest.fn(),
        unsubscribe: jest.fn(),
        onPriceUpdate: jest.fn(),
        onConnectionChange: jest.fn(),
        onError: jest.fn(),
      };

      adapterRegistry.getFiltered.mockReturnValue([mockAdapter]);
      dataSourceFactory.createFromAdapter.mockReturnValue(mockDataSource);
      connectionRecovery.registerDataSource.mockResolvedValue(undefined);
      dataManager.addDataSource.mockResolvedValue(undefined);

      // Act
      await service.initialize();

      // Assert
      expect(dataSourceFactory.createFromAdapter).toHaveBeenCalledWith(mockAdapter, 1);
      expect(connectionRecovery.registerDataSource).toHaveBeenCalledWith(mockDataSource);
      expect(circuitBreaker.registerCircuit).toHaveBeenCalledWith("binance", expect.any(Object));
      expect(dataManager.addDataSource).toHaveBeenCalledWith(mockDataSource);
    });
  });

  describe("subscribeToFeed", () => {
    beforeEach(async () => {
      // Initialize the service first
      adapterRegistry.getFiltered.mockReturnValue([]);
      await service.initialize();
    });

    it("should subscribe to feed through data manager", async () => {
      // Arrange
      const feedId: EnhancedFeedId = { category: 1, name: "BTC/USD" };
      dataManager.subscribeToFeed.mockResolvedValue(undefined);

      // Act
      await service.subscribeToFeed(feedId);

      // Assert
      expect(dataManager.subscribeToFeed).toHaveBeenCalledWith(feedId);
      expect(connectionRecovery.configureFeedSources).toHaveBeenCalledWith(
        feedId,
        expect.any(Array),
        expect.any(Array)
      );
    });

    it("should handle subscription errors", async () => {
      // Arrange
      const feedId: EnhancedFeedId = { category: 1, name: "BTC/USD" };
      const error = new Error("Subscription failed");
      dataManager.subscribeToFeed.mockRejectedValue(error);

      // Act & Assert
      await expect(service.subscribeToFeed(feedId)).rejects.toThrow("Subscription failed");
      expect(errorHandler.handleError).toHaveBeenCalledWith(error, {
        component: "feedSubscription",
        sourceId: "BTC/USD",
      });
    });

    it("should throw error if not initialized", async () => {
      // Arrange
      const uninitializedService = new DataSourceIntegrationService(
        dataManager,
        adapterRegistry,
        errorHandler,
        circuitBreaker,
        connectionRecovery,
        dataSourceFactory
      );
      const feedId: EnhancedFeedId = { category: 1, name: "BTC/USD" };

      // Act & Assert
      await expect(uninitializedService.subscribeToFeed(feedId)).rejects.toThrow(
        "Data source integration not initialized"
      );
    });
  });

  describe("shutdown", () => {
    it("should disconnect all data sources", async () => {
      // Arrange
      const mockSources = [
        {
          id: "binance",
          type: "websocket" as const,
          priority: 1,
          category: 1,
          isConnected: jest.fn().mockReturnValue(true),
          getLatency: jest.fn(),
          subscribe: jest.fn(),
          unsubscribe: jest.fn(),
          onPriceUpdate: jest.fn(),
          onConnectionChange: jest.fn(),
          onError: jest.fn(),
        },
        {
          id: "coinbase",
          type: "websocket" as const,
          priority: 1,
          category: 1,
          isConnected: jest.fn().mockReturnValue(true),
          getLatency: jest.fn(),
          subscribe: jest.fn(),
          unsubscribe: jest.fn(),
          onPriceUpdate: jest.fn(),
          onConnectionChange: jest.fn(),
          onError: jest.fn(),
        },
      ];
      dataManager.getConnectedSources.mockReturnValue(mockSources);
      connectionRecovery.unregisterDataSource.mockResolvedValue(undefined);
      dataManager.removeDataSource.mockResolvedValue(undefined);

      // Act
      await service.shutdown();

      // Assert
      expect(connectionRecovery.unregisterDataSource).toHaveBeenCalledWith("binance");
      expect(connectionRecovery.unregisterDataSource).toHaveBeenCalledWith("coinbase");
      expect(circuitBreaker.unregisterCircuit).toHaveBeenCalledWith("binance");
      expect(circuitBreaker.unregisterCircuit).toHaveBeenCalledWith("coinbase");
      expect(dataManager.removeDataSource).toHaveBeenCalledWith("binance");
      expect(dataManager.removeDataSource).toHaveBeenCalledWith("coinbase");
      expect(dataManager.cleanup).toHaveBeenCalled();
    });
  });

  describe("getDataSourceHealth", () => {
    it("should return connection health from data manager", () => {
      // Arrange
      const mockHealth = Promise.resolve({
        healthScore: 85,
        connectedSources: 5,
        totalSources: 6,
        averageLatency: 50,
        failedSources: [],
      });
      dataManager.getConnectionHealth.mockReturnValue(mockHealth);

      // Act
      const result = service.getDataSourceHealth();

      // Assert
      expect(dataManager.getConnectionHealth).toHaveBeenCalled();
      expect(result).toEqual(mockHealth);
    });
  });

  describe("getAdapterStats", () => {
    it("should return adapter stats from registry", () => {
      // Arrange
      const mockStats = {
        total: 5,
        active: 4,
        byCategory: { 1: 3, 2: 1, 3: 1, 4: 0 },
        byHealth: { healthy: 3, unhealthy: 1, unknown: 1 },
      };
      adapterRegistry.getStats.mockReturnValue(mockStats);

      // Act
      const result = service.getAdapterStats();

      // Assert
      expect(adapterRegistry.getStats).toHaveBeenCalled();
      expect(result).toEqual(mockStats);
    });
  });

  describe("event handling", () => {
    beforeEach(async () => {
      // Initialize the service first
      adapterRegistry.getFiltered.mockReturnValue([]);
      await service.initialize();
    });

    it("should handle price updates correctly", () => {
      // Arrange
      const priceUpdate: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        source: "binance",
        volume: 1000,
        confidence: 0.95,
      };

      const emitSpy = jest.spyOn(service, "emit");

      // Get the price update handler
      const priceUpdateHandler = dataManager.on.mock.calls.find(call => call[0] === "priceUpdate")?.[1];

      // Act
      priceUpdateHandler?.(priceUpdate);

      // Assert
      expect(adapterRegistry.updateHealthStatus).toHaveBeenCalledWith("binance", "healthy");
      expect(emitSpy).toHaveBeenCalledWith("priceUpdate", priceUpdate);
    });

    it("should handle source errors correctly", () => {
      // Arrange
      const sourceId = "binance";
      const error = new Error("Connection failed");
      const emitSpy = jest.spyOn(service, "emit");

      // Get the source error handler
      const sourceErrorHandler = dataManager.on.mock.calls.find(call => call[0] === "sourceError")?.[1];

      // Act
      sourceErrorHandler?.(sourceId, error);

      // Assert
      expect(errorHandler.handleError).toHaveBeenCalledWith(error, {
        sourceId: "binance",
        component: "dataSource",
      });
      expect(adapterRegistry.updateHealthStatus).toHaveBeenCalledWith("binance", "unhealthy");
      expect(emitSpy).toHaveBeenCalledWith("sourceError", sourceId, error);
    });

    it("should handle source unhealthy events correctly", () => {
      // Arrange
      const sourceId = "binance";
      const emitSpy = jest.spyOn(service, "emit");

      // Get the source unhealthy handler
      const sourceUnhealthyHandler = dataManager.on.mock.calls.find(call => call[0] === "sourceUnhealthy")?.[1];

      // Act
      sourceUnhealthyHandler?.(sourceId);

      // Assert
      expect(adapterRegistry.updateHealthStatus).toHaveBeenCalledWith("binance", "unhealthy");
      expect(circuitBreaker.openCircuit).toHaveBeenCalledWith("binance", "Source unhealthy");
      expect(emitSpy).toHaveBeenCalledWith("sourceUnhealthy", sourceId);
    });

    it("should handle source healthy events correctly", () => {
      // Arrange
      const sourceId = "binance";
      const emitSpy = jest.spyOn(service, "emit");

      // Get the source healthy handler
      const sourceHealthyHandler = dataManager.on.mock.calls.find(call => call[0] === "sourceHealthy")?.[1];

      // Act
      sourceHealthyHandler?.(sourceId);

      // Assert
      expect(adapterRegistry.updateHealthStatus).toHaveBeenCalledWith("binance", "healthy");
      expect(emitSpy).toHaveBeenCalledWith("sourceHealthy", sourceId);
    });
  });
});
