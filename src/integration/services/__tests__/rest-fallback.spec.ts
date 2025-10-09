import { Test, TestingModule } from "@nestjs/testing";
import { DataSourceFactory } from "../data-source.factory";
import { BinanceAdapter } from "@/adapters/crypto/binance.adapter";
import { PriceUpdate } from "@/common/types/core";

describe("REST Fallback Functionality", () => {
  let factory: DataSourceFactory;
  let binanceAdapter: BinanceAdapter;
  let module: TestingModule;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [DataSourceFactory, BinanceAdapter],
    }).compile();

    factory = module.get<DataSourceFactory>(DataSourceFactory);
    binanceAdapter = module.get<BinanceAdapter>(BinanceAdapter);
  });

  afterAll(async () => {
    await module.close();
  });

  describe("DataSourceFactory REST Fallback", () => {
    it("should create data source with REST fallback capability", () => {
      const dataSource = factory.createFromAdapter(binanceAdapter);

      expect(dataSource).toBeDefined();
      expect(dataSource.fetchPriceViaREST).toBeDefined();
      expect(typeof dataSource.fetchPriceViaREST).toBe("function");
    });

    it("should call adapter's fetchTickerREST method", async () => {
      const mockPriceUpdate: PriceUpdate = {
        symbol: "BTC/USDT",
        price: 50000,
        timestamp: Date.now(),
        source: "binance",
        confidence: 0.9,
      };

      // Mock the adapter's fetchTickerREST method
      const fetchTickerRESTSpy = jest.spyOn(binanceAdapter, "fetchTickerREST").mockResolvedValue(mockPriceUpdate);

      const dataSource = factory.createFromAdapter(binanceAdapter);

      // Mock the connect method to avoid actual connection
      jest.spyOn(dataSource, "connect").mockResolvedValue();
      jest.spyOn(dataSource, "isConnected").mockReturnValue(true);

      const result = await dataSource.fetchPriceViaREST!("BTC/USDT");

      expect(result).toEqual(mockPriceUpdate);
      expect(fetchTickerRESTSpy).toHaveBeenCalledWith("BTC/USDT");

      fetchTickerRESTSpy.mockRestore();
    });

    it("should return null when adapter fetchTickerREST fails", async () => {
      // Mock the adapter's fetchTickerREST method to throw an error
      const fetchTickerRESTSpy = jest
        .spyOn(binanceAdapter, "fetchTickerREST")
        .mockRejectedValue(new Error("API Error"));

      const dataSource = factory.createFromAdapter(binanceAdapter);

      // Mock the connect method to avoid actual connection
      jest.spyOn(dataSource, "connect").mockResolvedValue();
      jest.spyOn(dataSource, "isConnected").mockReturnValue(true);

      const result = await dataSource.fetchPriceViaREST!("BTC/USDT");

      expect(result).toBeNull();
      expect(fetchTickerRESTSpy).toHaveBeenCalledWith("BTC/USDT");

      fetchTickerRESTSpy.mockRestore();
    });

    it("should attempt to connect if not connected", async () => {
      const mockPriceUpdate: PriceUpdate = {
        symbol: "BTC/USDT",
        price: 50000,
        timestamp: Date.now(),
        source: "binance",
        confidence: 0.9,
      };

      const fetchTickerRESTSpy = jest.spyOn(binanceAdapter, "fetchTickerREST").mockResolvedValue(mockPriceUpdate);

      const dataSource = factory.createFromAdapter(binanceAdapter);

      // Mock connection methods
      const connectSpy = jest.spyOn(dataSource, "connect").mockResolvedValue();
      jest.spyOn(dataSource, "isConnected").mockReturnValue(false);

      const result = await dataSource.fetchPriceViaREST!("BTC/USDT");

      expect(result).toEqual(mockPriceUpdate);
      expect(connectSpy).toHaveBeenCalled();
      expect(fetchTickerRESTSpy).toHaveBeenCalledWith("BTC/USDT");

      fetchTickerRESTSpy.mockRestore();
      connectSpy.mockRestore();
    });

    it("should return null if connection fails", async () => {
      const dataSource = factory.createFromAdapter(binanceAdapter);

      // Mock connection to fail
      const connectSpy = jest.spyOn(dataSource, "connect").mockRejectedValue(new Error("Connection failed"));
      jest.spyOn(dataSource, "isConnected").mockReturnValue(false);

      const result = await dataSource.fetchPriceViaREST!("BTC/USDT");

      expect(result).toBeNull();
      expect(connectSpy).toHaveBeenCalled();

      connectSpy.mockRestore();
    });
  });

  describe("hasRestFallbackCapability type guard", () => {
    it("should correctly identify data sources with REST capability", () => {
      const dataSource = factory.createFromAdapter(binanceAdapter);

      // Check if the data source has the REST fallback method
      const hasRestFallback = typeof dataSource.fetchPriceViaREST === "function";
      expect(hasRestFallback).toBe(true);
    });
  });
});
