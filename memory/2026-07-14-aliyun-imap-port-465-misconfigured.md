# Aliyun IMAP Port 465 Misconfiguration

Date: 2026-07-14

## Symptom

IMAP **TEST CONNECTION** returned `Unexpected close`.

The debug log showed:

- protocol: `imap`
- host: `imap.qiye.aliyun.com`
- port: `465`
- SSL/TLS: `true`

## Root Cause

Port `465` is SMTP sending, not IMAP receiving. Aliyun's receive settings are:

- IMAP receive: `imap.qiye.aliyun.com`, SSL port `993`, non-SSL port `143`
- POP3 receive: `pop.qiye.aliyun.com`, SSL port `995`, non-SSL port `110`
- SMTP send: `smtp.qiye.aliyun.com`, SSL port `465`, non-SSL port `25`

The app tried both STARTTLS and implicit TLS against an endpoint/port
combination that does not serve IMAP, so ImapFlow reported connection-level
failures.

## Fix

Added receive endpoint validation before test/sync:

- Reject port `465` for receive protocols with a clear message.
- Reject `smtp.*` hosts for IMAP/POP3 receive.
- Preserve valid Aliyun IMAP settings (`imap.qiye.aliyun.com:993` with SSL).

## Evidence

`yarn vitest --config vite.utilityCode.config.mjs test/vitest/utilitycode/EmailReceiveConnectionConfig.test.ts --run`

Result: 18 tests passed, including the project `tsc --noEmit -p tsconfig.json`
type-check gate.

## Status

DONE
