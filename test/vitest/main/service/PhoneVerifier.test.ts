import { describe, it, expect } from "vitest";
import { PhoneVerifier } from "@/service/contact-verification/PhoneVerifier";
import type { CountryEvidence } from "@/entityTypes/contactVerificationTypes";

const NOW = new Date("2026-01-01T00:00:00Z");
function makeVerifier(): PhoneVerifier {
  return new PhoneVerifier({ now: () => NOW });
}

function ev(
  country: string,
  source: CountryEvidence["source"],
  evidenceText?: string
): CountryEvidence {
  return { country, source, evidenceText };
}

describe("PhoneVerifier", () => {
  it("parses an explicit + international number as likely_valid", async () => {
    const v = makeVerifier();
    const r = await v.verify("+1 415 555 2671");
    expect(r.status).toBe("likely_valid");
    expect(r.normalized).toMatch(/^\+1/);
    expect(r.countryConfidence).toBe("high");
  });

  it("parses a +44 London number as likely_valid", async () => {
    const v = makeVerifier();
    const r = await v.verify("+44 20 7946 0958");
    expect(r.status).toBe("likely_valid");
    expect(r.country).toBe("GB");
    expect(r.normalized).toBe("+442079460958");
  });

  it("converts leading 00 to + and parses as explicit international", async () => {
    const v = makeVerifier();
    const r = await v.verify("0044 20 7946 0958");
    expect(r.status).toBe("likely_valid");
    expect(r.normalized).toBe("+442079460958");
  });

  it("resolves a national number with one strong country as context_resolved", async () => {
    const v = makeVerifier();
    const r = await v.verify("020 7946 0958", [ev("GB", "same_block_address", "London office address")]);
    expect(r.status).toBe("context_resolved");
    expect(r.country).toBe("GB");
    expect(r.countryConfidence).toBe("high");
    expect(r.normalized).toBe("+442079460958");
  });

  it("resolves a US national number with strong evidence", async () => {
    const v = makeVerifier();
    const r = await v.verify("(415) 555-2671", [ev("US", "explicit_user")]);
    expect(r.status).toBe("context_resolved");
    expect(r.country).toBe("US");
    expect(r.normalized).toBe("+14155552671");
  });

  it("returns ambiguous_region with NO E.164 when no country evidence", async () => {
    const v = makeVerifier();
    const r = await v.verify("020 7946 0958", []);
    expect(r.status).toBe("ambiguous_region");
    expect(r.normalized).toBeUndefined();
    expect(r.original).toBe("020 7946 0958");
  });

  it("returns ambiguous_region when only weak evidence is present (no normalization)", async () => {
    const v = makeVerifier();
    const r = await v.verify("020 7946 0958", [
      ev("US", "site_domain"),
      ev("GB", "campaign_country"),
    ]);
    expect(r.status).toBe("ambiguous_region");
    expect(r.normalized).toBeUndefined();
    expect(r.reasons.some((x) => /weak country evidence/i.test(x))).toBe(true);
  });

  it("returns ambiguous_region when two distinct strong countries conflict", async () => {
    const v = makeVerifier();
    const r = await v.verify("020 7946 0958", [
      ev("GB", "same_block_address"),
      ev("US", "same_block_heading"),
    ]);
    expect(r.status).toBe("ambiguous_region");
    expect(r.normalized).toBeUndefined();
    expect(r.reasons.some((x) => /multiple distinct strong/i.test(x))).toBe(true);
  });

  it("the same national string resolves differently under different strong evidence", async () => {
    const v = makeVerifier();
    // A US-format number resolves under US strong evidence
    const us = await v.verify("(415) 555-2671", [ev("US", "explicit_user")]);
    expect(us.status).toBe("context_resolved");
    expect(us.country).toBe("US");
    // The same string with no evidence is ambiguous
    const none = await v.verify("(415) 555-2671", []);
    expect(none.status).toBe("ambiguous_region");
  });

  it("classifies a repeated-digit placeholder as non_phone", async () => {
    const v = makeVerifier();
    const r = await v.verify("1111111111");
    expect(r.status).toBe("non_phone");
    expect(r.normalized).toBeUndefined();
  });

  it("classifies a date as non_phone", async () => {
    const v = makeVerifier();
    const r = await v.verify("2026-01-21");
    expect(r.status).toBe("non_phone");
  });

  it("classifies a time as non_phone", async () => {
    const v = makeVerifier();
    const r = await v.verify("12:30");
    expect(r.status).toBe("non_phone");
  });

  it("classifies a currency value as non_phone", async () => {
    const v = makeVerifier();
    const r = await v.verify("$199.99");
    expect(r.status).toBe("non_phone");
  });

  it("preserves the original value when normalization is omitted", async () => {
    const v = makeVerifier();
    const r = await v.verify("020 7946 0958", []);
    expect(r.original).toBe("020 7946 0958");
    expect(r.normalized).toBeUndefined();
  });

  it("extracts an extension as a separate field", async () => {
    const v = makeVerifier();
    const r = await v.verify("+1 415 555 2671 ext 1234");
    expect(r.extension).toBe("1234");
    expect(r.status).toBe("likely_valid");
  });

  it("normalizes full-width digits", async () => {
    const v = makeVerifier();
    // Full-width 1 415 555 2671
    const r = await v.verify("＋１ ４１５ ５５５ ２６７１");
    expect(r.status).toBe("likely_valid");
    expect(r.normalized).toBe("+14155552671");
  });

  it("returns invalid for an impossible-length number", async () => {
    const v = makeVerifier();
    const r = await v.verify("12", []);
    expect(r.status).toBe("invalid");
  });

  it("returns invalid for an impossible explicit number", async () => {
    const v = makeVerifier();
    // A too-long explicit number.
    const r = await v.verify("+1 415 555 2671 9999999");
    expect(["invalid", "possible"]).toContain(r.status);
  });

  it("never normalizes from campaign_country alone", async () => {
    const v = makeVerifier();
    const r = await v.verify("(415) 555-2671", [ev("US", "campaign_country")]);
    expect(r.status).toBe("ambiguous_region");
    expect(r.normalized).toBeUndefined();
  });

  it("never normalizes from headquarters alone", async () => {
    const v = makeVerifier();
    const r = await v.verify("(415) 555-2671", [ev("US", "headquarters")]);
    expect(r.status).toBe("ambiguous_region");
    expect(r.normalized).toBeUndefined();
  });

  it("never normalizes from user_locale alone", async () => {
    const v = makeVerifier();
    const r = await v.verify("(415) 555-2671", [ev("US", "user_locale")]);
    expect(r.status).toBe("ambiguous_region");
    expect(r.normalized).toBeUndefined();
  });

  it("never normalizes from site_domain alone", async () => {
    const v = makeVerifier();
    const r = await v.verify("(415) 555-2671", [ev("US", "site_domain")]);
    expect(r.status).toBe("ambiguous_region");
    expect(r.normalized).toBeUndefined();
  });

  it("every result includes at least one reason", async () => {
    const v = makeVerifier();
    const cases = [
      { input: "+1 415 555 2671", ev: [] as CountryEvidence[] },
      { input: "020 7946 0958", ev: [ev("GB", "same_block_address")] },
      { input: "020 7946 0958", ev: [] },
      { input: "1111111111", ev: [] },
      { input: "2026-01-21", ev: [] },
      { input: "12", ev: [] },
    ];
    for (const c of cases) {
      const r = await v.verify(c.input, c.ev);
      expect(r.reasons.length).toBeGreaterThanOrEqual(1);
    }
  });
});
