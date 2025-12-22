/**
 * Base exchange adapter configuration types
 */

import type { BaseServiceConfig } from "../services";
import type { ExchangeConnectionConfig } from "./exchange.types";

/**
 * Extended configuration for exchange adapters.
 */
export interface IExchangeAdapterConfig extends BaseServiceConfig {
  connection?: ExchangeConnectionConfig;
}
