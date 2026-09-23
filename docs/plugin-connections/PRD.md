# Plugin Connections and Google Drive for AI Chat — PRD

Status: Proposed implementation contract; not shipped.  
Date: 2026-09-23.  
Companion: [Technical design](TECHNICAL_DESIGN.md).

## 1. Product decision

Build reusable account connections into AiFetchly's plugin platform. Deliver Google Drive as the first independently packaged, first-party plugin using that platform. Users install a plugin, connect one or more accounts in its detail page through their system browser, select an account in AI chat, and let authorized tools act on that account.

The desktop owns connection UI, authorization sessions, credential protection, account selection, and enforcement. The plugin declares its requirements and implements AI-facing tools. The Go hub distributes compatible packages. Provider-specific account secrets do not pass through the hub for the initial Google integration.

This PRD records the conversation's agreed direction and makes recommended defaults explicit. Scope modes, limits, and rollout decisions below are proposed product defaults, not claims of user approval or implemented behavior.

## 2. Problem and users

Installing an MCP plugin does not by itself establish access to a user's cloud account. Copying tokens into plugin options is difficult for ordinary users and unsuitable for reusable, multiple-account authorization. A Google-specific login implementation embedded in plugin code would duplicate work for Salesforce, Meta, and subsequent integrations.

Primary users:

- Marketers using campaign briefs, research, and generated assets in AI chat.
- Users with personal and company accounts who must avoid actions in the wrong account.
- Plugin developers who need documented connection and runtime contracts.
- AiFetchly maintainers publishing reviewed plugins and supporting packaged desktop installations.

## 3. Outcomes and non-goals

### Release-one outcomes

1. Install the Drive plugin and open an app-owned setup page.
2. Authorize through Google in the default browser without copying credentials.
3. Connect at least two accounts; select and display the account used by a chat.
4. Search and read authorized files, create folders, and upload approved chat artifacts.
5. Run on supported packaged desktop targets without a system Node installation.
6. Persist credentials only with an acceptable OS-backed protection mechanism.
7. Reuse the contracts for other providers without duplicating the UI or vault.

### Explicit exclusions

- Shipping Salesforce or Meta adapters in release one.
- Whole-Drive indexing, continuous synchronization, autonomous scheduled execution, or offline cloud operations.
- Deleting files, changing sharing/ownership, editing existing documents, or sending external messages.
- Universal compatibility with every third-party stdio MCP server.
- Downloading arbitrary provider adapter code into the trusted main process.
- Treating Electron utility processes as a sandbox against malicious local code.
- Replacing AiFetchly account login or the existing global Token store.
- General remote HTTP MCP OAuth, cloud credential synchronization, and confidential-client broker hosting.

## 4. Current product baseline

Existing code has Plugin Manager, plugin manifests, direct community installation, MCP tool discovery, and a working stdio launch path. It also has desktop PKCE/loopback login primitives and an opt-in SecureStore. These are reusable building blocks, not a completed plugin connection system.

Missing capabilities include account lists/grants, strict plugin credential storage, multi-session provider authorization, account-aware tool invocation, a utility-process MCP transport, and enforcement of new manifest requirements. SSE remains unimplemented in the current MCP client. The hub's managed install-plan capabilities must not be assumed to work end to end in the desktop community installer.

## 5. User journeys

### Install and connect

1. User installs Drive from the supported source/catalog path.
2. Installation completes independently of authorization; plugin shows Setup required.
3. Detail opens on Accounts for a foreground user-initiated installation. Background/restored installations show a setup badge rather than unexpectedly opening pages.
4. User sees publisher, requested access, data-use explanation, and Connect Google account.
5. Clicking Connect opens the system browser. The app shows Waiting for browser with Cancel.
6. User completes provider consent and file selection as applicable.
7. App lists the account and tests permitted connectivity. Closing/reopening the detail page does not cancel an active main-process session.
8. User may defer setup; dependent tools remain unavailable without blocking unrelated plugins.

### Add and choose accounts

- Add account starts an independent authorization attempt with account selection.
- Reauthorizing the same provider account/client/tenant updates a compatible connection rather than creating an email-based duplicate.
- First account becomes the plugin default. Subsequent additions do not silently change it.
- Chat selection overrides the plugin default. A running invocation retains its original binding even if defaults change.
- If a selected connection disappears, prompt for another selection; never silently fall back to another account.
- Account labels appear in tool activity and approval cards. Defaults are scoped to the plugin and current AiFetchly user profile.

