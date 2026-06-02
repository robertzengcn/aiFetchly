/**
 * Frontend API wrapper for Yandex Maps Business Scraper.
 *
 * Provides typed functions for the Vue UI page to start/cancel
 * searches and subscribe to progress and result push events.
 */

import {
  windowInvoke,
  windowReceive,
  windowRemoveAllListeners,
} from "@/views/utils/apirequest";
import {
  YANDEX_MAPS_SEARCH_START,
  YANDEX_MAPS_SEARCH_CANCEL,
  YANDEX_MAPS_SEARCH_PROGRESS,
  YANDEX_MAPS_SEARCH_RESULT,
  YANDEX_MAPS_HISTORY_LIST,
  YANDEX_MAPS_HISTORY_DETAIL,
  YANDEX_MAPS_HISTORY_DELETE,
} from "@/config/channellist";
import type {
  YandexMapsSearchResult,
  YandexMapsProgressEvent,
} from "@/entityTypes/yandexMapsTypes";

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface YandexMapsSearchStartResponse {
  requestId: string;
}

export interface YandexMapsResultEvent {
  requestId: string;
  result: YandexMapsSearchResult;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

/**
 * Start a Yandex Maps search. Returns a requestId for tracking.
 * Progress updates arrive via onYandexMapsProgress() and the final
 * result arrives as a push event via onYandexMapsResult().
 */
export async function startYandexMapsSearch(params: {
  query: string;
  location: string;
  max_results?: number;
  include_website?: boolean;
  include_reviews?: boolean;
  show_browser?: boolean;
  language?: string;
  region?: string;
  account_id?: number;
  proxy_ids?: number[];
}): Promise<YandexMapsSearchStartResponse> {
  const resp = await windowInvoke(YANDEX_MAPS_SEARCH_START, params);
  if (!resp) {
    throw new Error("Failed to start search");
  }
  return resp as YandexMapsSearchStartResponse;
}

/**
 * Cancel an active Yandex Maps search.
 */
export async function cancelYandexMapsSearch(requestId: string): Promise<void> {
  await windowInvoke(YANDEX_MAPS_SEARCH_CANCEL, { requestId });
}

/**
 * Subscribe to Yandex Maps progress push events.
 * Returns an unsubscribe function.
 */
export function onYandexMapsProgress(
  callback: (event: YandexMapsProgressEvent) => void
): () => void {
  const handler = (data: YandexMapsProgressEvent): void => {
    callback(data);
  };
  windowReceive(YANDEX_MAPS_SEARCH_PROGRESS, handler);
  return () => {
    windowRemoveAllListeners(YANDEX_MAPS_SEARCH_PROGRESS);
  };
}

/**
 * Subscribe to Yandex Maps result push events.
 * Returns an unsubscribe function.
 */
export function onYandexMapsResult(
  callback: (event: YandexMapsResultEvent) => void
): () => void {
  const handler = (data: YandexMapsResultEvent): void => {
    callback(data);
  };
  windowReceive(YANDEX_MAPS_SEARCH_RESULT, handler);
  return () => {
    windowRemoveAllListeners(YANDEX_MAPS_SEARCH_RESULT);
  };
}

// ---------------------------------------------------------------------------
// History types
// ---------------------------------------------------------------------------

export interface YandexMapsHistoryRecord {
  id: number;
  query: string;
  location: string;
  status: string;
  totalResults: number;
  summary: string;
  results: string; // JSON string
  createdAt?: Date;
}

// ---------------------------------------------------------------------------
// History API functions
// ---------------------------------------------------------------------------

export async function getYandexMapsHistory(
  limit = 50,
  offset = 0
): Promise<{ records: YandexMapsHistoryRecord[]; total: number }> {
  const resp = await windowInvoke(YANDEX_MAPS_HISTORY_LIST, { limit, offset });
  if (!resp) throw new Error("Failed to load history");
  return resp as { records: YandexMapsHistoryRecord[]; total: number };
}

export async function getYandexMapsHistoryDetail(
  id: number
): Promise<YandexMapsHistoryRecord> {
  const resp = await windowInvoke(YANDEX_MAPS_HISTORY_DETAIL, { id });
  if (!resp) throw new Error("Failed to load record");
  return resp as YandexMapsHistoryRecord;
}

export async function deleteYandexMapsHistoryRecord(id: number): Promise<void> {
  await windowInvoke(YANDEX_MAPS_HISTORY_DELETE, { id });
}
