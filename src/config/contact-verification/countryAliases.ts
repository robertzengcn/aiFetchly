/**
 * ISO country name → ISO 3166-1 alpha-2 code alias table (design §6.3, §10.6).
 *
 * Compile-time TypeScript module (no runtime file read) so it resolves in
 * dev, Vite bundles, and packaged ASAR builds. `ContactEvidenceExtractor`
 * uses this to convert an explicit country NAME found in the same DOM
 * contact block into an ISO code; an ISO code from structured data
 * (e.g. `addressCountry`) is used directly.
 *
 * The first release does NOT infer a country from a city name alone (design
 * §10.6 — a global city database adds ambiguity and maintenance cost).
 * Only full country names and common aliases are mapped here.
 *
 * Bump `COUNTRY_ALIASES_VERSION` on any content change so stale phone
 * results can be detected (PRD FR-15).
 */

/** Version of this data module. Bump on any content change. */
export const COUNTRY_ALIASES_VERSION = "1.0.0";

/** Convenience type for a readonly string→string record. */
type ReadonlyRecord<K extends string, V> = Readonly<Record<K, V>>;

/** Alias keyed by lowercased trimmed text → ISO 3166-1 alpha-2 code. */
const COUNTRY_ALIASES: ReadonlyRecord<string, string> = {
  // English names + aliases
  "united states": "US",
  "united states of america": "US",
  usa: "US",
  "u.s.a.": "US",
  america: "US",
  "united kingdom": "GB",
  uk: "GB",
  "u.k.": "GB",
  "great britain": "GB",
  britain: "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  "northern ireland": "GB",
  canada: "CA",
  australia: "AU",
  "new zealand": "NZ",
  ireland: "IE",
  "republic of ireland": "IE",
  germany: "DE",
  deutschland: "DE",
  france: "FR",
  spain: "ES",
  italy: "IT",
  italia: "IT",
  netherlands: "NL",
  "the netherlands": "NL",
  holland: "NL",
  belgium: "BE",
  switzerland: "CH",
  sweden: "SE",
  norway: "NO",
  denmark: "DK",
  finland: "FI",
  poland: "PL",
  portugal: "PT",
  austria: "AT",
  greece: "GR",
  "czech republic": "CZ",
  czechia: "CZ",
  slovakia: "SK",
  hungary: "HU",
  romania: "RO",
  bulgaria: "BG",
  croatia: "HR",
  serbia: "RS",
  slovenia: "SI",
  lithuania: "LT",
  latvia: "LV",
  estonia: "EE",
  russia: "RU",
  "russian federation": "RU",
  ukraine: "UA",
  belarus: "BY",
  moldova: "MD",
  georgia: "GE",
  turkey: "TR",
  türkiye: "TR",
  israel: "IL",
  "saudi arabia": "SA",
  "united arab emirates": "AE",
  uae: "AE",
  qatar: "QA",
  kuwait: "KW",
  bahrain: "BH",
  oman: "OM",
  jordan: "JO",
  lebanon: "LB",
  iraq: "IQ",
  iran: "IR",
  egypt: "EG",
  "south africa": "ZA",
  nigeria: "NG",
  kenya: "KE",
  ghana: "GH",
  morocco: "MA",
  algeria: "DZ",
  tunisia: "TN",
  india: "IN",
  pakistan: "PK",
  bangladesh: "BD",
  "sri lanka": "LK",
  nepal: "NP",
  china: "CN",
  japan: "JP",
  "south korea": "KR",
  korea: "KR",
  "republic of korea": "KR",
  "north korea": "KP",
  taiwan: "TW",
  "hong kong": "HK",
  singapore: "SG",
  malaysia: "MY",
  indonesia: "ID",
  thailand: "TH",
  vietnam: "VN",
  philippines: "PH",
  mexico: "MX",
  brazil: "BR",
  argentina: "AR",
  chile: "CL",
  colombia: "CO",
  peru: "PE",
  venezuela: "VE",
  uruguay: "UY",
  paraguay: "PY",
  bolivia: "BO",
  ecuador: "EC",
};

/**
 * Resolve a free-text country token (name or alias) to an ISO 3166-1 alpha-2
 * code. Returns `undefined` when the token is not recognized — callers MUST
 * treat an unknown country as ambiguous, never invent one (design §10.6).
 *
 * The input is normalized (trimmed, lowercased, surrounding punctuation
 * stripped) before lookup. Already-ISO codes are not handled here — pass
 * those through directly.
 */
export function resolveCountryAlias(
  raw: string | undefined | null
): string | undefined {
  if (!raw) return undefined;
  const normalized = raw
    .toLowerCase()
    .trim()
    .replace(/[\s.,;:!?'"()]+$/g, "")
    .replace(/^[\s.,;:!?'"()]+/g, "")
    .trim();
  if (normalized.length === 0) return undefined;
  return COUNTRY_ALIASES[normalized];
}
