import { Injectable } from "@nestjs/common";
import { EventDrivenService } from "@/common/base/composed.service";
import { ExchangeAdapterRegistry } from "@/adapters/base/exchange-adapter.registry";
import { ConfigService } from "@/config/config.service";
import { hasCustomAdapter } from "@/common/utils";
import type { IExchangeAdapter } from "@/common/types/adapters";
import type { CoreFeedId } from "@/common/types/core";

interface ExchangeConnectionState {
  adapter: IExchangeAdapter;
  isConnected: boolean;
  lastConnectionAttempt: number;
  subscribedSymbols: Set<string>;
  requiredSymbols: Set<string>; // Symbols needed based on feeds.json
}

/**
 * Centralized WebSocket connection orchestrator that:
 * 1. Connects to all exchange adapters once at startup
 * 2. Uses feeds.json to determine which exchanges to subscribe to for each asset pair
 * 3. Only reconnects to exchanges if they are actually closed
 * 4. Handles both custom adapters and CCXT adapter properly
 */
@Injectable()
export class WebSocketOrchestratorService extends EventDrivenService {
  private exchangeStates = new Map<string, ExchangeConnectionState>();
  private feedToExchangeMap = new Map<string, Array<{ exchange: string; symbol: string }>>();
  public override isInitialized = false;

  constructor(
    private readonly adapterRegistry: ExchangeAdapterRegistry,
    private readonly configService: ConfigService
  ) {
    super({ useEnhancedLogging: true });
  }

  override async initialize(): Promise<void> {
    if (this.isInitialized) {
      this.logger.log("WebSocket orchestrator already initialized, skipping");
      return;
    }

    // Initialize synchronously only the essential parts needed for the service to be ready
    await this.executeWithErrorHandling(
      async () => {
        this.logger.log("Initializing WebSocket orchestrator...");

        // Step 1: Build feed-to-exchange mapping from feeds.json
        await this.buildFeedMapping();

        // Step 2: Initialize exchange connection states
        await this.initializeExchangeStates();

        // Mark as initialized so the service is ready
        this.isInitialized = true;
        this.logger.log("WebSocket orchestrator initialized successfully");

        // Step 3 & 4: Connect and subscribe asynchronously to avoid blocking server startup
        this.initializeConnectionsAsync();
      },
      "websocket_orchestrator_initialization",
      {
        retries: 2,
        retryDelay: 3000,
      }
    );
  }

  /**
   * Initialize WebSocket connections asynchronously to avoid blocking server startup
   */
  private initializeConnectionsAsync(): void {
    // Use setTimeout to ensure this runs after the current call stack
    setTimeout(async () => {
      try {
        this.logger.log("Starting asynchronous WebSocket connections...");

        // Step 3: Connect to all required exchanges once
        await this.connectAllExchanges();

        // Step 4: Subscribe to required symbols based on feeds.json (also async)
        this.subscribeToRequiredSymbolsAsync();

        this.logger.log("Asynchronous WebSocket initialization completed");
      } catch (error) {
        this.logger.error("Failed to initialize WebSocket connections asynchronously:", error);
        // Don't throw here as this shouldn't block the application
      }
    }, 100); // Small delay to ensure server startup completes first
  }

  /**
   * Subscribe to required symbols asynchronously to avoid blocking
   */
  private subscribeToRequiredSymbolsAsync(): void {
    setTimeout(async () => {
      try {
        await this.subscribeToRequiredSymbols();
        this.logger.log("Asynchronous symbol subscription completed");
      } catch (error) {
        this.logger.error("Failed to subscribe to symbols asynchronously:", error);
      }
    }, 1000); // Wait a bit longer for connections to stabilize
  }

