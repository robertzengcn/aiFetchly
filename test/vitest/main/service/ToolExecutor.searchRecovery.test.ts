import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { SearchTaskStatus } from "@/model/SearchTask.model";

const searchByKeywordAndEngine = vi.fn();
const getTaskStatus = vi.fn();
const listSearchResult = vi.fn();

vi.mock("@/modules/SearchModule", () => ({
  SearchModule: class SearchModule {
    searchByKeywordAndEngine = searchByKeywordAndEngine;
    getTaskStatus = getTaskStatus;
    listSearchResult = listSearchResult;
  },
  chunkToUtf8: (data: unknown): string => String(data),
}));

vi.mock("@/service/ToolExecutionService", () => ({
  ToolExecutionService: {
    extractCleanResults: (results: unknown[]) => results,
    formatSearchResultsForLLM: () => "formatted",
  },
}));

describe("ToolExecutor search Error recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    searchByKeywordAndEngine.mockReset();
    getTaskStatus.mockReset();
    listSearchResult.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("returns saved results when task status is Error but rows exist", async () => {
    searchByKeywordAndEngine.mockResolvedValue(58);
    getTaskStatus.mockResolvedValue(SearchTaskStatus.Error);
    listSearchResult.mockResolvedValue([
      {
        link: "https://example.com",
        title: "Example",
        snippet: "snippet",
        visible_link: "example.com",
      },
    ]);

    const { ToolExecutor } = await import("@/service/ToolExecutor");
    const pending = ToolExecutor.execute(
      "scrape_urls_from_search_engine",
      {
        query: "value added reseller seattle",
        search_engine: "bing",
        num_results: 10,
      },
      "conv-search-recovery"
    );

    // errorGraceMs is 120s — advance past it so the poll loop exits
    await vi.advanceTimersByTimeAsync(121_000);
    const result = await pending;

    expect(result.success).toBe(true);
    expect(result.taskId).toBe(58);
    expect(result.totalResults).toBe(1);
    expect(Array.isArray(result.results)).toBe(true);
  });

  test("fails with labeled status when Error and no results after grace", async () => {
    searchByKeywordAndEngine.mockResolvedValue(58);
    getTaskStatus.mockResolvedValue(SearchTaskStatus.Error);
    listSearchResult.mockResolvedValue([]);

    const { ToolExecutor } = await import("@/service/ToolExecutor");
    const pending = ToolExecutor.execute(
      "scrape_urls_from_search_engine",
      {
        query: "empty query",
        search_engine: "bing",
        num_results: 10,
      },
      "conv-search-fail"
    );

    const assertion = expect(pending).rejects.toThrow(
      /Search task 58 did not complete successfully\. Status: 3 \(Error\)/
    );
    await vi.advanceTimersByTimeAsync(121_000);
    await assertion;
  });
});
