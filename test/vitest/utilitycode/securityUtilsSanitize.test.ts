/**
 * Regression tests for the securityUtils sanitization fixes.
 *
 * Pins the CodeQL `js/bad-tag-filter` / `js/incomplete-multi-character-sanitization`
 * fixes: `sanitizeInput.string` previously relied on a blocklist regex
 * (`/<script…>…<\/script>/`) and a generic tag strip that could leave
 * re-formable fragments. It now strips all tags via a tight loop and
 * escapes residual angle brackets so no markup can ever re-form.
 *
 * `checkXss` no longer uses a `<script>` tag blocklist regex; it flags any
 * tag opener or dangerous scheme instead.
 */
import { describe, it, expect } from "vitest";
import { sanitizeInput, securityValidation } from "@/views/utils/securityUtils";

describe("sanitizeInput.string neutralizes markup", () => {
  it("strips a complete <script> tag and its body", () => {
    const out = sanitizeInput.string("<p>hi</p><script>alert(1)</script>");
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("alert");
    expect(out).toContain("hi");
  });

  it("strips <script src=x> with no body and self-closing variants", () => {
    expect(sanitizeInput.string('<script src="evil.js"></script>done')).toBe(
      "done"
    );
    expect(sanitizeInput.string("<script/>ok")).toBe("ok");
  });

  it("strips nested/broken tags so no tag can re-form", () => {
    const out = sanitizeInput.string("<scr<script>ipt>alert(1)</script>");
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
  });

  it("escapes residual angle brackets that do not form a tag", () => {
    // A stray `<` with no matching `>` must not survive as a raw bracket.
    const out = sanitizeInput.string("a < b");
    expect(out).not.toContain("<");
    expect(out).toContain("&lt;");
    // A stray `>` alone is removed as a bracket.
    const out2 = sanitizeInput.string("c > d");
    expect(out2).not.toContain(">");
    expect(out2).toContain("&gt;");
  });

  it("strips inline event handlers and other tags", () => {
    const out = sanitizeInput.string(
      '<img src=x onerror="alert(1)"><svg><script>alert(2)</script></svg>'
    );
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
    expect(out).not.toContain("alert");
    expect(out).not.toContain("onerror");
  });

  it("returns empty string for falsy input", () => {
    expect(sanitizeInput.string("")).toBe("");
    expect(sanitizeInput.string(null as unknown as string)).toBe("");
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizeInput.string("   <p>clean</p>   ")).toBe("clean");
  });

  it("leaves plain text untouched", () => {
    expect(sanitizeInput.string("just plain text")).toBe("just plain text");
  });
});

describe("checkXss flags markup and schemes (no tag blocklist)", () => {
  it("detects script/iframe/svg/object tag openers", () => {
    expect(securityValidation.checkXss("<script>x</script>")).toBe(true);
    expect(securityValidation.checkXss("<iframe src=x>")).toBe(true);
    expect(securityValidation.checkXss("<svg/onload=alert(1)>")).toBe(true);
    expect(securityValidation.checkXss("<object data=x>")).toBe(true);
  });

  it("detects dangerous URI schemes and handlers", () => {
    expect(securityValidation.checkXss("javascript:alert(1)")).toBe(true);
    expect(securityValidation.checkXss('"><img src=x onerror=alert(1)>')).toBe(
      true
    );
    expect(securityValidation.checkXss("data:text/html,<script>")).toBe(true);
  });

  it("does not flag inert plain text", () => {
    expect(securityValidation.checkXss("just a normal sentence")).toBe(false);
    expect(securityValidation.checkXss("")).toBe(false);
    // A bare `<` that is not a tag opener (e.g. math "a < b") is allowed.
    expect(securityValidation.checkXss("a < b and c > d")).toBe(false);
  });
});
