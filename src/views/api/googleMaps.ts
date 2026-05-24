/**
 * Frontend API wrapper for Google Maps Business Scraper.
 *
 * Provides typed functions for the Vue UI page to start/cancel
 * searches and subscribe to result push events from the main process.
 */

import {
  windowInvoke,
  windowReceive,
  windowRemoveAllListeners,
} from "@/views/utils/apirequest";
import {
  GOOGLE_MAPS_SEARCH_START,
  GOOGLE_MAPS_SEARCH_CANCEL,
  GOOGLE_MAPS_SEARCH_RESULT,
  GOOGLE_MAPS_HISTORY_LIST,
  GOOGLE_MAPS_HISTORY_DETAIL,
  GOOGLE_MAPS_HISTORY_DELETE,
} from "@/config/channellist";
import type { GoogleMapsSearchResult } from "@/entityTypes/googleMapsTypes";

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface GoogleMapsSearchStartResponse {
  requestId: string;
}

export interface GoogleMapsResultEvent {
  requestId: string;
  result: GoogleMapsSearchResult;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

/**
 * Start a Google Maps search. Returns a requestId for tracking.
 * The result will arrive as a push event via onGoogleMapsResult().
 */
export async function startGoogleMapsSearch(params: {
  query: string;
  location: string;
  max_results?: number;
  include_website?: boolean;
  include_reviews?: boolean;
  show_browser?: boolean;
  account_id?: number;
}): Promise<GoogleMapsSearchStartResponse> {
  const resp = await windowInvoke(GOOGLE_MAPS_SEARCH_START, params);
  if (!resp) {
    throw new Error("Failed to start search");
  }
  return resp as GoogleMapsSearchStartResponse;
}

/**
 * Cancel an active Google Maps search.
 */
export async function cancelGoogleMapsSearch(requestId: string): Promise<void> {
  await windowInvoke(GOOGLE_MAPS_SEARCH_CANCEL, { requestId });
}

/**
 * Subscribe to Google Maps result push events.
 * Returns an unsubscribe function.
 */
export function onGoogleMapsResult(
  callback: (event: GoogleMapsResultEvent) => void
): () => void {
  const handler = (data: GoogleMapsResultEvent): void => {
    callback(data);
  };
  windowReceive(GOOGLE_MAPS_SEARCH_RESULT, handler);
  return () => {
    windowRemoveAllListeners(GOOGLE_MAPS_SEARCH_RESULT);
  };
}

// ---------------------------------------------------------------------------
// History types
// ---------------------------------------------------------------------------

export interface GoogleMapsHistoryRecord {
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

export async function getGoogleMapsHistory(
  limit = 50,
  offset = 0
): Promise<{ records: GoogleMapsHistoryRecord[]; total: number }> {
  const resp = await windowInvoke(GOOGLE_MAPS_HISTORY_LIST, { limit, offset });
  if (!resp) throw new Error("Failed to load history");
  return resp as { records: GoogleMapsHistoryRecord[]; total: number };
}

export async function getGoogleMapsHistoryDetail(
  id: number
): Promise<GoogleMapsHistoryRecord> {
  const resp = await windowInvoke(GOOGLE_MAPS_HISTORY_DETAIL, { id });
  if (!resp) throw new Error("Failed to load record");
  return resp as GoogleMapsHistoryRecord;
}

export async function deleteGoogleMapsHistoryRecord(id: number): Promise<void> {
  await windowInvoke(GOOGLE_MAPS_HISTORY_DELETE, { id });
}
