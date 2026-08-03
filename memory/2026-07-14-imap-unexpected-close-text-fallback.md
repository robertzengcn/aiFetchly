# IMAP Unexpected Close Text Fallback

Date: 2026-07-14

## Symptom

After adding the greeting-timeout TLS fallback, clicking **TEST CONNECTION** for
some IMAP providers still returned:

`Receive connection failed: Unexpected close`

## Root Cause

ImapFlow uses two different failure codes when an IMAP server does not provide a
plaintext greeting:

- `GREETING_TIMEOUT` when the server leaves the plaintext socket open
- `ClosedAfterConnectText` when the server closes the plaintext socket quickly

The previous fallback only retried direct TLS for `GREETING_TIMEOUT`, so a
TLS-only server that closed immediately still surfaced as `Unexpected close`.

## Fix

The implicit TLS retry guard now also treats `ClosedAfterConnectText` as a
retryable pre-greeting plaintext failure. It still does not retry
`ClosedAfterConnectTLS` or unrelated connection/authentication failures.

## Evidence

`yarn vitest --config vite.utilityCode.config.mjs test/vitest/utilitycode/EmailReceiveConnectionConfig.test.ts --run`

## Status

DONE_WITH_CONCERNS: verified against ImapFlow's local error contract. Live
provider verification requires the user's real IMAP settings.
