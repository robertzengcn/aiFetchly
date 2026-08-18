"use strict";
import { describe, test, expect, beforeEach } from "vitest";
import { HtmlConversionService } from "@/service/HtmlConversionService";

describe("HtmlConversionService", () => {
  let htmlConversionService: HtmlConversionService;

  beforeEach(() => {
    htmlConversionService = new HtmlConversionService();
  });

  describe("basic functionality", () => {
    test("should be instantiated", () => {
      expect(htmlConversionService).toBeInstanceOf(HtmlConversionService);
    });
  });

  // Regression tests for the CodeQL js/bad-tag-filter fix (#62):
  // cleanHtmlContent now uses a parser-based allowlist (sanitize-html)
  // instead of regex tag blocklists that miss obfuscated tags.
  describe("cleanHtmlContent neutralizes dangerous markup", () => {
    test("strips <script> tags and their content", () => {
      const dirty = '<script>alert("xss")</script><p>Safe content</p>';
      const clean = htmlConversionService.cleanHtmlContent(dirty);
      expect(clean).not.toContain("<script");
      expect(clean).not.toContain("alert");
      expect(clean).toContain("<p>Safe content</p>");
    });

    test("strips <style> content and <noscript> tags", () => {
      const dirty =
        "<style>body{color:red}</style><noscript>nojs</noscript><p>ok</p>";
      const clean = htmlConversionService.cleanHtmlContent(dirty);
      expect(clean).not.toContain("<style");
      expect(clean).not.toContain("<noscript");
      // style CSS must never survive (it is not user-visible content).
      expect(clean).not.toContain("color:red");
      // noscript fallback text is safe inert text and may be preserved.
      expect(clean).toContain("<p>ok</p>");
    });

    test("strips HTML comments", () => {
      const dirty = "<!-- secret --><p>visible</p>";
      const clean = htmlConversionService.cleanHtmlContent(dirty);
      expect(clean).not.toContain("<!--");
      expect(clean).not.toContain("secret");
      expect(clean).toContain("<p>visible</p>");
    });

    test("strips inline event-handler attributes", () => {
      const dirty = '<p onclick="evil()">hi</p><img src="x" onerror="bad()">';
      const clean = htmlConversionService.cleanHtmlContent(dirty);
      expect(clean).not.toContain("onclick");
      expect(clean).not.toContain("onerror");
      expect(clean).toContain("hi");
    });

    test("strips data-* attributes", () => {
      const dirty = '<p data-payload="evil">hi</p>';
      const clean = htmlConversionService.cleanHtmlContent(dirty);
      expect(clean).not.toContain("data-payload");
      expect(clean).not.toContain("evil");
      expect(clean).toContain("hi");
    });

    test("drops javascript: URLs but keeps safe http links", () => {
      const dirty =
        '<a href="javascript:alert(1)">x</a><a href="https://ok.example.com">ok</a>';
      const clean = htmlConversionService.cleanHtmlContent(dirty);
      expect(clean).not.toContain("javascript:");
      expect(clean).not.toContain("alert(1)");
      expect(clean).toContain("https://ok.example.com");
    });

    test("a script tag cannot re-form from fragments", () => {
      // Obfuscated/nested markup must not leave a working <script> opener:
      // the security property is that no `<script` tag can form in the
      // output, even if the surrounding text is mangled.
      const dirty = "<scr<script>ipt>alert(1)</script>";
      const clean = htmlConversionService.cleanHtmlContent(dirty);
      expect(clean).not.toContain("<script");
      expect(clean).not.toContain("</script");
    });

    test("preserves markdown-relevant structure (links, lists, code, headings)", () => {
      const dirty =
        '<h1>Title</h1><ul><li>one</li><li>two</li></ul><pre><code>x</code></pre><a href="https://e.example.com">link</a>';
      const clean = htmlConversionService.cleanHtmlContent(dirty);
      expect(clean).toContain("<h1>Title</h1>");
      expect(clean).toContain("<ul>");
      expect(clean).toContain("<pre><code>x</code></pre>");
      expect(clean).toContain("https://e.example.com");
    });
  });
});
