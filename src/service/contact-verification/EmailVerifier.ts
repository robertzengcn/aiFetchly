/**
 * EmailVerifier — Standard email verification (design §9).
 *
 * Pipeline: conservative wrapper cleanup -> split local/domain ->
 * domainToASCII + lowercase -> validator.isEmail -> placeholder/role/
 * suspicious/disposable local rules -> DNS mail-route lookup (injected) ->
 * deterministic status precedence -> checks + reasons.
 *
 * Runtime-neutral: no Electron/TypeORM/Token. DNS work is delegated to an
 * injected `DnsMailRouteResolver` so tests never touch public DNS.
 */
import { isEmail } from "validator";
import { domainToASCII } from "node:url";
import {
  CONTACT_VERIFICATION_LIMITS,
  RULES_VERSION,
} from "@/config/contactVerification";
import { isDisposableDomain } from "@/config/contact-verification/disposableEmailDomains";
import { DISPOSABLE_DOMAINS_VERSION } from "@/config/contact-verification/disposableEmailDomains";
import type {
  EmailVerificationResult,
  MailRoutingStatus,
} from "@/entityTypes/contactVerificationTypes";
import type { DnsMailRouteResolver } from "./DnsMailRouteResolver";

// ---------------------------------------------------------------------------
// Local rule sets (design §9.5)
// ---------------------------------------------------------------------------

/** Role-based local parts (descriptive, NOT a rejection). */
const ROLE_LOCAL_PARTS: ReadonlySet<string> = new Set([
  "info",
  "sales",
  "support",
  "contact",
  "admin",
  "administrator",
  "help",
  "service",
  "office",
  "marketing",
  "press",
  "hello",
  "enquiries",
  "enquiry",
  "billing",
  "accounts",
  "account",
  "noreply",
  "no-reply",
  "donotreply",
  "postmaster",
  "webmaster",
  "abuse",
  "team",
  "general",
]);

/** Placeholder/example local parts -> invalid when matched.
 * Kept to the obvious, conventional example signals (design §9.5). Common
 * nouns like "name"/"user" are NOT flagged here because real people use
 * them as local parts; they are caught by the suspicious-pattern rules
 * (too-short / all-digits) only when they actually look like noise. */
const PLACEHOLDER_LOCAL_PARTS: ReadonlySet<string> = new Set([
  "test",
  "example",
  "yourname",
  "yourdomain",
  "youremail",
  "you",
  "someone",
  "foo",
  "bar",
]);

/** Placeholder/example domains -> invalid when matched. */
const PLACEHOLDER_DOMAINS: ReadonlySet<string> = new Set([
  "example.com",
  "example.org",
  "example.net",
  "example.edu",
  "test.com",
  "test.org",
  "yourdomain.com",
  "yourdomain.com",
  "domain.com",
  "email.com",
  "company.com",
]);

/** Suspicious local-part patterns (risky, not invalid). */
const SUSPICIOUS_LOCAL_PART_PATTERNS: readonly RegExp[] = [
  /^(.)\1{4,}$/i, // 5+ of the same char (aaaaaa)
  /^[A-Za-z0-9]{1,3}$/i, // too short to be real (abc)
  /^\d+$/i, // all digits
];

// ---------------------------------------------------------------------------
// Conservative cleanup (design §9.2)
// ---------------------------------------------------------------------------

/**
 * Conservative wrapper cleanup. Removes surrounding whitespace, a leading
 * `mailto:` prefix, and balanced display wrappers `<address>`. Trailing
 * punctuation that cannot be part of a parsed address is trimmed. Never
 * removes characters from the middle of an address or rewrites the local
 * part to make invalid input pass. The original is always retained by the
 * caller.
 */
