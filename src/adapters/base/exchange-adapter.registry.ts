import { ExchangeAdapter } from "@/interfaces/exchange-adapter.interface";
import { FeedCategory } from "@/types/feed-category.enum";

export class ExchangeAdapterRegistry {
  private adapters = new Map<string, ExchangeAdapter>();

  register(name: string, adapter: ExchangeAdapter): void {
    this.adapters.set(name.toLowerCase(), adapter);
  }

  get(name: string): ExchangeAdapter | undefined {
    return this.adapters.get(name.toLowerCase());
  }

  getByCategory(category: FeedCategory): ExchangeAdapter[] {
    return Array.from(this.adapters.values()).filter(adapter => adapter.category === category);
  }

  getSupportedExchanges(category?: FeedCategory): string[] {
    if (category) {
      return this.getByCategory(category).map(adapter => adapter.exchangeName);
    }
    return Array.from(this.adapters.keys());
  }

  has(name: string): boolean {
    return this.adapters.has(name.toLowerCase());
  }

  clear(): void {
    this.adapters.clear();
  }

  size(): number {
    return this.adapters.size;
  }
}
