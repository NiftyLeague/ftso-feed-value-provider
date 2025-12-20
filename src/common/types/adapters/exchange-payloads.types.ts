/**
 * Exchange-specific WebSocket/REST payload types.
 *
 * These are primarily used internally by exchange adapters and their tests.
 * Centralizing them avoids exporting type definitions from implementation files.
 */

import type { ExchangeConnectionConfig } from "./exchange.types";

// Binance
export interface BinanceTickerData {
  e: "24hrTicker";
  E: number;
  s: string;
  p: string;
  P: string;
  w: string;
  x: string;
  c: string;
  Q: string;
  b: string;
  B: string;
  a: string;
  A: string;
  o: string;
  h: string;
  l: string;
  v: string;
  q: string;
  O: number;
  C: number;
  F: number;
  L: number;
  n: number;
}

export interface BinanceRestTickerData {
  symbol: string;
  priceChange: string;
  priceChangePercent: string;
  weightedAvgPrice: string;
  prevClosePrice: string;
  lastPrice: string;
  lastQty: string;
  bidPrice: string;
  bidQty: string;
  askPrice: string;
  askQty: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
  openTime: number;
  closeTime: number;
  firstId: number;
  lastId: number;
  count: number;
}

// Coinbase
export interface CoinbaseTickerData {
  type: "ticker";
  sequence: number;
  product_id: string;
  price: string;
  open_24h: string;
  volume_24h: string;
  low_24h: string;
  high_24h: string;
  volume_30d: string;
  best_bid: string;
  best_ask: string;
  side: "buy" | "sell";
  time: string;
  trade_id: number;
  last_size: string;
}

export interface CoinbaseRestTickerData {
  ask: string;
  bid: string;
  volume: string;
  trade_id: number;
  price: string;
  size: string;
  time: string;
}

// Kraken
export interface KrakenTickerData {
  channelID: number;
  channelName: string;
  pair: string;
  data: {
    a: [string, string, string];
    b: [string, string, string];
    c: [string, string];
    v: [string, string];
    p: [string, string];
    t: [number, number];
    l: [string, string];
    h: [string, string];
    o: [string, string];
  };
}

export interface KrakenRestTickerData {
  [pair: string]: {
    a: [string, string, string];
    b: [string, string, string];
    c: [string, string];
    v: [string, string];
    p: [string, string];
    t: [number, number];
    l: [string, string];
    h: [string, string];
    o: string;
  };
}

// OKX
export interface OkxTickerData {
  instType: string;
  instId: string;
  last: string;
  lastSz: string;
  askPx: string;
  askSz: string;
  bidPx: string;
  bidSz: string;
  open24h: string;
  high24h: string;
  low24h: string;
  volCcy24h: string;
  vol24h: string;
  ts: string;
  sodUtc0: string;
  sodUtc8: string;
}

export interface OkxWebSocketMessage {
  arg: {
    channel: string;
    instId: string;
  };
  data: OkxTickerData[];
}

export interface OkxPongMessage {
  event?: "pong";
  op?: "pong";
}

export interface OkxSubscriptionMessage {
  event: "subscribe" | "subscription";
}

export interface OkxErrorMessage {
  event: "error";
  msg?: string;
  code?: string;
}

export type OkxMessage = OkxWebSocketMessage | OkxPongMessage | OkxSubscriptionMessage | OkxErrorMessage;

export interface OkxRestTickerData {
  instType: string;
  instId: string;
  last: string;
  lastSz: string;
  askPx: string;
  askSz: string;
  bidPx: string;
  bidSz: string;
  open24h: string;
  high24h: string;
  low24h: string;
  volCcy24h: string;
  vol24h: string;
  ts: string;
  sodUtc0: string;
  sodUtc8: string;
}

export interface OkxRestResponse {
  code: string;
  msg: string;
  data: OkxRestTickerData[];
}

// Crypto.com
export interface ICryptocomTickerData {
  i: string;
  b: string;
  k: string;
  a: string;
  t: number;
  v: string;
  h: string;
  l: string;
  c: string;
}

export interface ICryptocomWebSocketMessage {
  id?: number;
  method: string;
  code?: number;
  result?: {
    channel: string;
    subscription: string;
    data: ICryptocomTickerData[];
  };
}

export interface ICryptocomHeartbeatMessage {
  id?: number;
  method: "public/heartbeat";
}

export interface ICryptocomSubscriptionMessage {
  id?: number;
  method: "subscribe";
  result: {
    channel: string;
  };
}

export interface ICryptocomTickerMessage {
  id?: number;
  method: "ticker";
  result: {
    data: ICryptocomTickerData[];
  };
}

export interface ICryptocomRestTickerData {
  i: string;
  b: string;
  k: string;
  a: string;
  t: number;
  v: string;
  h: string;
  l: string;
  c: string;
}

export interface ICryptocomRestResponse {
  id: number;
  method: string;
  code: number;
  result: {
    data: ICryptocomRestTickerData[];
  };
}

// CCXT
export interface CcxtMultiExchangeConnectionConfig extends ExchangeConnectionConfig {
  tradesLimit?: number;
  lambda?: number;
  retryBackoffMs?: number;
  useEnhancedLogging?: boolean;
}

export interface ExchangePriceData {
  exchange: string;
  price: number;
  timestamp: number;
  confidence: number;
  volume?: number;
}
