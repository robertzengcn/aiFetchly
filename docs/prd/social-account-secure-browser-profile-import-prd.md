# Secure Social Account Sessions and Browser Profile Import - Product Requirements Document

## Document Information

- **Version**: 1.0
- **Status**: Proposed
- **Created**: 2026-08-05
- **Owner**: Engineering Team
- **Related areas**: Social Accounts, Electron main process, session persistence,
  secure local storage, browser extension integration
- **Related files**:
  - `src/entity/AccountCookies.entity.ts`
  - `src/model/AccountCookies.model.ts`
  - `src/modules/accountCookiesModule.ts`
  - `src/controller/socialaccount-controller.ts`
  - `src/main-process/communication/socialaccount-ipc.ts`
  - `src/views/pages/socialaccount/widgets/SocialaccountTable.vue`
  - `src/views/pages/socialaccount/socialaccountdetail.vue`
  - `src/modules/fieldCipher/FieldCipher.ts`
  - `src/modules/fieldCipher/UserSecretKeyService.ts`

## 1. Summary

AiFetchly stores social-account authentication cookies locally so automation and
the account-login window can reuse authenticated sessions. The current
`account_cookies.cookies` column stores raw JSON cookie values in SQLite. Anyone
who can read the local database can potentially reuse those sessions.

AiFetchly must encrypt all saved social-account cookie snapshots at rest using
the existing per-user AES-256-GCM field-cipher infrastructure. Existing plaintext
cookie rows must be safely migrated without losing sessions.

The product must also let a user connect an existing browser profile to a Tool
Account without exporting a Netscape `.txt` cookie file manually. The feature
will import only the cookies required for the selected social platform. It must
never copy a full browser profile, browser history, stored passwords, extensions,
or cookies from unrelated sites.

The first browser-profile import release will support Chromium-family browsers
through an AiFetchly browser extension and a local native-messaging bridge.
Directly reading Chromium's `Cookies` SQLite database is explicitly excluded
because cookie encryption is browser- and operating-system-specific, browser
files may be locked, and the approach is brittle across Chrome, Edge, Brave,
Windows, macOS, and Linux.

## 2. Problem

### 2.1 Plaintext authentication material

`AccountCookiesEntity.cookies` is a normal SQLite text column. The current
cookie-upload path serializes imported cookies and saves that raw JSON value.
The session contains bearer-like credentials that can grant access without a
password or second-factor prompt until the site invalidates the session.

### 2.2 Manual and fragile cookie import

The current user must create a Tool Account, export cookies using another
browser tool, find the exported `.txt` file, and upload it. This is error-prone,
especially when the export misses SSO cookies needed by Google, YouTube, and
other multi-domain login flows.

### 2.3 Session partition is not stable

`SocialAccountController.showSocialmediaWin()` generates a new Electron
partition every time it opens an account window. A stored `partition_path` is
overwritten rather than reused. The application compensates by injecting the
saved cookie snapshot again, but it does not preserve a durable browser session
partition per Tool Account.

### 2.4 Cookie capture is too narrow

When the login window closes, the current implementation calls
`session.cookies.get({ url: socialTypeUrl })`. This only retrieves cookies
matching the configured platform URL. It can omit required authentication
cookies from sibling and SSO domains, such as Google Account cookies required
for YouTube.

## 3. Goals

1. Encrypt every social-account cookie snapshot at rest before it reaches
   SQLite.
2. Reuse the existing per-user AES-256-GCM `FieldCipher` and secret-key service
   rather than introducing a second cookie key format.
3. Preserve existing plaintext sessions through an idempotent, failure-safe
   migration.
4. Never expose cookie values to the renderer, UI notifications, logs, IPC
   errors, analytics, or diagnostics.
5. Use one stable persistent Electron partition per Tool Account.
6. Save all approved first-party and SSO cookies needed by a platform login,
   not merely cookies matching one landing-page URL.
7. Let users import cookies from a selected Chromium browser profile with
   explicit user consent.
8. Import only platform allowlisted cookie domains and only to the Tool Account
   selected by the user.
