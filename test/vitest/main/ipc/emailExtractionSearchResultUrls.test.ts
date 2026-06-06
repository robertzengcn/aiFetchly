import { describe, expect, test } from "vitest";
import { resolveSearchResultUrls } from "@/main-process/communication/emailExtractionSearchResultUrls";
import type { SearchResEntity } from "@/entityTypes/scrapeType";

describe("resolveSearchResultUrls", () => {
  test("returns valid links from search results", () => {
    const results: SearchResEntity[] = [
      {
        keyword_id: 1,
        link: " https://example.com/contact ",
        title: "Example",
        snippet: null,
        visible_link: "example.com",
      },
      {
        keyword_id: 1,
        link: "not-a-url",
        title: "Invalid",
        snippet: null,
        visible_link: null,
      },
      {
        keyword_id: 1,
        link: "https://example.org/about",
        title: "About",
        snippet: null,
        visible_link: "example.org",
      },
    ];

    expect(resolveSearchResultUrls(results)).toEqual([
      "https://example.com/contact",
      "https://example.org/about",
    ]);
  });
});
