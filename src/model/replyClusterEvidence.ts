import { In, type EntityManager } from "typeorm";
import { EmailReplyDraftEntity } from "@/entity/EmailReplyDraft.entity";
import { EmailReplySendAttemptEntity } from "@/entity/EmailReplySendAttempt.entity";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import { EmailReplyGuardEntity } from "@/entity/EmailReplyGuard.entity";
import { normalizeStoredMessageId } from "@/service/emailReceive/EmailReplyIdentity";
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
 *
 * R03: the cluster aggregate now carries row-level positive evidence across
 * every equivalent row — `clusterReplyDetectedAt` (earliest non-null
 * `replyDetectedAt` across the cluster) and `clusterHasRowLevelSent` (any row
 * whose `replyStatus === "sent"`). These let every gate detect authoritative
 * reply history on a sibling row that the seed's own `replyStatus` does not
 * reflect.
 */
export interface ClusterEvidence {
  readonly replyStatus: string | null;
  /**
   * R03: the earliest non-null `replyDetectedAt` across every cluster row
   * (sticky positive — mailbox flag or verified Sent search). Null when no row
   * has a persisted positive. A non-null value means the canonical identity
   * has a known reply and every gate must refuse new work.
   */
  readonly clusterReplyDetectedAt: Date | null;
  /**
   * R03: true when ANY cluster row has `replyStatus === "sent"` (historical
   * app delivery projection). The seed's own `replyStatus` alone is
   * insufficient — a legacy/normalized sibling may carry the sent projection
   * the seed does not.
   */
  readonly clusterHasRowLevelSent: boolean;
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
 * R03 — the canonical resolver. Always includes the seed row, then safely
 * normalizes legacy raw IDs to join equivalent rows. A legacy seed whose
 * `normalizedMessageId` column is NULL is NOT omitted from its own cluster
 * when a newer normalized sibling exists: the seed is pushed unconditionally
 * (the bug was that the module layer returned `equivalents` without the seed
 * when equivalents were non-empty). Each equivalent row's historical sent
 * projection (`replyStatus === "sent"`) and sticky positive
 * (`replyDetectedAt`) is aggregated so a gate inspecting the seed sees
 * authoritative reply history living on a sibling. Mailbox isolation is
 * retained: the join is `(emailServiceId, normalizedMessageId)` so the same
 * RFC ID in two different services is never merged (§4.1).
 *
 * When `normalizedMessageId` is supplied it overrides the seed row's own
 * value (the acquire path passes the caller-resolved id). When it is null
 * the resolver normalizes the seed's raw `messageId` header on the fly via
 * {@link normalizeStoredMessageId} so legacy rows join the right cluster. A
 * row with no usable RFC ID forms a singleton cluster (the `row:` replyKey
 * fallback) — it is never merged with another missing-id row.
 */
export async function readClusterEvidence(
  manager: EntityManager,
  opts: {
    emailServiceId: number;
    normalizedMessageId: string | null;
    seedMessageId: number;
  }
): Promise<ClusterEvidence> {
  const messageRepo = manager.getRepository(EmailReceivedMessageEntity);
  const draftRepo = manager.getRepository(EmailReplyDraftEntity);
  const attemptRepo = manager.getRepository(EmailReplySendAttemptEntity);

  const seed = await messageRepo.findOne({ where: { id: opts.seedMessageId } });
  const clusterRows: EmailReceivedMessageEntity[] = [];
  if (seed) {
    clusterRows.push(seed);
    // R03: prefer the caller-supplied id, then the seed's stored normalized
    // column, then normalize the seed's raw `messageId` header on the fly so a
    // legacy row whose column was never populated still joins its cluster.
    const normalizedId =
      opts.normalizedMessageId ??
      seed.normalizedMessageId ??
      normalizeStoredMessageId(seed.messageId);
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
      clusterReplyDetectedAt: null,
      clusterHasRowLevelSent: false,
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

  // Order by id ASC so the [0] picks below (activeDraftId/activeAttemptId
  // binding on the guard row) are deterministic across reads. Without this,
  // a multi-record cluster binds whichever row SQLite returns first —
  // non-deterministic and operator-undiagnosable. listByMessage uses
  // { id: DESC }; cluster evidence uses ASC for stable oldest-first binding.
  const drafts = await draftRepo.find({
    where: { messageId: In(clusterRowIds) },
    order: { id: "ASC" },
  });
  const attempts = await attemptRepo.find({
    where: { messageId: In(clusterRowIds) },
    order: { id: "ASC" },
  });

  // R03: aggregate row-level positive evidence across every cluster row.
  // `clusterReplyDetectedAt` = earliest non-null `replyDetectedAt` (sticky
  // positive — mailbox flag or verified Sent search). `clusterHasRowLevelSent`
  // = any row whose `replyStatus === "sent"` (historical app delivery
  // projection living on a sibling the seed does not reflect).
  let clusterReplyDetectedAt: Date | null = null;
  let clusterHasRowLevelSent = false;
  for (const r of clusterRows) {
    if (r.replyDetectedAt) {
      if (
        clusterReplyDetectedAt === null ||
        r.replyDetectedAt.getTime() < clusterReplyDetectedAt.getTime()
      ) {
        clusterReplyDetectedAt = r.replyDetectedAt;
      }
    }
    if (r.replyStatus === "sent") {
      clusterHasRowLevelSent = true;
    }
  }

  const replyStatus = seed?.replyStatus ?? null;
  return {
    replyStatus,
    clusterReplyDetectedAt,
    clusterHasRowLevelSent,
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
 * R03: cluster-level positive evidence (a sibling row's `replyDetectedAt` or
 * `replyStatus=sent`) is authoritative at the SAME precedence as a sent
 * draft/attempt — the canonical identity has a known reply, regardless of
 * which row carries the projection.
 *
 *   - sent attempt / sent draft / replyStatus=sent / cluster positive → `sent`
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
    evidence.clusterHasRowLevelSent ||
    evidence.clusterReplyDetectedAt !== null ||
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
 * R03: cluster-level positive evidence (a sibling row's `replyDetectedAt` or
 * `replyStatus=sent`) blocks unconditionally — it is not the claiming draft's
 * own send, it is the canonical identity's authoritative reply history. This
 * closes the R02 hole where a fresh positive timestamp was accepted as
 * "freshness" inside the claim: a positive now blocks regardless of which
 * row carries it or how recently it was observed.
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
  // R03: any cluster row carries authoritative reply history → block.
  if (
    evidence.clusterReplyDetectedAt !== null ||
    evidence.clusterHasRowLevelSent ||
    evidence.replyStatus === "sent"
  ) {
    return true;
  }
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

/**
 * R01/R02/R04 — the single canonical eligibility contract every gate
 * (commit-time, claim-time, reconciliation) reconciles against. Maps cluster
 * evidence to a typed refusal reason or `eligible` BEFORE any write. Returns
 * a stable reason string so the caller can surface a typed refusal without
 * writing a draft/attempt or downgrading lifecycle state.
 *
 * Precedence (highest first):
 *  1. `already_replied` — any cluster positive (sibling `replyDetectedAt`,
 *     `replyStatus=sent`, sent draft, or sent attempt). The canonical
 *     identity has a known reply.
 *  2. `delivery_unknown` — a `delivery_unknown` draft/attempt (ambiguous
 *     prior send). Must not commit new work or claim a new send.
 *  3. `reply_in_progress` — a `sending` draft or in-flight attempt on a
 *     DIFFERENT draft (for claim) / any (for commit). The live submitter
 *     must quiesce first.
 *  4. `reply_state_conflict` — more than one live (editable, non-sent)
 *     draft across the cluster with no namespace resolution. Human review.
 *  5. `eligible` — clean cluster; the gate may proceed.
 *
 * The `actingDraftId` parameter excludes the calling draft's OWN in-flight
 * send (claim path): a concurrent replay of the same approval resolves via
 * the B04 idempotency lookup, not here. Pass `null` for the commit path
 * (no existing draft yet).
 */
export type ClusterEligibilityReason =
  | "already_replied"
  | "delivery_unknown"
  | "reply_in_progress"
  | "reply_state_conflict"
  | "eligible";

export function classifyClusterEligibility(
  evidence: ClusterEvidence,
  actingDraftId: number | null
): { reason: ClusterEligibilityReason } {
  // 1. Any cluster positive → already_replied.
  if (
    evidence.clusterReplyDetectedAt !== null ||
    evidence.clusterHasRowLevelSent ||
    evidence.replyStatus === "sent" ||
    evidence.sentDrafts.length > 0 ||
    evidence.sentAttempts.length > 0
  ) {
    return { reason: "already_replied" };
  }
  // 2. Ambiguous prior delivery.
  if (
    evidence.unknownDrafts.length > 0 ||
    evidence.unknownAttempts.length > 0
  ) {
    return { reason: "delivery_unknown" };
  }
  // 3. A live submitter on a different draft (claim path excludes its own).
  const sendingOnOtherDraft =
    evidence.sendingDrafts.some(
      (d) => actingDraftId === null || d.id !== actingDraftId
    ) ||
    evidence.inFlightAttempts.some(
      (a) => actingDraftId === null || a.draftId !== actingDraftId
    );
  if (sendingOnOtherDraft) {
    return { reason: "reply_in_progress" };
  }
  // 4. Contradictory records: multiple live drafts, no namespace resolution.
  if (evidence.liveDrafts.length > 1) {
    return { reason: "reply_state_conflict" };
  }
  return { reason: "eligible" };
}
