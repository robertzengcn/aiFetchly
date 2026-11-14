import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
} from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

/**
 * Durable browser-task cursor (PRD D-FR-07/10; technical design §6.2).
 *
 * T19: survives crashes so unfinished/paused/waiting tasks are marked
 * interrupted on restart and no mutation is ever automatically replayed.
 * Stores metadata and bounded accounting only — never page text, field
 * values, credentials, or DOM handles.
 */
@Entity("browser_tasks")
@Index(["sessionId"])
@Index(["conversationId"])
@Index(["phase"])
export class BrowserTaskEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  /** Runner task id (`task_<random>`). */
  @Column({ type: "varchar", length: 64 })
  taskId!: string;

  @Column({ type: "varchar", length: 64 })
  sessionId!: string;

  @Column({ type: "varchar", length: 64 })
  conversationId!: string;

  /** Sub-agent task id when this task runs under a batch/agent. */
  @Column({ type: "varchar", length: 64, nullable: true })
  agentTaskId!: string | null;
  /** D-FR-07: the tool call that started this task. */
  @Column("text", { nullable: true })
  toolCallId!: string | null;
  /** D-FR-07: the managed-async job driving the task, when any. */
  @Column("text", { nullable: true })
  jobId!: string | null;

  /** admitting | planning | observing | deciding | validating | executing |
   *  reconciling | verifying | recovering | awaiting_approval | handoff |
   *  signing_in | awaiting_user_input | paused | completed | failed |
   *  cancelled | interrupted */
  @Column({ type: "varchar", length: 32 })
  phase!: string;

  /** Hosted | chat route frozen at admission (no secrets). */
  @Column({ type: "varchar", length: 16 })
  providerMode!: string;

  /** Provider config key at admission (AIProviderConfigVersion). */
  @Column({ type: "varchar", length: 64, nullable: true })
  providerConfigKey!: string | null;

  /** Bounded counters snapshot. */
  @Column({ type: "integer", default: 0 })
  leafSteps!: number;

  @Column({ type: "integer", default: 0 })
  decisionRequests!: number;

  @Column({ type: "integer", default: 0 })
  recoveryCalls!: number;

  /** Active-time accounting (ms, user waits excluded). */
  @Column({ type: "integer", default: 0 })
  activeTimeMs!: number;

  /**
   * Mutation journal: the pending action intent written BEFORE dispatch.
   * A crash with a pending intent lacking confirmation means interrupted
   * with unknown effect — NEVER an invitation to replay.
   */
  @Column({ type: "varchar", length: 16, nullable: true })
  pendingActionIntent!: string | null;

  @Column({ type: "varchar", length: 16, nullable: true })
  pendingActionOutcome!: "confirmed" | "no_effect" | "unknown" | null;

  /** Terminal reason when phase is terminal. */
  @Column({ type: "varchar", length: 128, nullable: true })
  terminalReason!: string | null;

  @Column({ type: "integer", nullable: true })
  userInterventionCount!: number | null;
}