  /**
   * Subscribe to a specific feed - only subscribes if not already subscribed
   */
  async subscribeToFeed(feedId: CoreFeedId): Promise<void> {
    const feedKey = feedId.name;
    const exchangeConfigs = this.feedToExchangeMap.get(feedKey);

    if (!exchangeConfigs) {
      this.logger.warn(`No exchange configurations found for feed: ${feedKey}`);
      return;
    }

    // Group symbols by adapter type to avoid duplicate subscriptions
    const ccxtSymbols = new Set<string>();
    const customAdapterSubscriptions = new Map<IExchangeAdapter, Set<string>>();

    for (const config of exchangeConfigs) {
      const exchangeState = this.exchangeStates.get(config.exchange);
      if (!exchangeState) {
        this.logger.warn(`Exchange ${config.exchange} not available for feed ${feedKey}`);
        continue;
      }

      // Add to required symbols
      exchangeState.requiredSymbols.add(config.symbol);

      // Group by adapter type
      if (exchangeState.isConnected && !exchangeState.subscribedSymbols.has(config.symbol)) {
        if (exchangeState.adapter.exchangeName === "ccxt-multi-exchange") {
          // Collect all CCXT symbols for batch subscription
          ccxtSymbols.add(config.symbol);
        } else {
          // Group custom adapter subscriptions
          if (!customAdapterSubscriptions.has(exchangeState.adapter)) {
            customAdapterSubscriptions.set(exchangeState.adapter, new Set());
          }
          customAdapterSubscriptions.get(exchangeState.adapter)!.add(config.symbol);
        }
      }
    }

    // Subscribe to CCXT adapter once with all symbols
    if (ccxtSymbols.size > 0) {
      // Find the CCXT adapter from any exchange state that uses it
      let ccxtAdapter: IExchangeAdapter | undefined;
      for (const state of this.exchangeStates.values()) {
        if (state.adapter.exchangeName === "ccxt-multi-exchange") {
          ccxtAdapter = state.adapter;
          break;
        }
      }

      if (ccxtAdapter) {
        try {
          await ccxtAdapter.subscribe(Array.from(ccxtSymbols));
          // Update all CCXT exchange states
          for (const state of this.exchangeStates.values()) {
            if (state.adapter.exchangeName === "ccxt-multi-exchange") {
              ccxtSymbols.forEach(symbol => state.subscribedSymbols.add(symbol));
            }
          }
          this.logger.debug(`Subscribed CCXT adapter to ${ccxtSymbols.size} symbols for feed ${feedKey}`);
        } catch (error) {
          this.logger.error(`Failed to subscribe CCXT adapter to symbols for feed ${feedKey}:`, error);
        }
      } else {
        this.logger.warn(`CCXT adapter not found for feed ${feedKey}`);
      }
    }

    // Subscribe to custom adapters individually
    for (const [adapter, symbols] of customAdapterSubscriptions) {
      try {
        await adapter.subscribe(Array.from(symbols));
        // Update the corresponding exchange state
        for (const state of this.exchangeStates.values()) {
          if (state.adapter === adapter) {
            symbols.forEach(symbol => state.subscribedSymbols.add(symbol));
          }
        }
        this.logger.debug(`Subscribed ${adapter.exchangeName} to ${symbols.size} symbols for feed ${feedKey}`);
      } catch (error) {
        this.logger.error(`Failed to subscribe ${adapter.exchangeName} to symbols for feed ${feedKey}:`, error);
      }
    }
  }

  /**
   * Get connection status for all exchanges
   */
  getConnectionStatus(): Record<string, { connected: boolean; subscribedCount: number; requiredCount: number }> {
    const status: Record<string, { connected: boolean; subscribedCount: number; requiredCount: number }> = {};

    for (const [exchange, state] of this.exchangeStates) {
      // Always check the adapter's actual connection state
      const actuallyConnected = state.adapter.isConnected();

      // Update our tracking if it's out of sync
      if (state.isConnected !== actuallyConnected) {
        state.isConnected = actuallyConnected;
      }

      status[exchange] = {
        connected: actuallyConnected,
        subscribedCount: state.subscribedSymbols.size,
        requiredCount: state.requiredSymbols.size,
      };
    }

    return status;
  }

