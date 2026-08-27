import { describe, it, expect } from "vitest";
import { isTrustedNavigation } from "@/main-process/security/navigationGuard";

describe("isTrustedNavigation", () => {
  const options = {
    trustedOrigins: ["http://localhost:5173"],
    trustedProtocols: ["aifetchly:"],
  };

  it("blocks external http(s) origins", () => {
    expect(isTrustedNavigation("https://evil.example.com", options)).toBe(false);
    expect(isTrustedNavigation("http://attacker.io/path", options)).toBe(false);
    expect(
      isTrustedNavigation("https://localhost:5174", options) // wrong port
    ).toBe(false);
  });

  it("allows the trusted dev-server origin", () => {
    expect(isTrustedNavigation("http://localhost:5173/", options)).toBe(true);
    expect(
      isTrustedNavigation("http://localhost:5173/some/route", options)
    ).toBe(true);
  });

  it("allows file:// (production loadFile)", () => {
    expect(
      isTrustedNavigation("file:///app/dist/index.html", options)
    ).toBe(true);
  });

  it("allows about:blank (internal)", () => {
    expect(isTrustedNavigation("about:blank", options)).toBe(true);
  });

  it("allows the app's own custom scheme", () => {
    // URL parser lowercases the scheme
    expect(isTrustedNavigation("aifetchly://something", options)).toBe(true);
  });

  it("rejects malformed URLs", () => {
    expect(isTrustedNavigation("not-a-url", options)).toBe(false);
    expect(isTrustedNavigation("", options)).toBe(false);
    expect(isTrustedNavigation("http://", options)).toBe(false);
  });

  it("does NOT trust data: URLs (XSS vector)", () => {
    expect(
      isTrustedNavigation("data:text/html,<script>x</script>", options)
    ).toBe(false);
  });

  it("does NOT trust javascript: URLs", () => {
    expect(
      isTrustedNavigation("javascript:alert(1)", options)
    ).toBe(false);
  });

  it("with empty options trusts only builtins (file:, about:)", () => {
    expect(isTrustedNavigation("file:///x", {})).toBe(true);
    expect(isTrustedNavigation("about:blank", {})).toBe(true);
    expect(isTrustedNavigation("http://localhost:5173", {})).toBe(false);
    expect(isTrustedNavigation("aifetchly://x", {})).toBe(false);
  });

  it("blocks look-alikes of the dev origin (different host)", () => {
    expect(
      isTrustedNavigation("http://localhost:5173.evil.com", options)
    ).toBe(false);
  });
});
