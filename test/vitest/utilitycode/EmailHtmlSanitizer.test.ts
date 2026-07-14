import { describe, it, expect } from "vitest";
import {
  sanitizeEmailHtml,
  htmlToPlainText,
} from "@/service/emailReceive/EmailHtmlSanitizer";

describe("sanitizeEmailHtml", () => {
  it("strips <script> tags", () => {
    const dirty = `<p>hi</p><script>alert(1)</script>`;
    const clean = sanitizeEmailHtml(dirty)!;
    expect(clean).not.toContain("<script>");
    expect(clean).not.toContain("alert");
    expect(clean).toContain("<p>hi</p>");
  });

  it("strips inline event handlers", () => {
    const dirty = `<p onclick="evil()">hi</p><a href="x" onmouseover="bad">link</a>`;
    const clean = sanitizeEmailHtml(dirty)!;
    expect(clean).not.toContain("onclick");
    expect(clean).not.toContain("onmouseover");
  });

  it("strips 1x1 tracking pixels", () => {
    const dirty = `<p>hello</p><img src="https://e.example.com/pixel.gif" width="1" height="1">`;
    const clean = sanitizeEmailHtml(dirty)!;
    expect(clean).not.toContain("pixel.gif");
    expect(clean).toContain("<p>hello</p>");
  });

  it("strips tracking-pixel URL markers regardless of size", () => {
    const dirty = `<img src="https://track.open.example.com/x">`;
    const clean = sanitizeEmailHtml(dirty)!;
    expect(clean).not.toContain("track.open.example.com");
  });

  it("forces anchor links to open in a new tab with safe rel", () => {
    const clean = sanitizeEmailHtml(`<a href="https://example.com">go</a>`)!;
    expect(clean).toContain('target="_blank"');
    expect(clean).toContain('rel="noopener noreferrer nofollow"');
  });

  it("drops forms and iframes", () => {
    const dirty = `<iframe src="https://evil"></iframe><form><button>x</button></form>`;
    const clean = sanitizeEmailHtml(dirty)!;
    expect(clean).not.toContain("iframe");
    expect(clean).not.toContain("form");
  });

  it("returns null for empty/whitespace input", () => {
    expect(sanitizeEmailHtml("")).toBeNull();
    expect(sanitizeEmailHtml("   ")).toBeNull();
    expect(sanitizeEmailHtml(null)).toBeNull();
  });

  it("preserves basic formatting tags", () => {
    const clean = sanitizeEmailHtml(`<strong>b</strong><em>i</em><ul><li>a</li></ul>`)!;
    expect(clean).toContain("<strong>b</strong>");
    expect(clean).toContain("<em>i</em>");
    expect(clean).toContain("<ul>");
  });
});

describe("htmlToPlainText", () => {
  it("converts simple HTML to text", () => {
    expect(htmlToPlainText("<p>Hello <strong>world</strong></p>")).toContain("Hello world");
  });

  it("returns empty string for empty input", () => {
    expect(htmlToPlainText("")).toBe("");
    expect(htmlToPlainText(null)).toBe("");
  });

  it("skips images", () => {
    const text = htmlToPlainText(`<img src="x" alt="logo"><p>body</p>`);
    expect(text).toContain("body");
    expect(text).not.toContain("logo");
  });
});