9. Keep existing Netscape `.txt` upload and manual-login flows available as
   fallbacks, but route their writes through the new encrypted storage layer.
10. Validate all new renderer-to-main, extension-to-native-host, and persisted
    data boundaries with Zod v4.
11. Support Chrome, Microsoft Edge, and Brave in the first browser-profile
    import release. Firefox is deferred.
12. Provide clear user-facing results without revealing cookie names or values
    unnecessarily.

## 4. Non-Goals

1. Do not copy or clone an entire browser profile directory.
2. Do not import browser history, passwords, autofill records, extensions,
   bookmarks, downloads, or browsing preferences.
3. Do not decrypt or scrape a browser's internal cookie database directly.
4. Do not support remote debugging endpoints, browser command-line flags, or
   arbitrary network connections as the import mechanism.
5. Do not synchronize cookie sessions between different AiFetchly users.
6. Do not automatically import cookies without the account owner explicitly
   choosing a profile, a Tool Account, and confirming the selected platform.
7. Do not guarantee that any third-party social platform will accept imported
   sessions. Sites may expire sessions, require a security challenge, or prohibit
   automation under their terms.
8. Do not add cookie values to audit logs, support bundles, or crash reports.
9. Do not make browser-profile import available to child or worker processes.

## 5. Target Users

### 5.1 Marketing operator with existing browser login

The operator is already logged into YouTube, Facebook, X, or another supported
platform in Chrome, Edge, or Brave. They want to attach that authenticated
browser profile to the matching Tool Account without installing a separate
cookie-export extension or manually uploading a file.

### 5.2 Security-conscious team member

The team member wants to use Tool Accounts but expects stored browser sessions
to be protected when a local database backup or workstation file is inspected.

### 5.3 Support and engineering maintainer

The maintainer needs deterministic import results, actionable error states, and
a way to add a supported platform without allowing arbitrary domain access.

## 6. User Stories

1. As a user, I can choose **Import from browser profile** for a Tool Account.
2. As a user, I can select a supported Chromium browser and one of its profiles.
3. As a user, I see the target Tool Account and platform before any cookies are
   imported.
4. As a user, I can cancel at any point without modifying the Tool Account.
5. As a user, I receive a concise success result that says how many approved
   cookies were imported and whether the session should be verified.
6. As a user, I can still upload a Netscape cookie file or complete manual login
   when profile import is unavailable.
7. As a user, when I close the AiFetchly login window after signing in, the
   session is saved for all required platform domains.
8. As a user, I can clear a Tool Account's cookies and its associated Electron
   session data.
9. As a maintainer, I can define the allowed cookie domains for each supported
   platform in one reviewed, versioned manifest.
10. As a maintainer, I can observe import outcomes without ever reading an
    authentication token or cookie value.

## 7. Product Behavior

### 7.1 Secure storage behavior

1. Cookie JSON must be encrypted with `FieldCipher.encrypt()` immediately before
   persistence.
2. The stored envelope format must be `ENC1:<base64-iv>:<base64-ciphertext-and-tag>`.
3. Cookie JSON is decrypted only in the Electron main process immediately before
   it is supplied to an Electron session or validated for migration.
4. A renderer API must report only metadata, such as `hasCookies`,
   `cookieCount`, `lastUpdatedAt`, and `importSource`. It must never return
   cookie values.
5. If the per-user secret key cannot be fetched, the application must refuse
   to save or import cookies and show a recoverable error. It must not fall back
   to plaintext.
6. If an encrypted row is corrupt or fails AES-GCM authentication, the
   application must not use it. The account remains available, but its session
   is marked unavailable and the user is asked to reauthenticate.

### 7.2 Plaintext migration behavior

1. A row whose `cookies` value does not start with `ENC1:` is treated as a
   legacy plaintext candidate.
2. AiFetchly validates that the legacy value is a cookie array before migrating.
3. When a secret key is available, a background migration encrypts each valid
   legacy row and updates it atomically, one row at a time.
