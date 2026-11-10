/**
 * Computer Use trusted action grants (design §10.3, CU-PERM-03/04).
 *
 * The host computes authorization from the active user request, target scope,
 * action class, and current state, and mints a short-lived grant bound to
 * session generation, action id, normalized action hash, and target /
 * observation identity. The model cannot provide or mint grants: grant
 * objects arriving through model-visible tool arguments are structurally
 * rejected here (validateGrant only accepts host-minted references).
 */
import { createHash, randomUUID } from "crypto";
import {
  ComputerUseError,
  type ComputerUseActionClass,
  type ComputerUseActionGrant,
  type ComputerUseActionRequest,
  type ComputerUseSessionGeneration,
} from "@/entityTypes/computerUseTypes";

/** Grant lifetime (ms). Short by design; revalidation is cheap. */
export const ACTION_GRANT_TTL_MS = 30_000;

/** Action classes requiring explicit current-task authorization. */
export const CONSEQUENTIAL_ACTION_CLASSES: ReadonlySet<ComputerUseActionClass> =
  new Set(["consequential"]);

/**
 * Canonical serialization of an action request for hashing. Property order is
 * fixed so semantically identical actions hash identically.
 */
export function canonicalizeActionRequest(
  request: ComputerUseActionRequest
): string {
  return JSON.stringify({
    actionKind: request.actionKind,
    targetHandle: request.targetHandle,
    observationId: request.observationId,
    point: request.point ? [request.point.x, request.point.y] : null,
    text: request.text ?? null,
    key: request.key ?? null,
    modifiers: request.modifiers ? [...request.modifiers].sort() : null,
  });
}

export function hashActionRequest(request: ComputerUseActionRequest): string {
  return createHash("sha256")
    .update(canonicalizeActionRequest(request))
    .digest("hex");
}

/**
 * Grants are referenced by id in dispatch paths; the authority-bearing
 * objects live only in this host-side store.
 */
export class ComputerUseActionAuthorization {
  private readonly grants = new Map<string, ComputerUseActionGrant>();

  /**
   * Mint a grant for a validated action. The action id is host-generated;
   * duplicate action ids within a session are rejected (deduplication per
   * design §10.4).
   */
  mint(input: {
    sessionId: string;
    generation: ComputerUseSessionGeneration;
    request: ComputerUseActionRequest;
    actionClass: ComputerUseActionClass;
    observationId: string;
    actionId?: string;
    now?: number;
  }): ComputerUseActionGrant {
    const now = input.now ?? Date.now();
    const actionId = input.actionId ?? `act_${randomUUID()}`;
    if (this.grants.has(actionId)) {
      throw new ComputerUseError(
        "grant_invalid",
        "Duplicate action id within session history"
      );
    }
    const grant: ComputerUseActionGrant = {
      sessionId: input.sessionId,
      generation: input.generation,
      actionId,
      actionHash: hashActionRequest(input.request),
      targetHandle: input.request.targetHandle,
      observationId: input.observationId,
      actionClass: input.actionClass,
      issuedAt: now,
      expiresAt: now + ACTION_GRANT_TTL_MS,
    };
    this.grants.set(grant.actionId, grant);
    return grant;
  }

  /**
   * Validate a grant immediately before dispatch: existence, session,
   * generation, expiry, and exact action-hash match. A mismatched hash means
   * the action changed after authorization and must be re-authorized.
   */
  validate(
    actionId: string,
    expected: {
      sessionId: string;
      generation: ComputerUseSessionGeneration;
      request: ComputerUseActionRequest;
    },
    now = Date.now()
  ): ComputerUseActionGrant {
    const grant = this.grants.get(actionId);
    if (!grant) {
      throw new ComputerUseError("grant_invalid", "Unknown action grant");
    }
    if (grant.sessionId !== expected.sessionId) {
      throw new ComputerUseError("grant_invalid", "Grant belongs to another session");
    }
    if (grant.generation !== expected.generation) {
      throw new ComputerUseError(
        "grant_invalid",
        "Grant belongs to a revoked session generation"
      );
    }
    if (now > grant.expiresAt) {
      this.grants.delete(actionId);
      throw new ComputerUseError("grant_invalid", "Grant expired");
    }
    const requestHash = hashActionRequest(expected.request);
    if (requestHash !== grant.actionHash) {
      throw new ComputerUseError(
        "grant_invalid",
        "Action changed after authorization"
      );
    }
    if (grant.targetHandle !== expected.request.targetHandle) {
      throw new ComputerUseError("grant_invalid", "Grant target mismatch");
    }
    return grant;
  }

  /** Consume (single-use) — called after a successful dispatch. */
  consume(actionId: string): void {
    this.grants.delete(actionId);
  }

  /** Invalidate every grant of a generation (stop / revoke). */
  invalidateGeneration(generation: ComputerUseSessionGeneration): number {
    let removed = 0;
    for (const [id, grant] of this.grants) {
      if (grant.generation === generation) {
        this.grants.delete(id);
        removed++;
      }
    }
    return removed;
  }

  /** Whether the class requires explicit current-task authorization. */
  requiresExplicitAuthorization(actionClass: ComputerUseActionClass): boolean {
    return CONSEQUENTIAL_ACTION_CLASSES.has(actionClass);
  }

  clear(): void {
    this.grants.clear();
  }
}
