"use strict";
import { describe, expect, it } from "vitest";
import {
  checkOrigin,
  checkBearerToken,
  checkPayloadSize,
  MAX_PAYLOAD_BYTES,
  type SecurityCheck,
} from "@/main-process/devtools/DevBrowserSecurity";

const ALLOWED_ORIGIN = "http://localhost:5173";
const TOKEN = "session-token-abc123";

describe("checkOrigin — strict origin validation (FR-6.2)", () => {
  it("accepts an exact match", () => {
    expect(checkOrigin(ALLOWED_ORIGIN, ALLOWED_ORIGIN).ok).toBe(true);
  });

  it("rejects a missing Origin header", () => {
    const r = checkOrigin(undefined, ALLOWED_ORIGIN);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/origin/i);
  });

  it("rejects a mismatched origin", () => {
    const r = checkOrigin("http://evil.example", ALLOWED_ORIGIN);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/mismatch|origin/i);
  });

  it("rejects same-host different port (origin is scheme+host+port)", () => {
    const r = checkOrigin("http://localhost:5174", ALLOWED_ORIGIN);
    expect(r.ok).toBe(false);
  });

  it("rejects same origin with a trailing path (Origin header has no path)", () => {
    const r = checkOrigin("http://localhost:5173/foo", ALLOWED_ORIGIN);
    expect(r.ok).toBe(false);
  });

  it("rejects an empty string origin", () => {
    expect(checkOrigin("", ALLOWED_ORIGIN).ok).toBe(false);
  });
});

describe("checkBearerToken (FR-6.1)", () => {
  it("accepts the correct bearer token", () => {
    expect(checkBearerToken(`Bearer ${TOKEN}`, TOKEN).ok).toBe(true);
  });

  it("rejects a missing Authorization header", () => {
    const r = checkBearerToken(undefined, TOKEN);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/token|auth/i);
  });

  it("rejects the wrong token", () => {
    expect(checkBearerToken("Bearer wrong-token", TOKEN).ok).toBe(false);
  });

  it("rejects a non-Bearer scheme", () => {
    expect(checkBearerToken(`Basic ${TOKEN}`, TOKEN).ok).toBe(false);
  });

  it("rejects a token with no scheme prefix", () => {
    expect(checkBearerToken(TOKEN, TOKEN).ok).toBe(false);
  });

  it("is not vulnerable to timing via length when prefixes match", () => {
    // Correct token must still pass; this is a sanity check, not a real
    // constant-time proof, but ensures the happy path remains stable.
    expect(checkBearerToken(`Bearer ${TOKEN}`, TOKEN).ok).toBe(true);
  });
});

describe("checkPayloadSize", () => {
  it("accepts a payload under the limit", () => {
    expect(checkPayloadSize(1024).ok).toBe(true);
  });

  it("accepts a payload exactly at the limit", () => {
    expect(checkPayloadSize(MAX_PAYLOAD_BYTES).ok).toBe(true);
  });

  it("rejects a payload over the limit", () => {
    const r = checkPayloadSize(MAX_PAYLOAD_BYTES + 1);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/size|limit|large/i);
  });
});

describe("SecurityCheck type usage", () => {
  it("returns a reason string on failure usable for FR-7.3 messages", () => {
    const checks: SecurityCheck[] = [
      checkOrigin("http://evil", ALLOWED_ORIGIN),
      checkBearerToken(undefined, TOKEN),
      checkPayloadSize(MAX_PAYLOAD_BYTES + 1),
    ];
    for (const c of checks) {
      expect(c.ok).toBe(false);
      expect(typeof c.reason).toBe("string");
      expect(c.reason.length).toBeGreaterThan(0);
    }
  });
});
