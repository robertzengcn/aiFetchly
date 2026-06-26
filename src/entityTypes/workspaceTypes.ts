/**
 * Approval lifecycle for a workspace.
 *  - pending: created but not yet acknowledged in the UI
 *  - approved: user confirmed access to this folder
 *  - revoked: user removed access; tools must refuse further use
 */
export type WorkspaceApprovalState = "pending" | "approved" | "revoked";

export interface WorkspaceRecord {
  readonly id: number;
  readonly conversationId: string;
  readonly rootPath: string;
  readonly label: string | null;
  readonly approvalState: WorkspaceApprovalState;
  readonly createdAt: string;
  readonly approvedAt: string | null;
  readonly revokedAt: string | null;
}

/** Trimmed view returned to the renderer. */
export interface WorkspaceSummary {
  readonly id: number;
  readonly conversationId: string;
  readonly rootPath: string;
  readonly label: string | null;
  readonly approvalState: WorkspaceApprovalState;
}
