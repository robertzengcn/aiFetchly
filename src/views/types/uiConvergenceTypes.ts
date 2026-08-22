/**
 * Typed contracts for inner-page UI convergence
 * (docs/prd/inner-page-ui-convergence-technical-design.md §8–§18).
 *
 * Presentation-only: these types never determine authorization, database
 * access, or action safety (IPR-054, design §8.2).
 */

// ---------------------------------------------------------------------------
// Route UI metadata (design §8.1)
// ---------------------------------------------------------------------------

export type InnerPageTemplateKind =
  | "landing"
  | "collection"
  | "form"
  | "detail"
  | "results"
  | "settings";

/**
 * Task state is a supporting template layered onto any primary template
 * (PRD §16.1) — it is never a page's primary layout.
 */
export type SupportingTemplateKind = InnerPageTemplateKind | "task-state";

export type UiMigrationState = "legacy" | "shell" | "converged";

export interface InnerPageRouteUiMeta {
  family: string;
  template: InnerPageTemplateKind;
  migration: UiMigrationState;
  inspector?: "none" | "optional" | "preferred";
  contentWidth?: "reading" | "form" | "wide" | "full";
}

// ---------------------------------------------------------------------------
// Actions (design §11.2)
// ---------------------------------------------------------------------------

export type PageActionTone = "primary" | "secondary" | "quiet" | "danger";

export interface PageActionView {
  id: string;
  labelKey: string;
  icon?: string;
  tone: PageActionTone;
  loading?: boolean;
  disabled?: boolean;
  disabledReasonKey?: string;
}

// ---------------------------------------------------------------------------
// Shared page states (design §12.1)
// ---------------------------------------------------------------------------

export type PageLoadState =
  | { state: "loading" }
  | { state: "ready" }
  | { state: "empty"; kind: "first-use" | "no-results" }
  | { state: "error"; messageKey: string; recoverable: boolean }
  | { state: "forbidden"; capabilityKey: string };

export type SettingSaveState = "idle" | "saving" | "saved" | "error";

// ---------------------------------------------------------------------------
// Task presentation (design §18.1)
// ---------------------------------------------------------------------------

export type TaskPresentationState =
  | "queued"
  | "running"
  | "paused"
  | "awaiting_permission"
  | "awaiting_user"
  | "stopping"
  | "completed"
  | "failed"
  | "interrupted"
  | "cancelled";

export interface TaskPresentationProjection {
  readonly state: TaskPresentationState;
  readonly summaryKey: string;
  readonly primaryAction?: PageActionView;
  readonly secondaryAction?: PageActionView;
  readonly activityAvailable: boolean;
}

// ---------------------------------------------------------------------------
// Collections (design §13.3, §13.6)
// ---------------------------------------------------------------------------

export interface CollectionQuery<
  TFilter extends Record<string, unknown> = Record<string, unknown>,
> {
  search: string;
  filters: TFilter;
  page: number;
  pageSize: number;
  sort: ReadonlyArray<{ key: string; order: "asc" | "desc" }>;
}

export type ColumnPriority = "required" | "important" | "optional";

// ---------------------------------------------------------------------------
// Inspector targets (design §9.2) — discriminated union of validated ids.
// ---------------------------------------------------------------------------

export type AppInspectorTarget =
  | { kind: "schedule"; ownerRoute: string; scheduleId: number }
  | { kind: "campaign"; ownerRoute: string; campaignId: number }
  | { kind: "search-task"; ownerRoute: string; taskId: number }
  | { kind: "email-record"; ownerRoute: string; recordId: number }
  | { kind: "activity"; ownerRoute: string; runId: string }
  | {
      kind: "chat";
      ownerRoute: string;
      tab: "artifacts" | "activity" | "context";
    };

export type AppInspectorKind = AppInspectorTarget["kind"];

// ---------------------------------------------------------------------------
// Notices (design §20.1) — action ids, never closures.
// ---------------------------------------------------------------------------

export interface AppNotice {
  id: string;
  tone: "success" | "info" | "warning" | "error";
  messageKey: string;
  parameters?: Record<string, string | number>;
  timeoutMs?: number;
  action?: { labelKey: string; actionId: string };
}
