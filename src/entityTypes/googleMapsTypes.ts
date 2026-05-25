/**
 * Google Maps Business Scraper — shared type contracts.
 *
 * Used by:
 * - skillsRegistry (skill parameter schema mirrors these types)
 * - ToolExecutor (input validation and dispatch)
 * - GoogleMapsModule (orchestration layer — Phase 2)
 * - GoogleMapsWorker (child process — Phase 2)
 * - IPC handlers and UI page (Phase 3)
 */

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/** Parameters for a Google Maps business search request. */
export interface GoogleMapsSearchInput {
  /** Business keyword or category to search for (e.g. "dentist", "Italian restaurant"). */
  query: string;

  /** Target location for the search (e.g. "New York", "London, UK", "90210"). */
  location: string;

  /** Maximum number of business results to return. Defaults to 20. */
  max_results?: number;

  /** Whether to extract website URLs from business listings. Defaults to true. */
  include_website?: boolean;

  /** Whether to include review count in results. Defaults to false. */
  include_reviews?: boolean;

  /** Whether to show the browser window during scraping for debugging. Defaults to false. */
  show_browser?: boolean;

  /** IDs of proxies to rotate through during scraping. Optional. */
  proxy_ids?: number[];
}

// ---------------------------------------------------------------------------
// Output — single business result
// ---------------------------------------------------------------------------

/** A single business listing extracted from Google Maps. */
export interface GoogleMapsBusinessResult {
  /** Business name. */
  name: string;

  /** Average rating as a string (e.g. "4.5"). */
  rating?: string;

  /** Total number of reviews. */
  review_count?: number;

  /** Business category or type (e.g. "Dentist", "Italian Restaurant"). */
  category?: string;

  /** Physical address. */
  address?: string;

  /** Phone number. */
  phone?: string;

  /** Business website URL. */
  website?: string;

  /** Google Maps URL for this business. */
  maps_url?: string;

  /** Google Place ID. */
  place_id?: string;

  /** Operating hours description. */
  hours?: string;

  /** Geographic latitude. */
  latitude?: number;

  /** Geographic longitude. */
  longitude?: number;
}

// ---------------------------------------------------------------------------
// Output — search result envelope
// ---------------------------------------------------------------------------

/** Structured result returned after a Google Maps business search. */
export interface GoogleMapsSearchResult {
  /** Whether the search completed successfully. */
  success: boolean;

  /** The query that was searched. */
  query: string;

  /** The location that was searched. */
  location: string;

  /** Total number of business results returned. */
  totalResults: number;

  /** Human-readable summary of results for LLM consumption. */
  summary: string;

  /** Array of extracted business listings. */
  results: GoogleMapsBusinessResult[];
}

// ---------------------------------------------------------------------------
// Progress tracking
// ---------------------------------------------------------------------------

/** Possible statuses for a Google Maps scraping operation. */
export type GoogleMapsProgressStatus =
  | "idle"
  | "validating"
  | "launching"
  | "navigating"
  | "loading"
  | "extracting"
  | "completed"
  | "cancelled"
  | "failed"
  | "timed_out";

/** Progress event emitted during a Google Maps scraping operation. */
export interface GoogleMapsProgressEvent {
  /** Unique identifier for this search request. */
  requestId: string;

  /** Current status of the scraping operation. */
  status: GoogleMapsProgressStatus;

  /** Number of businesses extracted so far. */
  current: number;

  /** Target number of businesses (max_results). */
  total: number;

  /** Human-readable status message. */
  message: string;
}

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

/** Error codes for Google Maps scraping failures. */
export type GoogleMapsErrorCode =
  | "INVALID_INPUT"
  | "TIMEOUT"
  | "CANCELLED"
  | "SCRAPE_FAILED"
  | "NO_RESULTS"
  | "UNKNOWN";

/** Structured error response for Google Maps scraping failures. */
export interface GoogleMapsErrorResponse {
  /** Machine-readable error code. */
  code: GoogleMapsErrorCode;

  /** Human-readable error message. */
  message: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default maximum number of results when the caller does not specify one. */
export const GOOGLE_MAPS_DEFAULT_MAX_RESULTS = 20;

/** Hard cap on the number of results regardless of caller request. */
export const GOOGLE_MAPS_HARD_CAP = 50;
