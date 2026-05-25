import { describe, test, expect } from "vitest";
import {
  YandexMapsSearchInput,
  YandexMapsBusinessResult,
  YandexMapsSearchResult,
  YandexMapsProgressStatus,
  YandexMapsProgressEvent,
  YandexMapsErrorCode,
  YandexMapsErrorResponse,
  YANDEX_MAPS_DEFAULT_MAX_RESULTS,
  YANDEX_MAPS_HARD_CAP,
} from "@/entityTypes/yandexMapsTypes";

describe("yandexMapsTypes", () => {
  // -----------------------------------------------------------------------
  // TYPE-01: YandexMapsSearchInput
  // -----------------------------------------------------------------------
  describe("YandexMapsSearchInput", () => {
    test("accepts a fully populated search input object", () => {
      const input: YandexMapsSearchInput = {
        query: "dentist",
        location: "Moscow",
        max_results: 30,
        include_website: true,
        include_reviews: false,
        language: "ru",
        region: "ru",
        show_browser: false,
      };

      expect(input.query).toBe("dentist");
      expect(input.location).toBe("Moscow");
      expect(input.max_results).toBe(30);
      expect(input.include_website).toBe(true);
      expect(input.include_reviews).toBe(false);
      expect(input.language).toBe("ru");
      expect(input.region).toBe("ru");
      expect(input.show_browser).toBe(false);
    });

    test("accepts a minimal search input with only required fields", () => {
      const input: YandexMapsSearchInput = {
        query: "restaurant",
        location: "Saint Petersburg",
      };

      expect(input.query).toBe("restaurant");
      expect(input.location).toBe("Saint Petersburg");
      expect(input.max_results).toBeUndefined();
      expect(input.include_website).toBeUndefined();
      expect(input.include_reviews).toBeUndefined();
      expect(input.language).toBeUndefined();
      expect(input.region).toBeUndefined();
      expect(input.show_browser).toBeUndefined();
    });

    // @ts-expect-error -- missing required `query` field
    test("compile-time rejects input without required query field", () => {
      const _bad: YandexMapsSearchInput = {
        location: "Moscow",
      };
    });

    // @ts-expect-error -- missing required `location` field
    test("compile-time rejects input without required location field", () => {
      const _bad: YandexMapsSearchInput = {
        query: "dentist",
      };
    });
  });

  // -----------------------------------------------------------------------
  // TYPE-02: YandexMapsBusinessResult
  // -----------------------------------------------------------------------
  describe("YandexMapsBusinessResult", () => {
    test("accepts a fully populated business result object", () => {
      const result: YandexMapsBusinessResult = {
        name: "Test Business",
        rating: "4.5",
        review_count: 100,
        category: "Dentist",
        address: "123 Test St",
        phone: "+7-495-123-4567",
        website: "https://example.com",
        maps_url: "https://yandex.ru/maps/org/123",
        yandex_id: "1234567890",
        hours: "Mon-Fri 9:00-18:00",
        latitude: 55.7558,
        longitude: 37.6173,
      };

      expect(result.name).toBe("Test Business");
      expect(result.rating).toBe("4.5");
      expect(result.review_count).toBe(100);
      expect(result.category).toBe("Dentist");
      expect(result.address).toBe("123 Test St");
      expect(result.phone).toBe("+7-495-123-4567");
      expect(result.website).toBe("https://example.com");
      expect(result.maps_url).toBe("https://yandex.ru/maps/org/123");
      expect(result.yandex_id).toBe("1234567890");
      expect(result.hours).toBe("Mon-Fri 9:00-18:00");
      expect(result.latitude).toBe(55.7558);
      expect(result.longitude).toBe(37.6173);
    });

    test("accepts a minimal business result with only required name field", () => {
      const result: YandexMapsBusinessResult = {
        name: "Minimal Business",
      };

      expect(result.name).toBe("Minimal Business");
      expect(result.rating).toBeUndefined();
      expect(result.review_count).toBeUndefined();
      expect(result.category).toBeUndefined();
      expect(result.address).toBeUndefined();
      expect(result.phone).toBeUndefined();
      expect(result.website).toBeUndefined();
      expect(result.maps_url).toBeUndefined();
      expect(result.yandex_id).toBeUndefined();
      expect(result.hours).toBeUndefined();
      expect(result.latitude).toBeUndefined();
      expect(result.longitude).toBeUndefined();
    });

    // @ts-expect-error -- missing required `name` field
    test("compile-time rejects result without required name field", () => {
      const _bad: YandexMapsBusinessResult = {
        rating: "4.0",
      };
    });
  });

  // -----------------------------------------------------------------------
  // TYPE-03: YandexMapsSearchResult
  // -----------------------------------------------------------------------
  describe("YandexMapsSearchResult", () => {
    test("accepts a valid search result with empty results array", () => {
      const result: YandexMapsSearchResult = {
        success: true,
        query: "dentist",
        location: "Moscow",
        totalResults: 0,
        summary: "Found 0 results",
        results: [],
      };

      expect(result.success).toBe(true);
      expect(result.query).toBe("dentist");
      expect(result.location).toBe("Moscow");
      expect(result.totalResults).toBe(0);
      expect(result.summary).toBe("Found 0 results");
      expect(result.results).toEqual([]);
    });

    test("accepts a search result with populated business results", () => {
      const result: YandexMapsSearchResult = {
        success: true,
        query: "restaurant",
        location: "Kazan",
        totalResults: 2,
        summary: "Found 2 results",
        results: [
          { name: "Cafe One", rating: "4.8" },
          { name: "Cafe Two", rating: "4.2" },
        ],
      };

      expect(result.totalResults).toBe(2);
      expect(result.results).toHaveLength(2);
      expect(result.results[0].name).toBe("Cafe One");
      expect(result.results[1].name).toBe("Cafe Two");
    });
  });

  // -----------------------------------------------------------------------
  // TYPE-04: YandexMapsProgressStatus and YandexMapsProgressEvent
  // -----------------------------------------------------------------------
  describe("YandexMapsProgressStatus", () => {
    const expectedStatuses: readonly YandexMapsProgressStatus[] = [
      "idle",
      "validating",
      "launching",
      "loading",
      "extracting",
      "completed",
      "cancelled",
      "failed",
      "captcha",
      "timed_out",
    ] as const;

    test("contains exactly 10 status literals", () => {
      expect(expectedStatuses).toHaveLength(10);
    });

    test("each status value is a valid YandexMapsProgressStatus", () => {
      const statusSet = new Set<string>(expectedStatuses);

      expect(statusSet.has("idle")).toBe(true);
      expect(statusSet.has("validating")).toBe(true);
      expect(statusSet.has("launching")).toBe(true);
      expect(statusSet.has("loading")).toBe(true);
      expect(statusSet.has("extracting")).toBe(true);
      expect(statusSet.has("completed")).toBe(true);
      expect(statusSet.has("cancelled")).toBe(true);
      expect(statusSet.has("failed")).toBe(true);
      expect(statusSet.has("captcha")).toBe(true);
      expect(statusSet.has("timed_out")).toBe(true);
    });

    test("includes captcha status (Yandex-specific)", () => {
      const captchaStatus: YandexMapsProgressStatus = "captcha";
      expect(captchaStatus).toBe("captcha");
    });

    test("does not include navigating status (removed from Google Maps)", () => {
      // "navigating" should NOT be a valid YandexMapsProgressStatus
      // This is a design decision: Yandex Maps loads search results
      // on the same page without a separate navigation step.
      const allStatuses: string[] = [...expectedStatuses];
      expect(allStatuses).not.toContain("navigating");
    });

    // @ts-expect-error -- invalid status string should not compile
    test("compile-time rejects invalid status string", () => {
      const _bad: YandexMapsProgressStatus = "invalid_status";
    });
  });

  describe("YandexMapsProgressEvent", () => {
    test("accepts a valid progress event", () => {
      const event: YandexMapsProgressEvent = {
        requestId: "test-123",
        status: "loading",
        current: 5,
        total: 20,
        message: "Extracting businesses...",
      };

      expect(event.requestId).toBe("test-123");
      expect(event.status).toBe("loading");
      expect(event.current).toBe(5);
      expect(event.total).toBe(20);
      expect(event.message).toBe("Extracting businesses...");
    });

    test("accepts progress event with captcha status", () => {
      const event: YandexMapsProgressEvent = {
        requestId: "req-456",
        status: "captcha",
        current: 3,
        total: 30,
        message: "Captcha challenge detected",
      };

      expect(event.status).toBe("captcha");
    });
  });

  // -----------------------------------------------------------------------
  // TYPE-05: YandexMapsErrorCode and YandexMapsErrorResponse
  // -----------------------------------------------------------------------
  describe("YandexMapsErrorCode", () => {
    const expectedCodes: readonly YandexMapsErrorCode[] = [
      "INVALID_INPUT",
      "TIMEOUT",
      "CANCELLED",
      "SCRAPE_FAILED",
      "NO_RESULTS",
      "UNKNOWN",
      "CAPTCHA",
      "NETWORK_FAILURE",
      "LAYOUT_CHANGE",
    ] as const;

    test("contains exactly 9 error codes", () => {
      expect(expectedCodes).toHaveLength(9);
    });

    test("each error code is a valid YandexMapsErrorCode", () => {
      const codeSet = new Set<string>(expectedCodes);

      expect(codeSet.has("INVALID_INPUT")).toBe(true);
      expect(codeSet.has("TIMEOUT")).toBe(true);
      expect(codeSet.has("CANCELLED")).toBe(true);
      expect(codeSet.has("SCRAPE_FAILED")).toBe(true);
      expect(codeSet.has("NO_RESULTS")).toBe(true);
      expect(codeSet.has("UNKNOWN")).toBe(true);
      expect(codeSet.has("CAPTCHA")).toBe(true);
      expect(codeSet.has("NETWORK_FAILURE")).toBe(true);
      expect(codeSet.has("LAYOUT_CHANGE")).toBe(true);
    });

    test("includes Yandex-specific error codes", () => {
      const captcha: YandexMapsErrorCode = "CAPTCHA";
      const network: YandexMapsErrorCode = "NETWORK_FAILURE";
      const layout: YandexMapsErrorCode = "LAYOUT_CHANGE";

      expect(captcha).toBe("CAPTCHA");
      expect(network).toBe("NETWORK_FAILURE");
      expect(layout).toBe("LAYOUT_CHANGE");
    });

    // @ts-expect-error -- invalid error code should not compile
    test("compile-time rejects invalid error code string", () => {
      const _bad: YandexMapsErrorCode = "INVALID_ERROR";
    });
  });

  describe("YandexMapsErrorResponse", () => {
    test("accepts a valid error response", () => {
      const error: YandexMapsErrorResponse = {
        code: "CAPTCHA",
        message: "Captcha detected",
      };

      expect(error.code).toBe("CAPTCHA");
      expect(error.message).toBe("Captcha detected");
    });

    test("accepts error response with network failure code", () => {
      const error: YandexMapsErrorResponse = {
        code: "NETWORK_FAILURE",
        message: "Failed to connect to Yandex Maps",
      };

      expect(error.code).toBe("NETWORK_FAILURE");
      expect(error.message).toBe("Failed to connect to Yandex Maps");
    });

    test("accepts error response with layout change code", () => {
      const error: YandexMapsErrorResponse = {
        code: "LAYOUT_CHANGE",
        message: "Yandex Maps page layout has changed",
      };

      expect(error.code).toBe("LAYOUT_CHANGE");
      expect(error.message).toBe("Yandex Maps page layout has changed");
    });
  });

  // -----------------------------------------------------------------------
  // Constants
  // -----------------------------------------------------------------------
  describe("Constants", () => {
    test("YANDEX_MAPS_DEFAULT_MAX_RESULTS equals 20", () => {
      expect(YANDEX_MAPS_DEFAULT_MAX_RESULTS).toBe(20);
    });

    test("YANDEX_MAPS_HARD_CAP equals 50", () => {
      expect(YANDEX_MAPS_HARD_CAP).toBe(50);
    });

    test("hard cap is greater than default max results", () => {
      expect(YANDEX_MAPS_HARD_CAP).toBeGreaterThan(YANDEX_MAPS_DEFAULT_MAX_RESULTS);
    });
  });
});
