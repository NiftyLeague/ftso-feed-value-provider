# Modernized Exchange Adapter Architecture

This directory contains the fully modernized exchange adapter architecture with
consolidated base classes, interfaces, and utilities. All adapters now follow
unified patterns and have been optimized for performance and maintainability.

## Files Overview

### Core Interfaces and Classes

- **`exchange-adapter.interface.ts`** - Core exchange adapter interface and
  configuration types
- **`base-exchange-adapter.ts`** - Base implementation with common patterns and
  boilerplate elimination
- **`exchange-adapter.registry.ts`** - Registry for managing multiple exchange
  adapters
- **`index.ts`** - Exports all public interfaces and classes

### Tests

- **`__tests__/exchange-adapter.registry.spec.ts`** - Comprehensive tests for
  the adapter registry

## Architecture

```
src/adapters/
├── base/                           # Base classes and interfaces
│   ├── exchange-adapter.interface.ts    # Core interface
│   ├── base-exchange-adapter.ts         # Base implementation
│   ├── exchange-adapter.registry.ts     # Registry implementation
│   └── index.ts                         # Public exports
├── crypto/                         # Crypto exchange implementations
│   ├── binance.adapter.ts
│   ├── coinbase.adapter.ts
│   ├── kraken.adapter.ts
│   └── ...
└── README.md
```

## Usage

### Importing Exchange Adapter Types

```typescript
// Import from the consolidated base directory
import {
  ExchangeAdapter,
  ExchangeCapabilities,
  ExchangeConnectionConfig,
  BaseExchangeAdapter,
  ExchangeAdapterRegistry,
} from "@/adapters/base";
```

### Creating New Exchange Adapters

```typescript
import { BaseExchangeAdapter } from "@/adapters/base";

export class MyExchangeAdapter extends BaseExchangeAdapter {
  readonly exchangeName = "my-exchange";
  readonly category = FeedCategory.Crypto;

  // Implement required abstract methods with standardized error handling
  protected async doConnect(): Promise<void> {
    // Connection logic with automatic retry and circuit breaker protection
  }

  protected async doDisconnect(): Promise<void> {
    // Disconnection logic with proper cleanup
  }

  // All adapters now include unified monitoring and error handling
}
```

### Using the Registry

```typescript
import { ExchangeAdapterRegistry } from "@/adapters/base";

const registry = new ExchangeAdapterRegistry();
registry.register("binance", new BinanceAdapter());
const adapter = registry.get("binance");
```

## Testing

```bash
# Test the adapter registry
pnpm test -- src/adapters/base/__tests__

# Test crypto adapters (should still work with new imports)
pnpm test -- src/adapters/crypto/__tests__

# Test data manager (uses adapter interfaces)
pnpm test -- src/data-manager/__tests__
```
