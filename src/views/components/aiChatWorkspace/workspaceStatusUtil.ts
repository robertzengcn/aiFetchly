import type {
  ConversationAttention,
  ConversationRuntimeStatus,
} from "@/entityTypes/aiChatWorkspaceTypes";

/**
 * Semantic status presentation helpers for the workspace shell
 * (PRD §10.3, §11.4; design §15.4, §16.2). Icon shape + localized label
 * carry meaning — color is supplementary only (FR-041).
 */

export interface ConversationStatusVisual {
  /** Material Design icon name (shape carries meaning without color). */
  readonly icon: string;
  /** True for the running spinner animation (reduced-motion aware in CSS). */
  readonly spinning: boolean;
  /** i18n key for the accessible name / tooltip. */
  readonly labelKey: string;
  /** English fallback when the key is missing. */
  readonly fallback: string;
}

export function conversationStatusVisual(input: {
  runtimeStatus: ConversationRuntimeStatus;
  attention: ConversationAttention;
  unread: boolean;
}): ConversationStatusVisual {
  const { runtimeStatus, attention, unread } = input;
  switch (runtimeStatus) {
    case "running":
      return {
        icon: "mdi-loading",
        spinning: true,
        labelKey: "workspaceChat.status.running",
        fallback: "Running",
      };
    case "queued":
      return {
        icon: "mdi-clock-outline",
        spinning: false,
        labelKey: "workspaceChat.status.queued",
        fallback: "Queued",
      };
    case "awaiting_permission":
      return {
        icon: "mdi-lock-outline",
        spinning: false,
        labelKey: "workspaceChat.status.awaitingPermission",
        fallback: "Permission required",
      };
    case "awaiting_user":
      return {
        icon: "mdi-help-circle-outline",
        spinning: false,
        labelKey: "workspaceChat.status.awaitingUser",
        fallback: "Your input is required",
      };
    case "failed":
      return {
        icon: "mdi-alert-circle-outline",
        spinning: false,
        labelKey: "workspaceChat.status.failed",
        fallback: "Failed",
      };
    case "interrupted":
      return {
        icon: "mdi-restore",
        spinning: false,
        labelKey: "workspaceChat.status.interrupted",
        fallback: "Interrupted",
      };
    case "cancelled":
      return {
        icon: "mdi-stop-circle-outline",
        spinning: false,
        labelKey: "workspaceChat.status.cancelled",
        fallback: "Cancelled",
      };
    case "completed":
      return unread
        ? {
            icon: "mdi-circle",
            spinning: false,
            labelKey: "workspaceChat.status.completedUnread",
            fallback: "Completed, unread",
          }
        : {
            icon: "",
            spinning: false,
            labelKey: "workspaceChat.status.idle",
            fallback: "",
          };
    default:
      if (attention === "failure") {
        return {
          icon: "mdi-alert-circle-outline",
          spinning: false,
          labelKey: "workspaceChat.status.needsAttention",
          fallback: "Needs attention",
        };
      }
      if (unread) {
        return {
          icon: "mdi-circle",
          spinning: false,
          labelKey: "workspaceChat.status.completedUnread",
          fallback: "Completed, unread",
        };
      }
      return {
        icon: "",
        spinning: false,
        labelKey: "workspaceChat.status.idle",
        fallback: "",
      };
  }
}

/**
 * The ONE summarized header status (design §15.4 precedence):
 * permission > user input > recovering > failed > stopping > running >
 * queued > none.
 */
export interface HeaderStatus {
  readonly labelKey: string;
  readonly fallback: string;
  /** Opens the Activity inspector when details exist (PRD §11.4). */
  readonly opensActivity: boolean;
}

export function headerStatusFor(input: {
  runtimeStatus: ConversationRuntimeStatus;
  recovering: boolean;
  activeToolCount: number;
}): HeaderStatus | null {
  const { runtimeStatus, recovering, activeToolCount } = input;
  if (runtimeStatus === "awaiting_permission") {
    return {
      labelKey: "workspaceChat.headerStatus.needsPermission",
      fallback: "Needs permission",
      opensActivity: true,
    };
  }
  if (runtimeStatus === "awaiting_user") {
    return {
      labelKey: "workspaceChat.headerStatus.needsYourInput",
      fallback: "Needs your input",
      opensActivity: true,
    };
  }
  if (recovering) {
    return {
      labelKey: "workspaceChat.headerStatus.recovering",
      fallback: "Recovering",
      opensActivity: true,
    };
  }
  if (runtimeStatus === "failed") {
    return {
      labelKey: "workspaceChat.headerStatus.failed",
      fallback: "Failed",
      opensActivity: true,
    };
  }
  if (runtimeStatus === "running") {
    return {
      labelKey:
        activeToolCount > 0
          ? "workspaceChat.headerStatus.runningTools"
          : "workspaceChat.headerStatus.running",
      fallback:
        activeToolCount > 0 ? `Running · ${activeToolCount} tools` : "Running",
      opensActivity: true,
    };
  }
  if (runtimeStatus === "queued") {
    return {
      labelKey: "workspaceChat.headerStatus.queued",
      fallback: "Queued",
      opensActivity: false,
    };
  }
  return null;
}

/** Relative time label for sidebar rows (bounded, localized by the caller). */
export function relativeTimeLabel(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const diffMs = now - then;
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(then).toLocaleDateString();
}