4. The migration is idempotent. Rerunning it must skip rows already encrypted.
5. An invalid legacy row is not overwritten. It is marked unusable through
   non-sensitive metadata or diagnostics, and the user is prompted to import
   or sign in again.
6. A missing key, database failure, or process shutdown leaves the original
   row intact. The migration resumes safely later.
7. New writes from cookie-file upload, browser-profile import, manual login,
   and automated session refresh must be encrypted from the first release.

### 7.3 Stable session partition behavior

Each Tool Account owns a persistent Electron partition. The partition identifier
is created once when the account first receives a session and is subsequently
reused.

Open-account flow:

```text
Tool Account ID
  -> load account cookie record
  -> reuse stored partition_path, or create it once if absent
  -> session.fromPartition(partition_path)
  -> decrypt and validate saved cookie snapshot
  -> apply allowed cookies to this account session
  -> configure the account's selected proxy
  -> open the platform login window
```

Close-account-window flow:

```text
Electron account session
  -> session.cookies.get({})
  -> platform-specific domain allowlist filter
  -> normalize and validate cookie records
  -> encrypt cookie snapshot
  -> atomically save encrypted snapshot and the same partition_path
```

Clearing account cookies must delete the encrypted database snapshot and clear
storage for the account's saved Electron partition. A clear must not affect any
other Tool Account partition.

### 7.4 Platform cookie domain manifest

AiFetchly must use a pure-data platform session manifest that maps a supported
social platform to:

- canonical platform identifier and display name;
- navigation URL;
- allowed cookie-domain suffixes;
- required SSO cookie-domain suffixes where applicable;
- supported browser-profile-import status;
- optional verification URL;
- an explicit schema version.

The manifest must be main-process safe. It must not import Vue Router, renderer
components, or browser-only code.

Domain matching rules:

1. A cookie domain matches only if it equals an allowlisted suffix or ends in
   `.<allowlisted suffix>`.
2. A leading dot in a cookie domain is normalized before matching.
3. Broad public suffixes such as `com`, `net`, `org`, and `co.uk` are invalid
   manifest entries.
4. Third-party tracking, advertising, analytics, and unrelated domains are
   excluded even if they were present in the browser session.
5. Platform-specific SSO domains must be explicit. Example: a YouTube account
   may require approved `youtube.com` and `google.com`/`accounts.google.com`
   cookies, but not every cookie in the user's Chrome profile.

### 7.5 Browser-profile import UX

The Social Account table and edit page must provide **Import from browser
profile** next to the existing cookie-file upload action for saved accounts.

Flow:

1. User chooses **Import from browser profile**.
2. The app validates that the Tool Account exists, is active, and has a
   platform with browser-profile import enabled.
3. The dialog displays:
   - target Tool Account name and platform;
   - supported browser choices;
   - discovered profiles for the selected browser;
   - the approved platform domains;
   - a short consent statement explaining that only platform cookies are read;
   - an explicit **Import** button and a **Cancel** button.
4. The user selects a profile and confirms.
5. The app creates a short-lived, single-use import request bound to the
   selected account, platform, browser, profile, and current local user.
6. The supported AiFetchly extension receives the request through the local
   native-messaging host and asks for browser permission only for the manifest's
   approved domains.
7. The extension obtains allowed cookies from the user-selected profile,
   sends them once to the native host, and clears the one-time request.
8. The main process validates, normalizes, deduplicates, encrypts, and stores
   the accepted cookies.
9. The UI shows an import result:
   - success, partial success, no eligible cookies, canceled, extension missing,
     permission denied, expired request, or storage failure;
   - count of imported cookies;
   - count of rejected cookies grouped only by safe reason, such as
     `outside_allowed_domains` or `expired`;
   - an action to open the account login window and verify the session.

The UI must not show cookie values. Cookie names should also be omitted by
default because names can reveal account, experiment, and authentication details.

### 7.6 Browser extension and native-messaging behavior

The first release uses a signed or clearly versioned AiFetchly Chromium extension
and a local native-messaging host registered by the desktop installer.

Security requirements:

