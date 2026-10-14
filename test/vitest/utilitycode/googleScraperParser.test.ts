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
    const cases: Array<{ href: string; expected: string }> = [
      {
        href: "https://www.google.co.uk/url?q=https://example.co.uk/page&sa=D&source=hangouts",
        expected: "https://example.co.uk/page",
      },
      {
        href: "https://www.google.de/url?q=https://example.de/angebot&sa=t",
        expected: "https://example.de/angebot",
      },
      {
        href: "https://www.google.co.jp/url?q=https://example.jp/item&sa=t",
        expected: "https://example.jp/item",
      },
      {
        href: "https://www.google.com.hk/url?q=https://example.hk/shop&sa=t",
        expected: "https://example.hk/shop",
      },
      {
        href: "https://www.google.ca/url?q=https://example.ca/a&sa=t",
        expected: "https://example.ca/a",
      },
    ];

    for (const { href, expected } of cases) {
      const results = GoogleScraper.parseResultSnapshots([
        {
          htmlPreview: "<div></div>",
          anchors: [
            {
              href,
              text: "Example",
              hasHeading: true,
              headingText: "Example",
              ariaLabel: "Example",
            },
          ],
          headings: ["Example"],
          citeTexts: ["example"],
          snippetTexts: ["snippet"],
        },
      ]);

      expect(results).toHaveLength(1);
      expect(results[0]?.link).toBe(expected);
    }
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

  test("treats non-US Google hosts as non-organic internal links", () => {
    const results = GoogleScraper.parseResultSnapshots([
      {
        htmlPreview: "<div></div>",
        anchors: [
          {
            href: "https://www.google.co.uk/search?q=example",
            text: "Example",
            hasHeading: true,
            headingText: "Example",
            ariaLabel: "Example",
          },
        ],
        headings: ["Example"],
        citeTexts: ["google.co.uk"],
        snippetTexts: ["snippet"],
      },
    ]);

    expect(results).toEqual([]);
  });

  test("detects non-US Google search results pages", () => {
    expect(
      GoogleScraper.isSearchResultsPageState({
        url: "https://www.google.co.uk/search?q=software+sale+company",
        title: "software sale company - Google Suche",
        html: "<html></html>",
      })
    ).toBe(true);
  });

  test("does not treat attacker look-alike hosts as Google hosts", () => {
    const lookAlikes = [
      "https://evilgoogle.com/page",
      "https://google.com.evil.com/page",
      "https://www.google.co.uk.evil.com/page",
    ];

    for (const href of lookAlikes) {
      const results = GoogleScraper.parseResultSnapshots([
        {
          htmlPreview: "<div></div>",
          anchors: [
            {
              href,
              text: "Example",
              hasHeading: true,
              headingText: "Example",
              ariaLabel: "Example",
            },
          ],
          headings: ["Example"],
          citeTexts: ["example"],
          snippetTexts: ["snippet"],
        },
      ]);

      expect(results).toHaveLength(1);
      // Kept links are www-stripped by canonicalization (no URL round-trip,
      // no redirect unwrapping) — the look-alike host survives verbatim.
      const expectedLink = href.replace(/^https:\/\/www\./i, "https://");
      expect(results[0]?.link).toBe(expectedLink);
    }
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
