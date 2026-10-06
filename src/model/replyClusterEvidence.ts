import { In, type EntityManager } from "typeorm";
import { EmailReplyDraftEntity } from "@/entity/EmailReplyDraft.entity";
import { EmailReplySendAttemptEntity } from "@/entity/EmailReplySendAttempt.entity";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import { EmailReplyGuardEntity } from "@/entity/EmailReplyGuard.entity";
import type {
  EmailReplySendAttemptStatus,
  GuardPhase,
} from "@/entityTypes/emailReplyReliabilityTypes";

/**
 * Canonical-cluster draft/attempt evidence (technical design §5.2/§8.1/§8.2).
 *
 * Shared by the guard transactions (acquire, reclaim) and the send claim
 * (T08) so every mutation reconciles against the SAME cluster read. Lives in
 * its own module (like `replyTxn.ts`) so `EmailReplyGuardModel` and
 * `EmailReplyDraftModel` never import one another.
 */
export interface ClusterEvidence {
  readonly replyStatus: string | null;
  readonly liveDrafts: EmailReplyDraftEntity[];
  readonly sentDrafts: EmailReplyDraftEntity[];
  readonly sendingDrafts: EmailReplyDraftEntity[];
  readonly unknownDrafts: EmailReplyDraftEntity[];
  readonly failedDrafts: EmailReplyDraftEntity[];
  readonly sentAttempts: EmailReplySendAttemptEntity[];
  readonly unknownAttempts: EmailReplySendAttemptEntity[];
  readonly inFlightAttempts: EmailReplySendAttemptEntity[];
}

/**
 * Read every draft + attempt across the canonical cluster (§5.2/§8.1). Runs
 * inside the caller's transaction `manager` so the read is consistent with
 * the mutation in the same transaction (no TOCTOU between read and write).
 *
 * The cluster is resolved from the seed message row: the row itself plus every
 * row sharing its `normalizedMessageId` (§4.1). A row without an RFC id forms
 * a singleton cluster (the `row:` replyKey fallback).
 *
 * When `normalizedMessageId` is supplied it overrides the seed row's own value
 * (the acquire path passes the caller-resolved id); `replyKey` is accepted for
 * provenance/logging symmetry with the guard row and is not used to resolve
 * the cluster — the (emailServiceId, normalizedMessageId) join is authoritative.
 */
export async function readClusterEvidence(
  manager: EntityManager,
  opts: {
    emailServiceId: number;
    normalizedMessageId: string | null;
    seedMessageId: number;
    replyKey?: string;
  }
): Promise<ClusterEvidence> {
  const messageRepo = manager.getRepository(EmailReceivedMessageEntity);
  const draftRepo = manager.getRepository(EmailReplyDraftEntity);
  const attemptRepo = manager.getRepository(EmailReplySendAttemptEntity);

  const seed = await messageRepo.findOne({ where: { id: opts.seedMessageId } });
  const clusterRows: EmailReceivedMessageEntity[] = [];
  if (seed) {
    clusterRows.push(seed);
    const normalizedId =
      opts.normalizedMessageId ?? seed.normalizedMessageId ?? null;
    if (normalizedId) {
      const equivalents = await messageRepo.find({
        where: {
          emailServiceId: opts.emailServiceId,
          normalizedMessageId: normalizedId,
        },
      });
      for (const r of equivalents) {
        if (!clusterRows.some((c) => c.id === r.id)) {
          clusterRows.push(r);
        }
      }
    }
  }
  const clusterRowIds = clusterRows.map((r) => r.id);
  if (clusterRowIds.length === 0) {
    return {
      replyStatus: null,
      liveDrafts: [],
      sentDrafts: [],
      sendingDrafts: [],
      unknownDrafts: [],
      failedDrafts: [],
      sentAttempts: [],
      unknownAttempts: [],
      inFlightAttempts: [],
    };
  }

  const drafts = await draftRepo.find({
    where: { messageId: In(clusterRowIds) },
  });
  const attempts = await attemptRepo.find({
    where: { messageId: In(clusterRowIds) },
  });

  const replyStatus = seed?.replyStatus ?? null;
  return {
    replyStatus,
    liveDrafts: drafts.filter((d) => isLiveDraftStatus(d.status)),
    sentDrafts: drafts.filter((d) => d.status === "sent"),
    sendingDrafts: drafts.filter((d) => d.status === "sending"),
    unknownDrafts: drafts.filter((d) => d.status === "delivery_unknown"),
    failedDrafts: drafts.filter((d) => d.status === "failed"),
    sentAttempts: attempts.filter((a) => a.status === "sent"),
    unknownAttempts: attempts.filter((a) => a.status === "delivery_unknown"),
    inFlightAttempts: attempts.filter((a) => isAttemptInFlight(a.status)),
  };
}

export function isLiveDraftStatus(status: string): boolean {
  return status === "draft" || status === "approved" || status === "sending";
}

export function isAttemptInFlight(status: EmailReplySendAttemptStatus): boolean {
  return status === "claimed" || status === "submitted";
}

