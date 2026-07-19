# Email Service Password Encryption

## Symptom

`email_service.password` and `email_service.receivePassword` were stored as
plaintext in the local SQLite table.

## Root Cause

Social account credentials are encrypted in `SocialAccountModule` before the
model save call and decrypted on module read. Email service persistence did not
have the same module-level encryption/decryption layer; `EmailServiceModule`
passed credentials directly to `EmailServiceModel`.

## Fix

- Encrypt SMTP `password` and inbound `receivePassword` before
  `EmailServiceModule.createEmailService()` and `updateEmailService()` persist
  entities.
- Decrypt credentials on normal module read/list/find paths so existing send,
  receive, and update flows still receive usable plaintext.
- Preserve legacy plaintext rows by returning them as-is until the next save
  lazily migrates them to encrypted storage.
- Preserve encrypted envelopes when decrypt key lookup fails, preventing an
  edit-save with empty credential sentinels from erasing stored secrets.

## Evidence

- `TS_NODE_PROJECT=tsconfig.json npx mocha --require tsconfig-paths/register --require tsx/cjs test/modules/emailMarketingController.test.ts test/modules/emailServiceModule.cipher.test.ts`
  - 8 tests passed.
- `yarn tsc-result`
  - passed.
- `npx eslint src/modules/emailServiceModule.ts test/modules/emailServiceModule.cipher.test.ts`
  - passed.
- `yarn test`
  - blocked by an unrelated existing runner issue:
    `test/modules/SystemDependencyModule.test.ts` imports Vitest under the Mocha
    suite, causing `Vitest cannot be imported in a CommonJS module using require()`.

## Status

DONE_WITH_CONCERNS
