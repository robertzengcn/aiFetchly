import "reflect-metadata";
import { Entity, Column, Index, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";
import type { WorkspaceApprovalState } from "@/entityTypes/workspaceTypes";

@Entity("workspace")
@Index("idx_workspace_conversation", ["conversationId"])
export class WorkspaceEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Order(1)
  @Column("varchar", { length: 64, nullable: false })
  conversationId: string;

  @Order(2)
  @Column("varchar", { length: 1024, nullable: false })
  rootPath: string;

  @Order(3)
  @Column("varchar", { length: 255, nullable: true })
  label: string | null;

  @Order(4)
  @Column("varchar", { length: 16, nullable: false })
  approvalState: WorkspaceApprovalState;

  @Order(5)
  @Column("datetime", { nullable: true })
  approvedAt: Date | null;

  @Order(6)
  @Column("datetime", { nullable: true })
  revokedAt: Date | null;
}
