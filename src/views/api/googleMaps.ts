/**
 * Frontend API wrapper for Google Maps Business Scraper.
 *
 * Provides typed functions for the Vue UI page to start/cancel
 * searches and subscribe to result push events from the main process.
 */

import { windowInvoke, windowReceive, windowRemoveAllListeners } from "@/views/utils/apirequest";
import {
  GOOGLE_MAPS_SEARCH_START,
  GOOGLE_MAPS_SEARCH_CANCEL,
  GOOGLE_MAPS_SEARCH_RESULT,
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
export async function cancelGoogleMapsSearch(
  requestId: string
): Promise<void> {
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