1. The extension manifest requests only `cookies` permission and host
   permissions derived from the reviewed platform manifest, not `<all_urls>`.
2. The extension accepts requests only from the local native host and only
   for the configured AiFetchly extension ID in production builds.
3. Each import request carries an unpredictable one-time token with a maximum
   lifetime of five minutes.
4. The native host verifies the request token, account ID, platform ID, profile
   selection, extension origin, request expiration, and expected domain set
   before accepting cookie data.
5. The native host rejects unexpected message types, oversized payloads,
   duplicate requests, invalid JSON, and cookies outside the allowed domains.
6. Cookies cross only the local native-messaging channel. They must not be sent
   to the AiFetchly backend or any remote service.
7. The extension and native host must not write cookie payloads to logs.
8. An update that changes allowed domains must require review of the desktop
   manifest and extension host permissions.

### 7.7 Existing cookie-file import

The existing Netscape `.txt` upload remains supported. Its behavior changes only
as required for safety:

1. Read access, not write access, is checked for the selected file.
2. Parsed cookies are validated against the selected Tool Account's platform
   manifest before storage.
3. Rejected cookies produce a safe summary without revealing values.
4. Valid cookies are saved through encrypted cookie storage.
5. A user may upload a file containing only a subset of required SSO cookies,
   but the result must warn when no accepted cookie belongs to a required
   platform domain.

## 8. Functional Requirements

### 8.1 Cookie encryption service

- Introduce a dedicated cookie-session service or extend
  `AccountCookiesModule` with typed methods for:
  - `saveCookieSnapshot(accountId, partitionPath, cookies, source)`;
  - `getCookieSnapshot(accountId)`;
  - `migrateLegacyCookieSnapshots()`;
  - `clearCookieSnapshot(accountId)`.
- The model layer persists only ciphertext and non-sensitive metadata.
- The module layer owns encryption, decryption, validation, and migration.
- IPC handlers and renderer APIs must never interact with raw database entities
  containing cookies.
- Reuse `userSecretKeyService` and `FieldCipher`; do not use the legacy
  hard-coded-key `CryptoSource`.

### 8.2 Cookie schema and normalization

- Define a Zod v4 cookie schema for both imported Chromium cookies and legacy
  Netscape-converted cookies.
- Normalize domain casing, leading dots, path defaults, expiration representation,
  `SameSite`, `Secure`, and `HttpOnly`.
- Reject malformed names, empty domains, unsupported same-site combinations,
  expired cookies, cookie values above a documented maximum length, and
  non-HTTPS `SameSite=None` combinations.
- Deduplicate by normalized domain, path, and name. The newest valid cookie wins.
- Store the encrypted JSON snapshot as an array, not an opaque browser profile.

### 8.3 Account session service

- Replace per-window random partition generation with account-specific partition
  resolution.
- Persist a partition only after it is validated as a `persist:` Electron
  partition identifier.
- Load cookies into the account's session before `BrowserWindow.loadURL()`.
- Capture cookies from `session.cookies.get({})`, filter them through the
  platform manifest, then persist the approved snapshot.
- Ensure every asynchronous session-save path is awaited before reporting
  `saveCookiesSuccess`.
- Do not use `any` in new TypeScript code. Browser-window and Electron session
  types must be explicit.

### 8.4 IPC and renderer contracts

New main-process channels must be registered through
`registerValidatedHandler` and validate input with Zod v4. Suggested operations:

- `socialaccount:browser-import:availability`
- `socialaccount:browser-import:profiles`
- `socialaccount:browser-import:start`
- `socialaccount:browser-import:cancel`
- `socialaccount:session:metadata`

The renderer may receive only:

```ts
interface AccountSessionMetadata {
  hasCookies: boolean;
  cookieCount: number;
  lastUpdatedAt: string | null;
  importSource: "manual_login" | "netscape_file" | "browser_profile" | null;
  sessionStatus: "available" | "missing" | "invalid" | "migration_pending";
}
```

### 8.5 User interface and accessibility

