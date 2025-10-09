import * as ccxt from "ccxt";

async function fetchTickers(exchangeName: string): Promise<void> {
  try {
    // Create exchange instance
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ExchangeClass = (ccxt as any)[exchangeName];
    if (!ExchangeClass) {
      throw new Error(`Exchange ${exchangeName} not supported by CCXT`);
    }

    const exchange = new ExchangeClass({
      enableRateLimit: true,
      timeout: 30000,
      sandbox: false,
    });

    // Load markets first
    await exchange.loadMarkets();

    // Get all symbols
    const symbols = Object.keys(exchange.markets);

    // Filter for active markets only
    const activeSymbols = symbols.filter((symbol: string) => {
      const market = exchange.markets[symbol];
      return market.active !== false;
    });

    // Create ticker data structure
    const tickerData: {
      exchange: string;
      timestamp: number;
      count: number;
      symbols: string[];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      markets: Record<string, any>;
    } = {
      exchange: exchangeName,
      timestamp: Date.now(),
      count: activeSymbols.length,
      symbols: activeSymbols.sort(),
      markets: {},
    };

    // Add market details for each symbol
    activeSymbols.forEach((symbol: string) => {
      const market = exchange.markets[symbol];
      tickerData.markets[symbol] = {
        id: market.id,
        symbol: market.symbol,
        base: market.base,
        quote: market.quote,
        baseId: market.baseId,
        quoteId: market.quoteId,
        type: market.type,
        spot: market.spot,
        margin: market.margin,
        future: market.future,
        option: market.option,
        active: market.active,
        contract: market.contract,
        linear: market.linear,
        inverse: market.inverse,
        taker: market.taker,
        maker: market.maker,
        contractSize: market.contractSize,
        expiry: market.expiry,
        expiryDatetime: market.expiryDatetime,
        strike: market.strike,
        optionType: market.optionType,
        precision: market.precision,
        limits: market.limits,
        info: market.info,
      };
    });

    console.log(JSON.stringify(tickerData, null, 2));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error(`Error fetching tickers for ${exchangeName}:`, error.message);
    process.exit(1);
  }
}

const exchangeName = process.argv[2];
if (!exchangeName) {
  console.error("Exchange name is required");
  process.exit(1);
}

void fetchTickers(exchangeName);
