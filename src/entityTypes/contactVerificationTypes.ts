/**
 * Contact Verification AI Tool — internal type contracts.
 *
 * The shared deterministic verifier is runtime-neutral: it must NOT import
 * Electron, TypeORM, `Token`, or renderer code so the contact-extraction
 * worker process can import it safely (design §4.2, §2.4, DoD #10).
 *
 * These are the INTERNAL camelCase types consumed by
 * `ContactVerificationService` and its verifiers. The LLM-facing snake_case
 * JSON contract is produced by `ContactVerificationAiTools` (and the Zod
 * input schema in `src/schemas/contactVerification.ts`). Internal types
 * must not duplicate snake_case properties (design §8.4).
 *
 * See:
 *   docs/prd/contact-verification-ai-tool-prd.md
 *   docs/prd/contact-verification-ai-tool-technical-design.md
 */

// ---------------------------------------------------------------------------
// Country evidence
// ---------------------------------------------------------------------------

/**
 * The source/strength of a country inference attached to a contact block.
 *
 * Strong sources (design §10.5) authorize phone normalization for the
 * contact in the SAME block; weak sources never authorize normalization
 * by themselves and are retained only for human-readable reasons.
 */
export type CountryEvidenceSource =
  /** User explicitly stated the country. */
  | "explicit_user"
  /** Structured data (e.g. JSON-LD `addressCountry`) tied to the contact. */
  | "structured_contact"
  /** A postal address in the same bounded DOM contact block. */
  | "same_block_address"
  /** An office/country heading in the same bounded DOM contact block. */
  | "same_block_heading"
  /** Other tightly scoped nearby text in the same contact block. */
  | "same_block_text"
  /** Page-level country evidence (WEAK — never authorizes normalization). */
  | "page_level"
  /** Website top-level domain (WEAK). */
  | "site_domain"
  /** Company headquarters (WEAK). */
  | "headquarters"
  /** Campaign country (WEAK). */
  | "campaign_country"
  /** Browser/user locale (WEAK). */
  | "user_locale"
  /** Evidence present but its source is not classifiable. */
  | "unknown";

/** A single country claim with its provenance. */
export interface CountryEvidence {
  /** ISO 3166-1 alpha-2 country code, uppercased. */
  readonly country: string;
  /** Where the country inference came from (drives strong/weak classification). */
  readonly source: CountryEvidenceSource;
  /** Optional short human-readable description of the evidence (≤240 chars). */
  readonly evidenceText?: string;
}

// ---------------------------------------------------------------------------
// Verification request (internal)
// ---------------------------------------------------------------------------

/** Per-contact-block context that applies only to the values in this group. */
export interface ContactVerificationContext {
  readonly nearbyText?: string;
  readonly address?: string;
  readonly countryEvidence: readonly CountryEvidence[];
}

/** A group of contacts sharing the same source URL and contact-block context. */
export interface ContactVerificationGroup {
  readonly sourceUrl?: string;
  readonly emails: readonly string[];
  readonly phones: readonly string[];
  readonly context?: ContactVerificationContext;
}

/** Top-level verification request consumed by the service. */
export interface ContactVerificationRequest {
  readonly contacts: readonly ContactVerificationGroup[];
}

// ---------------------------------------------------------------------------
// Status types (design §8.1)
// ---------------------------------------------------------------------------

export type EmailVerificationStatus =
  | "likely_valid"
  | "role_based"
  | "risky"
  | "invalid"
  | "unknown";

export type PhoneVerificationStatus =
  | "likely_valid"
  | "context_resolved"
  | "ambiguous_region"
  | "possible"
  | "invalid"
  | "non_phone";

/**
 * Mail-routing outcome for an email domain. `not_checked` is used when a
 * higher-precedence rule (invalid syntax, placeholder) made DNS work
 * unnecessary. `domainResolves: null` means the DNS check did not produce a
 * stable answer and must NOT be converted to `false`.
 */
export type MailRoutingStatus =
  | "mx"
  | "implicit_address"
  | "null_mx"
  | "no_route"
  | "nxdomain"
  | "temporary_failure"
  | "resolver_failure"
  | "not_checked";

/**
 * Mail-routing outcome for a domain. `domainResolves: null` means the DNS
 * check did not produce a stable answer (temporary/resolver failure) and
 * must NOT be coerced to `false`. `retryable` flags whether a re-verification
 * should re-attempt the lookup.
 */
export interface DnsMailRouteResult {
  readonly status: MailRoutingStatus;
  readonly domainResolves: boolean | null;
  readonly retryable: boolean;
}