/**
 * Map canonical-cluster evidence onto a guard phase (§5.2/§8.2). Used by
 * {@link EmailReplyGuardModel.reclaimExpiredReservation} (recovery) and by
 * the send claim's pre-write sibling check (T08/FR-036) so the two paths
 * apply the SAME precedence ladder — never trust `idle` while a related
 * sent/unknown/in-flight record exists.
 *
 *   - sent attempt / sent draft / replyStatus=sent → `sent`
 *   - delivery_unknown draft / attempt            → `delivery_unknown`
 *   - sending draft / in-flight attempt            → `sending`
 *   - live draft (otherwise clean)                 → `draft_ready`
 *   - nothing live                                 → `idle`
 */
export function evidenceToPhase(evidence: ClusterEvidence): {
  phase: GuardPhase;
  activeDraftId: number | null;
  activeAttemptId: number | null;
} {
  if (
    evidence.replyStatus === "sent" ||
    evidence.sentDrafts.length > 0 ||
    evidence.sentAttempts.length > 0
  ) {
    return {
      phase: "sent",
      activeDraftId: evidence.sentDrafts[0]?.id ?? null,
      activeAttemptId: evidence.sentAttempts[0]?.id ?? null,
    };
  }
  if (
    evidence.unknownDrafts.length > 0 ||
    evidence.unknownAttempts.length > 0
  ) {
    return { phase: "delivery_unknown", activeDraftId: null, activeAttemptId: null };
  }
  if (
    evidence.sendingDrafts.length > 0 ||
    evidence.inFlightAttempts.length > 0
  ) {
    return {
      phase: "sending",
      activeDraftId: evidence.sendingDrafts[0]?.id ?? null,
      activeAttemptId: evidence.inFlightAttempts[0]?.id ?? null,
    };
  }
  if (evidence.liveDrafts.length > 0) {
    return {
      phase: "draft_ready",
      activeDraftId: evidence.liveDrafts[0].id,
      activeAttemptId: null,
    };
  }
  return { phase: "idle", activeDraftId: null, activeAttemptId: null };
}

/**
 * Whether canonical-cluster evidence blocks a NEW send claim on a different
 * draft (T08/FR-036 §8.2). The claim's own draft is excluded by id; anything
 * terminal or in-flight on a sibling blocks. A clean cluster (only the
 * claiming draft itself) does not block.
 *
 * Attempts are scoped by `draftId`: an in-flight/terminal attempt on the
 * CLAIMING draft is not sibling evidence — it is this draft's own send (a
 * concurrent replay of the same approval, which the B04 idempotency lookup
 * after the conditional UPDATE resolves to `already_processed`). Only
 * attempts on a DIFFERENT draft block the claim.
 */
export function clusterEvidenceBlocksSend(
  evidence: ClusterEvidence,
  claimingDraftId: number
): boolean {
  for (const a of evidence.sentAttempts) {
    if (a.draftId !== claimingDraftId) return true;
  }
  for (const a of evidence.unknownAttempts) {
    if (a.draftId !== claimingDraftId) return true;
  }
  for (const a of evidence.inFlightAttempts) {
    if (a.draftId !== claimingDraftId) return true;
  }
  for (const d of evidence.sentDrafts) {
    if (d.id !== claimingDraftId) return true;
  }
  for (const d of evidence.unknownDrafts) {
    if (d.id !== claimingDraftId) return true;
  }
  for (const d of evidence.sendingDrafts) {
    if (d.id !== claimingDraftId) return true;
  }
  return false;
}

/**
 * T08/FR-036: bind a guard row to an in-flight send attempt — conditional
 * UPDATE to `phase = "sending"` + `activeAttemptId`, fenced by
 * `phase IN ("draft_ready", "idle")`. Must be called INSIDE the claim's
 * `runReplyTxn` so the bind is atomic with the attempt INSERT.
 *
 * The fence is phase-based, NOT owner-based: the claim's conditional draft
 * UPDATE is the authority for which draft is sending; the guard binding is
 * the message-level exclusion. 0 rows affected means the guard is already
 * `sending`/`sent`/`delivery_unknown` (in-flight or terminal evidence that
 * must not be overwritten) — the caller must throw so the transaction rolls
 * back the attempt INSERT (§8.2).
 *
 * A null `guardId` (no guard row for the replyKey — e.g. legacy data
 * predating the guard) skips binding: the claim's conditional draft UPDATE +
 * sibling check remain the authority.
 */
export async function bindGuardToSendPhase(
  manager: EntityManager,
  input: {
    guardId: number | null;
    activeAttemptId: number;
  }
): Promise<boolean> {
  if (input.guardId === null) {
    return false;
  }
  const res = await manager.getRepository(EmailReplyGuardEntity).update(
    {
      id: input.guardId,
      phase: In(["draft_ready", "idle"] as GuardPhase[]),
    },
    {
      phase: "sending" as GuardPhase,
      activeAttemptId: input.activeAttemptId,
    }
  );
  return (res.affected ?? 0) > 0;
}
