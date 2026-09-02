/**
 * Managed-browser shared domain types (technical design §6).
 *
 * Transport-independent contracts used by the main process, the
 * managed-browser worker, IPC schemas, and AI tool schemas.
 *
 * HARD RULES
 *  - No Electron, DB, or renderer imports — this file must be loadable from
 *    every process (main, utility worker, tests).
 *  - No cookie-bearing type may appear here: renderer/LLM-facing shapes
 *    (`SafeManagedBrowser*`) carry only ids, states, counts, and reason codes.
 *  - Cookie values live exclusively in `src/schemas/worker/managedBrowser.ts`
 *    (START_SESSION / REFRESHED_COOKIES) and never cross to renderer types.
 */

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

/**
 * Authoritative worker-side session state (technical design §9).
 * The MAIN process remains the source of truth for renderer-visible state
 * because it also owns approval and worker-lifecycle knowledge.
 */
export type ManagedBrowserSessionState =
  | "starting"
  | "validating_fingerprint"
  | "applying_session"
  | "verifying_login"
  | "login_required"
  | "user_login_in_progress"
  | "verifying_manual_login"
  | "ready"
  | "running"
  | "awaiting_approval"
  | "challenge_detected"
  | "challenge_resolving"
  | "handoff"
  | "stopping"
  | "stopped"
  | "failed";

/** Host-enforced action risk classification (technical design §17.1). */
export type BrowserRiskClass =
  | "read"
  | "reversible_write"
  | "consequential_write"
  | "credential_or_security"
  | "local_data_delete"
  | "privileged_script";

/** Safe error codes returned to renderer/LLM (technical design §23). */
export type ManagedBrowserErrorCode =
  | "ai_disabled"
  | "managed_browser_disabled"
  | "account_not_found"
  | "account_in_use"
  | "global_session_limit"
  | "session_cookie_missing"
  | "browser_dependency_missing"
  | "browser_incompatible"
  | "fingerprint_mismatch"
  | "proxy_unavailable"
  | "navigation_blocked"
  | "authentication_required"
  | "challenge_requires_handoff"
  | "challenge_provider_not_authorized"
  | "challenge_provider_unavailable"
  | "challenge_provider_timeout"
  | "challenge_resolution_failed"
  | "stale_page_reference"
  | "action_not_allowed"
  | "approval_required"
  | "approval_expired"
  | "script_rejected"
  | "script_timeout"
  | "result_too_large"
  | "worker_protocol_violation"
  | "worker_start_timeout"
  | "worker_unresponsive"
  | "chrome_disconnected"
  | "worker_exited"
  | "cancelled"
  | "stop_timeout"
  | "cookie_refresh_failed"
  | "cookie_persistence_failed"
  | "cache_disabled"
  | "cache_incompatible"
  | "cache_scope_active"
  | "cache_clear_deferred"
  | "cache_path_invalid"
  | "cache_maintenance_failed"
  | "cache_limit_invalid"
  | "internal_error";

/** Bounded reason codes for user handoff (technical design §18). */
export type ManagedBrowserHandoffReason =
  | "login_required"
  | "login_expired"
  | "captcha_sensitive_flow"
  | "mfa_prompt"
  | "passkey_prompt"
  | "password_field"
  | "recovery_flow"
  | "account_selection_ambiguous"
  | "browser_permission_prompt"
  | "destructive_action_unclear"
  | "repeated_action_failure"
  | "user_requested"
  | "challenge_unresolved";

// ---------------------------------------------------------------------------
// Browser executable and fingerprint
// ---------------------------------------------------------------------------

/** Validated Chrome executable descriptor (technical design §10.1). */
export interface BrowserExecutableDescriptor {
  readonly path: string;
  readonly source: "managed" | "configured" | "system";
  readonly product: "chrome";
  readonly version: string;
  readonly majorVersion: number;
  readonly architecture: string;
}

/** Launch + page identity settings (technical design §11.1). */
export interface BrowserLaunchPolicy {
  readonly headless: false;
  readonly locale: string | null;
  readonly timezoneId: string | null;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly windowSize: { readonly width: number; readonly height: number };
  readonly userAgentOverride: string | null;
  readonly enabledStealthEvasions: readonly string[];
  readonly extraArgs: readonly string[];
}

/** Evidence collected from the local self-test page (technical design §11.2). */
export interface FingerprintSelfTestEvidence {
  readonly browserVersion: string;
  readonly browserMajor: number;
  readonly userAgent: string;
  readonly userAgentMajor: number | null;
  readonly platform: string;
  readonly language: string;
  readonly languages: readonly string[];
  readonly timezone: string;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly screen: { readonly width: number; readonly height: number };
  readonly webdriver: boolean | null;
}

/** Non-secret result of validating fingerprint evidence. */
export interface FingerprintValidationResult {
  readonly result: "pass" | "fail";
  readonly reasonCodes: readonly string[];
}

/** Bounded process identity for orphan cleanup (technical design §8.5). */
export interface ManagedBrowserProcessIdentity {
  readonly sessionId: string;
  readonly sessionNonce: string;
  readonly workerPid: number;
  readonly browserPid: number;
  readonly executableSha256: string;
  readonly executableVersion: string;
  readonly launchedAtEpochMs: number;
}

// ---------------------------------------------------------------------------
// Worker configuration payloads (main-derived; never renderer-visible)
// ---------------------------------------------------------------------------

/** Proxy contract fixed for the session lifetime (technical design §12.1). */
export type WorkerProxyConfig =
  | { readonly mode: "direct" }
  | {
      readonly mode: "http" | "https";
      readonly host: string;
      readonly port: number;
      readonly username?: string;
      readonly password?: string;
    };

