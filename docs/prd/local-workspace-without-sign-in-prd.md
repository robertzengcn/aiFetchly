# Local Workspace Without Sign-In — Product Requirements

- **Status:** Proposed | **Version:** 1.1 | **Updated:** 2026-11-25
- **Product:** AiFetchly Desktop | **Owner:** Desktop Engineering
- **Companion:** [Technical design](./local-workspace-without-sign-in-technical-design.md)

## 1. Problem and product decision

AiFetchly requires an account before users can reach most desktop features, even when work is stored on the device or runs against an AI provider the user pays for directly. Some saved credentials also depend on a backend-provided encryption key. Removing the login screen alone would leave those features broken or risk exposing the previously signed-in workspace.

Make **Local workspace** the default for fresh installations. It is permanent, not a trial or a temporary guest profile. AiFetchly sign-in remains optional and unlocks a separate account workspace and account-backed services. Email and social platforms may still require their own sign-in, token, or consent.

## 2. Scope and release sequence

| Capability | Phase 1: local chat | Phase 2: local credentials |
| --- | --- | --- |
| Local home, AI Provider settings, chat, history | Available without AiFetchly sign-in | Continues |
| User-configured AI endpoint and key | Available; key persistence depends on secure storage | Continues |
| Hosted AI, billing, sync, account-backed APIs | Account access and applicable entitlement required | Unchanged |
| Sign in later, switch workspaces, and recover an AiFetchly session | Available; no data transfer between workspaces | Continues |
| Email and social credentials | Not exposed in local mode | Supported connectors only: manual connect, verify, reconnect, and forget |
| Background email sending, social automation, scheduled jobs, agent integrations | Not enabled in local mode | Out of scope until independently reviewed and tested |

Also out of scope: automatic account data migration or merge, multiple local profiles, cross-device credential recovery, password-based vaults, and full-database encryption. Import/export is a separate decision. Do not intentionally restrict existing signed-in features.

## 3. Requirements and acceptance criteria

| ID | Requirement | Acceptance criteria |
| --- | --- | --- |
| LW-01 | Start without an account | A fresh install opens Local workspace without OAuth, an AiFetchly token, or an AiFetchly API response. The shell identifies the active workspace and offers an optional Sign in action. |
| LW-02 | Chat using a user-configured provider | With AiFetchly blocked and the chosen provider reachable, configure and test the provider, select a model, stream a response, and reopen history after restart. No hosted fallback or hosted billing occurs. Explain that prompts and selected attachments may be sent to the configured provider. |
| LW-03 | Separate local and account workspaces | Switching or signing out preserves the previous workspace. Histories, provider settings, credentials, and job results do not cross over. Expired sessions offer reauthentication or local use without exposing account data to local mode. |
| LW-04 | Keep account-only capabilities gated | The UI explains why a feature requires sign-in or entitlement. Main-process handlers deny direct calls that lack those permissions. A custom provider never grants hosted AI access. |
| LW-05 | Protect persisted credentials | Supported email passwords/tokens, social passwords, and saved cookie snapshots are protected at rest. With AiFetchly unreachable, each enabled connector can reuse saved credentials after restart. Secrets are not written in plaintext to app-controlled databases, settings, logs, or browser profiles. |
| LW-06 | Handle unavailable and locked storage | Non-secret data remains usable. Offer explicitly labeled session-only credentials only where the connector proves non-persistence. Otherwise disable credential entry or saving as appropriate. Retain locked ciphertext and provide Retry and explicit reconnect or reset options. |
| LW-07 | Let users forget credentials | Forget clears app-held credentials and browser session state for the selected connection without deleting unrelated records. Explain that this is not revocation at the external provider. |
| LW-08 | Preserve upgrades and local-only intent | Do not move, merge, or silently expose old account data. Do not silently adopt the old temporary database or a global provider key. Recovering access to non-secret local data never requires an AiFetchly account. |
| LW-09 | Explain encryption limits | Distinguish encrypted credentials from unencrypted chat history, messages, attachments, and other SQLite data. Copying a database alone does not restore saved credentials. Do not promise protection against a compromised device or OS account. |
| LW-10 | Let local users sign in later | Offer **Sign in to AiFetchly** in the workspace menu and at account-gated features. Keep the local workspace usable while the existing browser sign-in flow runs. Open the matching account workspace only after the app verifies the session and account and the destination is ready. Canceling or failing sign-in leaves the local workspace active. No local data is uploaded, copied, or merged by signing in. |
| LW-11 | Distinguish switching from signing out | **Switch to Local** stops account work and suspends refresh without intentionally clearing the saved session. Returning to the account workspace requires validating or refreshing that session first; if it cannot be restored, offer sign-in again or stay local. **Sign out** clears the saved AiFetchly session on this device and returns to Local workspace even if the backend is unavailable. Neither action deletes workspace data. |
| LW-12 | Refresh only the active AiFetchly session | Allow proactive and on-demand refresh for account-backed work, with one refresh in flight per authenticated session. While Local workspace is active, do not start background refresh; an explicit request to return to the account workspace may validate or refresh its session before switching. A third-party provider's authentication error never triggers AiFetchly refresh or sign-in. |
| LW-13 | Recover from refresh failures safely | A temporary network or backend failure does not sign the user out: report hosted services as temporarily unavailable, retry with backoff while the account workspace is active, and offer **Switch to Local**. An expired or definitively rejected refresh credential stops account-backed work and offers **Sign in again** or **Continue in Local workspace**. A refresh response from a prior workspace activation or signed-out session cannot restore or overwrite tokens, reopen a workspace, or restart account work. |

