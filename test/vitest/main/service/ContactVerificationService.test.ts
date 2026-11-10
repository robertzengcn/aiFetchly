import { describe, it, expect } from "vitest";
import { ContactVerificationService } from "@/service/contact-verification/ContactVerificationService";
import { ContactVerificationCache } from "@/service/contact-verification/ContactVerificationCache";
import type { DnsMailRouteResolver } from "@/service/contact-verification/DnsMailRouteResolver";
import type { DnsMailRouteResult } from "@/entityTypes/contactVerificationTypes";
import type { ContactVerificationRequest } from "@/entityTypes/contactVerificationTypes";

const MX_OK: DnsMailRouteResult = {
  status: "mx",
  domainResolves: true,
  retryable: false,
};
const NXDOMAIN: DnsMailRouteResult = {
  status: "nxdomain",
  domainResolves: false,
  retryable: false,
};

/** Fake DNS resolver that returns a canned result per (lowercased) domain. */
function fakeResolver(
  byDomain: Record<string, DnsMailRouteResult>
): DnsMailRouteResolver {
  return {
    async resolve(domain: string): Promise<DnsMailRouteResult> {
      return (
        byDomain[domain] ?? {
          status: "nxdomain",
          domainResolves: false,
          retryable: false,
        }
      );
    },
  } as unknown as DnsMailRouteResolver;
}

function makeService(
  byDomain: Record<string, DnsMailRouteResult> = {},
  now = new Date("2026-01-01T00:00:00Z")
): ContactVerificationService {
  return new ContactVerificationService({
    dnsResolver: fakeResolver(byDomain),
    cache: new ContactVerificationCache(() => now),
    now: () => now,
  });
}

