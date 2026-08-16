/**
 * Registrable-domain host validation.
 *
 * Replaces fragile substring checks such as `host.endsWith("bing.com")`,
 * which CodeQL flags as `js/incomplete-url-substring-sanitization` because
 * they accept attacker-controlled look-alikes (`evilbing.com`,
 * `bing.com.evil.com`). A registrable-domain comparison accepts only the
 * exact domain, its `www.` prefix, or a subdomain of it.
 */

/** Canonical registrable domains used by the platform scrapers/adapters. */
export const ALLOWED_HOSTS = {
  bing: 'bing.com',
  baidu: 'baidu.com',
  yandex: ['yandex.com', 'yandex.ru'],
  yellowpages: 'yellowpages.com',
  yelp: 'yelp.com',
  yell: 'yell.com',
  '192': '192.com',
  google: 'google.com',
} as const;

/**
 * Returns true when `hostname` belongs to the same registrable domain as
 * `registrableDomain`. Accepts `registrableDomain`, `www.`+registrableDomain,
 * and any `*.registrableDomain` subdomain. Rejects look-alikes such as
 * `evilbing.com` for `bing.com`, or `bing.com.evil.com`.
 *
 * Comparison is case-insensitive per RFC 4343; inputs are lowercased and
 * trimmed. Empty inputs return false.
 */
export function isSameRegistrableHost(
  hostname: string,
  registrableDomain: string
): boolean {
  const host = (hostname ?? '').trim().toLowerCase();
  const domain = (registrableDomain ?? '').trim().toLowerCase();
  if (!host || !domain) return false;
  if (host === domain) return true;
  if (host === `www.${domain}`) return true;
  // `host` must end with `.domain` to be a true subdomain (the leading dot
  // prevents `evilbing.com` from matching `bing.com`).
  return host.endsWith(`.${domain}`);
}

/**
 * Returns true when `hostname` belongs to any of the provided registrable
 * domains. Useful for platforms spanning multiple TLDs (e.g. yandex.com /
 * yandex.ru).
 */
export function hostMatchesAny(
  hostname: string,
  registrableDomains: readonly string[]
): boolean {
  return registrableDomains.some((domain) =>
    isSameRegistrableHost(hostname, domain)
  );
}