import { describe, it, expect } from "vitest";
import {
  normalizeNetscapeCookie,
  normalizeChromiumCookie,
  normalizeCookieBatch,
  normalizedToCookiesType,
  emptyRejectCounts,
} from "@/modules/accountSession/cookieNormalize";
import type { CookiesType } from "@/entityTypes/cookiesType";

const baseNetscape = (over: Partial<CookiesType> = {}): CookiesType => ({
  domain: ".youtube.com",
  flag: true,
  path: "/",
  secure: true,
  expirationDate: 4_000_000_000,
  name: "SID",
  value: "v",
  ...over,
});

const baseChromium = (
  over: Record<string, unknown> = {}
): Record<string, unknown> => ({
  domain: ".youtube.com",
  path: "/",
  secure: true,
  httpOnly: true,
  hostOnly: false,
  expirationDate: 4_000_000_000,
  sameSite: "lax",
  name: "SID",
  value: "v",
  ...over,
});

describe("normalizeNetscapeCookie", () => {
  it("normalizes domain (lowercase, strip one leading dot) and defaults path", () => {
    const c = normalizeNetscapeCookie(
      baseNetscape({ domain: ".YouTUBE.com", path: undefined })
    );
    expect(c.domain).toBe("youtube.com");
    expect(c.path).toBe("/");
    expect(c.sameSite).toBe("lax");
    expect(c.hostOnly).toBe(false);
  });

  it("maps flag FALSE to hostOnly=true", () => {
    const c = normalizeNetscapeCookie(
      baseNetscape({ flag: false, domain: "youtube.com" })
    );
    expect(c.hostOnly).toBe(true);
  });

  it("rejects empty name (malformed) and oversize value (oversize)", () => {
    expect(() => normalizeNetscapeCookie(baseNetscape({ name: "" }))).toThrow();
    expect(() =>
      normalizeNetscapeCookie(baseNetscape({ value: "x".repeat(16385) }))
    ).toThrow();
  });

  it("rejects empty domain (malformed)", () => {
    expect(() =>
      normalizeNetscapeCookie(baseNetscape({ domain: "" }))
    ).toThrow();
  });

  it("rejects SameSite=None when not secure", () => {
    expect(() =>
      normalizeNetscapeCookie(baseNetscape({ sameSite: "None", secure: false }))
    ).toThrow();
  });

  it("keeps SameSite=None when secure", () => {
    const c = normalizeNetscapeCookie(
      baseNetscape({ sameSite: "None", secure: true })
    );
    expect(c.sameSite).toBe("no_restriction");
  });

  it("treats non-positive expirationDate as a session cookie (omitted)", () => {
    const c = normalizeNetscapeCookie(baseNetscape({ expirationDate: 0 }));
    expect(c.expirationDate).toBeUndefined();
  });
});

describe("normalizeChromiumCookie", () => {
  it("adapts Electron/chrome.cookies shape", () => {
    const c = normalizeChromiumCookie(baseChromium({ sameSite: "strict" }));
    expect(c.domain).toBe("youtube.com");
    expect(c.sameSite).toBe("strict");
    expect(c.httpOnly).toBe(true);
  });

  it("rejects SameSite=no_restriction when not secure", () => {
    expect(() =>
      normalizeChromiumCookie(
        baseChromium({ sameSite: "no_restriction", secure: false })
      )
    ).toThrow();
  });

  it("rejects non-object input as malformed", () => {
    expect(() => normalizeChromiumCookie(null)).toThrow();
    expect(() => normalizeChromiumCookie("nope")).toThrow();
  });
});

