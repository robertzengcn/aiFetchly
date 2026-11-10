import { Entity, PrimaryGeneratedColumn, Column, Index } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";
import type { GuardPhase } from "@/entityTypes/emailReplyReliabilityTypes";

/**
 * Message-level generation/send guard (technical design §5.2, FR-035/FR-036).
 *
 * One row per canonical inbound identity `(emailServiceId, replyKey)`. The
 * guard is an ownership index, NOT the sole authority: every mutation MUST
 * reconcile against actual draft/attempt records. Never trust `phase = "idle"`
 * while a related sent/unknown/in-flight attempt exists (§5.2).
 *
 * Lifecycle:
 *
 *   idle            — no active work; available for a new generation/send.
 *   generating      — a generation owner token + lease are held (FR-035).
 *                     Released on commit/failure or reclaimed after lease
 *                     expiry with reconciliation (§8.2).
 *   draft_ready     — a committed draft is bound (activeDraftId). Available
 *                     for approval/send claim.
 *   sending         — an approved revision has been claimed for SMTP
 *                     (activeAttemptId). Finalize transitions to sent /
 *                     delivery_unknown / draft_ready.
 *   sent            — terminal protection (a successful send exists).
 *   delivery_unknown — protected-unknown; timeout/expiry alone never
 *                     releases the message (FR-036 §9). A late successful
 *                     SMTP finalization may upgrade to `sent`.
 *   conflict        — contradictory records across the canonical cluster
 *                     require operator remediation.
 *
 * The unique `(emailServiceId, replyKey)` constraint backs the atomic acquire
 * (§8.1): two concurrent generation invocations cannot both hold the lease.
 * Owner tokens are 64-byte random hex; the lease duration is the 5-minute
 * generation invocation budget (FR-035). An expired/replaced owner cannot
 * renew, commit, or release the current lease (§8.2 fenced late-result
 * rejection).
 *
 * Never store credentials, raw SMTP dumps, message bodies, or prompts here.
 * `ownerToken` is an opaque fencing token, not a secret.
 */
@Entity("email_reply_guard")
@Index(["emailServiceId", "replyKey"], { unique: true })
@Index(["phase", "leaseExpiresAt"])
export class EmailReplyGuardEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column("integer")
  emailServiceId!: number;

  /** `rfc:<sha256(normalizedId)>` or `row:<storedMessageId>` (§4.1). varchar(80). */
  @Column("varchar", { length: 80 })
  replyKey!: string;

  /** Representative received row, navigation only — NOT sole identity authority. */
  @Column("integer")
  messageId!: number;

  @Column("varchar", { length: 20, default: "idle" })
  phase!: GuardPhase;

  /** 64-byte random hex fencing token. Nullable when phase = idle. */
  @Column("varchar", { length: 128, nullable: true })
  ownerToken!: string | null;

  /** Lease expiry; null when phase = idle. */
  @Column("datetime", { nullable: true })
  leaseExpiresAt!: Date | null;

  /** Bound draft row when phase >= draft_ready. */
  @Column("integer", { nullable: true })
  activeDraftId!: number | null;

  /** Bound attempt row when phase = sending. */
  @Column("integer", { nullable: true })
  activeAttemptId!: number | null;
}