/** Storage paths derived and validated by the main process (§13.4). */
export interface WorkerBrowserStoragePolicy {
  readonly temporaryProfilePath: string;
  readonly persistentCache:
    | { readonly enabled: false; readonly reasonCode: string }
    | {
        readonly enabled: true;
        readonly cachePath: string;
        readonly scopeToken: string;
        readonly namespace: string;
      };
}

/** Platform facts sent to the worker (from PlatformSessionManifest). */
export interface WorkerPlatformDefinition {
  readonly platformId: number;
  readonly platformName: string;
  readonly loginUrl: string;
  readonly verificationUrl: string;
  readonly allowedDomainSuffixes: readonly string[];
}

// ---------------------------------------------------------------------------
// Safe renderer/LLM status shapes
// ---------------------------------------------------------------------------

/** Renderer-safe session status. No cookies, paths, or secrets. */
export interface SafeManagedBrowserStatus {
  readonly sessionId: string;
  readonly accountId: number;
  readonly platformId: number;
  readonly state: ManagedBrowserSessionState;
  readonly currentOrigin: string | null;
  readonly pageTitle: string | null;
  readonly pageRevision: number;
  readonly authenticated: boolean | null;
  readonly handoffReason: ManagedBrowserHandoffReason | null;
  readonly lastErrorCode: ManagedBrowserErrorCode | null;
}

// ---------------------------------------------------------------------------
// AI Chat notices
// ---------------------------------------------------------------------------

export type BrowserChatNoticeType =
  | "login_required"
  | "login_verifying"
  | "login_verified"
  | "login_verification_failed"
  | "session_persistence_failed"
  | "challenge_detected"
  | "challenge_provider_started"
  | "challenge_resolved"
  | "challenge_failed"
  | "challenge_manual_action_required"
  | "task_resuming"
  | "browser_crashed"
  | "cache_clear_deferred"
  | "cache_clear_completed"
  | "cache_clear_failed";

/** Renderer-safe chat notice. The renderer localizes `messageKey`. */
export interface SafeBrowserChatNotice {
  readonly eventId: string;
  readonly sessionId: string;
  readonly type: BrowserChatNoticeType;
  readonly messageKey: string;
  readonly severity: "info" | "warning" | "success" | "error";
  readonly requiresUserAction: boolean;
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// Settings and cache
// ---------------------------------------------------------------------------

/** Effective, validated browser/cache preferences (technical design §7.4). */
export interface EffectiveManagedBrowserSettings {
  readonly browserEnabled: boolean;
  readonly cacheEnabled: boolean;
  readonly cacheMaxBytes: number;
  readonly clearCacheOnExit: boolean;
  readonly disabledReasonCode: string | null;
}

/** Renderer-safe cache status (approximate sizes only, no paths/URLs). */
export interface SafeManagedBrowserCacheStatus {
  readonly scope: "account" | "all";
  readonly accountId?: number;
  readonly approximateBytes: number;
  readonly lastClearedAt: string | null;
  readonly active: boolean;
  readonly pendingClear: boolean;
}

export interface SafeManagedBrowserCacheClearResult {
  readonly state: "cleared" | "empty" | "deferred" | "cancelled" | "failed";
  readonly scope: "account" | "all";
  readonly approximateDeletedBytes: number;
  readonly savedLoginSessionPreserved: true;
  readonly reasonCode: string | null;
}

// ---------------------------------------------------------------------------
// Observation model (technical design §14.1)
// ---------------------------------------------------------------------------

export interface BrowserElementSummary {
  readonly ref: string;
  readonly role: string;
  readonly name: string;
  readonly valueSummary?: string;
  readonly disabled: boolean;
  readonly checked?: boolean;
  readonly selected?: boolean;
  readonly hrefOrigin?: string;
}

/** Safe page notice attached to an observation (code-driven, never page text). */
export interface BrowserNotice {
  readonly code:
    | "untrusted_content"
    | "dialog_open"
    | "download_blocked"
    | "popup_blocked"
    | "sensitive_field_visible"
    | "truncated";
}

export interface BrowserObservation {
  readonly sessionId: string;
  readonly pageRevision: number;
  /** Sanitized URL: credentials stripped; query/fragment redacted. */
  readonly url: string;
  readonly origin: string;
  readonly title: string;
  readonly state: "ready" | "loading" | "dialog" | "handoff";
  readonly elements: readonly BrowserElementSummary[];
  readonly visibleText: string;
  readonly notices: readonly BrowserNotice[];
  readonly truncated: boolean;
}

// ---------------------------------------------------------------------------
// Challenge detection (detection only — never provider data)
// ---------------------------------------------------------------------------

export type BrowserChallengeKind =
  | "captcha_image"
  | "captcha_invisible"
  | "robot_verification"
  | "otp"
  | "passkey"
  | "password"
  | "recovery"
  | "ambiguous";

export interface ChallengeDetectionResult {
  readonly kind: BrowserChallengeKind;
  readonly evidenceCodes: readonly string[];
}

// ---------------------------------------------------------------------------
// Authentication assessment (worker adapter output, §13.2)
// ---------------------------------------------------------------------------

export type AuthenticationAssessment =
  | {
      readonly state: "authenticated";
      readonly evidenceCodes: readonly string[];
    }
  | {
      readonly state: "unauthenticated";
      readonly evidenceCodes: readonly string[];
    }
  | { readonly state: "challenge"; readonly challenge: BrowserChallengeKind }
  | { readonly state: "unknown"; readonly reasonCode: string };

export type ManualLoginVerificationResult =
  | { readonly state: "verified"; readonly evidenceCodes: readonly string[] }
  | { readonly state: "not_verified"; readonly reasonCode: string }
  | { readonly state: "challenge"; readonly challengeKind: BrowserChallengeKind }
  | { readonly state: "wrong_account"; readonly reasonCode: string };
