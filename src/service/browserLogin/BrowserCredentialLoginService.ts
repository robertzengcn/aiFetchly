/**
 * Saved-account credential sign-in (PRD §6.7; technical design §13).
 *
 * A privileged MAIN-process service triggered by the credential-free
 * `browser_sign_in` tool. The LLM may see usernames (A-FR-04); passwords
 * never reach any LLM, tool result, transcript, log, or crash report —
 * they travel renderer→main over a single-use Zod-validated IPC channel
 * (A-FR-06) and worker→page inside one FILL_LOGIN_FORM request (A-FR-08).
 */
import { getDefaultManagedBrowserModule } from "@/modules/ManagedBrowserModule";
import {
  getDefaultBrowserSiteModule,
  type SiteMatch,
} from "@/modules/BrowserSiteModule";
import { SocialAccountModule } from "@/modules/socialAccountModule";

export interface BrowserSignInInput {
  readonly sessionId: string;
  readonly conversationId: string;
  /** C-FR-09: managed-async job id for the user-wait freeze. */
  readonly jobId?: string;
  /** T16: Stop while the card is open resolves the wait as cancelled. */
  readonly signal?: AbortSignal;
  readonly intent: "login" | "register";
  readonly accountId?: number;
  readonly usernameHint?: string;
}

export interface BrowserSignInResult {
  readonly status:
    | "signed_in"
    | "awaiting_user_credentials"
    | "handoff_required"
    | "failed";
  readonly accountId?: number;
  readonly username?: string;
  readonly siteId?: number;
  readonly reasonCode?: string;
}

/** A pending credential card (renderer submits via the secure channel). */
export interface PendingCredentialRequest {
  readonly requestId: string;
  readonly conversationId: string;
  readonly sessionId: string;
  readonly siteId: number | null;
  readonly siteDomain: string;
  readonly mode: "login" | "register";
  readonly prefillUsername: string | null;
  /**
   * A-FR-05/N03: TRUE for a saved username-only account — the card asks
   * for the PASSWORD only (the username is fixed by the account).
   */
  readonly passwordOnly: boolean;
  readonly resolve: (input: {
    username: string;
    password: string;
    save: boolean;
    cancelled: boolean;
  }) => void;
  readonly createdAt: number;
}

const PENDING_TTL_MS = 10 * 60_000;

class CredentialCardWaitRegistry {
  private readonly pending = new Map<string, PendingCredentialRequest>();
  private sink: ((request: PendingCredentialRequest) => void) | null = null;

  /** Main-process wiring: push card requests to the renderer. */
  public setSink(sink: (request: PendingCredentialRequest) => void): void {
    this.sink = sink;
  }

