/**
 * PhoneVerifier — Standard phone verification (design §10).
 *
 * Pipeline: Unicode normalization -> extract extension -> non-phone
 * heuristics -> detect explicit international prefix -> select strong
 * country evidence (if needed) -> libphonenumber parse -> possible/valid/
 * type checks -> safe E.164 normalization or preserve original -> status
 * + reasons.
 *
 * CRITICAL INVARIANT (PRD §3.3, FR-10): country evidence is per-contact-block.
 * Weak sources (page_level / site_domain / headquarters / campaign_country /
 * user_locale / unknown) NEVER authorize normalization. With zero or >=2
 * distinct strong countries, a national number returns `ambiguous_region`
 * with NO E.164 value. We never brute-force across every country.
 *
 * Runtime-neutral: no Electron/TypeORM/Token. No network requests.
 */
import {
  parsePhoneNumberWithError,
  isSupportedCountry,
  type PhoneNumber,
  type CountryCode,
} from "libphonenumber-js/max";
import { RULES_VERSION } from "@/config/contactVerification";
import { CONTACT_VERIFICATION_LIMITS } from "@/config/contactVerification";
import type {
  CountryEvidence,
  CountryEvidenceSource,
  PhoneVerificationResult,
  PhoneNumberType,
} from "@/entityTypes/contactVerificationTypes";
import { COUNTRY_ALIASES_VERSION } from "@/config/contact-verification/countryAliases";

// ---------------------------------------------------------------------------
// Strong vs weak evidence (design §10.5)
// ---------------------------------------------------------------------------

const STRONG_SOURCES: ReadonlySet<CountryEvidenceSource> = new Set([
  "explicit_user",
  "structured_contact",
  "same_block_address",
  "same_block_heading",
  "same_block_text",
]);

const WEAK_SOURCES: ReadonlySet<CountryEvidenceSource> = new Set([
  "page_level",
  "site_domain",
  "headquarters",
  "campaign_country",
  "user_locale",
  "unknown",
]);

// ---------------------------------------------------------------------------
// Unicode digit normalization (design §10.2)
// ---------------------------------------------------------------------------

/** Arabic-Indic digits ٠-٩ → 0-9. */
const ARABIC_INDIC: Record<string, string> = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
};
/** Eastern Arabic-Indic digits ۰-۹ → 0-9. */
const EASTERN_ARABIC_INDIC: Record<string, string> = {
  "۰": "0",
  "۱": "1",
  "۲": "2",
  "۳": "3",
  "۴": "4",
  "۵": "5",
  "۶": "6",
  "۷": "7",
  "۸": "8",
  "۹": "9",
};

function normalizeDigits(s: string): string {
  // NFKC handles full-width digits and some compatibility forms.
  let out = s.normalize("NFKC");
  out = out.replace(/[٠-٩]/g, (ch) => ARABIC_INDIC[ch] ?? ch);
  out = out.replace(/[۰-۹]/g, (ch) => EASTERN_ARABIC_INDIC[ch] ?? ch);
  // Non-breaking spaces -> ordinary space.
  out = out.replace(/[\u00A0\u202F]/g, " ");
  return out;
}

// ---------------------------------------------------------------------------
// Extension extraction (design §10.2)
// ---------------------------------------------------------------------------

/** Extension markers split off into a separate value. */
const EXT_RE = /(?:^|\s)(?:ext|x\.?|extension|ex|e\.?|;)\s*(\d{1,8})\s*$/i;

function extractExtension(input: string): {
  value: string;
  extension?: string;
} {
  const m = EXT_RE.exec(input);
  if (m) {
    return {
      value: input.slice(0, m.index).trim(),
      extension: m[1],
    };
  }
  return { value: input };
}

// ---------------------------------------------------------------------------
// Non-phone heuristics (design §10.3)
// ---------------------------------------------------------------------------

/** ISO/locale date patterns. */
const DATE_RE = /^\d{1,4}[-/]\d{1,2}[-/]\d{1,4}$/;
/** Time/timestamp patterns. */
const TIME_RE = /^\d{1,2}:\d{2}(:\d{2})?$/;
/** Currency-prefixed numeric. */
const CURRENCY_RE = /^(?:[$€£¥]|USD|EUR|GBP|JPY)\s?\d/;
/** Repeated single-digit placeholders (>=6 same digit). */
const REPEATED_DIGIT_RE = /^(\d)\1{5,}$/;

/**
 * Detect values that are more likely non-phone (dates, prices, IDs, postal
 * codes, repeated digits). Context labels can strengthen a non-phone result
 * but must never turn an impossible number into a valid one.
 */
