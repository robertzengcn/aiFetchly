import "reflect-metadata";
import { Entity, Column, PrimaryGeneratedColumn, Index, Unique } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";

/**
 * Registry row for one preserved tool output stream (technical design §5.1).
 *
 * The registry — not the file — is authoritative for authorization and
 * publication. A payload file merely existing does NOT make it readable
 * through the retrieval tools: every access is authorized against this row
 * and the conversation's current output epoch.
 *
 * UNIQUE ARTIFACT IDENTITY is
 *   (profileId, conversationId, outputEpoch, executionId, streamKey)
 * so repeated processing of the same execution deduplicates onto one artifact
 * and one terminal receipt (AC-25), while a deliberate re-execution (new
 * executionId) legitimately creates a new artifact.
 */
@Entity("ai_tool_outputs")
@Index(["outputId"], { unique: true })
@Index(["profileId", "conversationId", "outputEpoch"])
@Index(["profileId", "outputState"])
@Unique("uq_tool_output_identity", [
    "profileId",
    "conversationId",
    "outputEpoch",
    "executionId",
    "streamKey",
])
export class AIToolOutputEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id: number;

    /** Public, model-visible reference. Random hex; no user/tool/path names. */
    @Order(1)
    @Column("varchar", { length: 64, nullable: false })
    outputId: string;

    @Order(2)
    @Column("varchar", { length: 100, nullable: false })
    profileId: string;

    @Order(3)
    @Column("varchar", { length: 100, nullable: false })
    conversationId: string;

    @Order(4)
    @Column("varchar", { length: 64, nullable: false })
    outputEpoch: string;

    /** Child agent that owns this artifact, when produced inside an agent. */
    @Order(5)
    @Column("varchar", { length: 100, nullable: true })
    ownerAgentId?: string;

    @Order(6)
    @Column("varchar", { length: 100, nullable: true })
    turnId?: string;

    /** One actual attempt. Distinct from a permission placeholder. */
    @Order(7)
    @Column("varchar", { length: 100, nullable: false })
    executionId: string;

    @Order(8)
    @Column("varchar", { length: 100, nullable: false })
    toolCallId: string;

    @Order(9)
    @Column("varchar", { length: 200, nullable: false })
    toolName: string;

    /** Distinguishes stdout / stderr / main body of one execution. */
    @Order(10)
    @Column("varchar", { length: 64, nullable: false })
    streamKey: string;

    @Order(11)
    @Column("int", { nullable: false, default: 1 })
    revision: number;

    @Order(12)
    @Column("varchar", { length: 32, nullable: false, default: "writing" })
    outputState: string;

    @Order(13)
    @Column("varchar", { length: 32, nullable: false, default: "file" })
    storageBackend: string;

    @Order(14)
    @Column("varchar", { length: 16, nullable: false, default: "text" })
    outputFormat: string;

    @Order(15)
    @Column("varchar", { length: 200, nullable: false, default: "text/plain" })
    mediaType: string;

    /** Path relative to the app-managed root. Never an absolute path. */
    @Order(16)
    @Column("varchar", { length: 500, nullable: true })
    storageKey?: string;

    /** Source row identity for the legacy_message backend. */
    @Order(17)
    @Column("varchar", { length: 100, nullable: true })
    sourceRowKey?: string;

    @Order(18)
    @Column("int", { nullable: false, default: 0 })
    capturedBytes: number;

    @Order(19)
    @Column("int", { nullable: true })
    originalBytes?: number;

    /** Lowercase hex. Required for a committed file-backend artifact. */
    @Order(20)
    @Column("varchar", { length: 64, nullable: true })
    sha256?: string;

    /** Producer completeness: did the UPSTREAM tool deliver everything? */
    @Order(21)
    @Column("varchar", { length: 16, nullable: false, default: "unknown" })
    sourceCompleteness: string;

    /** Capture preservation: did WE keep everything we received? */
    @Order(22)
    @Column("varchar", { length: 16, nullable: false, default: "complete" })
    preservation: string;

    @Order(23)
    @Column("varchar", { length: 100, nullable: true })
    failureCode?: string;

    @Order(24)
    @Column("varchar", { length: 64, nullable: false, default: "tool-result-policy-v1" })
    policyVersion: string;

    /** Fence token; a stale writer is rejected at commit time. */
    @Order(25)
    @Column("varchar", { length: 64, nullable: true })
    leaseFence?: string;

    @Order(26)
    @Column("datetime", { nullable: true })
    leaseExpiresAt?: Date;

    /**
     * Durable outbox: "pending" means the file is committed but the terminal
     * receipt has not been published yet. Startup reconciliation finishes it.
     */
    @Order(27)
    @Column("varchar", { length: 32, nullable: false, default: "published" })
    receiptPublication: string;

    /** Bounded terminal receipt JSON, retained for recovery. */
    @Order(28)
    @Column("text", { nullable: true })
    receiptJson?: string;

    @Order(29)
    @Column("int", { nullable: true })
    recordCount?: number;
}