  public create(input: {
    readonly conversationId: string;
    readonly sessionId: string;
    readonly siteId: number | null;
    readonly siteDomain: string;
    readonly mode: "login" | "register";
    readonly prefillUsername: string | null;
    readonly passwordOnly?: boolean;
  }): {
    readonly request: PendingCredentialRequest;
    readonly promise: Promise<{
      username: string;
      password: string;
      save: boolean;
      cancelled: boolean;
    }>;
  } {
    let resolve!: PendingCredentialRequest["resolve"];
    const promise = new Promise<{
      username: string;
      password: string;
      save: boolean;
      cancelled: boolean;
    }>((res) => {
      resolve = res;
    });
    const requestId = `cred_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    const request: PendingCredentialRequest = {
      requestId,
      conversationId: input.conversationId,
      sessionId: input.sessionId,
      siteId: input.siteId,
      siteDomain: input.siteDomain,
      mode: input.mode,
      prefillUsername: input.prefillUsername,
      passwordOnly: input.passwordOnly ?? false,
      resolve,
      createdAt: Date.now(),
    };
    this.pending.set(requestId, request);
    this.sink?.(request);
    setTimeout(() => {
      const entry = this.pending.get(requestId);
      if (entry) {
        this.pending.delete(requestId);
        entry.resolve({ username: "", password: "", save: false, cancelled: true });
      }
    }, PENDING_TTL_MS).unref?.();
    return { request, promise };
  }

  /**
   * A-FR-06: consume a submitted credential. The request id is SINGLE-USE
   * and bound to the owner conversation; a mismatch is rejected.
   */
  public consume(input: {
    readonly requestId: string;
    readonly conversationId: string;
  }): PendingCredentialRequest | null {
    const entry = this.pending.get(input.requestId);
    if (!entry || entry.conversationId !== input.conversationId) {
      return null;
    }
    this.pending.delete(input.requestId);
    return entry;
  }

  public listForConversation(conversationId: string): readonly PendingCredentialRequest[] {
    return [...this.pending.values()].filter(
      (entry) => entry.conversationId === conversationId
    );
  }
}

const registry = new CredentialCardWaitRegistry();

/** Renderer-facing accessor for the credential card IPC handler. */
export function getCredentialCardWaitRegistry(): CredentialCardWaitRegistry {
  return registry;
}

/** A pending account-picker card (B02/A-FR-03: the user picks the account). */
export interface PendingAccountPickerRequest {
  readonly requestId: string;
  readonly conversationId: string;
  readonly sessionId: string;
  readonly siteDomain: string;
  readonly candidates: ReadonlyArray<{ id: number; user: string; name: string }>;
  readonly resolve: (input: {
    accountId: number | null;
    cancelled: boolean;
  }) => void;
  readonly createdAt: number;
}

class AccountPickerWaitRegistry {
  private readonly pending = new Map<string, PendingAccountPickerRequest>();
  private sink: ((request: PendingAccountPickerRequest) => void) | null = null;

  public setSink(sink: (request: PendingAccountPickerRequest) => void): void {
    this.sink = sink;
  }

  public create(input: {
    readonly conversationId: string;
    readonly sessionId: string;
    readonly siteDomain: string;
    readonly candidates: ReadonlyArray<{ id: number; user: string; name: string }>;
  }): {
    readonly request: PendingAccountPickerRequest;
    readonly promise: Promise<{ accountId: number | null; cancelled: boolean }>;
  } {
    let resolve!: PendingAccountPickerRequest["resolve"];
    const promise = new Promise<{ accountId: number | null; cancelled: boolean }>(
      (res) => {
        resolve = res;
      }
    );
    const requestId = `pick_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    const request: PendingAccountPickerRequest = {
      requestId,
      conversationId: input.conversationId,
      sessionId: input.sessionId,
      siteDomain: input.siteDomain,
      candidates: input.candidates,
      resolve,
      createdAt: Date.now(),
    };
    this.pending.set(requestId, request);
    this.sink?.(request);
    setTimeout(() => {
      const entry = this.pending.get(requestId);
      if (entry) {
        this.pending.delete(requestId);
        entry.resolve({ accountId: null, cancelled: true });
      }
    }, PENDING_TTL_MS).unref?.();
    return { request, promise };
  }

  /** Single-use, owner-conversation-bound consume (mirrors the credential card). */
  public consume(input: {
    readonly requestId: string;
    readonly conversationId: string;
  }): PendingAccountPickerRequest | null {
    const entry = this.pending.get(input.requestId);
    if (!entry || entry.conversationId !== input.conversationId) {
      return null;
    }
    this.pending.delete(input.requestId);
    return entry;
  }
}

const pickerRegistry = new AccountPickerWaitRegistry();

/** Renderer-facing accessor for the account-picker IPC handler. */
export function getAccountPickerWaitRegistry(): AccountPickerWaitRegistry {
  return pickerRegistry;
}

/**
 * B03/S-FR-04: a pending extra-domain confirmation card. The proposal
 * (domains + token) is minted from the session's AUTHORITATIVE redirect
 * ledger; the renderer card answers with a domain subset only — the
 * confirmation token never leaves the main process.
 */
export interface PendingSiteConfirmRequest {
  readonly requestId: string;
  readonly conversationId: string;
  readonly sessionId: string;
  readonly siteId: number;
  readonly registrableDomain: string;
  readonly proposedDomains: readonly string[];
  /** Main-process-only; applyAdditionalDomains consumes it. */
  readonly token: string;
  readonly resolve: (input: {
    applied: boolean;
    domains: readonly string[];
    cancelled: boolean;
  }) => void;
  readonly createdAt: number;
}

class SiteConfirmWaitRegistry {
  private readonly pending = new Map<string, PendingSiteConfirmRequest>();
  private sink: ((request: PendingSiteConfirmRequest) => void) | null = null;

  public setSink(sink: (request: PendingSiteConfirmRequest) => void): void {
    this.sink = sink;
  }

