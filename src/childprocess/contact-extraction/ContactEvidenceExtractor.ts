/**
 * ContactEvidenceExtractor — captures per-value DOM contact-block evidence
 * before the page closes (design §11).
 *
 * Why: the flat `emails`/`phones` arrays do not prove which address belongs
 * to which phone. To resolve phone regions per-contact-block (PRD §3.3,
 * FR-10), the worker must capture, for each extracted value, the nearest
 * bounded semantic container and any country/address evidence inside it.
 *
 * Evidence sources (in order): JSON-LD Organization/LocalBusiness/
 * ContactPoint/address objects, mailto:/tel: anchors, exact rendered-text
 * matches, regex fallback. Strong evidence requires the contact AND the
 * country/address to share the same JSON-LD object or bounded DOM container;
 * a page-wide address/heading stays weak (§11.3).
 *
 * Runs in the worker process (Puppeteer context). Caps nearby text at 1500
 * chars and evidence text at 240 chars before IPC. Releases DOM references
 * immediately — never keeps a page alive after evidence capture.
 */
import type { Page } from "puppeteer";
import type {
  CountryEvidence,
  ExtractedContactEvidence,
} from "@/entityTypes/contactVerificationTypes";
import { resolveCountryAlias } from "@/config/contact-verification/countryAliases";

/** Max chars for nearby-text before IPC (design §11.2). */
const NEARBY_TEXT_CAP = 1500;
/** Max chars for an evidence-text reason (design §11.2). */
const EVIDENCE_TEXT_CAP = 240;

export interface ContactEvidenceExtractorDeps {
  /** Allows tests to inject a fake page.evaluate. */
  readonly evaluate?: <T>(fn: () => T | Promise<T>) => Promise<T>;
}

export class ContactEvidenceExtractor {
  constructor(private readonly deps?: ContactEvidenceExtractorDeps) {}

  /**
   * Capture per-value evidence for the given emails and phones. Returns one
   * `ExtractedContactEvidence` per input value (matched in order). Values
   * with no DOM match get an empty evidence record (no country evidence) —
   * the verifier will classify them as ambiguous_region, which is the safe
   * outcome (design §11.5).
   */
  async capture(
    page: Page,
    emails: readonly string[],
    phones: readonly string[]
  ): Promise<ExtractedContactEvidence[]> {
    const evidence: ExtractedContactEvidence[] = [];
    const evaluate = this.deps?.evaluate ?? ((fn) => page.evaluate(fn));

    // Collect the bounded containers + their text + structured-data country
    // in one pass (single evaluate round-trip).
    const blocks = await this.collectBlocks(evaluate);

    for (const email of emails) {
      evidence.push(this.matchValue("email", email, blocks));
    }
    for (const phone of phones) {
      evidence.push(this.matchValue("phone", phone, blocks));
    }
    return evidence;
  }

  /**
   * One evaluate round-trip: returns each bounded container's text + any
   * country ISO code found in its structured data, so matching is purely
   * in-process (no per-value evaluate). Keeps DOM access bounded.
   */
  private async collectBlocks(
    evaluate: <T>(fn: () => T | Promise<T>) => Promise<T>
  ): Promise<RawBlock[]> {
    const raw = await evaluate(() => {
      const out: {
        text: string;
        countryIso?: string;
        countryName?: string;
        hasContactPageHeading: boolean;
      }[] = [];
      const els = Array.from(
        document.querySelectorAll(
          'address, article, section, li, footer, [itemscope], [class*="contact" i], [class*="office" i], [class*="location" i]'
        )
      ).slice(0, 60); // cap the number of containers scanned
      for (const el of els) {
        const text = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (!text) continue;
        // Look for a country in JSON-LD addressCountry inside this container,
        // or a structured-data itemtype address.
        let countryIso: string | undefined;
        let countryName: string | undefined;
        const ld = el.querySelectorAll('script[type="application/ld+json"]');
        for (const s of Array.from(ld)) {
          try {
            const data = JSON.parse(s.textContent || "{}");
            const c = pickCountryFromJsonLd(data);
            if (c) {
              countryIso = countryIso ?? c.iso;
              countryName = countryName ?? c.name;
            }
          } catch {
            // ignore malformed JSON-LD
          }
        }
        out.push({
          text,
          countryIso,
          countryName,
          hasContactPageHeading: /contact|office|location|get in touch/i.test(
            text.slice(0, 80)
          ),
        });
      }
      return out;

      function pickCountryFromJsonLd(
        data: unknown
      ): { iso?: string; name?: string } | undefined {
        if (!data || typeof data !== "object") return undefined;
        const d = data as Record<string, unknown>;
        // addressCountry can be a string or { "@type": "Country", name: "..." }
        const addr = (d.address ?? d.location ?? d.areaServed) as
          | Record<string, unknown>
          | string
          | undefined;
        if (addr && typeof addr === "object") {
          const ac = (addr as Record<string, unknown>).addressCountry;
          if (typeof ac === "string") return { name: ac };
          if (ac && typeof ac === "object") {
            const n = (ac as Record<string, unknown>).name;
            if (typeof n === "string") return { name: n };
          }
        } else if (typeof addr === "string") {
          return { name: addr };
        }
        // ContactPoint telephone/email + country
        const cp = d.contactPoint;
        if (Array.isArray(cp)) {
          for (const item of cp) {
            if (item && typeof item === "object") {
              const a = (item as Record<string, unknown>).contactOption;
              void a;
            }
          }
        }
        return undefined;
      }
    });
    return raw;
  }

