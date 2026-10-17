import { Token } from "@/modules/token";
import {
  AI_CHAT_MESSAGE_QUEUE_ENABLED,
  AI_CHAT_MESSAGE_STEERING_ENABLED,
  USER_AI_CHAT_WORKSPACE_REDESIGN,
} from "@/config/usersetting";

/**
 * Independently controlled rollout flags (G03, design §23.1).
 *
 * Each flag chooses a presentation or dispatch adapter only — flags never
 * change authorization rules, database ownership, or persisted identity
 * formats, so rollback preserves pending rows, identities, and
 * authorization behavior (design §23.2). All flags default to the current
 * shipped behavior:
 *
 * - workspace pending queue (default ON): ordinary sends route through
 *   durable pending rows; OFF keeps list/resume/remove working so nothing
 *   is orphaned.
 * - steering (default ON, requires queue): follow-up steering of a running
 *   turn; OFF rejects steering while dispatch is unaffected.
 * - workspace redesign visibility (default OFF): the `/aiworkspace` shell
 *   stays opt-in until parity acceptance passes; V2 remains available.
 * - history UI (default per staged rollout): archive browsing/selection;
 *   resolved through the staged-rollout reader (historyUiEnabled).
 *
 * Shared renderer orchestration (useChatCommandRouting, voice/memory
 * panels), specialized results (installation/artifact/report surfaces), and
 * voice/memory parity ship BEHIND the workspace visibility flag — they are
 * workspace-shell surfaces with no independent legacy path to preserve.
 * Extracting them into separately flaggable adapters is tracked follow-up;
 * this module documents the mapping so the next flag has a home.
 */
export const WorkspaceRolloutFlag = {
  Queue: AI_CHAT_MESSAGE_QUEUE_ENABLED,
  Steering: AI_CHAT_MESSAGE_STEERING_ENABLED,
  WorkspaceRedesign: USER_AI_CHAT_WORKSPACE_REDESIGN,
} as const;

function flagOn(key: string, defaultOn: boolean): boolean {
  let raw: string | null = null;
  try {
    raw = new Token().getValue(key);
  } catch {
    raw = null;
  }
  if (raw === null || raw === undefined || raw === "") return defaultOn;
  return raw !== "false" && raw !== "0";
}

export function isWorkspaceQueueEnabled(): boolean {
  return flagOn(WorkspaceRolloutFlag.Queue, true);
}

export function isWorkspaceSteeringEnabled(): boolean {
  return isWorkspaceQueueEnabled() && flagOn(WorkspaceRolloutFlag.Steering, true);
}

export function isWorkspaceRedesignEnabled(): boolean {
  return flagOn(WorkspaceRolloutFlag.WorkspaceRedesign, false);
}

/**
 * Chat V2 visibility (design §23.1's fifth control): the legacy dock stays
 * reachable whenever the workspace shell is not the active surface — the
 * exact §23.2 rollback state. Routing (layout.vue) mounts the dock when the
 * redesign flag is off; this accessor names that inverse explicitly so the
 * control is auditable instead of implicit.
 */
export function isChatV2DockVisible(): boolean {
  return !isWorkspaceRedesignEnabled();
}
