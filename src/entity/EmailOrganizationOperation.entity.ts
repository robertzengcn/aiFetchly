import { Entity, Index, Column, PrimaryColumn } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";
import type {
  EmailOrganizationOperationKind,
  EmailOrganizationOperationStatus,
  EmailOrganizationOrigin,
} from "@/entityTypes/emailOrganizationTypes";

/**
 * Durable organization operation (technical design §6.2). One operation
 * covers one frozen action payload; item rows carry per-message outcomes.
 * `idempotencyKey` is the unique dedup handle: a duplicate invocation
 * resolves to the existing operation instead of creating a fresh attempt.
 */
@Entity("email_organization_operation")
@Index(["idempotencyKey"], { unique: true })
@Index(["emailServiceId", "requestedAt"])
@Index(["status"])
export class EmailOrganizationOperationEntity extends AuditableEntity {
  /** Generated operation UUID (main-process generated, opaque to tools). */
  @PrimaryColumn("varchar", { length: 64 }) operationId!: string;

  @Column("varchar", { length: 20 }) kind!: EmailOrganizationOperationKind;

  @Column("integer") emailServiceId!: number;

  /** Trusted provenance: how this operation was authorized. */
  @Column("varchar", { length: 30 }) origin!: EmailOrganizationOrigin;

  @Column("integer", { nullable: true }) conversationId!: number | null;

  /** Persisted user turn / UI event that authorized the action. */
  @Column("varchar", { length: 255, nullable: true }) sourceUserMessageId!: string | null;

  /** Canonical hash of the frozen payload. */
  @Column("varchar", { length: 64 }) payloadHash!: string;

  /** Unique dedup key binding action ID + kind + payload hash. */
  @Column("varchar", { length: 160 }) idempotencyKey!: string;

  @Column("varchar", { length: 30, default: "prepared" })
  status!: EmailOrganizationOperationStatus;

  /** Linked forward draft when kind = forward. */
  @Column("integer", { nullable: true }) draftId!: number | null;

  @Column("integer", { default: 0 }) completedCount!: number;
  @Column("integer", { default: 0 }) failedCount!: number;
  @Column("integer", { default: 0 }) unknownCount!: number;
  @Column("integer", { default: 0 }) pendingCount!: number;
  @Column("integer", { default: 0 }) cancelledCount!: number;

  @Column("varchar", { length: 50, nullable: true }) errorCode!: string | null;

  @Column("varchar", { length: 30, nullable: true }) policyVersion!: string | null;

  @Column("datetime") requestedAt!: Date;
  @Column("datetime", { nullable: true }) startedAt!: Date | null;
  @Column("datetime", { nullable: true }) completedAt!: Date | null;
  @Column("datetime", { nullable: true }) cancelRequestedAt!: Date | null;
}
