# IMAP Test Connection Unexpected Close

Date: 2026-07-14

## Symptom

Clicking **Test Connect** for an IMAP receive configuration returned:

`Receive connection failed: Unexpected close`

## Root Cause

The app mapped the IMAP SSL/TLS toggle directly to ImapFlow's `secure` option.
In ImapFlow, `secure: true` means direct/implicit TLS, normally port `993`.
For STARTTLS-style IMAP connections, commonly port `143`, the client must start
plain with `secure: false` and require the upgrade with `doSTARTTLS: true`.

Passing `secure: true` to a STARTTLS/plain IMAP endpoint makes the app send a
TLS handshake before the server's IMAP greeting, and some servers close the
socket, which surfaces as `Unexpected close`.

## Fix

`ImapEmailReceiveClient` now builds ImapFlow options from the configured port:

- IMAP port `993` with SSL/TLS enabled uses direct TLS.
- IMAP non-`993` with SSL/TLS enabled uses STARTTLS.
- IMAP with SSL/TLS disabled does not opportunistically upgrade.

## Evidence

`yarn vitest --config vite.utilityCode.config.mjs test/vitest/utilitycode/EmailReceiveConnectionConfig.test.ts --run`

Result: 9 tests passed, including the project `tsc --noEmit -p tsconfig.json`
type-check gate.

## Status

DONE_WITH_CONCERNS: verified by unit tests and ImapFlow API contract. Live IMAP
connection verification requires the user's real mail provider credentials.
