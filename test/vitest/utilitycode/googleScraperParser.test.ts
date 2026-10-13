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
      expect(results[0]?.link).toBe(href);
    }
  });
});