describe("normalizeCookieBatch", () => {
  const now = 1_700_000_000;

  it("domain-filter rejects cookies outside the allowlist", () => {
    const res = normalizeCookieBatch(
      [
        baseNetscape({ domain: ".youtube.com", name: "a" }),
        baseNetscape({ domain: ".evil.com", name: "b" }),
      ],
      "netscape",
      { now, matchesDomain: (d) => d.endsWith("youtube.com") }
    );
    expect(res.accepted).toHaveLength(1);
    expect(res.accepted[0]?.name).toBe("a");
    expect(res.rejected.outside_allowed_domains).toBe(1);
  });

  it("expiry-filter drops past-due cookies", () => {
    const res = normalizeCookieBatch(
      [
        baseNetscape({ name: "fresh", expirationDate: now + 1000 }),
        baseNetscape({ name: "old", expirationDate: now - 1000 }),
      ],
      "netscape",
      { now }
    );
    expect(res.accepted).toHaveLength(1);
    expect(res.accepted[0]?.name).toBe("fresh");
    expect(res.rejected.expired).toBe(1);
  });

  it("dedupes by domain+path+name, newest expiry wins", () => {
    const res = normalizeCookieBatch(
      [
        baseNetscape({ name: "SID", value: "old", expirationDate: now + 100 }),
        baseNetscape({ name: "SID", value: "new", expirationDate: now + 9999 }),
      ],
      "netscape",
      { now }
    );
    expect(res.accepted).toHaveLength(1);
    expect(res.accepted[0]?.value).toBe("new");
    expect(res.rejected.duplicate).toBe(1);
  });

  it("session cookie (no expiry) wins over a finite-expiry duplicate", () => {
    const res = normalizeCookieBatch(
      [
        baseNetscape({ name: "SID", value: "session", expirationDate: 0 }),
        baseNetscape({
          name: "SID",
          value: "finite",
          expirationDate: now + 100,
        }),
      ],
      "netscape",
      { now }
    );
    expect(res.accepted).toHaveLength(1);
    expect(res.accepted[0]?.value).toBe("session");
  });

  it("returns a full zero-initialized reject tally when nothing is rejected", () => {
    const res = normalizeCookieBatch(
      [baseNetscape({ name: "ok" })],
      "netscape",
      { now }
    );
    expect(res.rejected).toEqual(emptyRejectCounts());
  });

  it("tallies multiple distinct reject reasons together", () => {
    const res = normalizeCookieBatch(
      [
        baseNetscape({ domain: ".evil.com", name: "outside" }), // outside (if filtered)
        baseNetscape({ name: "", domain: ".youtube.com" }), // malformed
        baseNetscape({
          sameSite: "None",
          secure: false,
          name: "badss",
          domain: ".youtube.com",
        }), // invalid_samesite
      ],
      "netscape",
      { now, matchesDomain: (d) => d.endsWith("youtube.com") }
    );
    expect(res.accepted).toHaveLength(0);
    expect(res.rejected.outside_allowed_domains).toBe(1);
    expect(res.rejected.malformed).toBe(1);
    expect(res.rejected.invalid_samesite).toBe(1);
  });
});

describe("normalizedToCookiesType", () => {
  const now = 1_700_000_000;
  it("converts a normalized snapshot back to the CookiesType shape workers expect", () => {
    const accepted = normalizeCookieBatch(
      [baseNetscape({ domain: ".youtube.com", name: "SID", flag: true })],
      "netscape",
      { now }
    ).accepted;
    const legacy: CookiesType[] = normalizedToCookiesType(accepted);
    expect(legacy).toHaveLength(1);
    const c = legacy[0];
    expect(c.domain).toBe("youtube.com");
    // flag is the inverse of hostOnly: domain cookie (flag=true) since hostOnly=false
    expect(c.flag).toBe(true);
    expect(c.hostOnly).toBe(false);
    expect(c.path).toBe("/");
  });

  it("maps session cookies (no expirationDate) to expirationDate 0", () => {
    const accepted = normalizeCookieBatch(
      [baseNetscape({ name: "sess", expirationDate: 0 })],
      "netscape",
      { now }
    ).accepted;
    const legacy = normalizedToCookiesType(accepted);
    expect(legacy[0]?.expirationDate).toBe(0);
  });
});