## 4. User flows

- **First run:** Open Local workspace → set up AI Provider → test connection and select a model → send first message. Provider failures keep the user in setup and explain the provider-side problem, not an AiFetchly login requirement.
- **Connect an external account:** Enter credentials or sign in at the external service → verify → show whether credentials will survive restart. Never display a saved password or cookie value on readback.
- **Use AiFetchly services after starting locally:** Choose **Sign in to AiFetchly** from the workspace menu or a hosted feature → finish browser sign-in → open the verified account workspace. Show the destination and warn if switching will stop active work. Don't automatically replay an action started before sign-in; let the user confirm it in the account workspace.
- **Return to Local workspace:** Choose **Switch to Local** to stop account work while keeping the saved session for a possible return, or **Sign out** to clear the session. Local chat history and settings reappear unchanged. Reopening the account workspace never imports that local history.
- **Recover:** Distinguish a retryable OS unlock failure from missing or unreadable key material. Before an explicit reset, show which credentials will be cleared and what must be reconnected. Preserve chats, non-secret connector metadata, and signed-in workspaces.
- **Internationalization:** Ship onboarding, gated states, storage errors, recovery, and confirmation text in English, Chinese, Spanish, French, German, and Japanese. Cover the main flows in component and end-to-end tests.

## 5. Account session behavior

| Situation | Expected outcome |
| --- | --- |
| Local workspace, with or without a saved AiFetchly session | No background refresh or account jobs. The user can keep using their configured provider during an AiFetchly outage. A rejected provider key is reported as a provider error. |
| Account access token is nearing expiry or an AiFetchly request returns an authentication failure that can be refreshed | Refresh proactively or on demand for the same session. Concurrent requests share the refresh. On success, retry an affected request at most once and only when replay is safe; don't duplicate sends or other side effects. |
| Offline, timed out, or temporary server failure | Keep the saved session. If the access token is no longer usable, pause operations that require it until recovery. Stop background retries after switching to Local. |
| Refresh credential is expired, revoked, or conclusively rejected | Block account-backed operations and present recovery choices. Signing back in to the same account reopens the existing account workspace. Signing in to a different account does not expose the original workspace. |
| User signs out, switches to Local, or changes accounts during refresh | A late response cannot reactivate the old session or affect the destination. If refresh-token rotation makes the retained session unusable after a switch to Local, require sign-in again on return rather than assuming the old token still works. |

## 6. Release gates and pilot measures

- **Phase 1:** Pass fresh-install, restart, existing-account upgrade, direct-IPC authorization, and profile-switch tests. The local chat acceptance flow records no AiFetchly requests, including startup and provider error paths.
- **Phase 1 session gate:** Start and save a local chat; cancel sign-in once, then successfully sign in without moving local data. Verify concurrent refresh requests share one operation, temporary failures preserve the session, and definitive rejection requires reauthentication. Exercise both **Switch to Local** and **Sign out** with a refresh delayed until after the transition; verify the stale result cannot restore credentials or start jobs and the original local chat is still present. Verify returning to the account works only after session validation, and a third-party provider `401` never reaches AiFetchly refresh.
- **Phase 2:** Pass restart, cross-workspace isolation, weak/locked storage, missing-key recovery, and forget tests for each enabled connector and OS configuration. Leave capabilities disabled where coverage is incomplete.
- **Pilot:** Assess first-chat completion, provider setup failure categories, vault unavailability, and profile-switch failures. Any telemetry must be opt-in, coarse, and independent of local startup. Exclude identifying data, credentials, prompts, provider URLs, and cookie content.
- **Before general availability:** Confirm the supported connector and OS matrix, the retention policy for old temporary data, and the recovery copy. Disable incomplete capabilities individually rather than restoring a blanket login gate.