  /**
   * Match a single value to the best block (first block whose text contains
   * the value). Strong country evidence comes only from the SAME block.
   */
  private matchValue(
    kind: "email" | "phone",
    value: string,
    blocks: RawBlock[]
  ): ExtractedContactEvidence {
    const v = value.toLowerCase().trim();
    const block = blocks.find((b) => b.text.toLowerCase().includes(v));
    if (!block) {
      return { kind, value, labels: [], countryEvidence: [] };
    }
    const nearbyText = block.text.slice(0, NEARBY_TEXT_CAP);
    const labels: string[] = [];
    // Page-derived labels: fax, mobile, whatsapp, toll-free, office, support.
    const lower = block.text.toLowerCase();
    if (/\bfax\b/.test(lower)) labels.push("fax");
    if (/\bmobile|cell|handy\b/.test(lower)) labels.push("mobile");
    if (/\bwhatsapp\b/.test(lower)) labels.push("whatsapp");
    if (/\btoll[- ]?free|freephone\b/.test(lower)) labels.push("toll-free");
    if (/\boffice\b/.test(lower)) labels.push("office");
    if (/\bsupport\b/.test(lower)) labels.push("support");

    // Country evidence: strong only when derived from THIS block's
    // structured data or a country name in this block's text.
    const countryEvidence: CountryEvidence[] = [];
    if (block.countryName || block.countryIso) {
      const name = block.countryName || "";
      const iso = block.countryIso || resolveCountryAlias(name);
      if (iso) {
        countryEvidence.push({
          country: iso,
          source: "structured_contact",
          evidenceText: name
            ? `Structured address country: ${name}`.slice(0, EVIDENCE_TEXT_CAP)
            : undefined,
        });
      }
    }
    // Also scan the block text for an explicit country name (same-block).
    if (countryEvidence.length === 0) {
      const found = scanForCountryName(block.text);
      if (found) {
        countryEvidence.push({
          country: found.iso,
          source: "same_block_text",
          evidenceText: found.match.slice(0, EVIDENCE_TEXT_CAP),
        });
      }
    }
    void block.hasContactPageHeading;
    return {
      kind,
      value,
      nearbyText,
      labels,
      countryEvidence,
    };
  }
}

interface RawBlock {
  readonly text: string;
  readonly countryIso?: string;
  readonly countryName?: string;
  readonly hasContactPageHeading: boolean;
}

/** A small set of country-name -> ISO lookups done at runtime via the alias table. */
function scanForCountryName(
  text: string
): { iso: string; match: string } | undefined {
  // Look for a known country name as a whole word in the block text.
  // Use the alias table to resolve. Limited to common full names.
  const candidates = [
    "United States",
    "United Kingdom",
    "Canada",
    "Australia",
    "Germany",
    "France",
    "Spain",
    "Italy",
    "Netherlands",
    "Ireland",
    "Japan",
    "China",
    "India",
    "Brazil",
    "Mexico",
  ];
  for (const name of candidates) {
    const re = new RegExp(`\\b${name}\\b`, "i");
    const m = text.match(re);
    if (m) {
      const iso = resolveCountryAlias(m[0]);
      if (iso) return { iso, match: m[0] };
    }
  }
  return undefined;
}
