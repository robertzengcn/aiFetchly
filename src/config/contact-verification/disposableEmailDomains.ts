/**
 * Shipped disposable-email-domain list (design §6.3, §9.5, FR-6).
 *
 * Compile-time TypeScript module (not a runtime file read) so it resolves
 * identically in dev, Vite bundles, and packaged ASAR builds.
 *
 * The list is a replaceable data module: bump `DISPOSABLE_DOMAINS_VERSION`
 * whenever it changes so cached verification results can be detected as
 * stale (PRD FR-15). A stale list must NOT turn all unknown domains into
 * `risky` results — membership is a sufficient-but-not-necessary risk
 * signal (design §9.5: disposable ⇒ risky only when no stronger invalid
 * condition applies; unknown domains are `likely_valid` if routing passes).
 *
 * Source: well-known public disposable-domain sets (disposable.github.io,
 * mailchecker, etc.). Trimmed to the most common entries; replaceable
 * without changing the public tool contract.
 */

/** Version of this data module. Bump on any content change. */
export const DISPOSABLE_DOMAINS_VERSION = "1.0.0";

/**
 * Lowercased ASCII disposable domains. Kept as a `Set` for O(1) lookup.
 * Domains are normalized (lowercased, punycode) by the verifier before
 * membership testing, so this list stores the canonical lowercased form.
 */
const DISPOSABLE_DOMAINS: readonly string[] = [
  // Common temporary / 10-minute mail providers.
  "mailinator.com",
  "guerrillamail.com",
  "guerrillamail.info",
  "guerrillamail.net",
  "guerrillamail.biz",
  "guerrillamail.com.de",
  "sharklasers.com",
  "spam4.me",
  "10minutemail.com",
  "10minutemail.net",
  "10minutemail.org",
  "10minutemail.info",
  "yopmail.com",
  "yopmail.net",
  "yopmail.fr",
  "temp-mail.org",
  "tempmail.com",
  "tempmail.net",
  "tempmailo.com",
  "throwawaymail.com",
  "throwawaymail.net",
  "throwawaymail.org",
  "maildrop.cc",
  "getnada.com",
  "nada.email",
  "nada.ltd",
  "dispostable.com",
  "mailnesia.com",
  "mintemail.com",
  "fakeinbox.com",
  "fakeinbox.net",
  "fakeinbox.org",
  "trashmail.com",
  "trashmail.net",
  "trashmail.org",
  "trashmail.me",
  "sharklasers.com",
  "mailcatch.com",
  "mohmal.com",
  "mohmal.tech",
  "tempr.email",
  "tempinbox.com",
  "tmpmail.net",
  "tmpmail.org",
  "tmail.ws",
  "moakt.com",
  "moakt.ws",
  "tmails.net",
  "mytemp.email",
  "tmpemails.net",
  "tmpeml.com",
  "tmpeml.info",
  "emltmp.com",
  "emltmp.net",
  "emltmp.org",
  "mailtmp.com",
  "mailtmp.net",
  "mailtmp.org",
  "mailto.space",
  "mail7.io",
  "mail707.com",
  "vomoto.com",
  "cryptonmail.com",
  "mozmail.com",
  "incognitomail.com",
  "incognitomail.net",
  "incognitomail.org",
  "mailnull.com",
  "mailme.gq",
  "mailme.cf",
  "mailme.ml",
  "my10minutemail.com",
  "30minutemail.com",
  "20minutemail.com",
  "15minutemail.com",
  "1secmail.com",
  "1secmail.net",
  "1secmail.org",
  "esiix.com",
  "kwift.com",
  "laoeq.com",
  "kumli.com",
  "vjuum.com",
];

const DISPOSABLE_DOMAIN_SET: ReadonlySet<string> = new Set(
  DISPOSABLE_DOMAINS.map((d) => d.trim().toLowerCase()).filter(
    (d) => d.length > 0
  )
);

/** True when the (already lowercased ASCII) domain is on the disposable list. */
export function isDisposableDomain(loweredAsciiDomain: string): boolean {
  return DISPOSABLE_DOMAIN_SET.has(loweredAsciiDomain);
}
