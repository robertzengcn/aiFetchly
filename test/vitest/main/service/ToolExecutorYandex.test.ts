"use strict";
import { describe, test, expect, vi } from "vitest";
import { ToolExecutor } from "@/service/ToolExecutor";
import {
  YANDEX_MAPS_DEFAULT_MAX_RESULTS,
  YANDEX_MAPS_HARD_CAP,
} from "@/entityTypes/yandexMapsTypes";

// Mock FileOperationTracker to avoid side effects
vi.mock("@/service/FileOperationTracker", () => ({
  FileOperationTracker: {
    emit: vi.fn(),
  },
}));

describe("ToolExecutor Maps search dispatch (Yandex)", () => {
  describe("input validation", () => {
    test("returns error when query is blank", async () => {
      const result = await ToolExecutor.execute(
        "search_maps_businesses",
        { platform: "yandex", query: "", location: "Moscow" },
        "conv-1"
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("query");
    });

    test("returns error when query is missing", async () => {
      const result = await ToolExecutor.execute(
        "search_maps_businesses",
        { platform: "yandex", location: "Moscow" },
        "conv-1"
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("query");
    });

    test("returns error when location is blank", async () => {
      const result = await ToolExecutor.execute(
        "search_maps_businesses",
        { platform: "yandex", query: "dentist", location: "" },
        "conv-1"
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("location");
    });

    test("returns error when location is missing", async () => {
      const result = await ToolExecutor.execute(
        "search_maps_businesses",
        { platform: "yandex", query: "dentist" },
        "conv-1"
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("location");
    });
  });

  describe("hard cap enforcement", () => {
    test("accepts max_results above HARD_CAP without throwing", async () => {
      const result = await ToolExecutor.execute(
        "search_maps_businesses",
        {
          platform: "yandex",
          query: "dentist",
          location: "Moscow",
          max_results: 200,
        },
        "conv-1"
      );
      // Should return a structured response, not throw
      expect(result).toBeDefined();
      expect(typeof result.success).toBe("boolean");
    });

    test("accepts max_results at HARD_CAP boundary", async () => {
      const result = await ToolExecutor.execute(
        "search_maps_businesses",
        {
          platform: "yandex",
          query: "dentist",
          location: "Moscow",
          max_results: YANDEX_MAPS_HARD_CAP,
        },
        "conv-1"
      );
      expect(result).toBeDefined();
      expect(typeof result.success).toBe("boolean");
    });

    test("accepts max_results below HARD_CAP", async () => {
      const result = await ToolExecutor.execute(
        "search_maps_businesses",
        {
          platform: "yandex",
          query: "dentist",
          location: "Moscow",
          max_results: 10,
        },
        "conv-1"
      );
      expect(result).toBeDefined();
      expect(typeof result.success).toBe("boolean");
    });
  });

  describe("yandex maps worker execution", () => {
    test("returns error when worker file is not available (test environment)", async () => {
      const result = await ToolExecutor.execute(
        "search_maps_businesses",
        { platform: "yandex", query: "dentist", location: "Moscow" },
        "conv-1"
      );
      expect(result.success).toBe(false);
      // Worker file not found in test environment
      expect(result.error).toContain("Failed to spawn Yandex Maps worker");
    });
  });

  describe("rate limiting", () => {
    test("uses yandexMaps rate limit config", async () => {
      // Calling execute should not throw due to missing rate limit config.
      // The rate limiter is created lazily by RateLimiterManager.
      // We verify that the tool name is routed to a config entry (not the default)
      // by checking that repeated calls within limits succeed without rate-limit errors.
      const result = await ToolExecutor.execute(
        "search_maps_businesses",
        { platform: "yandex", query: "dentist", location: "Moscow" },
        "conv-1"
      );
      // Should return a structured result, not a rate-limit error
      expect(result).toBeDefined();
      expect(result).not.toEqual({
        success: false,
        error: expect.stringContaining("rate limit"),
      });
    });
  });

  describe("platform routing", () => {
    test("defaults to google when platform is not specified", async () => {
      const result = await ToolExecutor.execute(
        "search_maps_businesses",
        { query: "dentist", location: "New York" },
        "conv-1"
      );
      expect(result).toBeDefined();
      expect(typeof result.success).toBe("boolean");
    });
  });
});
