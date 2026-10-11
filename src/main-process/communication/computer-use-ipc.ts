/**
 * Computer Use IPC (design §3.2, mandatory AI-gate rule).
 *
 * Every session-serving channel is AI-gated via registerAiValidatedHandler:
 * the USER_AI_ENABLED check runs before parsing, capture, or inference
 * (CU-PERM-01). Settings and readiness are component-management channels
 * and use registerValidatedHandler.
 *
 * Until the plugin repository ships a qualified Windows backend, the
 * desktop adapter fails closed with `backend_unavailable` — the supervisor,
 * lease, hotkey, and safety logic is still fully wired and exercised.
 */
import { ipcMain } from "electron";
import {
  COMPUTER_USE_GROUNDING_READINESS,
  COMPUTER_USE_LIST_WINDOWS,
  COMPUTER_USE_SESSION_PAUSE,
  COMPUTER_USE_SESSION_RESUME,
  COMPUTER_USE_SESSION_START,
  COMPUTER_USE_SESSION_STOP,
  COMPUTER_USE_SETTINGS_GET,
  COMPUTER_USE_SETTINGS_SET,
  COMPUTER_USE_STATUS,
  COMPUTER_USE_VALIDATE_HOTKEY,
} from "@/config/channellist";
import { log } from "@/modules/Logger";
import {
  registerAiValidatedHandler,
  registerValidatedHandler,
} from "@/main-process/communication/_shared/registerValidatedHandler";
import {
  computerUseSessionControlInputSchema,
  computerUseSessionPauseInputSchema,
  computerUseSessionResumeInputSchema,
  computerUseSessionStartInputSchema,
  computerUseSettingsInputSchema,
  computerUseValidateHotkeyInputSchema,
} from "@/schemas/ipc/computerUse";
import {
  ComputerUseError,
  type ComputerUseSettings,
  type ComputerUseSessionSummary,
  type GroundingReadiness,
  DEFAULT_COMPUTER_USE_SETTINGS,
} from "@/entityTypes/computerUseTypes";
import {
  isValidStopHotkeyAccelerator,
} from "@/service/computerUse/ComputerUseStopHotkeyService";
import { z } from "zod";

const noInputSchema = z.strictObject({});

/** Settings persistence seam (Token store in production; injectable). */
export interface ComputerUseSettingsStore {
  read(): ComputerUseSettings;
  write(settings: ComputerUseSettings): void;
}

let settingsStore: ComputerUseSettingsStore | null = null;

/** Install the settings store (composition root); defaults otherwise. */
export function setComputerUseSettingsStore(store: ComputerUseSettingsStore): void {
  settingsStore = store;
}

function currentSettings(): ComputerUseSettings {
  try {
    return settingsStore?.read() ?? DEFAULT_COMPUTER_USE_SETTINGS;
  } catch (error) {
    log.warn(
      "[computer-use-ipc] settings read failed; using defaults:",
      error instanceof Error ? error.message : String(error)
    );
    return DEFAULT_COMPUTER_USE_SETTINGS;
  }
}

/**
 * Handlers throw ComputerUseError on failure; the shared dispatch wraps both
 * successes and failures into the CommonMessage envelope, so the error code
 * travels as the message for renderer-side localization.
 */
function unwrapCode(error: unknown): string {
  const code = error instanceof ComputerUseError ? error.code : "unknown_error";
  log.warn(
    `[computer-use-ipc] ${code}: ${error instanceof Error ? error.message : String(error)}`
  );
  if (error instanceof ComputerUseError) {
    // Re-throw with the stable code embedded for the envelope message.
    error.message = `computer_use.${error.code}`;
  }
  throw error;
}

/**
 * Register every Computer Use channel. The supervisor composition (real
 * desktop adapter, control strip, grounding worker) is supplied by the
 * caller; sessions fail closed with `backend_unavailable` until a qualified
 * plugin backend is installed.
 */
export function registerComputerUseIpcHandlers(deps: {
  listSessions: () => ComputerUseSessionSummary[];
  startSession: (
    input: z.infer<ReturnType<typeof computerUseSessionStartInputSchema>>
  ) => Promise<ComputerUseSessionSummary>;
  stopSession: (sessionId: string) => Promise<ComputerUseSessionSummary>;
  pauseSession: (
    sessionId: string,
    reason?: "user_request" | "human_input" | "focus_change" | "handoff"
  ) => Promise<ComputerUseSessionSummary>;
  resumeSession: (sessionId: string) => Promise<ComputerUseSessionSummary>;
  listWindows: () => Promise<
    import("@/entityTypes/computerUseTypes").ComputerUseWindowInfo[]
  >;
  groundingReadiness: () => GroundingReadiness;
}): void {
  // ---- AI-gated session channels (CU-PERM-01) ----
  registerAiValidatedHandler(
    COMPUTER_USE_SESSION_START,
    computerUseSessionStartInputSchema,
    async (input) => deps.startSession(input).catch(unwrapCode)
  );

  registerAiValidatedHandler(
    COMPUTER_USE_SESSION_STOP,
    computerUseSessionControlInputSchema,
    async (input) => deps.stopSession(input.sessionId).catch(unwrapCode)
  );

  registerAiValidatedHandler(
    COMPUTER_USE_SESSION_PAUSE,
    computerUseSessionPauseInputSchema,
    async (input) =>
      deps.pauseSession(input.sessionId, input.reason).catch(unwrapCode)
  );

  registerAiValidatedHandler(
    COMPUTER_USE_SESSION_RESUME,
    computerUseSessionResumeInputSchema,
    async (input) => deps.resumeSession(input.sessionId).catch(unwrapCode)
  );

  registerAiValidatedHandler(
    COMPUTER_USE_LIST_WINDOWS,
    () => noInputSchema,
    async () => deps.listWindows().catch(unwrapCode)
  );

  // ---- Component-management channels ----
  registerValidatedHandler(COMPUTER_USE_STATUS, () => noInputSchema, async () => ({
    sessions: deps.listSessions(),
    settings: currentSettings(),
  }));

  registerValidatedHandler(
    COMPUTER_USE_SETTINGS_GET,
    () => noInputSchema,
    async () => currentSettings()
  );

  registerValidatedHandler(
    COMPUTER_USE_SETTINGS_SET,
    computerUseSettingsInputSchema,
    async (input) => {
      const next = { ...currentSettings(), ...input };
      if (input.stopHotkey !== undefined) {
        if (!isValidStopHotkeyAccelerator(next.stopHotkey)) {
          throw new ComputerUseError(
            "stop_hotkey_unavailable",
            "Stop hotkey must be an accelerator with at least two modifiers"
          );
        }
      }
      settingsStore?.write(next);
      return next;
    }
  );

  registerValidatedHandler(
    COMPUTER_USE_VALIDATE_HOTKEY,
    computerUseValidateHotkeyInputSchema,
    async (input) => ({
      valid: isValidStopHotkeyAccelerator(input.accelerator),
    })
  );

  registerValidatedHandler(
    COMPUTER_USE_GROUNDING_READINESS,
    () => noInputSchema,
    async () => deps.groundingReadiness()
  );

  // Keep ipcMain referenced for future event pushes (control strip state).
  void ipcMain;
}
