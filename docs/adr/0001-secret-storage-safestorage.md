# ADR-0001: Secret storage via Electron `safeStorage`

- **Status:** Accepted — adapter shipped; live cutover pending verification
- **Workstream:** WS-1 (R1.1)
- **Date:** 2026-07-10

## Context

The review flagged secrets stored in plaintext `electron-store`. On inspection
the reality is more nuanced: `Token` (`src/modules/token.ts`) already encrypts
values with `CryptoSource` (AES) **before** calling `ElectronStoreService`, and
`electron-store` itself is constructed with no `encryptionKey`. So at-rest values
are CryptoSource-encrypted JSON, not raw plaintext.

The remaining weakness is the *key*: `CryptoSource`'s key is bundled with the
app, so an attacker who obtains the asar + the user's userData can decrypt.
`safeStorage` (Electron) binds encryption to **OS user credentials** (macOS
Keychain / Windows DPAPI / Linux libsecret), which is strictly stronger and is
what the commented-out `keytar` previously provided.

## Decision

Ship a `SecureStore` adapter (`src/modules/SecureStore.ts`) that wraps
`electron-store` and encrypts sensitive keys with `safeStorage`. Encrypted
values carry an `enc:v1:` prefix for deterministic, migration-safe detection.
Opt in behind `AIFETCHLY_ENCRYPT_STORE=1` (default **off**).

The adapter is **not yet wired** into the live `ElectronStoreService`/`Token`
path. Full cutover is a follow-up that must: (a) read existing CryptoSource
values transparently, (b) be verified against a copy of a real user store, and
(c) keep a rollback (flip the flag → plaintext/CryptoSource reads resume).

## Consequences

- + Stronger at-rest protection once enabled (OS-bound key).
- + Migration-safe: `getValue` only decrypts marker-prefixed values; legacy
  plaintext / CryptoSource values pass through until `migratePlaintextValues()`.
- − Until cutover, the default path is unchanged (still CryptoSource-only).
- − `safeStorage` is unavailable on Linux without a keyring; `SecureStore`
  logs a warning and stores plaintext in that case (fail-open, documented).

## Alternatives considered

- **`electron-store` `encryptionKey`:** rejected — a hardcoded key in the asar
  is trivially extractable, no better than CryptoSource today.
- **Re-add `keytar`:** rejected — native-module packaging cost; `safeStorage`
  covers the same OS keychain surface without a native dep.
- **Replace `CryptoSource` entirely with `safeStorage`:** deferred — higher
  migration risk; the layered approach lets us cutover incrementally.
