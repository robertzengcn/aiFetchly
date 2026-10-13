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

  test("detects when Google already reached the search results page", () => {
    expect(
      GoogleScraper.isSearchResultsPageState({
        url: "https://www.google.com/search?q=software+sale+company",
        title: "software sale company - Google Search",
        html: '<html itemscope itemtype="http://schema.org/SearchResultsPage"></html>',
      })
    ).toBe(true);
  });

  test("dedupes links that differ only by trailing slash", () => {
    const results = GoogleScraper.parseResultSnapshots([
      makeResult("https://example.com/page", "First Result"),
      makeResult("https://example.com/page/", "Second Result"),
    ]);

    expect(results).toHaveLength(1);
    expect(results[0]?.link).toBe("https://example.com/page");
  });

  test("dedupes links that differ only by www. prefix", () => {
    const results = GoogleScraper.parseResultSnapshots([
      makeResult("https://example.com/page", "First Result"),
      makeResult("https://www.example.com/page", "Second Result"),
    ]);

    expect(results).toHaveLength(1);
    expect(results[0]?.link).toBe("https://example.com/page");
  });

  test("unwraps non-US Google redirect links regardless of country TLD", () => {
    const results = GoogleScraper.parseResultSnapshots([
      {
        htmlPreview: "",
        anchors: [
          {
            href: "https://www.google.co.uk/url?q=https://example.com/contact&sa=U",
            text: "Example Contact",
            hasHeading: true,
            headingText: "Example Contact",
          },
        ],
        headings: ["Example Contact"],
        citeTexts: [],
        snippetTexts: [],
      },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0]?.link).toBe("https://example.com/contact");
  });

  test("unwraps non-US redirect variants of both US forms (q= and url= params)", () => {
    const results = GoogleScraper.parseResultSnapshots([
      makeResult("https://www.google.de/url?q=https://example.com/contact", "Example Contact"),
      makeResult("https://google.com.au/url?sa=t&url=https://example.com/about", "Example About"),
    ]);

    expect(results.map(item => item.link)).toEqual([
      "https://example.com/contact",
      "https://example.com/about",
    ]);
  });

  test("rejects any google.* country TLD host as an organic result", () => {
    const results = GoogleScraper.parseResultSnapshots([
      makeResult("https://www.google.co.uk/search?q=test", "Google Search Result"),
      makeResult("https://www.google.de/imghp", "Google Images"),
    ]);

    expect(results).toHaveLength(0);
  });

  test("still accepts legitimate non-google hosts and stores them www-stripped", () => {
    const results = GoogleScraper.parseResultSnapshots([
      makeResult("https://www.example.org/business", "Legit www Result"),
    ]);

    expect(results).toHaveLength(1);
    expect(results[0]?.link).toBe("https://example.org/business");
  });

  test("dedupes bare-domain homepage links across www and trailing-slash variants", () => {
    const results = GoogleScraper.parseResultSnapshots([
      makeResult("https://example.com", "Home"),
      makeResult("https://www.example.com", "Home www"),
      makeResult("https://example.com/", "Home slash"),
    ]);

    expect(results).toHaveLength(1);
    expect(results[0]?.link).toBe("https://example.com");
  });
});

function makeResult(href: string, headingText: string) {
  return {
    htmlPreview: "",
    anchors: [
      {
        href,
        text: headingText,
        hasHeading: true,
        headingText,
      },
    ],
    headings: [headingText],
    citeTexts: [],
    snippetTexts: [],
  };
}
