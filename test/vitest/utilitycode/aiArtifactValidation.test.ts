/**
 * Tests for AIArtifactValidationService — the product/performance guard
 * that steers the model away from unsupported HTML. (The sandboxed iframe
 * is the real security boundary; these checks reject obvious bad output.)
 */
import { describe, it, expect } from "vitest";
import {
  validateCreateInput,
  ensureHtmlDocument,
  escapeHtmlText,
  AI_HTML_ARTIFACT_MAX_HTML_BYTES,
} from "@/service/AIArtifactValidationService";

describe("AIArtifactValidationService.validateCreateInput", () => {
  it("accepts a valid full HTML document", () => {
    const result = validateCreateInput({
      title: "Report",
      html: "<!doctype html><html><body><p>ok</p></body></html>",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBe("Report");
      expect(result.value.openImmediately).toBe(true);
      expect(result.value.html).toContain("<!doctype html>");
    }
  });

  it("wraps a fragment into a full document with an escaped title", () => {
    const result = validateCreateInput({
      title: "Sales <Q3> & Beyond",
      html: "<p>fragment</p>",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.html).toContain("<!doctype html>");
      expect(result.value.html).toContain(
        "<title>Sales &lt;Q3&gt; &amp; Beyond</title>"
      );
      expect(result.value.html).toContain("<p>fragment</p>");
    }
  });

  it("rejects an empty title", () => {
    const result = validateCreateInput({ title: "   ", html: "<p>x</p>" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/title/i);
  });

  it("rejects an empty HTML body", () => {
    const result = validateCreateInput({ title: "T", html: "   " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/html/i);
  });

  it("rejects oversized HTML", () => {
    const huge =
      "<p>" + "a".repeat(AI_HTML_ARTIFACT_MAX_HTML_BYTES + 10) + "</p>";
    const result = validateCreateInput({ title: "T", html: huge });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/size/i);
  });

  it("defaults openImmediately to true and lets the model disable it", () => {
    const on = validateCreateInput({ title: "T", html: "<p>x</p>" });
    const off = validateCreateInput({
      title: "T",
      html: "<p>x</p>",
      openImmediately: false,
    });
    expect(on.ok && on.value.openImmediately).toBe(true);
    expect(off.ok && off.value.openImmediately).toBe(false);
  });

  it("rejects <script> tags", () => {
    const result = validateCreateInput({
      title: "T",
      html: "<div><script>alert(1)</script></div>",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/script/i);
  });

  it("rejects inline event handlers", () => {
    const result = validateCreateInput({
      title: "T",
      html: '<button onclick="alert(1)">x</button>',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/event handler/i);
  });

  it("rejects javascript: URLs", () => {
    const result = validateCreateInput({
      title: "T",
      html: '<a href="javascript:alert(1)">x</a>',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/javascript/i);
  });

  it("rejects remote scripts, styles, and images", () => {
    const cases = [
      '<script src="https://evil.example/a.js"></script>',
      '<link rel="stylesheet" href="https://evil.example/a.css">',
      '<img src="https://evil.example/pixel.png">',
    ];
    for (const html of cases) {
      const result = validateCreateInput({ title: "T", html });
      expect(result.ok).toBe(false);
    }
  });

  it("rejects protocol-relative remote media (tracking-pixel gap)", () => {
    const cases = [
      '<img src="//evil.example/pixel.png">',
      '<link rel="stylesheet" href="//evil.example/a.css">',
      '<audio src="//evil.example/track.mp3">',
      '<video src="//evil.example/clip.mp4">',
      '<source src="//evil.example/clip.mp4">',
    ];
    for (const html of cases) {
      expect(validateCreateInput({ title: "T", html }).ok).toBe(false);
    }
  });

  it("allows inline data: images and same-document fragments", () => {
    expect(
      validateCreateInput({
        title: "T",
        html: '<img src="data:image/png;base64,iVBORw0KGgo=">',
      }).ok
    ).toBe(true);
  });

  it("rejects forms", () => {
    const result = validateCreateInput({
      title: "T",
      html: '<form action="https://evil.example"><input name="x"/></form>',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/form/i);
  });

  it("rejects nested iframes, objects, and embeds", () => {
    for (const html of [
      "<iframe src='x'></iframe>",
      "<object data='x'></object>",
      "<embed src='x'>",
    ]) {
      expect(validateCreateInput({ title: "T", html }).ok).toBe(false);
    }
  });

  it("rejects parent/top navigation targets", () => {
    expect(
      validateCreateInput({
        title: "T",
        html: '<a href="x" target="_parent">x</a>',
      }).ok
    ).toBe(false);
    expect(
      validateCreateInput({
        title: "T",
        html: '<a href="x" target="_top">x</a>',
      }).ok
    ).toBe(false);
  });

  it("enforces title and description length limits", () => {
    const longTitle = "t".repeat(161);
    expect(validateCreateInput({ title: longTitle, html: "<p>x</p>" }).ok).toBe(
      false
    );
    const longDesc = "d".repeat(501);
    expect(
      validateCreateInput({
        title: "T",
        description: longDesc,
        html: "<p>x</p>",
      }).ok
    ).toBe(false);
  });
});

describe("ensureHtmlDocument", () => {
  it("leaves a document that already has a doctype untouched (trimmed only)", () => {
    const doc = "  <!doctype html><html><body>x</body></html>  ";
    expect(ensureHtmlDocument(doc, "T")).toBe(doc.trim());
  });

  it("leaves a document that starts with <html> untouched", () => {
    const doc = "<html><body>x</body></html>";
    expect(ensureHtmlDocument(doc, "T")).toBe(doc);
  });
});

describe("escapeHtmlText", () => {
  it("escapes the five significant characters", () => {
    expect(escapeHtmlText(`<a href="x" title='y'>&`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;"
    );
  });
});
