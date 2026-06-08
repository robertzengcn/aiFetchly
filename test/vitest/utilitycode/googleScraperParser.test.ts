import { describe, expect, test } from "vitest";
import { GoogleScraper } from "@/childprocess/googleScraper";

describe("GoogleScraper result parsing", () => {
  test("extracts an organic result from Google's updated jsname result markup", () => {
    const results = GoogleScraper.parseResultSnapshots([
      {
        htmlPreview:
          '<div class="MjjYud"><a jsname="UWckNb" href="https://example.com"><h3>Example Result</h3></a><div data-sncf="1">Updated snippet text</div><cite>example.com</cite></div>',
        anchors: [
          {
            href: "/search?q=cache:example",
            text: "Cached",
            hasHeading: false,
          },
          {
            href: "https://example.com",
            text: "Example Result",
            hasHeading: true,
            headingText: "Example Result",
            ariaLabel: "Example Result",
          },
        ],
        headings: ["Example Result"],
        citeTexts: ["example.com"],
        snippetTexts: ["Updated snippet text"],
      },
    ]);

    expect(results).toEqual([
      {
        link: "https://example.com",
        title: "Example Result",
        snippet: "Updated snippet text",
        visible_link: "example.com",
      },
    ]);
  });
});
