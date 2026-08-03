# IMAP Greeting Timeout TLS Fallback

Date: 2026-07-14

## Symptom

Clicking **TEST CONNECTION** for IMAP returned:

`Receive connection failed: Failed to receive greeting from server in required time. Maybe should use TLS?`

## Root Cause

The email receive settings have one `SSL/TLS` toggle, but IMAP has two secure
connection modes:

- implicit/direct TLS, commonly port `993`
- STARTTLS, commonly port `143`

The previous fix mapped IMAP SSL/TLS on non-`993` ports to STARTTLS. That fixed
STARTTLS servers, but it left no way to connect to providers that require
implicit/direct TLS on a custom IMAP port. Those servers do not send a plaintext
IMAP greeting, so ImapFlow times out waiting and reports that TLS may be needed.

## Fix

When IMAP SSL/TLS is enabled on a non-`993` port, the client still tries STARTTLS
first. If ImapFlow reports `GREETING_TIMEOUT`, the client now retries once with
implicit/direct TLS.

## Evidence

`yarn vitest --config vite.utilityCode.config.mjs test/vitest/utilitycode/EmailReceiveConnectionConfig.test.ts --run`

Result: 13 tests passed, including the project `tsc --noEmit -p tsconfig.json`
type-check gate.

## Status

DONE_WITH_CONCERNS: verified by unit tests and the ImapFlow error contract. Live
provider verification still depends on the user's real IMAP settings.