- Disable browser-profile import for unsaved Tool Accounts and unsupported
  platforms, with an explanatory tooltip.
- Use existing `useI18n` patterns and add all user-facing keys to English,
  Chinese, Spanish, French, German, and Japanese language files.
- Provide loading, empty, extension-not-installed, permission-denied, expired,
  partial-import, and generic-error states.
- Require a confirmation after profile selection. The confirmation must include
  the target account, platform, browser profile label, and domain list.
- Do not display raw filesystem paths for browser profiles unless the user
  explicitly expands troubleshooting information.

## 9. Data Model and Migration

The existing `account_cookies` table remains the source of truth. The initial
release may retain the `cookies` column name for compatibility, but its contents
must become the `ENC1` envelope.

Add non-secret metadata columns through the project's SQLite/TypeORM migration
approach:

- `encryption_version` nullable integer;
- `source` nullable text;
- `cookie_count` nullable integer;
- `session_status` nullable text;
- `last_error_code` nullable text;
- `migration_attempted_at` nullable text.

No migration may record raw exception text if it could include a cookie value or
URL query parameter.

Migration algorithm:

```text
For each account_cookies row:
  if cookies starts with "ENC1:":
    leave unchanged
  else:
    parse and validate as a cookie snapshot
    if key unavailable:
      leave row unchanged and retry later
    else if valid:
      encrypt snapshot and atomically update row plus metadata
    else:
      preserve original row, mark session_status = invalid, never load it
```

The migration must run after the user secret key is available and must not block
application startup. It must be observable through aggregate safe counts only.

## 10. Security and Privacy Requirements

1. Cookie payloads are secrets equivalent to active sessions.
2. AES-GCM authentication failures are security failures, not recoverable
   plaintext fallbacks.
3. Cookie plaintext lives only in main-process memory for the shortest necessary
   duration.
4. Key buffers are invalidated and zeroed using the existing secret-key service
   behavior on logout or session change.
5. IPC inputs are schema-validated before browser profile discovery, native-host
   request creation, session access, or database writes.
6. Browser profile import requires local interactive confirmation. It is not
   exposed as an AI tool or background automation action.
7. The import flow must verify that the selected Tool Account's platform matches
   the requested manifest. The renderer cannot choose arbitrary domains.
8. Audit events may include account ID, platform ID, result code, accepted count,
   rejected count, and timestamp. They must never include cookie values, raw
   domains outside approved manifests, browser-profile paths, or request tokens.
9. Existing debug logs that print `cookieDetails`, `cookiescontent`, parsed
   cookie arrays, or filenames containing sensitive data must be removed or
   replaced with redacted counts.
10. The feature must be reviewed against Electron context-isolation and
    least-privilege requirements before release.

## 11. Acceptance Criteria

### 11.1 Encryption and migration

1. A newly imported, manually logged-in, or file-uploaded cookie snapshot is
   stored as an `ENC1:` value, never raw JSON.
2. A database inspection cannot find a plaintext cookie value from a new write.
3. A valid legacy plaintext cookie row is readable once, encrypted, and remains
   usable after restart.
4. Migration reruns do not change rows already encrypted.
5. A key-service failure prevents writes and leaves existing plaintext data
   unchanged rather than replacing it with an empty or corrupt value.
6. A tampered encrypted cookie row is not applied to a session and produces a
   safe reauthentication state.

### 11.2 Electron session behavior

1. Opening the same Tool Account twice uses the same stored persistent
   partition.
2. Two Tool Accounts never share a partition or cookies.
3. Closing a manual-login window saves approved cookies from multiple required
   platform and SSO domains.
4. Cookies outside the platform allowlist are not stored.
5. Clearing a Tool Account removes both its encrypted snapshot and only its own
   Electron partition storage.

### 11.3 Browser profile import

1. An unsaved account cannot start an import.
2. A supported account can select a supported Chromium browser and profile,
   confirm, and import only approved cookies.
3. The native host rejects expired, duplicated, malformed, or wrong-platform
   extension messages.
4. A profile containing unrelated site cookies does not add those cookies to
   AiFetchly.
