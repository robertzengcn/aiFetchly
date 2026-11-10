import { describe, it, expect } from "vitest";
import { sanitizeForLog } from "@/service/SkillExecutor";

describe("SkillExecutor contact-key redaction", () => {
  it("redacts an emails array to a count, not values", () => {
    const out = sanitizeForLog({
      contacts: [{ emails: ["alice@example.com", "bob@example.com"] }],
    });
    const contacts = (out.contacts as unknown as string).toString
      ? (out.contacts as unknown as string)
      : JSON.stringify(out.contacts);
    void contacts;
    // The contacts group should be redacted to a count marker.
    expect(JSON.stringify(out)).not.toContain("alice@example.com");
    expect(JSON.stringify(out)).not.toContain("bob@example.com");
    expect(JSON.stringify(out)).toContain("REDACTED");
  });

  it("redacts a top-level emails array to a count", () => {
    const out = sanitizeForLog({ emails: ["a@b.com", "c@d.com", "e@f.com"] });
    expect(out.emails).toBe("[REDACTED_CONTACTS count=3]");
    expect(JSON.stringify(out)).not.toContain("a@b.com");
  });

  it("redacts a top-level phones array to a count", () => {
    const out = sanitizeForLog({ phones: ["+15551234567"] });
    expect(out.phones).toBe("[REDACTED_CONTACTS count=1]");
    expect(JSON.stringify(out)).not.toContain("15551234567");
  });

  it("redacts nearby_text, address, country_evidence, evidence_text", () => {
    const out = sanitizeForLog({
      nearby_text: "London Office, call us",
      address: "10 Example Street, London",
      country_evidence: [{ country: "GB", source: "same_block_address" }],
      evidence_text: "London office address",
    });
    expect(JSON.stringify(out)).not.toContain("London Office");
    expect(JSON.stringify(out)).not.toContain("Example Street");
    expect(out.nearby_text).toBe("[REDACTED_CONTACT]");
    expect(out.address).toBe("[REDACTED_CONTACT]");
  });

  it("redacts a nested verify_contact_info args payload completely", () => {
    const out = sanitizeForLog({
      contacts: [
        {
          source_url: "https://example.com",
          emails: ["sales@example.com"],
          phones: ["020 7946 0958"],
          context: {
            nearby_text: "London",
            address: "10 Example Street",
            country_evidence: [
              { country: "GB", source: "same_block_address", evidence_text: "addr" },
            ],
          },
        },
      ],
    });
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain("sales@example.com");
    expect(serialized).not.toContain("020 7946 0958");
    expect(serialized).not.toContain("London");
    expect(serialized).not.toContain("Example Street");
    expect(serialized).toContain("REDACTED");
  });

  it("still redacts sensitive keys (password) and truncates long strings", () => {
    const long = "x".repeat(200);
    const out = sanitizeForLog({ password: "secret", note: long });
    expect(out.password).toBe("[REDACTED]");
    expect(typeof out.note).toBe("string");
    expect((out.note as string).includes("[truncated")).toBe(true);
  });
});
