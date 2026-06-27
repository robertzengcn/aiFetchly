/**
 * Type definitions for workspace-aware file tools.
 *
 * Covers workspace records, approval state lifecycle,
 * and trimmed summaries for the renderer process.
 */

// ---------------------------------------------------------------------------
// Workspace approval state
// ---------------------------------------------------------------------------

/**
 * Approval lifecycle for a workspace.
 *  - pending: created but not yet acknowledged in the UI
 *  - approved: user confirmed access to this folder
 *  - revoked: user removed access; tools must refuse further use
 */
export type WorkspaceApprovalState = 'pending' | 'approved' | 'revoked';

// ---------------------------------------------------------------------------
// Workspace record
// ---------------------------------------------------------------------------

export interface WorkspaceRecord {
  readonly id: string;
  readonly conversationId: string;
  readonly rootPath: string;
  readonly label: string | null;
  readonly approvalState: WorkspaceApprovalState;
  readonly createdAt: string;
  readonly approvedAt: string | null;
  readonly revokedAt: string | null;
}

// ---------------------------------------------------------------------------
// Workspace summary
// ---------------------------------------------------------------------------

/** Trimmed view returned to the renderer. */
export interface WorkspaceSummary {
  readonly id: string;
  readonly conversationId: string;
  readonly rootPath: string;
  readonly label: string | null;
  readonly approvalState: WorkspaceApprovalState;
}