### Use Drive in chat

User asks: “Read the campaign brief and save a draft campaign plan to my marketing Drive.” The chat resolves the selected account, searches authorized files, presents source references, reads bounded content, generates an artifact, and requests authorization to upload it. The upload result includes its Drive link and account label.

If setup is missing, an app-owned Connect card opens the detail setup flow. The model must not request tokens in the conversation. Resuming after authorization revalidates the pending action, account, grant, and artifact; it does not blindly replay writes.

### Disconnect and reconnect

“Disconnect from this plugin” removes that plugin's grant. “Remove account from AiFetchly” affects all local bindings and explains the scope. Provider revocation is a separate explicit operation because it can affect other grants associated with the OAuth application. Local removal completes even if the network is unavailable; report provider-revocation failure honestly.

Expired access tokens normally refresh without interaction. Confirmed invalid/revoked credentials produce Reconnect required. Timeouts and rate limits produce transient errors without deleting the connection.

## 6. Functional requirements

| ID | Requirement | Acceptance evidence |
|---|---|---|
| PC-01 | Versioned declarative setup schema generates app-owned Accounts/Settings UI | Valid fixture renders; malformed/unsupported fixture is rejected |
| PC-02 | Foreground installation opens setup; Set up later is supported | Component and installation E2E tests |
| PC-03 | Browser authorization uses isolated, expiring, cancelable sessions | Concurrent, canceled, expired, replayed callback tests |
| PC-04 | Multiple accounts and stable identity deduplication | Two-account flow and same-account reconnect tests |
| PC-05 | Per-plugin grants and immutable per-call account selection | Cross-plugin and concurrent-account negative tests |
| PC-06 | Strict encrypted credential persistence; session-only fallback | OS-backend failure and restart tests |
| PC-07 | Renderer/plugin/model cannot read vault credentials through supported APIs | IPC/port contract tests and redaction checks |
| PC-08 | Central refresh, rotation, and recoverable failure states | Concurrent refresh and crash-recovery tests |
| PC-09 | AI gate and action policy apply at trusted execution boundary | Disabled AI, revoked grant, and write approval tests |
| PC-10 | Utility-process plugin runs without external Node | Packaged clean-machine acceptance |
| PC-11 | Disable, uninstall, profile switching, and source replacement invalidate access | Lifecycle race tests |
| PC-12 | Schema/runtime compatibility enforced before plugin launch | Unsupported-client install rejection |
| PC-13 | Six-language, accessible account/configuration UI | Component tests and localization key parity |
| PC-14 | Restricted, structured observability without secrets/content | Logging allowlist tests |
| GD-01 | Search/get/read files authorized to the connection | Fixture tests plus dedicated-account acceptance |
| GD-02 | Browser file selection grants access to existing files | Live selection then successful read |
| GD-03 | Create folder and upload approved artifact | Link returned; correct account and destination verified |
| GD-04 | Bounded content and pagination, explicit unsupported types | Limits and type matrix tests |
| GD-05 | Uncertain writes never automatically duplicate | Interrupted-write and retry tests |
| GD-06 | Built plugin is independently versioned and distributed by the hub | Actual release ZIP installation |

## 7. Drive access and tools

Default release-one access is selected/app-created files through `drive.file`. “Search Drive” must be described as searching files accessible to AiFetchly, not the entire account. Selecting a folder does not imply recursive authorization to every descendant. Broader search is a future separately reviewed access mode.

Use Google's supported browser file-selection flow to grant access. An in-app resource picker only selects already accessible resources; pasting an ID does not grant access. Validate the browser flow with the registered production desktop client before release. [Google Drive scope guidance](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)

| Tool | Initial behavior | Side-effect policy |
|---|---|---|
| search_files | Search accessible file metadata with bounded pagination | Existing chat read policy |
| get_file | Return metadata and source link | Existing chat read policy |
| read_file | Read text or export supported Google-native content | Existing chat read policy |
| create_folder | Create within an authorized destination | Request-scoped authorization |
| upload_file | Upload a host-approved artifact as a new file | Request-scoped authorization |