  /**
   * Request reconnection for a specific exchange (delegates to adapter)
   */
  async reconnectExchange(exchangeName: string): Promise<boolean> {
    const state = this.exchangeStates.get(exchangeName);
    if (!state) {
      this.logger.warn(`Exchange ${exchangeName} not found in orchestrator`);
      return false;
    }

    // Check if actually disconnected
    if (state.adapter.isConnected()) {
      this.logger.debug(`Exchange ${exchangeName} is already connected, skipping reconnection`);
      return true;
    }

    // Prevent rapid reconnection attempts
    const timeSinceLastAttempt = Date.now() - state.lastConnectionAttempt;
    if (timeSinceLastAttempt < 10000) {
      // 10 second cooldown
      this.logger.debug(`Skipping reconnection for ${exchangeName} - too recent (${timeSinceLastAttempt}ms ago)`);
      return false;
    }

    try {
      this.logger.log(`Requesting reconnection for exchange: ${exchangeName}`);
      state.lastConnectionAttempt = Date.now();

      // Let the adapter handle its own reconnection
      await state.adapter.connect();

      // Update our tracking
      state.isConnected = state.adapter.isConnected();

      // Re-subscribe to required symbols if reconnected
      if (state.isConnected) {
        await this.resubscribeExchange(exchangeName);
        this.logger.log(`Successfully reconnected to exchange: ${exchangeName}`);
        return true;
      } else {
        this.logger.warn(`Exchange ${exchangeName} connection attempt failed`);
        return false;
      }
    } catch (error) {
      this.logger.error(`Failed to reconnect to exchange ${exchangeName}:`, error);
      state.isConnected = false;
      return false;
    }
  }

  private async buildFeedMapping(): Promise<void> {
    this.logger.log("Building feed-to-exchange mapping from feeds.json...");

    const feedConfigs = this.configService.getFeedConfigurations();
    let totalMappings = 0;

    for (const feedConfig of feedConfigs) {
      const feedKey = feedConfig.feed.name;
      const exchangeConfigs = feedConfig.sources.map(source => ({
        exchange: source.exchange,
        symbol: source.symbol,
      }));

      this.feedToExchangeMap.set(feedKey, exchangeConfigs);
      totalMappings += exchangeConfigs.length;

      this.logger.debug(`Mapped feed ${feedKey} to ${exchangeConfigs.length} exchanges`);
    }

    this.logger.log(`Built feed mapping: ${feedConfigs.length} feeds, ${totalMappings} exchange mappings`);
  }

  private async initializeExchangeStates(): Promise<void> {
    this.logger.log("Initializing exchange connection states...");

    // Get all unique exchanges from feed mappings
    const requiredExchanges = new Set<string>();
    for (const exchangeConfigs of this.feedToExchangeMap.values()) {
      for (const config of exchangeConfigs) {
        requiredExchanges.add(config.exchange);
      }
    }

    // Initialize states for required exchanges
    for (const exchangeName of requiredExchanges) {
      let adapter: IExchangeAdapter | undefined;

      if (hasCustomAdapter(exchangeName)) {
        // Get custom adapter
        adapter = this.adapterRegistry.get(exchangeName);
      } else {
        // Use CCXT adapter for non-custom exchanges
        adapter = this.adapterRegistry.get("ccxt-multi-exchange");
      }

      if (adapter) {
        // Calculate required symbols for this exchange
        const requiredSymbols = new Set<string>();
        for (const exchangeConfigs of this.feedToExchangeMap.values()) {
          for (const config of exchangeConfigs) {
            if (config.exchange === exchangeName) {
              requiredSymbols.add(config.symbol);
            }
          }
        }

        this.exchangeStates.set(exchangeName, {
          adapter,
          isConnected: false,
          lastConnectionAttempt: 0,
          subscribedSymbols: new Set(),
          requiredSymbols,
        });

        this.logger.debug(
          `Initialized state for exchange ${exchangeName} with ${requiredSymbols.size} required symbols`
        );
      } else {
        this.logger.warn(`No adapter found for exchange: ${exchangeName}`);
      }
    }

    this.logger.log(`Initialized ${this.exchangeStates.size} exchange states`);
  }

