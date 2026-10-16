/**
 * N05: process-wide AI provider/config version (epoch) for capability-cache
 * keying. Every settings change that can alter provider identity (mode
 * switch, new local config, key clear, provider clear) bumps the version;
 * production model-capability lookups pass the current key so a catalog
 * fetched under a previous provider can never satisfy the current one.
 * In-memory and process-scoped like the catalogs it versions — no
 * persistence (a restart starts uncached, which is fail-safe). Zero imports
 * so any layer can use it without dependency cycles.
 */

let providerConfigVersion = 0;

/** Monotonically bumped on every provider-identity-affecting change. */
export function bumpProviderConfigVersion(): number {
  providerConfigVersion += 1;
  return providerConfigVersion;
}

/** Current version for keying capability lookups. */
export function currentProviderConfigVersion(): number {
  return providerConfigVersion;
}

/** Opaque key form consumed by keyed catalog loads. */
export function providerConfigKey(): string {
  return `provider-config:v${providerConfigVersion}`;
}
