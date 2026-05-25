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