function conservativeCleanup(raw: string): string {
  let s = raw.trim();
  // Strip mailto: prefix.
  if (/^mailto:/i.test(s)) {
    s = s.slice("mailto:".length).trim();
  }
  // Strip any ?subject= / ?body= query that follows a mailto.
  const qIdx = s.indexOf("?");
  if (qIdx >= 0) {
    s = s.slice(0, qIdx).trim();
  }
  // Balanced display wrapper: `Name <addr>` -> `addr`.
  const openLt = s.lastIndexOf("<");
  const closeGt = s.lastIndexOf(">");
  if (openLt >= 0 && closeGt > openLt) {
    s = s.slice(openLt + 1, closeGt).trim();
  }
  // Trim trailing punctuation that cannot be part of the address.
  s = s.replace(/[,.;:!?)]+$/g, "").trim();
  // Trim a leading stray quote/paren.
  s = s.replace(/^[('"]+/g, "").trim();
  return s;
}

// ---------------------------------------------------------------------------
// Domain normalization (design §9.3)
// ---------------------------------------------------------------------------

interface NormalizedEmail {
  readonly localPart: string;
  readonly asciiDomain: string;
  readonly normalized: string;
}

/**
 * Normalize the domain: domainToASCII (punycode) then lowercase. Preserve
 * the local part's display case. Returns undefined when the domain cannot
 * be normalized (empty conversion).
 */
function normalizeEmail(cleaned: string): NormalizedEmail | undefined {
  const atIdx = cleaned.lastIndexOf("@");
  if (atIdx < 0 || atIdx === 0 || atIdx === cleaned.length - 1) {
    return undefined;
  }
  const localPart = cleaned.slice(0, atIdx);
  const domain = cleaned.slice(atIdx + 1);
  if (!localPart || !domain) return undefined;
  const asciiDomain = domainToASCII(domain.trim().toLowerCase());
  if (!asciiDomain) return undefined;
  return {
    localPart,
    asciiDomain,
    normalized: `${localPart}@${asciiDomain}`,
  };
}

// ---------------------------------------------------------------------------
// Syntax validation (design §9.4)
// ---------------------------------------------------------------------------

/**
 * Practical email syntax validation via validator.isEmail with the Standard
 * profile: require a domain, disallow display names, reject IP literals,
 * reject localhost/single-label, enforce practical lengths.
 */
function isSyntaxValid(normalized: string): boolean {
  return isEmail(normalized, {
    allow_display_name: false,
    require_display_name: false,
    allow_ip_domain: false,
    require_tld: true,
    ignore_max_length: false,
    allow_utf8_local_part: true,
    domain_specific_validation: true,
  });
}

/** True when the value is an IP-literal / single-label / localhost domain. */
function isInvalidDomainShape(asciiDomain: string): boolean {
  if (!asciiDomain.includes(".")) return true; // single label
  if (asciiDomain === "localhost") return true;
  if (asciiDomain.endsWith(".localhost")) return true;
  if (/^\[[0-9a-f:.]+\]$/i.test(asciiDomain)) return true; // IP literal
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(asciiDomain)) return true; // bare IPv4
  return false;
}

// ---------------------------------------------------------------------------
// Email verifier
// ---------------------------------------------------------------------------

export interface EmailVerifierDeps {
  readonly dnsResolver: DnsMailRouteResolver;
  readonly now: () => Date;
}

export class EmailVerifier {
  constructor(private readonly deps: EmailVerifierDeps) {}

  async verify(originalRaw: string): Promise<EmailVerificationResult> {
    const original = originalRaw;
    const cleaned = conservativeCleanup(originalRaw);
    const reasons: string[] = [];
    const checkedAt = this.deps.now().toISOString();

    const baseChecks = {
      syntaxValid: false,
      placeholder: false,
      disposableDomain: false,
      suspiciousLocalPart: false,
      roleBased: false,
      domainResolves: null as boolean | null,
      mailRouting: "not_checked" as MailRoutingStatus,
    };

    // Empty / no-@ -> invalid immediately.
    if (!cleaned || !cleaned.includes("@")) {
      reasons.push("The value is not a syntactically valid email address");
      return {
        original,
        status: "invalid",
        checks: baseChecks,
        reasons: cap(reasons),
        checkedAt,
        rulesVersion: RULES_VERSION,
      };
    }

    const normalized = normalizeEmail(cleaned);
    if (!normalized) {
      reasons.push("The email domain could not be normalized");
      return {
        original,
        status: "invalid",
        checks: baseChecks,
        reasons: cap(reasons),
        checkedAt,
        rulesVersion: RULES_VERSION,
      };
    }

    const { localPart, asciiDomain, normalized: normalizedAddr } = normalized;
    const lowerLocal = localPart.toLowerCase();
    const lowerDomain = asciiDomain.toLowerCase();

    // Placeholder detection (invalid).
    const isPlaceholderDomain = PLACEHOLDER_DOMAINS.has(lowerDomain);
    const isPlaceholderLocal = PLACEHOLDER_LOCAL_PARTS.has(lowerLocal);
    if (isPlaceholderDomain || isPlaceholderLocal) {
      reasons.push(
        isPlaceholderDomain
          ? "The domain is a placeholder/example domain"
          : "The local part is a placeholder/example value"
      );
      return {
        original,
        normalized: normalizedAddr,
        status: "invalid",
        checks: { ...baseChecks, placeholder: true },
        reasons: cap(reasons),
        checkedAt,
        rulesVersion: RULES_VERSION,
      };
    }

    // Invalid domain shape (IP literal / single label / localhost).
    if (isInvalidDomainShape(lowerDomain)) {
      reasons.push("The domain is an IP literal, single label, or localhost");
      return {
        original,
        normalized: normalizedAddr,
        status: "invalid",
        checks: { ...baseChecks, syntaxValid: false },
        reasons: cap(reasons),
        checkedAt,
        rulesVersion: RULES_VERSION,
      };
    }

    const syntaxValid = isSyntaxValid(normalizedAddr);
    if (!syntaxValid) {
      reasons.push("The value is not a syntactically valid email address");
      return {
        original,
        normalized: normalizedAddr,
        status: "invalid",
        checks: { ...baseChecks, syntaxValid: false },
        reasons: cap(reasons),
        checkedAt,
        rulesVersion: RULES_VERSION,
      };
    }

    // Local rule flags (role / disposable / suspicious) — descriptive.
    const isRole = ROLE_LOCAL_PARTS.has(lowerLocal);
    const isDisposable = isDisposableDomain(lowerDomain);
    const isSuspicious = SUSPICIOUS_LOCAL_PART_PATTERNS.some((re) =>
      re.test(lowerLocal)
    );

    if (isRole) reasons.push("The local part identifies a role or team");
    if (isDisposable)
      reasons.push("The domain is a known disposable/temporary email provider");
    if (isSuspicious)
      reasons.push("The local part matches a suspicious pattern");

    // DNS mail-route lookup.
    const dns = await this.deps.dnsResolver.resolve(lowerDomain);
    const mailRouting = dns.status;
    const domainResolves = dns.domainResolves;
    reasons.push(...dnsReason(mailRouting));

    const checks = {
      syntaxValid: true,
      placeholder: false,
      disposableDomain: isDisposable,
      suspiciousLocalPart: isSuspicious,
      roleBased: isRole,
      domainResolves,
      mailRouting,
    };

    // Deterministic precedence (design §9.9).
    const status = classifyEmail({
      mailRouting,
      isDisposable,
      isSuspicious,
      isRole,
    });

    return {
      original,
      normalized: normalizedAddr,
      status,
      checks,
      reasons: cap(reasons),
      checkedAt,
      rulesVersion: RULES_VERSION,
    };
  }
}

/** Exported for the disposable-domains data-version surface. */
export { DISPOSABLE_DOMAINS_VERSION };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Apply the per-contact reason count + length caps (design §19.2). */
function cap(reasons: string[]): readonly string[] {
  return reasons
    .slice(0, CONTACT_VERIFICATION_LIMITS.maxReasonsPerContact)
    .map((r) =>
      r.length > CONTACT_VERIFICATION_LIMITS.maxReasonChars
        ? r.slice(0, CONTACT_VERIFICATION_LIMITS.maxReasonChars)
        : r
    );
}

/** Map a mail-routing status to a concise reason string. */
function dnsReason(status: MailRoutingStatus): string[] {
  switch (status) {
    case "mx":
      return ["The domain publishes MX mail-routing records"];
    case "implicit_address":
      return [
        "The domain has no MX records but publishes address (A/AAAA) records",
      ];
    case "null_mx":
      return ["The domain explicitly rejects mail (null MX)"];
    case "no_route":
      return ["The domain has no mail-routing records"];
    case "nxdomain":
      return ["The domain does not exist in DNS"];
    case "temporary_failure":
      return ["DNS lookup failed temporarily; result is uncertain"];
    case "resolver_failure":
      return [
        "DNS resolver returned an unclassified error; result is uncertain",
      ];
    case "not_checked":
      return [];
  }
}

interface ClassifyInput {
  readonly mailRouting: MailRoutingStatus;
  readonly isDisposable: boolean;
  readonly isSuspicious: boolean;
  readonly isRole: boolean;
}

/**
 * Deterministic classification precedence (design §9.9):
 * 1. invalid (null_mx / no_route / nxdomain)
 * 2. unknown (temporary/resolver failure)
 * 3. risky (disposable / suspicious)
 * 4. role_based (valid routing + role local part)
 * 5. likely_valid (valid syntax + supported routing)
 */
function classifyEmail(
  input: ClassifyInput
): EmailVerificationResult["status"] {
  const { mailRouting, isDisposable, isSuspicious, isRole } = input;
  if (
    mailRouting === "null_mx" ||
    mailRouting === "no_route" ||
    mailRouting === "nxdomain"
  ) {
    return "invalid";
  }
  if (
    mailRouting === "temporary_failure" ||
    mailRouting === "resolver_failure"
  ) {
    return "unknown";
  }
  if (isDisposable || isSuspicious) {
    return "risky";
  }
  if (isRole) {
    return "role_based";
  }
  return "likely_valid";
}
