import { describe, it, expect } from "vitest";
import { ContactEvidenceExtractor } from "@/childprocess/contact-extraction/ContactEvidenceExtractor";
import type { Page } from "puppeteer";

/** Build a fake page whose evaluate() returns canned block data. */
function fakePage(blocks: unknown): Page {
  const evaluate = async <T,>(fn: () => T | Promise<T>): Promise<T> => {
    void fn;
    return blocks as unknown as T;
  };
  return { evaluate } as unknown as Page;
}

describe("ContactEvidenceExtractor", () => {
  it("returns empty evidence (ambiguous) when no block matches the value", async () => {
    const ext = new ContactEvidenceExtractor({
      evaluate: (async <T,>(fn: () => T | Promise<T>) => {
        void fn;
        return [] as unknown as T;
      }) as never,
    });
    const ev = await ext.capture(fakePage([]), ["a@b.com"], ["+1 415 555 2671"]);
    expect(ev.length).toBe(2);
    expect(ev[0].countryEvidence).toEqual([]);
    expect(ev[1].countryEvidence).toEqual([]);
  });

  it("captures nearby text + structured country evidence for a matching email", async () => {
    const blocks = [
      {
        text: "London Office. Contact us at sales@example.com. 10 Example Street, London.",
        countryName: "United Kingdom",
        countryIso: undefined,
        hasContactPageHeading: true,
      },
    ];
    const ext = new ContactEvidenceExtractor({
      evaluate: (async <T,>(fn: () => T | Promise<T>) => {
        void fn;
        return blocks as unknown as T;
      }) as never,
    });
    const ev = await ext.capture(
      fakePage(blocks),
      ["sales@example.com"],
      []
    );
    expect(ev[0].nearbyText).toContain("London Office");
    expect(ev[0].countryEvidence.length).toBe(1);
    expect(ev[0].countryEvidence[0].country).toBe("GB");
    expect(ev[0].countryEvidence[0].source).toBe("structured_contact");
  });

  it("falls back to same-block-text country inference when no structured data", async () => {
    const blocks = [
      {
        text: "Paris office: call +33 1 23 45 67 89. France.",
      },
    ];
    const ext = new ContactEvidenceExtractor({
      evaluate: (async <T,>(fn: () => T | Promise<T>) => {
        void fn;
        return blocks as unknown as T;
      }) as never,
    });
    const ev = await ext.capture(fakePage(blocks), [], ["+33 1 23 45 67 89"]);
    expect(ev[0].countryEvidence.length).toBe(1);
    expect(ev[0].countryEvidence[0].country).toBe("FR");
    expect(ev[0].countryEvidence[0].source).toBe("same_block_text");
  });

  it("isolates evidence: office A's country never appears on office B's number", async () => {
    // Two offices in different countries on one page.
    const blocks = [
      {
        text: "London Office: +44 20 7946 0958. United Kingdom.",
      },
      {
        text: "New York Office: +1 212 555 1234. United States.",
      },
    ];
    const ext = new ContactEvidenceExtractor({
      evaluate: (async <T,>(fn: () => T | Promise<T>) => {
        void fn;
        return blocks as unknown as T;
      }) as never,
    });
    const ev = await ext.capture(
      fakePage(blocks),
      [],
      ["+44 20 7946 0958", "+1 212 555 1234"]
    );
    expect(ev[0].countryEvidence[0]?.country).toBe("GB");
    expect(ev[1].countryEvidence[0]?.country).toBe("US");
    // No leak: office A's evidence is not on office B's number.
    expect(ev[1].countryEvidence.find((c) => c.country === "GB")).toBeUndefined();
    expect(ev[0].countryEvidence.find((c) => c.country === "US")).toBeUndefined();
  });

  it("caps nearby text at 1500 characters", async () => {
    const long = "x".repeat(5000) + " sales@example.com " + "y".repeat(5000);
    const blocks = [{ text: long }];
    const ext = new ContactEvidenceExtractor({
      evaluate: (async <T,>(fn: () => T | Promise<T>) => {
        void fn;
        return blocks as unknown as T;
      }) as never,
    });
    const ev = await ext.capture(fakePage(blocks), ["sales@example.com"], []);
    expect((ev[0].nearbyText ?? "").length).toBeLessThanOrEqual(1500);
  });

  it("detects page-derived labels (fax, mobile, whatsapp)", async () => {
    const blocks = [
      {
        text: "Fax: +1 212 555 0000. Mobile/WhatsApp: +1 212 555 1234.",
      },
    ];
    const ext = new ContactEvidenceExtractor({
      evaluate: (async <T,>(fn: () => T | Promise<T>) => {
        void fn;
        return blocks as unknown as T;
      }) as never,
    });
    const ev = await ext.capture(
      fakePage(blocks),
      [],
      ["+1 212 555 0000", "+1 212 555 1234"]
    );
    expect(ev[0].labels).toContain("fax");
    expect(ev[1].labels).toContain("mobile");
    expect(ev[1].labels).toContain("whatsapp");
  });
});