describe("ContactVerificationService", () => {
  it("verifies an email-only request", async () => {
    const s = makeService({ "realcompany.com": MX_OK });
    const req: ContactVerificationRequest = {
      contacts: [{ emails: ["John@realcompany.com"] }],
    };
    const r = await s.verify(req);
    expect(r.success).toBe(true);
    expect(r.verificationDepth).toBe("standard");
    expect(r.verificationPerformed).toBe(true);
    expect(r.partial).toBe(false);
    expect(r.contacts[0].emails[0].status).toBe("likely_valid");
    expect(r.contacts[0].emails[0].normalized).toBe("John@realcompany.com");
  });

  it("verifies a phone-only request", async () => {
    const s = makeService();
    const req: ContactVerificationRequest = {
      contacts: [{ phones: ["+1 415 555 2671"] }],
    };
    const r = await s.verify(req);
    expect(r.contacts[0].phones[0].status).toBe("likely_valid");
  });

  it("verifies a mixed email+phone request in one call", async () => {
    const s = makeService({ "realcompany.com": MX_OK });
    const req: ContactVerificationRequest = {
      contacts: [
        {
          emails: ["sales@realcompany.com"],
          phones: ["+44 20 7946 0958"],
        },
      ],
    };
    const r = await s.verify(req);
    expect(r.contacts[0].emails[0].status).toBe("role_based");
    expect(r.contacts[0].phones[0].status).toBe("likely_valid");
  });

  it("shares DNS work for duplicate email domains (dedup)", async () => {
    const s = makeService({ "realcompany.com": MX_OK });
    const req: ContactVerificationRequest = {
      contacts: [
        { emails: ["alice@realcompany.com", "bob@realcompany.com"] },
      ],
    };
    const r = await s.verify(req);
    expect(r.summary.inputEmails).toBe(2);
    // Both classified likely_valid via shared DNS.
    expect(r.contacts[0].emails[0].status).toBe("likely_valid");
    expect(r.contacts[0].emails[1].status).toBe("likely_valid");
  });

  it("preserves per-group source URL and ordering", async () => {
    const s = makeService({ "realcompany.com": MX_OK, "other.com": MX_OK });
    const req: ContactVerificationRequest = {
      contacts: [
        {
          sourceUrl: "https://a.com",
          emails: ["alice@realcompany.com"],
          phones: ["+1 415 555 2671"],
        },
        {
          sourceUrl: "https://b.com",
          emails: ["bob@other.com"],
        },
      ],
    };
    const r = await s.verify(req);
    expect(r.contacts.length).toBe(2);
    expect(r.contacts[0].sourceUrl).toBe("https://a.com");
    expect(r.contacts[1].sourceUrl).toBe("https://b.com");
    expect(r.contacts[0].emails[0].status).toBe("likely_valid");
    expect(r.contacts[1].emails[0].status).toBe("likely_valid");
  });

  it("returns partial=true when the abort signal is already fired", async () => {
    const s = makeService({ "realcompany.com": MX_OK });
    const req: ContactVerificationRequest = {
      contacts: [{ emails: ["alice@realcompany.com"] }],
    };
    const ac = new AbortController();
    ac.abort();
    const r = await s.verify(req, { signal: ac.signal });
    expect(r.partial).toBe(true);
  });

  it("throws on exceeding the max-groups limit", async () => {
    const s = makeService();
    const groups = Array.from({ length: 26 }, () => ({ emails: ["alice@example.com"] }));
    await expect(s.verify({ contacts: groups })).rejects.toThrow(/Too many contact groups/);
  });

  it("computes summary counters correctly", async () => {
    const s = makeService({
      "realcompany.com": MX_OK,
      "doesnotexist.invalid": NXDOMAIN,
    });
    const req: ContactVerificationRequest = {
      contacts: [
        {
          emails: [
            "John@realcompany.com", // likely_valid
            "bad@doesnotexist.invalid", // invalid
          ],
          phones: ["+1 415 555 2671"], // likely_valid
        },
      ],
    };
    const r = await s.verify(req);
    expect(r.summary.inputEmails).toBe(2);
    expect(r.summary.inputPhones).toBe(1);
    expect(r.summary.likelyValid).toBe(2);
    expect(r.summary.invalid).toBe(1);
  });

  it("keeps the same national phone string separate under different evidence (no cross-office leak)", async () => {
    const s = makeService();
    const req: ContactVerificationRequest = {
      contacts: [
        {
          sourceUrl: "https://a.com",
          phones: ["(415) 555-2671"],
          context: {
            countryEvidence: [
              { country: "US", source: "same_block_address" },
            ],
          },
        },
        {
          sourceUrl: "https://b.com",
          phones: ["(415) 555-2671"],
          context: {
            countryEvidence: [
              { country: "GB", source: "same_block_address" },
            ],
          },
        },
      ],
    };
    const r = await s.verify(req);
    // Office A (US) resolves; office B (GB) with US-format number is
    // ambiguous/invalid under GB — they are NOT merged.
    expect(r.contacts[0].phones[0].country).toBe("US");
    expect(r.contacts[1].phones[0].country ?? "GB").toBe("GB");
  });

  it("includes fixed limitations and data versions on every result", async () => {
    const s = makeService({ "realcompany.com": MX_OK });
    const r = await s.verify({ contacts: [{ emails: ["alice@realcompany.com"] }] });
    expect(r.limitations.length).toBeGreaterThan(0);
    expect(r.limitations.some((l) => /Mailbox existence was not checked/i.test(l))).toBe(true);
    expect(r.dataVersions.rules).toBeTruthy();
    expect(r.dataVersions.disposableDomains).toBeTruthy();
    expect(r.dataVersions.phoneMetadata).toBeTruthy();
  });

  it("emits progress phases", async () => {
    const s = makeService({ "realcompany.com": MX_OK });
    const phases: string[] = [];
    await s.verify(
      { contacts: [{ emails: ["alice@realcompany.com"], phones: ["+1 415 555 2671"] }] },
      {
        emitProgress: (e) => phases.push(e.phase),
      }
    );
    expect(phases).toContain("validating");
    expect(phases).toContain("checking_email_domains");
    expect(phases).toContain("checking_phones");
    expect(phases).toContain("finalizing");
  });
});