  private async connectAllExchanges(): Promise<void> {
    this.logger.log("Requesting connections to all required exchanges (parallel with concurrency limit)...");

    const totalExchanges = this.exchangeStates.size;
    const concurrencyLimit = 5; // Connect to 5 exchanges at a time
    const exchanges = Array.from(this.exchangeStates.entries());
    let connectedCount = 0;

    // Process exchanges in batches to balance speed and memory usage
    for (let i = 0; i < exchanges.length; i += concurrencyLimit) {
      const batch = exchanges.slice(i, i + concurrencyLimit);

      const connectionPromises = batch.map(async ([exchangeName, state]) => {
        try {
          this.logger.log(
            `Requesting connection to exchange: ${exchangeName} (batch ${Math.floor(i / concurrencyLimit) + 1})`
          );
          state.lastConnectionAttempt = Date.now();

          // Let adapter handle its own connection
          await state.adapter.connect();

          // Update our tracking based on adapter's actual state
          state.isConnected = state.adapter.isConnected();

          if (state.isConnected) {
            this.logger.log(`Successfully connected to exchange: ${exchangeName}`);
            return { exchangeName, success: true };
          } else {
            this.logger.warn(`Exchange ${exchangeName} connection failed`);
            return { exchangeName, success: false };
          }
        } catch (error) {
          this.logger.warn(`Failed to connect to exchange ${exchangeName}:`, error);
          state.isConnected = false;
          return { exchangeName, success: false };
        }
      });

      // Wait for all connections in this batch to complete
      const results = await Promise.allSettled(connectionPromises);

      // Count successful connections
      results.forEach(result => {
        if (result.status === "fulfilled" && result.value.success) {
          connectedCount++;
        }
      });

      // Trigger garbage collection after each batch to manage memory
      if (global.gc) {
        const memBefore = process.memoryUsage();
        global.gc();
        const memAfter = process.memoryUsage();
        const freed = memBefore.heapUsed - memAfter.heapUsed;
        this.logger.debug(
          `GC after batch ${Math.floor(i / concurrencyLimit) + 1}: freed ${(freed / 1024 / 1024).toFixed(2)}MB`
        );
      }

      // Small delay between batches to prevent overwhelming the system
      if (i + concurrencyLimit < exchanges.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    this.logger.log(`Connected to ${connectedCount}/${totalExchanges} exchanges`);
  }

  private async subscribeToRequiredSymbols(): Promise<void> {
    this.logger.log("Subscribing to required symbols based on feeds.json...");

    for (const [exchangeName, state] of this.exchangeStates) {
      if (!state.isConnected) {
        this.logger.warn(`Skipping subscription for disconnected exchange: ${exchangeName}`);
        continue;
      }

      if (state.requiredSymbols.size === 0) {
        this.logger.debug(`No symbols required for exchange: ${exchangeName}`);
        continue;
      }

      try {
        const symbolsArray = Array.from(state.requiredSymbols);

        // For CCXT adapter, we need to handle per-exchange subscriptions differently
        if (state.adapter.exchangeName === "ccxt-multi-exchange") {
          // CCXT adapter handles multiple exchanges, so we need to pass exchange context
          // This would require modifications to the CCXT adapter to accept exchange-specific subscriptions
          this.logger.debug(`CCXT adapter subscription for ${exchangeName} with symbols: ${symbolsArray.join(", ")}`);
          // TODO: Implement CCXT-specific subscription logic
        } else {
          // Custom adapter - direct subscription
          await state.adapter.subscribe(symbolsArray);
          symbolsArray.forEach(symbol => state.subscribedSymbols.add(symbol));
        }

        this.logger.log(`Subscribed ${exchangeName} to ${symbolsArray.length} symbols`);
      } catch (error) {
        this.logger.error(`Failed to subscribe to symbols for exchange ${exchangeName}:`, error);
      }
    }
  }

  private async resubscribeExchange(exchangeName: string): Promise<void> {
    const state = this.exchangeStates.get(exchangeName);
    if (!state || !state.isConnected) {
      return;
    }

    try {
      const symbolsToSubscribe = Array.from(state.requiredSymbols);
      if (symbolsToSubscribe.length > 0) {
        await state.adapter.subscribe(symbolsToSubscribe);
        state.subscribedSymbols.clear();
        symbolsToSubscribe.forEach(symbol => state.subscribedSymbols.add(symbol));
        this.logger.debug(`Re-subscribed ${exchangeName} to ${symbolsToSubscribe.length} symbols`);
      }
    } catch (error) {
      this.logger.error(`Failed to re-subscribe symbols for exchange ${exchangeName}:`, error);
    }
  }

  override async cleanup(): Promise<void> {
    this.logger.log("Cleaning up WebSocket orchestrator...");

    for (const [exchangeName, state] of this.exchangeStates) {
      try {
        if (state.isConnected) {
          await state.adapter.disconnect();
        }
      } catch (error) {
        this.logger.error(`Error disconnecting from exchange ${exchangeName}:`, error);
      }
    }

    this.exchangeStates.clear();
    this.feedToExchangeMap.clear();
    this.isInitialized = false;
  }
}
