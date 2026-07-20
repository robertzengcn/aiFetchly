# POP3 Receive Test Connection Timeout

## Symptom

Clicking **TEST CONNECTION** in the email service receive settings could show:

`Receive connection failed: POP3 connection timed out`

The same mailbox settings could work in a desktop email client.

## Root Cause

The receive test trusted the stored/UI SSL toggle exactly. If POP3 used the
standard implicit TLS port `995` while `ssl` was false, the app opened a plain
TCP POP3 socket to a TLS-only endpoint. That endpoint never sends a plain POP3
greeting, so the low-level POP3 client waited until its connection timeout.

Desktop email clients commonly normalize port `995` to implicit TLS
automatically, which explains why the same visible configuration can work there.

A related validation bug also existed on the same button path: the frontend
sends `emailServiceId: 0` when testing unsaved receive settings, but the IPC
schema still required a positive id.

## Fix

- Normalize receive configs in `EmailReceiveSyncService` so IMAP `993` and POP3
  `995` always use TLS before testing or syncing.
- Synchronize the Vue SSL toggles when those implicit TLS ports are entered, so
  the UI reflects the effective security mode.
- Allow `emailServiceId: 0` for connection tests only when direct settings are
  supplied.

## Evidence

- `AIFETCHLY_SKIP_TSC=1 npx vitest --config vite.utilityCode.config.mjs test/vitest/utilitycode/EmailReceiveConnectionConfig.test.ts --run`
  - 6 tests passed.
- `yarn tsc-result`
  - passed.
- `npx vue-tsc --noEmit`
  - passed.

## Status

DONE
