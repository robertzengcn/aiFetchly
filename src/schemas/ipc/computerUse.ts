/**
 * Computer Use — renderer IPC input schemas.
 *
 * Every renderer→main payload is validated at the boundary before use
 * (design §9). Session-serving channels are AI requests and use
 * registerAiValidatedHandler with the USER_AI_ENABLED gate checked first.
 */
import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";
import { COMPUTER_USE_SESSION_ID_PATTERN } from "@/entityTypes/computerUseTypes";

const uuidSchema = z.string().uuid();
/** Session ids are the supervisor-minted `cus_<uuid>` (audit A07). */
const sessionIdSchema = z
  .string()
  .regex(
    COMPUTER_USE_SESSION_ID_PATTERN,
    "Expected a Computer Use session id (cus_<uuid>)."
  );

const windowIdSchema = z.string().min(1).max(256);

/** Electron accelerator: at least two modifiers plus a key (design §10.5.1). */
const acceleratorSchema = z
  .string()
  .min(3)
  .max(120)
  .refine(isValidAccelerator, "Expected an Electron accelerator with at least two modifiers.");

const hotkeyModifiers = new Set(["Command", "Cmd", "Control", "Ctrl", "CommandOrControl", "CmdOrCtrl", "Alt", "Option", "AltGr", "Shift", "Super"]);

/**
 * Structural accelerator validation: `Mod+Mod+...+Key`. The final segment is
 * the key; at least two leading segments must be modifiers. Registration
 * success is still verified with globalShortcut at apply time.
 */
function isValidAccelerator(value: string): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  const parts = value.split("+").map((part) => part.trim());
  if (parts.length < 3 || parts.some((part) => part.length === 0)) return false;
  const key = parts[parts.length - 1];
  if (key.length === 0 || key.length > 32) return false;
  if (parts.slice(0, -1).some((part) => part.includes(" "))) return false;
  const modifierCount = parts
    .slice(0, -1)
    .filter((part) => hotkeyModifiers.has(part)).length;
  return modifierCount >= 2;
}

export const computerUseSessionStartInputSchema = lazySchema(() =>
  z.strictObject({
    targetWindowId: windowIdSchema,
  }),
);

export const computerUseSessionControlInputSchema = lazySchema(() =>
  z.strictObject({
    sessionId: sessionIdSchema,
  }),
);

export const computerUseSessionPauseInputSchema = lazySchema(() =>
  z.strictObject({
    sessionId: sessionIdSchema,
    reason: z.enum(["user_request", "human_input", "focus_change", "handoff"]).optional(),
  }),
);

export const computerUseSessionResumeInputSchema = lazySchema(() =>
  z.strictObject({
    sessionId: sessionIdSchema,
  }),
);

export const computerUseStatusInputSchema = lazySchema(() =>
  z.strictObject({}),
);

export const computerUseListWindowsInputSchema = lazySchema(() =>
  z.strictObject({}),
);

export const computerUseSettingsInputSchema = lazySchema(() =>
  z.strictObject({
    localVisionEnabled: z.boolean().optional(),
    groundingModelRuntimeId: z.string().min(1).max(120).nullable().optional(),
    visualPlannerEnabled: z.boolean().optional(),
    stopHotkey: acceleratorSchema.optional(),
    debugCaptureEnabled: z.boolean().optional(),
    debugRetentionDays: z.number().int().min(1).max(365).optional(),
  }),
);

export const computerUseValidateHotkeyInputSchema = lazySchema(() =>
  z.strictObject({
    accelerator: acceleratorSchema,
  }),
);

export const computerUseGroundingReadinessInputSchema = lazySchema(() =>
  z.strictObject({}),
);

export const computerUseListGroundingModelsInputSchema = lazySchema(() =>
  z.strictObject({}),
);

export const computerUseSelectGroundingModelInputSchema = lazySchema(() =>
  z.strictObject({
    runtimeId: z.string().min(1).max(120),
  }),
);

export {
  acceleratorSchema,
  sessionIdSchema,
  uuidSchema,
  windowIdSchema,
};