5. Canceling before confirmation or in the extension leaves the target account
   unchanged.
6. Missing extension, denied permission, and no eligible cookies produce
   understandable recovery actions.
7. Cookie values never appear in UI, IPC payloads to the renderer, logs, or test
   snapshots.

### 11.4 Regression protection

1. Existing Netscape cookie-file import works and writes encrypted data.
2. Existing manual login works and writes encrypted data.
3. Account list and detail pages continue to report cookie presence without
   receiving cookie contents.
4. Existing proxy configuration remains scoped to the account session.
5. All user-facing states have translations in the six supported languages.

## 12. Test Strategy

### Unit tests

- `FieldCipher` envelope detection, encryption, decryption, malformed input, and
  GCM tamper detection.
- Cookie-session service: encrypted writes, decrypting reads, key failure,
  corrupt envelope, legacy migration, idempotency, and no plaintext fallback.
- Cookie schema: normalization, domain allowlist matching, expiry filtering,
  `SameSite` handling, deduplication, and maximum-size rejection.
- Platform manifest: reject unsafe domain entries and verify platform-to-domain
  matching.
- Account partition resolution: create once, reuse subsequently, and reject
  invalid stored partitions.
- Native-message schema and one-time request validation.

### IPC tests

- Invalid inputs to every new handler are rejected before work begins.
- Renderer responses contain metadata only.
- Browser import cannot request unsupported platforms or arbitrary domains.
- A canceled import removes its pending request and cannot be replayed.

### Integration tests

- Use a temporary SQLite database and mocked secret-key service to verify
  encrypted persistence and lazy migration.
- Use a mocked Electron session to verify cookie restoration, multi-domain
  capture, filtering, and partition cleanup.
- Use a mocked native-message transport to verify the browser-profile import
  state machine without requiring a real browser profile.

### Manual QA

- Chrome, Edge, and Brave profile import on Windows, macOS, and Linux.
- YouTube/Google multi-domain session import and post-import verification.
- Browser profile with no matching login.
- Browser profile containing matching plus unrelated cookies.
- Extension not installed, extension outdated, permission denied, and user
  cancellation.
- Existing plaintext database upgraded in place.

## 13. Rollout Plan

### Phase 1: Secure cookie persistence

- Add encrypted cookie-session service and safe migration.
- Route Netscape upload and manual-login session capture through it.
- Remove secret-bearing logs.
- Add migration and session unit tests.

### Phase 2: Stable account sessions

- Introduce platform cookie-domain manifest.
- Reuse stored account partitions.
- Capture all allowlisted cookies from an account session.
- Add session isolation and multi-domain tests.

### Phase 3: Chromium browser-profile import

- Deliver the extension, native-messaging host, one-time request protocol, and
  profile-import UI.
- Enable Chrome first behind a feature flag.
- Validate Edge and Brave compatibility, then enable them.

### Phase 4: Monitoring and expansion

- Review safe aggregate import outcomes and support failures.
- Add platform manifests only after testing their login and SSO requirements.
- Evaluate Firefox only with a separate, permission-scoped implementation.

## 14. Open Decisions

1. Should the browser extension be distributed through official extension stores,
   bundled for developer-mode installation, or both?
2. Which first-release platforms are supported beyond YouTube/Google, and what
   exact cookie-domain allowlists are required for each?
3. Should the existing backend per-user key remain mandatory for cookie access,
   or should an offline-only key-recovery design be defined for users without
   backend access?
4. What retention period, if any, should apply to safe aggregate import audit
   metadata?
5. Is an account-level `last verified` status required in the first release, or
   is an explicit **Open and verify login** action sufficient?

## 15. Implementation Dependencies

1. Existing `FieldCipher` and `userSecretKeyService` must remain available in
   Electron main-process code.
2. The SQLite migration process must support additive metadata columns.
3. The desktop installer must register and update a native-messaging host.
4. A reviewed Chromium extension is required before enabling browser-profile
   import.
5. Every supported social platform requires a reviewed session-domain manifest
   and manual QA before activation.
