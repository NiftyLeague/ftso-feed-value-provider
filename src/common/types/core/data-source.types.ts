/**
 * Core data source type definitions
 * Consolidated from interfaces/core/data-source.interface.ts
 */

import { FeedCategory } from "./feed.types";

export interface PriceUpdate {
  symbol: string;
  price: number;
  timestamp: number;
  source: string;
  volume?: number;
  confidence: number;
}

export interface VolumeUpdate {
  symbol: string;
  volume: number;
  timestamp: number;
  source: string;
}

export interface DataSource {
  id: string;
  type: "websocket" | "rest";
  priority: number;
  category: FeedCategory;
  isConnected(): boolean;
  getLatency(): number;
  subscribe(symbols: string[]): Promise<void>;
  unsubscribe(symbols: string[]): Promise<void>;
  onPriceUpdate(callback: (update: PriceUpdate) => void): void;
  onConnectionChange(callback: (connected: boolean) => void): void;
  onError?(callback: (error: Error) => void): void;
}
