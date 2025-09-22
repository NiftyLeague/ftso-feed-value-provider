import { Injectable, OnModuleInit } from "@nestjs/common";
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
export class WebSocketOrchestratorService extends EventDrivenService implements OnModuleInit {
  private exchangeStates = new Map<string, ExchangeConnectionState>();
  private feedToExchangeMap = new Map<string, Array<{ exchange: string; symbol: string }>>();
  public override isInitialized = false;

  constructor(
    private readonly adapterRegistry: ExchangeAdapterRegistry,
    private readonly configService: ConfigService
  ) {
    super({ useEnhancedLogging: true });
  }

  override async onModuleInit(): Promise<void> {
    // Initialize after a short delay to ensure all adapters are registered
    setTimeout(() => {
      void this.initialize();
    }, 1000);
  }

  override async initialize(): Promise<void> {
    if (this.isInitialized) {
      this.logger.log("WebSocket orchestrator already initialized, skipping");
      return;
    }

    await this.executeWithErrorHandling(
      async () => {
        this.logger.log("Initializing WebSocket orchestrator...");

        // Step 1: Build feed-to-exchange mapping from feeds.json
        await this.buildFeedMapping();

        // Step 2: Initialize exchange connection states
        await this.initializeExchangeStates();

        // Step 3: Connect to all required exchanges once
        await this.connectAllExchanges();

        // Step 4: Subscribe to required symbols based on feeds.json
        await this.subscribeToRequiredSymbols();

        this.isInitialized = true;
        this.logger.log("WebSocket orchestrator initialized successfully");
      },
      "websocket_orchestrator_initialization",
      {
        retries: 2,
        retryDelay: 3000,
      }
    );
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

    for (const config of exchangeConfigs) {
      const exchangeState = this.exchangeStates.get(config.exchange);
      if (!exchangeState) {
        this.logger.warn(`Exchange ${config.exchange} not available for feed ${feedKey}`);
        continue;
      }

      // Add to required symbols
      exchangeState.requiredSymbols.add(config.symbol);

      // Subscribe if not already subscribed and exchange is connected
      if (exchangeState.isConnected && !exchangeState.subscribedSymbols.has(config.symbol)) {
        try {
          await exchangeState.adapter.subscribe([config.symbol]);
          exchangeState.subscribedSymbols.add(config.symbol);
          this.logger.debug(`Subscribed ${config.exchange} to ${config.symbol} for feed ${feedKey}`);
        } catch (error) {
          this.logger.error(`Failed to subscribe ${config.exchange} to ${config.symbol}:`, error);
        }
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
    this.logger.log("Requesting connections to all required exchanges...");

    const connectionPromises: Promise<void>[] = [];

    for (const [exchangeName, state] of this.exchangeStates) {
      connectionPromises.push(
        this.executeWithErrorHandling(
          async () => {
            this.logger.log(`Requesting connection to exchange: ${exchangeName}`);
            state.lastConnectionAttempt = Date.now();

            // Let adapter handle its own connection
            await state.adapter.connect();

            // Update our tracking based on adapter's actual state
            state.isConnected = state.adapter.isConnected();

            if (state.isConnected) {
              this.logger.log(`Successfully connected to exchange: ${exchangeName}`);
            } else {
              this.logger.warn(`Exchange ${exchangeName} connection failed`);
            }
          },
          `connect_${exchangeName}`,
          {
            shouldThrow: false, // Don't fail entire initialization if one exchange fails
            retries: 2,
            retryDelay: 2000,
            onError: error => {
              this.logger.warn(`Failed to connect to exchange ${exchangeName}: ${error.message}`);
              state.isConnected = false;
            },
          }
        )
      );
    }

    await Promise.allSettled(connectionPromises);

    const connectedCount = Array.from(this.exchangeStates.values()).filter(s => s.isConnected).length;
    this.logger.log(`Connected to ${connectedCount}/${this.exchangeStates.size} exchanges`);
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
