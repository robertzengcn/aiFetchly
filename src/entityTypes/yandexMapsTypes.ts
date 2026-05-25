/**
 * Yandex Maps Business Scraper — shared type contracts.
 *
 * Used by:
 * - skillsRegistry (skill parameter schema mirrors these types)
 * - ToolExecutor (input validation and dispatch)
 * - YandexMapsModule (orchestration layer — Phase 10)
 * - YandexMapsWorker (child process — Phase 10)
 * - IPC handlers and UI page (Phase 11)
 */

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/** Parameters for a Yandex Maps business search request. */
export interface YandexMapsSearchInput {
  /** Business keyword or category to search for (e.g. "dentist", "Italian restaurant"). */
  query: string;

  /** Target location for the search (e.g. "Moscow", "Saint Petersburg, Russia"). */
  location: string;

  /** Maximum number of business results to return. Defaults to 20. */
  max_results?: number;

  /** Whether to extract website URLs from business listings. Defaults to true. */
  include_website?: boolean;

  /** Whether to include review count in results. Defaults to false. */
  include_reviews?: boolean;

  /** Language for Yandex Maps UI (e.g. "ru", "en", "tr"). Defaults to "ru". */
  language?: string;

  /** Region code for search context (e.g. "ru", "kz", "by"). */
  region?: string;

  /** Whether to show the browser window during scraping for debugging. Defaults to false. */
  show_browser?: boolean;
}

// ---------------------------------------------------------------------------
// Output — single business result
// ---------------------------------------------------------------------------

/** A single business listing extracted from Yandex Maps. */
export interface YandexMapsBusinessResult {
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

  /** Yandex Maps URL for this business. */
  maps_url?: string;

  /** Yandex business listing ID. */
  yandex_id?: string;

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

/** Structured result returned after a Yandex Maps business search. */
export interface YandexMapsSearchResult {
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
  results: YandexMapsBusinessResult[];
}

// ---------------------------------------------------------------------------
// Progress tracking
// ---------------------------------------------------------------------------

/** Possible statuses for a Yandex Maps scraping operation. */
export type YandexMapsProgressStatus =
  | "idle"
  | "validating"
  | "launching"
  | "loading"
  | "extracting"
  | "completed"
  | "cancelled"
  | "failed"
  | "captcha"
  | "timed_out";

/** Progress event emitted during a Yandex Maps scraping operation. */
export interface YandexMapsProgressEvent {
  /** Unique identifier for this search request. */
  requestId: string;

  /** Current status of the scraping operation. */
  status: YandexMapsProgressStatus;

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

/** Error codes for Yandex Maps scraping failures. */
export type YandexMapsErrorCode =
  | "INVALID_INPUT"
  | "TIMEOUT"
  | "CANCELLED"
  | "SCRAPE_FAILED"
  | "NO_RESULTS"
  | "UNKNOWN"
  | "CAPTCHA"
  | "NETWORK_FAILURE"
  | "LAYOUT_CHANGE";

/** Structured error response for Yandex Maps scraping failures. */
export interface YandexMapsErrorResponse {
  /** Machine-readable error code. */
  code: YandexMapsErrorCode;

  /** Human-readable error message. */
  message: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default maximum number of results when the caller does not specify one. */
export const YANDEX_MAPS_DEFAULT_MAX_RESULTS = 20;

/** Hard cap on the number of results regardless of caller request. */
export const YANDEX_MAPS_HARD_CAP = 50;
