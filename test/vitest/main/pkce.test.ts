/**
 * Unit tests for src/modules/pkce.ts.
 *
 * Verifies:
 *   - base64url output uses the URL-safe alphabet and has no padding.
 *   - generateCodeVerifier() is 43 chars (32 bytes → base64url), well-formed.
 *   - generateState() is 22 chars (16 bytes → base64url), well-formed.
 *   - deriveCodeChallenge() is deterministic and equals
 *     base64url(sha256(verifier)) for known vectors (RFC 7636 Appendix B).
 *   - Verifier/state have sufficient entropy across repeated calls.
 */
import { describe, it, expect } from "vitest";
import { createHash } from "crypto";
import {
  base64url,
  generateCodeVerifier,
  deriveCodeChallenge,
  generateState,
} from "@/modules/pkce";

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

describe("base64url", () => {
  it("produces url-safe alphabet with no padding", () => {
    // A buffer that would produce +, /, and = under standard base64.
    const buf = Buffer.from([
      0xfb, 0xff, 0xbf, 0x00, 0x00, 0x00,
    ]);
    const out = base64url(buf);
    expect(out).not.toMatch(/[+/=]/);
    expect(out).toMatch(BASE64URL_RE);
  });
});

describe("generateCodeVerifier", () => {
  it("returns 43-char base64url string", () => {
    const v = generateCodeVerifier();
    expect(v.length).toBe(43);
    expect(v).toMatch(BASE64URL_RE);
  });

  it("produces distinct values across calls (entropy sanity)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      seen.add(generateCodeVerifier());
    }
    expect(seen.size).toBe(100);
  });
});

describe("generateState", () => {
  it("returns 22-char base64url string (>= 128 bits)", () => {
    const s = generateState();
    expect(s.length).toBe(22);
    expect(s).toMatch(BASE64URL_RE);
  });

  it("produces distinct values across calls", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      seen.add(generateState());
    }
    expect(seen.size).toBe(100);
  });
});

describe("deriveCodeChallenge", () => {
  it("is deterministic for a fixed verifier", () => {
    const v = generateCodeVerifier();
    expect(deriveCodeChallenge(v)).toBe(deriveCodeChallenge(v));
  });

  it("equals base64url(sha256(verifier)) for any verifier", () => {
    const v = "dGhpcy1pcy1hLXZlcnlfbG9uZy1hbmQtc2VjcmVyLXZlcmlmaWVy"; // 43 chars
    const expected = base64url(createHash("sha256").update(v).digest());
    expect(deriveCodeChallenge(v)).toBe(expected);
  });

  it("matches the RFC 7636 Appendix B S256 vector", () => {
    // RFC 7636 Appendix B: verifier "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    // yields S256 challenge "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM".
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const expected = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
    expect(deriveCodeChallenge(verifier)).toBe(expected);
  });

  it("changes when the verifier changes", () => {
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();
    expect(a).not.toBe(b);
    expect(deriveCodeChallenge(a)).not.toBe(deriveCodeChallenge(b));
  });
});
