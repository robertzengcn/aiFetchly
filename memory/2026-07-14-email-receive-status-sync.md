# Email Receive Status Sync

Date: 2026-07-14

## Symptom

The email receive list showed stale unread state, and messages replied to from an external email client still displayed reply status `not_started`.

## Root Cause

Manual sync on the receive page requested `unreadOnly: true`, so read or answered messages were not fetched again and their stored mailbox flags could not be refreshed. The IMAP receive client also ignored the provider `\Answered` flag, so external replies were never promoted into local `replyStatus`.

## Fix

- Carry IMAP `\Answered` through `ParsedInboundEmail` as `isAnswered`.
- Convert provider-answered inbound messages to local `replyStatus: "sent"`.
- Preserve local processing state on ordinary re-syncs, but promote existing records to `sent` when the provider reports answered.
- Refresh recent mailbox messages on the receive page sync (`unreadOnly: false`, capped at 50) so read/unread and answered flags can update.
- Normalize stored boolean-like unread values before returning renderer DTOs.

## Evidence

`yarn vitest --config vite.utilityCode.config.mjs test/vitest/utilitycode/EmailReceiveStatusFlags.test.ts --run`

Result: 4 tests passed, including the project `tsc --noEmit -p tsconfig.json` type-check gate.
