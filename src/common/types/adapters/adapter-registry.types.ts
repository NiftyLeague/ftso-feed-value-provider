import type { FeedCategory } from "../core";
import type { IExchangeAdapter, ExchangeCapabilities } from "./exchange.types";

export type AdapterHealthStatus = "healthy" | "degraded" | "unhealthy";

export interface IAdapterRegistryEntry {
  adapter: IExchangeAdapter;
  registeredAt: Date;
  isActive: boolean;
  lastHealthCheck?: Date;
  healthStatus?: AdapterHealthStatus;
}

export interface IAdapterFilter {
  category?: FeedCategory;
  capabilities?: Partial<ExchangeCapabilities>;
  isActive?: boolean;
  healthStatus?: AdapterHealthStatus;
}