Initial read matrix: UTF-8 plain text/Markdown/CSV/JSON and Google Docs exported as text. Other binary files return metadata and an explicit unsupported-content response. PDFs, OCR, Sheets, Slides, shortcuts, shared drives, and large-file resumable transfers require follow-up coverage; do not advertise them based on MIME recognition alone.

No raw filesystem paths, arbitrary authenticated URLs, raw credentials, or unrestricted Google query language are accepted from the model. Uploads use host artifact references. Retrieved text is untrusted source material, not instructions granting new tool permissions.

## 8. Manifest and configuration expectations

Plugins declare logical connection slots, reviewed provider profile IDs, requested capabilities, multiple-account support, configuration fields, and per-tool connection bindings. Runtime account IDs and tokens never appear in published packages.

Application controls supply Connect/Reconnect/Disconnect/Default actions. Field labels support translation keys and English fallback text. Configuration values distinguish per-plugin and per-connection storage. Secret fields use a write-only credential submission path, not ordinary settings reads.

Capabilities express requested operations; they never constitute a grant. Host approval rules cannot be weakened by plugin configuration. New scopes or capabilities after update require review and authorization before affected tools become available.

## 9. Privacy, trust, and reliability

- Explain that chat processing may transmit selected document content to the configured AI provider. Do not suggest local OAuth implies local-only AI processing.
- Never send provider credentials or document bodies to plugin installation telemetry.
- No silent plaintext persistence when secure storage is unavailable. Offer explicit session-only connection; after restart show Connect again.
- Keep browser authorization and account configuration available without AI entitlement; executing AI functions requires the established AI-enabled check before request parsing/work.
- A trusted native-code plugin remains capable of local OS access. Release-one first-party review and explicit execution trust are required; the vault is not a malware boundary.
- Proposed limits: ten-minute auth sessions, five pending sessions/profile, fifty results/page, sixty-four KiB returned text, ten MiB downloaded text source, twenty MiB uploads, and bounded operation timeouts. Technical design specifies enforcement; load tests may justify changes before release.

## 10. Delivery stages and release gates

| Stage | Deliverable | Exit gate |
|---|---|---|
| 0 | SDK/manifest contract and Google OAuth/Picker spike | PKCE, file selection, account identity, refresh and production-client behavior demonstrated |
| 1 | Connection models, strict vault, provider sessions | PC-03 through PC-08 tests pass |
| 2 | Accounts UI and chat selection | PC-01, PC-02, PC-04, PC-09, PC-13 flows pass |
| 3 | Utility-process transport and host broker | No-Node packaged launch; account/grant boundaries verified |
| 4 | Separate Drive plugin and artifact packaging | GD-01 through GD-05 pass |
| 5 | Hub validation, compatibility, release ZIP | GD-06 and PC-10, PC-11, PC-12 pass on supported targets |

Release requires unit/contract tests, `yarn test:components`, relevant `yarn test:e2e` flows, all six translations, and live smoke tests with dedicated Google test accounts. Unit CI must not need real Google credentials. Verify actual packaged builds on Windows, macOS, and supported Linux configurations, including absent system Node and unavailable secure storage. Check distribution-channel eligibility for downloaded executable plugins separately for store builds.

## 11. Success measurement

Local diagnostics should distinguish install success, auth started/completed/canceled/timed out, ready state, and tool outcome using redacted codes. Proposed release targets: every supported clean-machine matrix passes; no cross-account or credential exposure failures; all replay and uncertain-write tests pass. Performance target: setup UI displays pending state within one second and local account lists load within two seconds on the agreed test machine, excluding provider/browser latency.

Do not invent production conversion targets before a baseline exists. Remote aggregate metrics are opt-in under existing telemetry policy and exclude account identities, filenames, queries, credentials, and document contents.

## 12. Decisions still requiring validation

1. Production Google project, desktop client configuration per platform, consent publication, and allowed use of data by the configured AI provider.
2. Browser Picker availability/behavior and stable account identity with the narrow scope; do not add identity scopes blindly to the Picker flow.
3. Desktop release number providing the new runtime and setup contract; it cannot be guessed from current app version.
4. SDK publishing namespace and plugin repository owner/license.
5. Exact OS/package/store distribution matrix and signing requirements.
6. Whether whole-Drive search is a later product requirement; currently excluded.

These are implementation/release gates, not permission to quietly broaden access or ship unsupported flows.
