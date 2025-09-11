/**
 * Provider API request/response type definitions
 */

import { CoreFeedId } from "@/common/types/core";

export interface FeedId extends Omit<CoreFeedId, "category"> {
  category: number; // Keep as number per API contract. Core uses enum.
  name: string;
}

export interface Volume {
  exchange: string;
  volume: number;
}

export interface FeedValuesRequest {
  feeds: FeedId[];
}

export interface VolumesRequest {
  feeds: FeedId[];
  startTime?: number;
  endTime?: number;
}

export interface FeedValueData {
  feed: FeedId;
  /** Value in base units as float */
  value: number;
}

export interface FeedVolumeData {
  feed: FeedId;
  volumes: Volume[];
}

export interface RoundFeedValuesResponse {
  votingRoundId: number;
  data: FeedValueData[];
}

export interface FeedValuesResponse {
  data: FeedValueData[];
}

export interface FeedVolumesResponse {
  data: FeedVolumeData[];
  windowSec?: number;
}