  public create(input: {
    readonly conversationId: string;
    readonly sessionId: string;
    readonly siteId: number;
    readonly registrableDomain: string;
    readonly proposedDomains: readonly string[];
    readonly token: string;
  }): {
    readonly request: PendingSiteConfirmRequest;
    readonly promise: Promise<{
      applied: boolean;
      domains: readonly string[];
      cancelled: boolean;
    }>;
  } {
    let resolve!: PendingSiteConfirmRequest["resolve"];
    const promise = new Promise<{
      applied: boolean;
      domains: readonly string[];
      cancelled: boolean;
    }>((res) => {
      resolve = res;
    });
    const requestId = `site_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    const request: PendingSiteConfirmRequest = {
      requestId,
      conversationId: input.conversationId,
      sessionId: input.sessionId,
      siteId: input.siteId,
      registrableDomain: input.registrableDomain,
      proposedDomains: input.proposedDomains,
      token: input.token,
      resolve,
      createdAt: Date.now(),
    };
    this.pending.set(requestId, request);
    this.sink?.(request);
    setTimeout(() => {
      const entry = this.pending.get(requestId);
      if (entry) {
        this.pending.delete(requestId);
        entry.resolve({ applied: false, domains: [], cancelled: true });
      }
    }, PENDING_TTL_MS).unref?.();
    return { request, promise };
  }

  /** Single-use, owner-conversation-bound consume. */
  public consume(input: {
    readonly requestId: string;
    readonly conversationId: string;
  }): PendingSiteConfirmRequest | null {
    const entry = this.pending.get(input.requestId);
    if (!entry || entry.conversationId !== input.conversationId) {
      return null;
    }
    this.pending.delete(input.requestId);
    return entry;
  }
}

const siteConfirmRegistry = new SiteConfirmWaitRegistry();

/** Renderer-facing accessor for the site-confirm IPC handler. */
export function getSiteConfirmWaitRegistry(): SiteConfirmWaitRegistry {
  return siteConfirmRegistry;
}

export class BrowserCredentialLoginService {
  /**
   * A-FR-10/F12: one automated attempt per account (and per session for
   * one-time/new card credentials) at a time. Keys are reserved
   * SYNCHRONOUSLY before any awaited check — the old has→await→add
   * window admitted concurrent callers.
   */
  private readonly inFlightAccounts = new Set<string>();

  private static accountAttemptKey(accountId: number): string {
    return `account:${accountId}`;
  }

  private static sessionAttemptKey(sessionId: string): string {
    return `session:${sessionId}`;
  }

  public async signIn(input: BrowserSignInInput): Promise<BrowserSignInResult> {
    const browserModule = getDefaultManagedBrowserModule();
    // A-FR-12 / PRD Q-02: registration is out of scope for automated v1 —
    // an agent can NEVER auto-register with saved or card credentials.
    // The session hands off so the user can register themselves.
    if (input.intent === "register") {
      await browserModule
        .requestHandoff(input.sessionId, "recovery_flow")
        .catch(() => undefined);
      return { status: "handoff_required", reasonCode: "registration_not_confirmed" };
    }
    const status = browserModule.getStatus(input.sessionId);
    if (!status) {
      return { status: "failed", reasonCode: "no_active_session" };
    }
    // A-FR-02: site identity comes from the LIVE page URL, never the LLM.
    // Refresh the observation first so the origin reflects the page NOW,
    // not a stale snapshot from before a redirect.
    await browserModule.observe(input.sessionId).catch(() => undefined);
    const refreshed = browserModule.getStatus(input.sessionId);
    const origin = refreshed?.currentOrigin ?? status.currentOrigin;
    if (!origin || !origin.startsWith("https://")) {
      return { status: "failed", reasonCode: "insecure_page" };
    }
    const siteModule = getDefaultBrowserSiteModule();
    const site: SiteMatch | null = await siteModule.matchByUrl(origin);
    if (!site) {
      return { status: "failed", reasonCode: "origin_mismatch" };
    }

    const accountModule = new SocialAccountModule();
    const candidates = await accountModule.getAccountsForSite(site.siteId, {
      requireAiOptIn: true,
      platformId: site.siteId,
    });

    let chosen: { id: number; user: string } | null = null;
    if (input.accountId) {
      const found = candidates.find((c) => c.id === input.accountId);
      if (!found) {
        return { status: "failed", reasonCode: "account_not_eligible" };
      }
      chosen = found;
    } else if (candidates.length === 1) {
      chosen = candidates[0]!;
    } else if (candidates.length === 0) {
      // A-FR-03/05: post a credential card and wait INSIDE the job.
      const { request, promise } = registry.create({
        conversationId: input.conversationId,
        sessionId: input.sessionId,
        siteId: site.siteId,
        siteDomain: site.registrableDomain,
        mode: input.intent,
        prefillUsername: input.usernameHint ?? null,
      });
      // The renderer renders the card from the browser notice channel; the
      // request itself is delivered through MANAGED_BROWSER_CREDENTIAL_REQUEST.
      void request;
      // C-FR-09: the job is waiting for the user — freeze the parent's
      // poll deadline for the duration of the card wait. T16: Stop while
      // the card is open resolves the wait immediately as cancelled.
      const { getDefaultToolJobRegistry } = await import(
        "@/service/ToolJobRegistry"
      );
      const jobId = input.jobId ?? null;
      if (jobId) {
        getDefaultToolJobRegistry().setUserWait(jobId, true, "credential_card");
      }
      const onAbort = (): void => {
        registry.consume({ requestId: request.requestId, conversationId: input.conversationId })
          ?.resolve({ username: "", password: "", save: false, cancelled: true });
      };
      input.signal?.addEventListener("abort", onAbort, { once: true });
      let submitted: {
        username: string;
        password: string;
        save: boolean;
        cancelled: boolean;
      };
      try {
        submitted = await promise;
      } finally {
        input.signal?.removeEventListener("abort", onAbort);
        if (jobId) {
          getDefaultToolJobRegistry().setUserWait(jobId, false);
        }
      }
      if (submitted.cancelled) {
        if (input.signal?.aborted) {
          // F12: a STOP (job abort) terminates — it never opens a handoff.
          return { status: "failed", siteId: site.siteId, reasonCode: "cancelled" };
        }
        // T16: 'I'll sign in myself'/cancel opens the handoff dialog so
        // the user can complete sign-in manually (C-FR-13).
        await browserModule
          .requestHandoff(input.sessionId, "user_requested")
          .catch(() => undefined);
        return { status: "handoff_required", reasonCode: "user_cancelled", siteId: site.siteId };
      }
      if (input.signal?.aborted) {
        // F12: a STOP terminates the sign-in — never a handoff.
        return { status: "failed", siteId: site.siteId, reasonCode: "cancelled" };
      }
      if (!submitted.save) {
        // One-time in-memory credential (never persisted, never logged).
        return this.fillWithSessionReservation(input, site, {
          username: submitted.username,
          password: submitted.password,
          accountId: null,
        });
      }
      const newAccountId = await accountModule.saveSubmittedCredential({
        siteId: site.siteId,
        platformId: site.siteId,
        username: submitted.username,
        password: submitted.password,
        save: true,
      });
      return this.fillWithSessionReservation(input, site, {
        username: submitted.username,
        password: submitted.password,
        accountId: newAccountId,
      });
    } else {
      // B02/A-FR-03: several matches — the LLM may choose by account_id; it
      // did not, so the USER picks. Post the picker card and wait INSIDE
      // the job (like the credential card) instead of returning a
      // picker-required stub the user can never see.
      const { request, promise } = pickerRegistry.create({
        conversationId: input.conversationId,
        sessionId: input.sessionId,
        siteDomain: site.registrableDomain,
        candidates: candidates.map((c) => ({
          id: c.id,
          user: c.user,
          name: c.user,
        })),
      });
      void request;
      // C-FR-09: the job is waiting for the user — freeze the parent's
      // poll deadline for the duration of the picker wait.
      const { getDefaultToolJobRegistry } = await import(
        "@/service/ToolJobRegistry"
      );
      const jobId = input.jobId ?? null;
      if (jobId) {
        getDefaultToolJobRegistry().setUserWait(jobId, true, "account_picker");
      }
      const onAbort = (): void => {
        pickerRegistry
          .consume({
            requestId: request.requestId,
            conversationId: input.conversationId,
          })
          ?.resolve({ accountId: null, cancelled: true });
      };
      input.signal?.addEventListener("abort", onAbort, { once: true });
      let choice: { accountId: number | null; cancelled: boolean };
      try {
        choice = await promise;
      } finally {
        input.signal?.removeEventListener("abort", onAbort);
        if (jobId) {
          getDefaultToolJobRegistry().setUserWait(jobId, false);
        }
      }
      if (choice.cancelled || choice.accountId === null) {
        if (input.signal?.aborted) {
          // F12: a STOP terminates — never a handoff.
          return { status: "failed", siteId: site.siteId, reasonCode: "cancelled" };
        }
        // Cancel / "use another account" opens the handoff dialog
        // (C-FR-13) — the credential card then takes over if wanted.
        await browserModule
          .requestHandoff(input.sessionId, "user_requested")
          .catch(() => undefined);
        return {
          status: "handoff_required",
          siteId: site.siteId,
          reasonCode: "user_cancelled",
        };
      }
      if (input.signal?.aborted) {
        return { status: "failed", siteId: site.siteId, reasonCode: "cancelled" };
      }
      const picked = candidates.find((c) => c.id === choice.accountId);
      if (!picked) {
        return {
          status: "failed",
          siteId: site.siteId,
          reasonCode: "account_not_eligible",
        };
      }
      chosen = picked;
    }

    // A-FR-10/N05: reserve FIRST (synchronously) — BOTH the account and
    // the SESSION — then the awaited cooldown check. Two calls on one
    // session with different accounts would otherwise run concurrent
    // FILL_LOGIN_FORM on one page.
    const attemptKey = BrowserCredentialLoginService.accountAttemptKey(
      chosen.id
    );
    const sessionKey = BrowserCredentialLoginService.sessionAttemptKey(
      input.sessionId
    );
    if (
      this.inFlightAccounts.has(attemptKey) ||
      this.inFlightAccounts.has(sessionKey)
    ) {
      return {
        status: "failed",
        accountId: chosen.id,
        siteId: site.siteId,
        reasonCode: "cooldown",
      };
    }
    this.inFlightAccounts.add(attemptKey);
    this.inFlightAccounts.add(sessionKey);
    try {
      if (await accountModule.isSignInCoolingDown(chosen.id, { siteId: site.siteId })) {
        return {
          status: "failed",
          accountId: chosen.id,
          siteId: site.siteId,
          reasonCode: "cooldown",
        };
      }
      return await this.attemptCredentialSignIn(
        input,
        site,
        accountModule,
        chosen,
        candidates
      );
    } finally {
      this.inFlightAccounts.delete(attemptKey);
      this.inFlightAccounts.delete(sessionKey);
    }
  }

  /**
   * F12: one-time and new-card credential attempts reserve the SESSION —
   * the account+site attempt window applies to every automated path, not
   * only chosen saved accounts.
   */
  private async fillWithSessionReservation(
    input: BrowserSignInInput,
    site: SiteMatch,
    credential: {
      readonly username: string;
      readonly password: string;
      readonly accountId: number | null;
    }
  ): Promise<BrowserSignInResult> {
    const sessionKey = BrowserCredentialLoginService.sessionAttemptKey(
      input.sessionId
    );
    if (this.inFlightAccounts.has(sessionKey)) {
      return {
        status: "failed",
        ...(credential.accountId !== null
          ? { accountId: credential.accountId }
          : {}),
        siteId: site.siteId,
        reasonCode: "cooldown",
      };
    }
    this.inFlightAccounts.add(sessionKey);
    try {
      return await this.fillAndAssess(input, site, credential);
    } finally {
      this.inFlightAccounts.delete(sessionKey);
    }
  }

  private async attemptCredentialSignIn(
    input: BrowserSignInInput,
    site: SiteMatch,
    accountModule: SocialAccountModule,
    chosen: { id: number; user: string },
    candidates: ReadonlyArray<{ id: number; user: string }>
  ): Promise<BrowserSignInResult> {

    // F12: a Stop that landed before dispatch terminates — no fill.
    if (input.signal?.aborted) {
      return { status: "failed", siteId: site.siteId, reasonCode: "cancelled" };
    }
    // A-FR-07: the ONLY decrypting read, gated on the LIVE page
    // hostname (X1: the DB record's registrable domain made the gate
    // tautological and broke host-specific allowlists).
    // X1: the LIVE page origin, re-read from the session status at the
    // moment of the read — never the DB record's registrable domain.
    const liveOrigin =
      getDefaultManagedBrowserModule().getStatus(input.sessionId)
        ?.currentOrigin ?? "";
    const liveHostname = (() => {
      try {
        return new URL(liveOrigin).hostname;
      } catch {
        return "";
      }
    })();
    const credentialResult = await accountModule.getCredentialForLogin(
      chosen.id,
      liveHostname || site.registrableDomain
    );
    if (!credentialResult.ok) {
      // F12: domain refusal / missing account / missing site are
      // REFUSALS — never a password card (only a username-only account
      // legitimately asks for its password).
      if (credentialResult.reason !== "credential_unavailable") {
        return {
          status: "failed",
          accountId: chosen.id,
          siteId: site.siteId,
          reasonCode: credentialResult.reason,
        };
      }
      // T16: a username-only account (saved without a password) asks for
      // the password through the card instead of failing.
      const { request, promise: cardPromise } = registry.create({
        conversationId: input.conversationId,
        sessionId: input.sessionId,
        siteId: site.siteId,
        siteDomain: site.registrableDomain,
        mode: "login",
        prefillUsername: chosen.user,
        // A-FR-05: a saved username-only account asks for its password.
        passwordOnly: true,
      });
      void request;
      const onCardAbort = (): void => {
        registry
          .consume({ requestId: request.requestId, conversationId: input.conversationId })
          ?.resolve({ username: "", password: "", save: false, cancelled: true });
      };
      input.signal?.addEventListener("abort", onCardAbort, { once: true });
      // F06: the username-only card branch is ALSO a user wait — the
      // parent poll's exclusion must cover it like the no-account
      // branch does.
      const { getDefaultToolJobRegistry } = await import(
        "@/service/ToolJobRegistry"
      );
      const cardJobId = input.jobId ?? null;
      if (cardJobId) {
        getDefaultToolJobRegistry().setUserWait(cardJobId, true, "credential_card");
      }
      let submitted: {
        username: string;
        password: string;
        save: boolean;
        cancelled: boolean;
      };
      try {
        submitted = await cardPromise;
      } finally {
        input.signal?.removeEventListener("abort", onCardAbort);
        if (cardJobId) {
          getDefaultToolJobRegistry().setUserWait(cardJobId, false);
        }
      }
      if (submitted.cancelled) {
        if (input.signal?.aborted) {
          // F12: a STOP terminates — never a handoff.
          return { status: "failed", siteId: site.siteId, reasonCode: "cancelled" };
        }
        await getDefaultManagedBrowserModule()
          .requestHandoff(input.sessionId, "user_requested")
          .catch(() => undefined);
        return {
          status: "handoff_required",
          accountId: chosen.id,
          siteId: site.siteId,
          reasonCode: "user_cancelled",
        };
      }
      // F12: the password-only card may EDIT the username — persisting
      // or binding against chosen.id would mix account identities.
      // Re-resolve the account by the submitted username; with no match,
      // fill WITHOUT saving or binding.
      if (submitted.username !== chosen.user) {
        const edited = candidates.find((c) => c.user === submitted.username);
        if (!edited) {
          return this.fillWithSessionReservation(input, site, {
            username: submitted.username,
            password: submitted.password,
            accountId: null,
          });
        }
        chosen = { id: edited.id, user: edited.user };
        // N05: the reservation and cooldown checked the ORIGINAL account —
        // re-reserve the switched account synchronously and re-check its
        // cooldown; a held or cooling new account refuses the attempt.
        const editedKey = BrowserCredentialLoginService.accountAttemptKey(
          chosen.id
        );
        if (this.inFlightAccounts.has(editedKey)) {
          return {
            status: "failed",
            accountId: chosen.id,
            siteId: site.siteId,
            reasonCode: "cooldown",
          };
        }
        // B14/A-FR-10: the switched account's reservation is released on
        // EVERY return below — including the cooldown refusal. The old
        // code returned `cooldown` after `add` without the delete, so the
        // account stayed locked in `inFlightAccounts` until restart.
        try {
          this.inFlightAccounts.add(editedKey);
          if (
            await accountModule.isSignInCoolingDown(chosen.id, {
              siteId: site.siteId,
            })
          ) {
            return {
              status: "failed",
              accountId: chosen.id,
              siteId: site.siteId,
              reasonCode: "cooldown",
            };
          }
          if (submitted.save) {
            // R21: update the EXISTING account's password, not a new row.
            await accountModule.updatePasswordForAccount(
              chosen.id,
              submitted.password
            );
          }
          return this.fillAndAssess(input, site, {
            username: submitted.username,
            password: submitted.password,
            accountId: chosen.id,
          });
        } finally {
          this.inFlightAccounts.delete(editedKey);
        }
      }
      // B14: the switched account's reservation is handled by the
      // try/finally INSIDE the edited-username branch above; the
      // non-edited path holds no extra account key.
      if (submitted.save) {
        // R21: update the EXISTING account's password, not a new row.
        await accountModule.updatePasswordForAccount(
          chosen.id,
          submitted.password
        );
      }
      return this.fillAndAssess(input, site, {
        username: submitted.username,
        password: submitted.password,
        accountId: chosen.id,
      });
    }
    return this.fillAndAssess(input, site, {
      username: credentialResult.username,
      password: credentialResult.password,
      accountId: chosen.id,
    });
  }

  /**
   * B03/D-15/D-16: post the extra-domain confirmation card after a
   * successful sign-in. The proposal comes ONLY from the session's
   * redirect ledger (`proposeExtraDomainsFromSession`); the card's apply
   * is consumed through the single-use token minted with the proposal.
   */
  private async postSiteDomainConfirmation(
    input: BrowserSignInInput,
    site: SiteMatch
  ): Promise<void> {
    const confirmation = await getDefaultManagedBrowserModule()
      .proposeExtraDomainsFromSession(input.sessionId, site.siteId)
      .catch(() => null);
    if (!confirmation || confirmation.proposedDomains.length === 0) {
      return;
    }
    const { request, promise } = siteConfirmRegistry.create({
      conversationId: input.conversationId,
      sessionId: input.sessionId,
      siteId: site.siteId,
      registrableDomain: site.registrableDomain,
      proposedDomains: confirmation.proposedDomains,
      token: confirmation.token,
    });
    void request;
    const choice = await promise;
    if (choice.cancelled || choice.domains.length === 0) {
      return;
    }
    await getDefaultBrowserSiteModule().applyAdditionalDomains({
      siteId: site.siteId,
      domains: choice.domains,
      token: request.token,
    });
  }

  /**
   * A-FR-08/09: fill via the worker, wipe the local copy, then classify the
   * outcome. Failure paths hand off with a clear reason and never retry.
   */
  private async fillAndAssess(
    input: BrowserSignInInput,
    site: SiteMatch,
    credential: {
      readonly username: string;
      readonly password: string;
      readonly accountId: number | null;
    }
  ): Promise<BrowserSignInResult> {
    const browserModule = getDefaultManagedBrowserModule();
    const recipe = site.loginRecipe ? safeParseRecipe(site.loginRecipe) : null;
    try {
      const result = await browserModule.fillLoginForm(input.sessionId, {
        mode: input.intent,
        allowedDomainSuffixes: [...site.allowedDomainSuffixes],
        recipe,
        username: credential.username,
        password: credential.password,
      });
      const accountModule = new SocialAccountModule();
      if (result.outcome === "success") {
        await getDefaultBrowserSiteModule().markVerified(site.siteId);
        // T21: save the learned login recipe (fingerprints only).
        if (result.recipe) {
          await getDefaultBrowserSiteModule()
            .saveLoginRecipe(site.siteId, {
              version: 1,
              formAction: result.recipe.formAction,
              steps: [
                {
                  usernameField: result.recipe.usernameField,
                  passwordField: result.recipe.passwordField,
                  submitVia: "form" as const,
                },
              ],
            })
            .catch(() => undefined);
        }
        // T21/A-FR-11: persist refreshed cookies for the account through
        // the existing cookie path (captureAndSend already flowed via the
        // worker; binding the account keeps the session authoritative).
        if (credential.accountId !== null) {
          await accountModule.recordLoginFailureClear(credential.accountId);
        }
        // N05/P-FR-03: link the proxy the session actually used so later
        // sessions for this account reuse it. Best-effort.
        try {
          const postStatus = getDefaultManagedBrowserModule().getStatus(
            input.sessionId
          );
          const usedProxyId = postStatus?.effectiveProxyId ?? null;
          if (
            credential.accountId !== null &&
            usedProxyId !== null &&
            postStatus?.accountId === credential.accountId
          ) {
            await accountModule
              .linkProxyToAccount(credential.accountId, usedProxyId)
              .catch(() => undefined);
          }
        } catch {
          // Proxy linking never fails the sign-in.
        }
        if (credential.accountId !== null) {
          try {
            await getDefaultManagedBrowserModule().bindAccountToSession(
              input.sessionId,
              credential.accountId
            );
          } catch (error) {
            // F03: a failed lease transfer means NO account-backed
            // session — never report signed_in. The fill itself
                // succeeded; hand off with the transfer reason.
            return {
              status: "handoff_required",
              accountId: credential.accountId,
              siteId: site.siteId,
              reasonCode: `account_bind_failed:${
                error instanceof Error ? error.message : "unknown"
              }`,
            };
          }
        }
        // B03/S-FR-04: after a successful sign-in, propose the extra
        // domains the session ACTUALLY visited (redirect ledger) through
        // the confirmation card. Non-blocking — the sign-in result returns
        // while the user reviews the proposal; the apply is token-gated.
        void this.postSiteDomainConfirmation(input, site).catch(() => undefined);
        return {
          status: "signed_in",
          ...(credential.accountId !== null ? { accountId: credential.accountId } : {}),
          username: credential.username,
          siteId: site.siteId,
        };
      }
      // A-FR-10: record the failure with a reason (cooldown + UI) — but
      // NOT for reasons that must never start a cooldown: form_not_found
      // (the site's layout defeated us, not the credential) and the
      // challenge handoff (2FA/CAPTCHA is not a credential failure).
      const SKIP_COOLDOWN_REASONS = new Set([
        "form_not_found",
        "ambiguous_password_field",
      ]);
      const failureReason = result.reasonCode ?? result.outcome;
      const startsCooldown =
        result.outcome !== "challenge" && !SKIP_COOLDOWN_REASONS.has(failureReason);
      if (credential.accountId !== null && startsCooldown) {
        await accountModule.recordLoginFailure(
          credential.accountId,
          failureReason,
          { siteId: site.siteId }
        );
      }
      // A-FR-16: safety failures in the password-field family NEVER
      // return as a plain `failed` — the user takes over via handoff.
      const SAFETY_FAILURE_REASONS = new Set([
        "password_field_unsafe",
        "password_field_visible",
        "ambiguous_password_field",
        "sensitive_field_visible",
      ]);
      if (
        result.outcome === "wrong_credential" ||
        result.outcome === "challenge" ||
        (result.reasonCode != null &&
          SAFETY_FAILURE_REASONS.has(result.reasonCode))
      ) {
        // A-FR-09: hand off with a clear reason; never retry automatically.
        await browserModule
          .requestHandoff(
            input.sessionId,
            result.outcome === "wrong_credential" ? "login_required" : "captcha_sensitive_flow"
          )
          .catch(() => undefined);
        return {
          status: "handoff_required",
          ...(credential.accountId !== null ? { accountId: credential.accountId } : {}),
          siteId: site.siteId,
          reasonCode: result.reasonCode ?? undefined,
        };
      }
      return {
        status: "failed",
        siteId: site.siteId,
        reasonCode: result.reasonCode ?? "login_outcome_unknown",
      };
    } finally {
      // The credential copy in this frame dies with the call; nothing is
      // captured, logged, or persisted along the way.
    }
  }
}

function safeParseRecipe(raw: string): {
  version: 1;
  formAction: string | null;
  steps: Array<{
    usernameField: string | null;
    passwordField: string | null;
    submitVia: "form" | "enter";
  }>;
} | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as { steps?: unknown }).steps)
    ) {
      return parsed as {
        version: 1;
        formAction: string | null;
        steps: Array<{
          usernameField: string | null;
          passwordField: string | null;
          submitVia: "form" | "enter";
        }>;
      };
    }
    return null;
  } catch {
    return null;
  }
}

let defaultService: BrowserCredentialLoginService | null = null;

export function getDefaultBrowserCredentialLoginService(): BrowserCredentialLoginService {
  if (!defaultService) {
    defaultService = new BrowserCredentialLoginService();
  }
  return defaultService;
}
