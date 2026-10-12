/**
 * Computer Use task authority (audit A03, CU-PERM-02–05).
 *
 * Host-owned, deny-by-default approval registry for consequential and
 * confirmation-required action classes. Session-start consent covers
 * read_only/within_task work; anything that saves, sends, publishes,
 * deletes, overwrites, or pays requires an explicit CURRENT-TASK approval
 * minted here — never a model's classification, plugin text, or observed
 * screen content (CU-PERM-07).
 *
 * Approvals bind to the exact canonical request hash (or, when granted
 * class-wide for the task, to the session + class), and to the session
 * generation: a stop/resume/handoff revokes them.
 */
import { randomUUID } from "crypto";
import {
  ComputerUseError,
  type ComputerUseActionClass,
} from "@/entityTypes/computerUseTypes";
import {
  canonicalizeActionRequest,
  hashActionRequest,
} from "@/service/computerUse/ComputerUseActionAuthorization";

/** Classes that always require an explicit current-task approval. */
export const APPROVAL_REQUIRED_CLASSES: ReadonlySet<ComputerUseActionClass> =
  new Set(["consequential", "confirmation_required"]);

export interface TaskApproval {
  readonly approvalId: string;
  readonly sessionId: string;
  readonly generation: number;
  /** Exact request hash covered (when the user approved one action). */
  readonly requestHash: string | null;
  /** Class-wide coverage for the current task (e.g. every "overwrite"). */
  readonly actionClasses: readonly ComputerUseActionClass[];
  readonly grantedAt: number;
  readonly expiresAt: number;
}

export interface TaskApprovalRequest {
  readonly sessionId: string;
  /** Defaults to the session's current generation when minted via the supervisor. */
  readonly generation?: number;
  /** Approve one exact action (hash of its canonical request). */
  readonly requestHash?: string;
  /** Approve every action of these classes for the current task. */
  readonly actionClasses?: readonly ComputerUseActionClass[];
  readonly now?: number;
}

/** Default approval lifetime: a task approval is deliberately short-lived. */
export const TASK_APPROVAL_TTL_MS = 5 * 60_000;

export class ComputerUseTaskAuthority {
  private readonly approvals = new Map<string, TaskApproval>();

  /** Mint an approval after an explicit user decision (approval UI path). */
  grant(request: TaskApprovalRequest): TaskApproval {
    const now = request.now ?? Date.now();
    if (!request.requestHash && !(request.actionClasses?.length)) {
      throw new ComputerUseError(
        "permission_denied",
        "An approval must cover a request hash or action classes"
      );
    }
    if (request.generation === undefined) {
      throw new ComputerUseError(
        "permission_denied",
        "An approval requires a session generation"
      );
    }
    const approval: TaskApproval = {
      approvalId: `apr_${randomUUID()}`,
      sessionId: request.sessionId,
      generation: request.generation,
      requestHash: request.requestHash ?? null,
      actionClasses: request.actionClasses ?? [],
      grantedAt: now,
      expiresAt: now + TASK_APPROVAL_TTL_MS,
    };
    this.approvals.set(approval.approvalId, approval);
    return approval;
  }

  /**
   * Deny-by-default check used by the supervisor before minting a grant:
   * returns silently for self-covered classes; throws `permission_denied`
   * when a consequential/confirmation-required action lacks a matching
   * CURRENT-task approval.
   */
  assertDispatchAllowed(input: {
    sessionId: string;
    generation: number;
    actionClass: ComputerUseActionClass;
    requestHash: string;
    now?: number;
  }): void {
    if (!APPROVAL_REQUIRED_CLASSES.has(input.actionClass)) return;
    const now = input.now ?? Date.now();
    for (const approval of this.approvals.values()) {
      if (approval.sessionId !== input.sessionId) continue;
      if (approval.generation !== input.generation) continue; // revoked by lifecycle
      if (now > approval.expiresAt) continue;
      const hashMatch =
        approval.requestHash !== null &&
        approval.requestHash === input.requestHash;
      const classMatch = approval.actionClasses.includes(input.actionClass);
      if (hashMatch || classMatch) return;
    }
    throw new ComputerUseError(
      "permission_denied",
      `Action class ${input.actionClass} requires explicit current-task authorization`
    );
  }

  /** Revoke every approval of a session generation (stop/resume/handoff). */
  invalidateGeneration(sessionId: string, generation: number): number {
    let removed = 0;
    for (const [id, approval] of this.approvals) {
      if (
        approval.sessionId === sessionId &&
        approval.generation === generation
      ) {
        this.approvals.delete(id);
        removed++;
      }
    }
    return removed;
  }

  /** Whether a class needs approval (used by tests/UI). */
  requiresApproval(actionClass: ComputerUseActionClass): boolean {
    return APPROVAL_REQUIRED_CLASSES.has(actionClass);
  }

  listActive(sessionId: string, now = Date.now()): TaskApproval[] {
    return [...this.approvals.values()].filter(
      (a) => a.sessionId === sessionId && now <= a.expiresAt
    );
  }

  clear(): void {
    this.approvals.clear();
  }
}

export { canonicalizeActionRequest, hashActionRequest };
