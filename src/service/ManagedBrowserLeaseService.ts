import { v4 as uuidv4 } from "uuid";

/**
 * Managed-browser account leases (technical design §7.2).
 *
 * In-memory MAIN-process singleton enforcing:
 *  - one account → at most one active managed-browser session (FR-COOKIE-001..003);
 *  - a global concurrency limit (default 1, FR-RUNTIME-008);
 *  - release requires BOTH sessionId and an unguessable leaseToken;
 *  - worker exit, explicit stop, startup timeout, app before-quit, and module
 *    disposal all release through this service.
 *
 * The lease spans manual login and CAPTCHA handoff — it is NOT released
 * merely because AI control is paused. Handoff timeout, cancellation, crash,
 * or stop releases it via the supervisor cleanup path.
 *
 * All methods are synchronous, therefore atomic within the Node event loop.
 */

export interface AccountLease {
  readonly accountId: number;
  readonly sessionId: string;
  readonly leaseToken: string;
  readonly acquiredAt: number;
  readonly ownerConversationId: string | null;
}

export interface AcquireLeaseInput {
  readonly sessionId: string;
  readonly ownerConversationId: string | null;
}

export type AcquireLeaseResult =
  | { readonly status: "granted"; readonly leaseToken: string }
  /** Same owner requested the same account: return the live session. */
  | { readonly status: "already_active"; readonly sessionId: string }
  /** A different owner holds the account. No owner details are exposed. */
  | { readonly status: "account_in_use" }
  | { readonly status: "global_limit_reached" };

export type ReleaseLeaseResult = "released" | "not_held" | "token_mismatch";

export class ManagedBrowserLeaseService {
  private readonly leases = new Map<number, AccountLease>();
  private readonly globalLimit: number;

  constructor(globalLimit = 1) {
    this.globalLimit = globalLimit;
  }

  public acquire(
    accountId: number,
    input: AcquireLeaseInput
  ): AcquireLeaseResult {
    const existing = this.leases.get(accountId);
    if (existing) {
      if (
        input.ownerConversationId != null &&
        existing.ownerConversationId === input.ownerConversationId
      ) {
        return { status: "already_active", sessionId: existing.sessionId };
      }
      return { status: "account_in_use" };
    }
    if (this.leases.size >= this.globalLimit) {
      return { status: "global_limit_reached" };
    }
    const lease: AccountLease = {
      accountId,
      sessionId: input.sessionId,
      leaseToken: uuidv4(),
      acquiredAt: Date.now(),
      ownerConversationId: input.ownerConversationId,
    };
    this.leases.set(accountId, lease);
    return { status: "granted", leaseToken: lease.leaseToken };
  }

  /**
   * Release requires both the session id and the unguessable lease token.
   * Idempotent: releasing an unheld account is `not_held`, not an error.
   */
  public release(
    accountId: number,
    sessionId: string,
    leaseToken: string
  ): ReleaseLeaseResult {
    const lease = this.leases.get(accountId);
    if (!lease) {
      return "not_held";
    }
    if (lease.sessionId !== sessionId || lease.leaseToken !== leaseToken) {
      return "token_mismatch";
    }
    this.leases.delete(accountId);
    return "released";
  }

  /** Release everything (app before-quit / module disposal). */
  public releaseAll(): number {
    const count = this.leases.size;
    this.leases.clear();
    return count;
  }

  /** Watchdog support: is a lease live for this account? */
  public isHeld(accountId: number): boolean {
    return this.leases.has(accountId);
  }

  /** The active lease for an account, if any (main-process internal use). */
  public getLease(accountId: number): AccountLease | null {
    return this.leases.get(accountId) ?? null;
  }

  /** All live leases (snapshot for supervisor cleanup). */
  public activeLeases(): readonly AccountLease[] {
    return [...this.leases.values()];
  }
}

let defaultService: ManagedBrowserLeaseService | null = null;

export function getDefaultManagedBrowserLeaseService(): ManagedBrowserLeaseService {
  if (!defaultService) {
    defaultService = new ManagedBrowserLeaseService();
  }
  return defaultService;
}

/** Test seam: replace/reset the process singleton. */
export function setDefaultManagedBrowserLeaseServiceForTest(
  service: ManagedBrowserLeaseService | null
): void {
  defaultService = service;
}
