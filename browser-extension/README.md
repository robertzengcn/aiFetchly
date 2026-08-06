# AiFetchly Browser-Profile Import Extension (DEFERRED)

This directory will hold the signed Manifest V3 Chromium extension that reads
approved cookies from the user's Chrome / Edge / Brave profile and relays them
once to the AiFetchly native-messaging host.

## Status: not yet shipped

The in-application layer is implemented and tested with a mocked transport:

- Protocol schemas: `src/schemas/nativeMessaging.ts`
- One-time request state machine: `src/main-process/browserProfileImport/ImportRequestRegistry.ts`
- Coordinator (availability, pairing, persist): `src/main-process/browserProfileImport/BrowserImportCoordinator.ts`
- Native-messaging host relay (framing + validation): `src/childprocess/browserProfileNativeHost.ts`
- Feature flag (default OFF): `src/config/featureFlags.ts`

The extension itself, its signing/distribution, and the OS-installer registration
of the native-messaging host are deferred (technical-design Open Implementation
Decisions #1–#2). The feature flag `BROWSER_PROFILE_IMPORT_FLAG` must remain
`"true"`-gated until a reviewed extension + installer registration exist.

## Why an extension (not direct DB read)

Directly reading Chromium's `Cookies` SQLite database is explicitly excluded
(PRD §1, §4.3): cookie encryption is browser- and OS-specific, browser files may
be locked, and the approach is brittle. The extension uses Chromium's own
authorized `cookies` API for the profile it runs in; native messaging keeps the
transfer local.
