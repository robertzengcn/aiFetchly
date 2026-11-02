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

export class BrowserCredentialLoginService {
  public async signIn(input: BrowserSignInInput): Promise<BrowserSignInResult> {
    const browserModule = getDefaultManagedBrowserModule();
    const status = browserModule.getStatus(input.sessionId);
    if (!status) {
      return { status: "failed", reasonCode: "no_active_session" };
    }
    // A-FR-02: site identity comes from the LIVE page URL, never the LLM.
    const origin = status.currentOrigin;
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
      const submitted = await promise;
      if (submitted.cancelled) {
        return { status: "handoff_required", reasonCode: "user_cancelled", siteId: site.siteId };
      }
      if (!submitted.save) {
        // One-time in-memory credential (never persisted, never logged).
        return this.fillAndAssess(input, site, {
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
      return this.fillAndAssess(input, site, {
        username: submitted.username,
        password: submitted.password,
        accountId: newAccountId,
      });
    } else {
      // A-FR-03: several matches — the LLM may choose by account_id; it did
      // not, so the user picks. Return the eligible list for the picker card.
      return {
        status: "awaiting_user_credentials",
        siteId: site.siteId,
        reasonCode: "account_picker_required",
      };
    }

    // A-FR-10: cooldown — never retry a password the site rejected.
    if (await accountModule.isSignInCoolingDown(chosen.id)) {
      return {
        status: "failed",
        accountId: chosen.id,
        siteId: site.siteId,
        reasonCode: "cooldown",
      };
    }

    // A-FR-07: the ONLY decrypting read, gated on the live page's domain.
    const registrableDomain = site.registrableDomain;
    const credential = await accountModule.getCredentialForLogin(
      chosen.id,
      registrableDomain
    );
    if (!credential) {
      return {
        status: "failed",
        accountId: chosen.id,
        siteId: site.siteId,
        reasonCode: "origin_mismatch",
      };
    }
    return this.fillAndAssess(input, site, {
      username: credential.username,
      password: credential.password,
      accountId: chosen.id,
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
        if (credential.accountId !== null) {
          await accountModule.recordLoginFailureClear(credential.accountId);
        }
        return {
          status: "signed_in",
          ...(credential.accountId !== null ? { accountId: credential.accountId } : {}),
          username: credential.username,
          siteId: site.siteId,
        };
      }
      // A-FR-10: record the failure with a reason (cooldown + UI).
      if (credential.accountId !== null) {
        await accountModule.recordLoginFailure(
          credential.accountId,
          result.reasonCode ?? result.outcome
        );
      }
      if (
        result.outcome === "wrong_credential" ||
        result.outcome === "challenge"
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
