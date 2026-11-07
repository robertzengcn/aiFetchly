import { Token } from "@/modules/token";
import {
  AI_CHAT_MESSAGE_QUEUE_ENABLED,
  AI_CHAT_MESSAGE_STEERING_ENABLED,
  AI_CHAT_WORKSPACE_SHARED_ORCHESTRATION,
  AI_CHAT_WORKSPACE_SPECIALIZED_RESULTS,
  AI_CHAT_WORKSPACE_VOICE_MEMORY,
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
 * - shared renderer orchestration (default ON): command routing, shared
 *   permission helpers, and goal/loop/skill orchestration adapters on the
 *   workspace shell. OFF degrades sends to plain durable sends on the
 *   workspace surface; the pending queue, run identities and permission
 *   gates stay untouched (they are main-process owned).
 * - specialized results (default ON): installation/artifact/report/plan
 *   specialized-result panels. OFF degrades those rows to plain text while
 *   durable results keep flowing.
 * - voice and memory parity (default ON): voice composer controls and
 *   workspace memory/trust panels. OFF hides the optional panels; speech
 *   policy and memory storage behavior stay governed by their own modules.
 *
 * Chat V2 visibility (design §23.1's fifth control) remains the inverse of
 * the redesign visibility: the dock is reachable whenever the workspace
 * shell is not the active surface (§23.2 rollback state). Mount-time
 * enforcement only lands the DEFAULT (explicit preference wins — A02).
 */
export const WorkspaceRolloutFlag = {
  Queue: AI_CHAT_MESSAGE_QUEUE_ENABLED,
  Steering: AI_CHAT_MESSAGE_STEERING_ENABLED,
  WorkspaceRedesign: USER_AI_CHAT_WORKSPACE_REDESIGN,
  SharedOrchestration: AI_CHAT_WORKSPACE_SHARED_ORCHESTRATION,
  SpecializedResults: AI_CHAT_WORKSPACE_SPECIALIZED_RESULTS,
  VoiceMemory: AI_CHAT_WORKSPACE_VOICE_MEMORY,
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
 * §23.1 adapter: shared renderer orchestration (command routing + shared
 * permission helper seams). Presentation/dispatch only — turning it off never
 * disables the durable queue, pending rows, or main-process permission gates.
 */
export function isWorkspaceSharedOrchestrationEnabled(): boolean {
  return flagOn(WorkspaceRolloutFlag.SharedOrchestration, true);
}

/** §23.1 adapter: specialized installation/artifact/report result panels. */
export function isWorkspaceSpecializedResultsEnabled(): boolean {
  return flagOn(WorkspaceRolloutFlag.SpecializedResults, true);
}

/** §23.1 adapter: voice controls + memory/trust panels. */
export function isWorkspaceVoiceMemoryEnabled(): boolean {
  return flagOn(WorkspaceRolloutFlag.VoiceMemory, true);
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