// ---------------------------------------------------------------------------
// Result types (design §8.2, §8.3, §8.4)
// ---------------------------------------------------------------------------

/** Machine-readable check outcomes for a single email (design §8.2). */
export interface EmailVerificationChecks {
  readonly syntaxValid: boolean;
  readonly placeholder: boolean;
  readonly disposableDomain: boolean;
  readonly suspiciousLocalPart: boolean;
  readonly roleBased: boolean;
  /** `null` = DNS did not produce a stable answer (do not coerce to false). */
  readonly domainResolves: boolean | null;
  readonly mailRouting: MailRoutingStatus;
}

/** Per-email verification result. */
export interface EmailVerificationResult {
  readonly original: string;
  readonly normalized?: string;
  readonly status: EmailVerificationStatus;
  readonly checks: EmailVerificationChecks;
  readonly reasons: readonly string[];
  readonly checkedAt: string;
  readonly rulesVersion: string;
}

/** libphonenumber-js number type mapped into the stable public enum (§10.8). */
export type PhoneNumberType =
  | "mobile"
  | "fixed_line"
  | "fixed_line_or_mobile"
  | "toll_free"
  | "premium_rate"
  | "voip"
  | "unknown";

/** Per-phone verification result. */
export interface PhoneVerificationResult {
  readonly original: string;
  readonly normalized?: string;
  readonly extension?: string;
  readonly status: PhoneVerificationStatus;
  readonly country?: string;
  readonly countryConfidence?: "high" | "medium" | "low";
  readonly countryEvidence?: string;
  readonly numberType?: PhoneNumberType;
  readonly reasons: readonly string[];
  readonly checkedAt: string;
  readonly rulesVersion: string;
}

/** A group result mirroring an input `ContactVerificationGroup`. */
export interface ContactVerificationGroupResult {
  readonly sourceUrl?: string;
  readonly emails: readonly EmailVerificationResult[];
  readonly phones: readonly PhoneVerificationResult[];
}

/** Top-level verification result (design §8.4). */
export interface ContactVerificationResult {
  readonly success: boolean;
  readonly verificationDepth: "standard";
  readonly verificationPerformed: true;
  readonly partial: boolean;
  readonly limitations: readonly string[];
  readonly summary: {
    readonly inputEmails: number;
    readonly inputPhones: number;
    readonly uniqueEmails: number;
    readonly uniquePhones: number;
    readonly likelyValid: number;
    readonly needsReview: number;
    readonly invalid: number;
    readonly unknown: number;
  };
  readonly contacts: readonly ContactVerificationGroupResult[];
  readonly dataVersions: {
    readonly rules: string;
    readonly disposableDomains: string;
    readonly phoneMetadata: string;
  };
}

// ---------------------------------------------------------------------------
// Stable error codes (design §18.1)
// ---------------------------------------------------------------------------

export type ContactVerificationErrorCode =
  | "INVALID_INPUT"
  | "LIMIT_EXCEEDED"
  | "AI_DISABLED"
  | "DNS_TIMEOUT"
  | "DNS_TEMPORARY_FAILURE"
  | "DNS_RESOLVER_FAILURE"
  | "DATA_LOAD_FAILURE"
  | "CANCELLED"
  | "DEADLINE_EXCEEDED"
  | "INTERNAL_ERROR";

// ---------------------------------------------------------------------------
// Progress (design §12.4) — internal phase names
// ---------------------------------------------------------------------------

/**
 * Internal verification phase. The AI adapter maps these onto the shared
 * `SkillExecutionContext.emitProgress` phase enum (which is fixed at
 * queued|running|fetching|extracting|finalizing) and carries the precise
 * phase in the progress message string.
 */
export type ContactVerificationPhase =
  | "validating"
  | "checking_email_domains"
  | "checking_phones"
  | "finalizing";

export interface ContactVerificationProgress {
  readonly phase: ContactVerificationPhase;
  readonly message: string;
  readonly progress?: number | null;
  readonly partialCount?: number | null;
  readonly expectedCount?: number | null;
}

// ---------------------------------------------------------------------------
// Contact evidence (worker → service adapter, design §11.4)
// ---------------------------------------------------------------------------

/** Evidence captured for a single extracted contact value, pre-verification. */
export interface ExtractedContactEvidence {
  readonly kind: "email" | "phone";
  readonly value: string;
  readonly nearbyText?: string;
  readonly address?: string;
  /** Page-derived labels: fax, mobile, whatsapp, toll-free, office, support. */
  readonly labels: readonly string[];
  readonly countryEvidence: readonly CountryEvidence[];
}
