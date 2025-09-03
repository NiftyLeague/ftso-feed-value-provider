import type { IExchangeAdapter, ExchangeCapabilities } from "@/common/types/adapters";
import { FeedCategory } from "@/common/types/core";

export interface AdapterRegistryEntry {
  adapter: IExchangeAdapter;
  registeredAt: Date;
  isActive: boolean;
  lastHealthCheck?: Date;
  healthStatus?: "healthy" | "degraded" | "unhealthy";
}

export interface AdapterFilter {
  category?: FeedCategory;
  capabilities?: Partial<ExchangeCapabilities>;
  isActive?: boolean;
  healthStatus?: "healthy" | "degraded" | "unhealthy";
}

export class ExchangeAdapterRegistry {
  private adapters = new Map<string, AdapterRegistryEntry>();

  /**
   * Register a new exchange adapter
   */
  register(name: string, adapter: IExchangeAdapter): void {
    const normalizedName = name.toLowerCase();

    if (this.adapters.has(normalizedName)) {
      throw new Error(`Adapter '${name}' is already registered`);
    }

    this.adapters.set(normalizedName, {
      adapter,
      registeredAt: new Date(),
      isActive: true,
    });
  }

  /**
   * Get an adapter by name
   */
  get(name: string): IExchangeAdapter | undefined {
    const entry = this.adapters.get(name.toLowerCase());
    return entry?.isActive ? entry.adapter : undefined;
  }

  /**
   * Get all adapters matching the filter criteria
   */
  getFiltered(filter: AdapterFilter = {}): IExchangeAdapter[] {
    return Array.from(this.adapters.values())
      .filter(entry => this.matchesFilter(entry, filter))
      .map(entry => entry.adapter);
  }

  /**
   * Get adapters by category
   */
  getByCategory(category: FeedCategory): IExchangeAdapter[] {
    return this.getFiltered({ category, isActive: true });
  }

  /**
   * Get adapters by capabilities
   */
  getByCapabilities(capabilities: Partial<ExchangeCapabilities>): IExchangeAdapter[] {
    return this.getFiltered({ capabilities, isActive: true });
  }

  /**
   * Get all supported exchange names
   */
  getSupportedExchanges(category?: FeedCategory): string[] {
    const filter: AdapterFilter = { isActive: true };
    if (category) {
      filter.category = category;
    }

    return this.getFiltered(filter).map(adapter => adapter.exchangeName);
  }

  /**
   * Check if an adapter is registered
   */
  has(name: string): boolean {
    return this.adapters.has(name.toLowerCase());
  }

  /**
   * Check if an adapter is active
   */
  isActive(name: string): boolean {
    const entry = this.adapters.get(name.toLowerCase());
    return entry?.isActive ?? false;
  }

  /**
   * Activate/deactivate an adapter
   */
  setActive(name: string, isActive: boolean): boolean {
    const entry = this.adapters.get(name.toLowerCase());
    if (entry) {
      entry.isActive = isActive;
      return true;
    }
    return false;
  }

  /**
   * Update health status of an adapter
   */
  updateHealthStatus(name: string, status: "healthy" | "degraded" | "unhealthy"): boolean {
    const entry = this.adapters.get(name.toLowerCase());
    if (entry) {
      entry.healthStatus = status;
      entry.lastHealthCheck = new Date();
      return true;
    }
    return false;
  }

  /**
   * Get registry statistics
   */
  getStats(): {
    total: number;
    active: number;
    byCategory: Record<FeedCategory, number>;
    byHealth: Record<string, number>;
  } {
    const entries = Array.from(this.adapters.values());
    const active = entries.filter(e => e.isActive);

    const byCategory = active.reduce(
      (acc, entry) => {
        acc[entry.adapter.category] = (acc[entry.adapter.category] || 0) + 1;
        return acc;
      },
      {} as Record<FeedCategory, number>
    );

    const byHealth = active.reduce(
      (acc, entry) => {
        const status = entry.healthStatus || "unknown";
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    return {
      total: entries.length,
      active: active.length,
      byCategory,
      byHealth,
    };
  }

  /**
   * Find the best adapter for a symbol and category
   */
  findBestAdapter(symbol: string, category: FeedCategory): IExchangeAdapter | undefined {
    const candidates = this.getByCategory(category)
      .filter(adapter => adapter.validateSymbol(symbol))
      .filter(adapter => this.getHealthStatus(adapter.exchangeName) !== "unhealthy");

    if (candidates.length === 0) {
      return undefined;
    }

    // Prefer healthy adapters over degraded ones
    const healthy = candidates.filter(adapter => this.getHealthStatus(adapter.exchangeName) === "healthy");

    if (healthy.length > 0) {
      return healthy[0]; // Return first healthy adapter
    }

    return candidates[0]; // Return first available adapter
  }

  /**
   * Get health status of an adapter
   */
  getHealthStatus(name: string): "healthy" | "degraded" | "unhealthy" | "unknown" {
    const entry = this.adapters.get(name.toLowerCase());
    return entry?.healthStatus || "unknown";
  }

  /**
   * Remove an adapter from the registry
   */
  unregister(name: string): boolean {
    return this.adapters.delete(name.toLowerCase());
  }

  /**
   * Clear all adapters
   */
  clear(): void {
    this.adapters.clear();
  }

  /**
   * Get total number of registered adapters
   */
  size(): number {
    return this.adapters.size;
  }

  /**
   * Get all adapter names (including inactive ones)
   */
  getAllNames(): string[] {
    return Array.from(this.adapters.keys());
  }

  private matchesFilter(entry: AdapterRegistryEntry, filter: AdapterFilter): boolean {
    if (filter.category !== undefined && entry.adapter.category !== filter.category) {
      return false;
    }

    if (filter.isActive !== undefined && entry.isActive !== filter.isActive) {
      return false;
    }

    if (filter.healthStatus !== undefined && entry.healthStatus !== filter.healthStatus) {
      return false;
    }

    if (filter.capabilities) {
      const capabilities = entry.adapter.capabilities;

      if (
        filter.capabilities.supportsWebSocket !== undefined &&
        capabilities.supportsWebSocket !== filter.capabilities.supportsWebSocket
      ) {
        return false;
      }

      if (
        filter.capabilities.supportsREST !== undefined &&
        capabilities.supportsREST !== filter.capabilities.supportsREST
      ) {
        return false;
      }

      if (
        filter.capabilities.supportsVolume !== undefined &&
        capabilities.supportsVolume !== filter.capabilities.supportsVolume
      ) {
        return false;
      }

      if (
        filter.capabilities.supportedCategories &&
        !filter.capabilities.supportedCategories.every(cat => capabilities.supportedCategories.includes(cat))
      ) {
        return false;
      }
    }

    return true;
  }
}