function isLikelyNonPhone(
  digitsOnly: string,
  original: string,
  labels: readonly string[]
): boolean {
  if (DATE_RE.test(original.trim())) return true;
  if (TIME_RE.test(original.trim())) return true;
  if (CURRENCY_RE.test(original.trim())) return true;
  if (REPEATED_DIGIT_RE.test(digitsOnly)) return true;
  // Postal/ZIP when context labels it as postal data.
  if (
    labels.some((l) => /postal|zip|postcode/i.test(l)) &&
    /^\d{4,10}$/.test(digitsOnly)
  ) {
    return true;
  }
  // Order/tracking/SKU/ID when nearby labels say so.
  if (
    labels.some((l) => /order|tracking|sku|id|account|reference|ref/i.test(l))
  ) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Country evidence selection (design §10.5)
// ---------------------------------------------------------------------------

interface SelectedCountry {
  /** Distinct strong country codes (already uppercased + validated). */
  readonly strongCountries: readonly string[];
  /** A human-readable summary of the evidence for reasons. */
  readonly evidenceSummary?: string;
  /** Weak sources retained for reasons only. */
  readonly weakCount: number;
}

function selectStrongCountries(
  evidence: readonly CountryEvidence[]
): SelectedCountry {
  const strong = new Set<string>();
  const weak: string[] = [];
  let summary: string | undefined;
  for (const ev of evidence) {
    const code = ev.country.toUpperCase();
    if (STRONG_SOURCES.has(ev.source)) {
      // Only accept codes libphonenumber knows about.
      if (isSupportedCountry(code as CountryCode)) {
        strong.add(code);
        if (!summary && ev.evidenceText) {
          summary = ev.evidenceText;
        }
      }
    } else if (WEAK_SOURCES.has(ev.source)) {
      weak.push(`${code} (${ev.source})`);
    }
  }
  return {
    strongCountries: [...strong],
    evidenceSummary: summary,
    weakCount: weak.length,
  };
}

// ---------------------------------------------------------------------------
// Number type mapping (design §10.8)
// ---------------------------------------------------------------------------

function mapNumberType(
  raw: ReturnType<PhoneNumber["getType"]>
): PhoneNumberType | undefined {
  if (!raw) return undefined;
  switch (raw) {
    case "MOBILE":
      return "mobile";
    case "FIXED_LINE":
      return "fixed_line";
    case "FIXED_LINE_OR_MOBILE":
      return "fixed_line_or_mobile";
    case "TOLL_FREE":
      return "toll_free";
    case "PREMIUM_RATE":
      return "premium_rate";
    case "VOIP":
      return "voip";
    default:
      return "unknown";
  }
}

// ---------------------------------------------------------------------------
// Phone verifier
// ---------------------------------------------------------------------------

export interface PhoneVerifierDeps {
  readonly now: () => Date;
}

export class PhoneVerifier {
  constructor(private readonly deps: PhoneVerifierDeps) {}

  verify(
    originalRaw: string,
    evidence: readonly CountryEvidence[] = []
  ): PhoneVerificationResult {
    const original = originalRaw;
    const reasons: string[] = [];
    const checkedAt = this.deps.now().toISOString();

    // Unicode normalize + extract extension.
    const normalized = normalizeDigits(originalRaw);
    const { value: withoutExt, extension } = extractExtension(normalized);
    const digitsOnly = withoutExt.replace(/[^\d+]/g, "");

    // Non-phone heuristics (use labels from evidence evidenceText where
    // available — kept simple in the first release).
    const labels: string[] = [];
    if (isLikelyNonPhone(digitsOnly, withoutExt, labels)) {
      reasons.push(
        "The value matches a date, price, ID, or repeated-digit placeholder rather than a phone number"
      );
      return {
        original,
        status: "non_phone",
        extension,
        reasons: cap(reasons),
        checkedAt,
        rulesVersion: RULES_VERSION,
      };
    }

    // Detect explicit international prefix.
    const isExplicit =
      /^\+/.test(withoutExt.trim()) || /^00/.test(withoutExt.trim());
    let explicitInput = withoutExt.trim();
    if (/^00/.test(explicitInput)) {
      explicitInput = `+${explicitInput.slice(2)}`;
    } else if (!explicitInput.startsWith("+")) {
      // Not explicit international.
    }

    if (isExplicit) {
      return this.verifyExplicit(
        original,
        explicitInput,
        extension,
        reasons,
        checkedAt
      );
    }

    // National number — select strong country evidence.
    const selected = selectStrongCountries(evidence);

    // 0 or >=2 strong countries -> ambiguous (unless impossible length).
    if (selected.strongCountries.length !== 1) {
      if (digitsOnly.length < 4 || digitsOnly.length > 15) {
        reasons.push(
          "The number has an impossible length for any phone number"
        );
        return {
          original,
          extension,
          status: "invalid",
          reasons: cap(reasons),
          checkedAt,
          rulesVersion: RULES_VERSION,
        };
      }
      if (selected.weakCount > 0) {
        reasons.push(
          "Only weak country evidence was available (website domain, headquarters, locale, or campaign); it cannot authorize normalization"
        );
      }
      if (selected.strongCountries.length > 1) {
        reasons.push(
          "Multiple distinct strong countries were found in the same contact block"
        );
      } else {
        reasons.push(
          "No strong same-contact-block country evidence was available"
        );
      }
      reasons.push("The national number was preserved without an E.164 value");
      return {
        original,
        extension,
        status: "ambiguous_region",
        reasons: cap(reasons),
        checkedAt,
        rulesVersion: RULES_VERSION,
      };
    }

    // Exactly one strong country — parse with it.
    const country = selected.strongCountries[0] as CountryCode;
    return this.verifyNational(
      original,
      withoutExt,
      country,
      selected,
      extension,
      reasons,
      checkedAt
    );
  }

  /** Parse an explicit + international number with no default region. */
  private verifyExplicit(
    original: string,
    input: string,
    extension: string | undefined,
    reasons: string[],
    checkedAt: string
  ): PhoneVerificationResult {
    try {
      const parsed = parsePhoneNumberWithError(input);
      if (!parsed) {
        reasons.push("The explicit international number could not be parsed");
        return {
          original,
          extension,
          status: "invalid",
          reasons: cap(reasons),
          checkedAt,
          rulesVersion: RULES_VERSION,
        };
      }
      if (parsed.isValid()) {
        reasons.push(
          "The explicit international number matches a valid numbering structure"
        );
        return {
          original,
          normalized: parsed.format("E.164"),
          extension,
          status: "likely_valid",
          country: parsed.country,
          countryConfidence: "high",
          numberType: mapNumberType(parsed.getType()),
          reasons: cap(reasons),
          checkedAt,
          rulesVersion: RULES_VERSION,
        };
      }
      if (parsed.isPossible()) {
        reasons.push(
          "The number is possible but not a confirmed valid assignment"
        );
        return {
          original,
          normalized: parsed.format("E.164"),
          extension,
          status: "possible",
          country: parsed.country,
          countryConfidence: "high",
          numberType: mapNumberType(parsed.getType()),
          reasons: cap(reasons),
          checkedAt,
          rulesVersion: RULES_VERSION,
        };
      }
      reasons.push(
        "The explicit international number is impossible under numbering metadata"
      );
      return {
        original,
        extension,
        status: "invalid",
        reasons: cap(reasons),
        checkedAt,
        rulesVersion: RULES_VERSION,
      };
    } catch {
      reasons.push("The explicit international number could not be parsed");
      return {
        original,
        extension,
        status: "invalid",
        reasons: cap(reasons),
        checkedAt,
        rulesVersion: RULES_VERSION,
      };
    }
  }

  /** Parse a national number using one strong same-block country. */
  private verifyNational(
    original: string,
    input: string,
    country: CountryCode,
    selected: SelectedCountry,
    extension: string | undefined,
    reasons: string[],
    checkedAt: string
  ): PhoneVerificationResult {
    try {
      const parsed = parsePhoneNumberWithError(input, country);
      if (!parsed) {
        reasons.push(
          "The national number could not be parsed under the resolved country"
        );
        return {
          original,
          extension,
          status: "invalid",
          reasons: cap(reasons),
          checkedAt,
          rulesVersion: RULES_VERSION,
        };
      }
      if (parsed.isValid()) {
        reasons.push(
          `The number matches the ${country} numbering structure resolved from the same contact block`
        );
        return {
          original,
          normalized: parsed.format("E.164"),
          extension,
          status: "context_resolved",
          country,
          countryConfidence: "high",
          countryEvidence: selected.evidenceSummary,
          numberType: mapNumberType(parsed.getType()),
          reasons: cap(reasons),
          checkedAt,
          rulesVersion: RULES_VERSION,
        };
      }
      if (parsed.isPossible()) {
        reasons.push(
          "The number is possible but not a confirmed valid assignment"
        );
        return {
          original,
          normalized: parsed.format("E.164"),
          extension,
          status: "possible",
          country,
          countryConfidence: "medium",
          countryEvidence: selected.evidenceSummary,
          numberType: mapNumberType(parsed.getType()),
          reasons: cap(reasons),
          checkedAt,
          rulesVersion: RULES_VERSION,
        };
      }
      reasons.push(
        "The number is impossible under the resolved country's numbering metadata"
      );
      return {
        original,
        extension,
        status: "invalid",
        country,
        countryConfidence: "high",
        countryEvidence: selected.evidenceSummary,
        reasons: cap(reasons),
        checkedAt,
        rulesVersion: RULES_VERSION,
      };
    } catch {
      reasons.push(
        "The national number could not be parsed under the resolved country"
      );
      return {
        original,
        extension,
        status: "invalid",
        reasons: cap(reasons),
        checkedAt,
        rulesVersion: RULES_VERSION,
      };
    }
  }
}

/** Exported for the country-aliases data-version surface. */
export { COUNTRY_ALIASES_VERSION };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cap(reasons: string[]): readonly string[] {
  return reasons
    .slice(0, CONTACT_VERIFICATION_LIMITS.maxReasonsPerContact)
    .map((r) =>
      r.length > CONTACT_VERIFICATION_LIMITS.maxReasonChars
        ? r.slice(0, CONTACT_VERIFICATION_LIMITS.maxReasonChars)
        : r
    );
}
