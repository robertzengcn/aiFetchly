# IMAP Test Connection Debug Logging

Date: 2026-07-14

## Symptom

IMAP **TEST CONNECTION** still fails for the user's provider after TLS-mode
fallback attempts, with the UI showing `Receive connection failed: Unexpected
close`.

## Current State

The UI error is too lossy to identify which connection attempt failed:

- initial configured mode
- retry implicit TLS mode
- mailbox open after connection
- final sanitized IPC error

## Instrumentation Added

Added credential-safe main-process logging:

- `[email-receive:test]` logs the normalized protocol, host, port, SSL flag,
  folder, and whether username/password are present.
- `[email-receive:imap]` logs each IMAP attempt event with a trace id, mode,
  ImapFlow `secure`/`doSTARTTLS` options, and structured error fields
  (`message`, `code`, `reason`, `tlsFailed`).

No passwords, message bodies, or email contents are logged.

## Evidence

`yarn vitest --config vite.utilityCode.config.mjs test/vitest/utilitycode/EmailReceiveConnectionConfig.test.ts --run`

Result: 15 tests passed, including the project `tsc --noEmit -p tsconfig.json`
type-check gate.

## Status

DONE_WITH_CONCERNS: instrumentation is verified. The next debugging step is to
click **TEST CONNECTION** again and inspect the new main-process logs.
