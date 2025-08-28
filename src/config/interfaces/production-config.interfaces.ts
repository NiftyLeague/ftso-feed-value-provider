import { EnhancedFeedId, FeedCategory } from "@/types";
import { ExchangeAdapter } from "@/interfaces/exchange-adapter.interface";
import { AggregationConfig, ValidationConfig } from "@/aggregators/base/aggregation.interfaces";
import { AlertRule } from "@/monitoring/interfaces/monitoring.interfaces";

export interface ProductionFeedConfig {
  feed: EnhancedFeedId;
  sources: DataSourceConfig[];
  validation: ValidationConfig;
  aggregation: AggregationConfig;
  monitoring: MonitoringConfig;
}

export interface DataSourceConfig {
  exchange: string;
  symbol: string;
  type: "websocket" | "rest";
  priority: number;
  weight: number;
  maxLatency: number;
  adapter: ExchangeAdapter;
  fallbackSources?: DataSourceConfig[];
}

export interface MonitoringConfig {
  alertRules: AlertRule[];
  metricsEnabled: boolean;
  healthCheckInterval: number;
}

// Category-specific exchange mappings
export interface CategoryExchangeMapping {
  [FeedCategory.Crypto]: CryptoExchange[];
  [FeedCategory.Forex]: ForexExchange[];
  [FeedCategory.Commodity]: CommodityExchange[];
  [FeedCategory.Stock]: StockExchange[];
}

export interface CryptoExchange {
  name: "binance" | "bitmart" | "bybit" | "coinbase" | "cryptocom" | "gate" | "kraken" | "kucoin" | "okx" | "probit";
  websocketSupport: boolean;
  restFallback: boolean;
  supportedPairs: string[];
}

export interface ForexExchange {
  name: "fxpro" | "oanda" | "currencylayer" | "exchangerate-api";
  websocketSupport: boolean;
  restFallback: boolean;
  supportedPairs: string[];
}

export interface CommodityExchange {
  name: "quandl" | "alpha-vantage" | "marketstack" | "commodity-api";
  websocketSupport: boolean;
  restFallback: boolean;
  supportedPairs: string[];
}

export interface StockExchange {
  name: "alpha-vantage" | "iex-cloud" | "polygon" | "finnhub";
  websocketSupport: boolean;
  restFallback: boolean;
  supportedPairs: string[];
}

// CCXT Fallback configuration using existing implementation
export interface CcxtFallbackConfig {
  enabled: boolean;
  fallbackDelay: number; // Immediate fallback delay (50ms max for FTSO requirements)
  ccxtConfig: {
    tradesLimit: number;
    retryBackoffMs: number;
    lambda: number; // Exponential decay parameter for weighted median
  };
}
