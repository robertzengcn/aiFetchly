# DEBUG REPORT: Workspace Memory PEM Private-Key Validation

Date: 2026-07-16

## Symptom

WM-VALID-07 expected secret patterns to be rejected, but the manual workspace
memory UI accepted the literal input `-----BEGIN RSA PRIVATE KEY-----` and saved
it.

## Root Cause

Manual workspace memory saves already call `AIWorkspaceMemoryModule`, and that
module calls the shared `MemorySecretFilter` before persistence. The save path
was not bypassing validation. The shared filter simply had no pattern for PEM
private-key block headers, so `looksSecretlike("-----BEGIN RSA PRIVATE KEY-----")`
returned false.

## Fix

Added PEM private-key header detection to `src/service/MemorySecretFilter.ts`.
Because workspace memory create/update paths use this shared filter, the panel
now receives the existing rejected-save response without requiring panel-specific
validation.

## Evidence

- `yarn testmain --run test/vitest/main/service/MemorySecretFilter.test.ts`
  passed.
- `yarn testmain --run test/vitest/main/modules/AIWorkspaceMemoryModule.test.ts -t "WM-VALID-07"`
  passed.
- Running the full workspace-memory module test file was blocked by the local
  native dependency state: `better-sqlite3.node` was compiled for Node module
  ABI 133 while the active Node runtime expects ABI 127.

## Regression Test

- `test/vitest/main/service/MemorySecretFilter.test.ts` covers RSA, OpenSSH,
  and PGP private-key PEM headers.
- `test/vitest/main/modules/AIWorkspaceMemoryModule.test.ts` covers WM-VALID-07
  and verifies the model create method is not called.

## Status

DONE_WITH_CONCERNS: fix is verified through targeted tests, but the full module
file cannot run until `better-sqlite3` is rebuilt for the active Node runtime.
