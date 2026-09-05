import { describe, it, expect } from "vitest";
import {
  contactVerificationInputSchema,
  countryEvidenceSourceSchema,
  CONTACT_VERIFICATION_TOOL_PARAMETERS,
  CONTACT_VERIFICATION_TOOL_DESCRIPTION,
  EXTRACT_CONTACT_INFO_VERIFICATION_POSTCONDITION,
  EXTRACT_CONTACT_VERIFY_NEXT_STEP,
} from "@/schemas/contactVerification";

describe("contactVerificationInputSchema", () => {
  function parse(raw: unknown) {
    return contactVerificationInputSchema().safeParse(raw);
  }

  it("accepts a minimal email-only group", () => {
    const r = parse({
      contacts: [{ emails: ["sales@example.com"] }],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      // defaults applied: empty phones when omitted; context omitted entirely.
      expect(r.data.contacts[0].emails).toEqual(["sales@example.com"]);
      expect(r.data.contacts[0].phones).toEqual([]);
      expect(r.data.contacts[0].context).toBeUndefined();
    }
  });

  it("accepts a phone-only group", () => {
    const r = parse({ contacts: [{ phones: ["020 7946 0958"] }] });
    expect(r.success).toBe(true);
  });

  it("accepts a mixed request with full context and uppercases country codes", () => {
    const r = parse({
      contacts: [
        {
          source_url: "https://example.com/contact",
          emails: ["Sales@Example.com"],
          phones: ["020 7946 0958"],
          context: {
            nearby_text: "London Office",
            address: "10 Example Street, London, United Kingdom",
            country_evidence: [{ country: "gb", source: "same_block_address" }],
          },
        },
      ],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.contacts[0].context?.country_evidence[0].country).toBe(
        "GB"
      );
    }
  });

  it("rejects an empty contacts array", () => {
    expect(parse({ contacts: [] }).success).toBe(false);
  });

  it("rejects a group with neither emails nor phones", () => {
    const r = parse({ contacts: [{ emails: [], phones: [] }] });
    expect(r.success).toBe(false);
  });

  it("rejects more than 25 contact groups", () => {
    const groups = Array.from({ length: 26 }, () => ({ emails: ["a@b.com"] }));
    expect(parse({ contacts: groups }).success).toBe(false);
  });

  it("rejects more than 100 total values combined", () => {
    // 2 groups of 51 emails each = 102 > 100
    const emails = Array.from({ length: 51 }, (_, i) => `a${i}@b.com`);
    expect(parse({ contacts: [{ emails }, { emails }] }).success).toBe(false);
  });

  it("rejects an invalid source_url", () => {
    const r = parse({
      contacts: [{ source_url: "not-a-url", emails: ["a@b.com"] }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown country evidence source", () => {
    const r = parse({
      contacts: [
        {
          emails: ["a@b.com"],
          context: {
            country_evidence: [{ country: "US", source: "invented_source" }],
          },
        },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("rejects a non-2-char country code", () => {
    const r = parse({
      contacts: [
        {
          emails: ["a@b.com"],
          context: {
            country_evidence: [{ country: "USA", source: "explicit_user" }],
          },
        },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("rejects additional unknown top-level keys (strictObject)", () => {
    const r = parse({
      contacts: [{ emails: ["a@b.com"] }],
      unexpected: true,
    });
    expect(r.success).toBe(false);
  });
});

describe("countryEvidenceSourceSchema", () => {
  it("accepts every declared source", () => {
    const sources = [
      "explicit_user",
      "structured_contact",
      "same_block_address",
      "same_block_heading",
      "same_block_text",
      "page_level",
      "site_domain",
      "headquarters",
      "campaign_country",
      "user_locale",
      "unknown",
    ];
    for (const s of sources) {
      expect(countryEvidenceSourceSchema.safeParse(s).success).toBe(true);
    }
  });

  it("rejects an unknown source", () => {
    expect(countryEvidenceSourceSchema.safeParse("invented").success).toBe(
      false
    );
  });
});

describe("shared tool constants", () => {
  it("exposes a JSON-schema parameters object with required contacts", () => {
    expect(CONTACT_VERIFICATION_TOOL_PARAMETERS).toMatchObject({
      type: "object",
    });
    const required = (
      CONTACT_VERIFICATION_TOOL_PARAMETERS as Record<string, unknown>
    ).required;
    expect(required).toEqual(["contacts"]);
  });

  it("exposes a non-empty description that forbids deliverability claims", () => {
    expect(CONTACT_VERIFICATION_TOOL_DESCRIPTION.length).toBeGreaterThan(200);
    expect(CONTACT_VERIFICATION_TOOL_DESCRIPTION).toContain(
      "does not confirm mailbox existence"
    );
    expect(CONTACT_VERIFICATION_TOOL_DESCRIPTION.toLowerCase()).toContain(
      "ambiguous"
    );
    expect(CONTACT_VERIFICATION_TOOL_DESCRIPTION).toContain("Standard preview");
  });

  it("requires extract_contact_info to call verify_contact_info before presenting", () => {
    expect(EXTRACT_CONTACT_INFO_VERIFICATION_POSTCONDITION).toContain(
      "MUST call verify_contact_info"
    );
    expect(EXTRACT_CONTACT_INFO_VERIFICATION_POSTCONDITION).not.toContain(
      "Do not call verify_contact_info again"
    );
    expect(EXTRACT_CONTACT_VERIFY_NEXT_STEP).toContain("REQUIRED NEXT STEP");
    expect(EXTRACT_CONTACT_VERIFY_NEXT_STEP).toContain("verify_contact_info");
  });
});
