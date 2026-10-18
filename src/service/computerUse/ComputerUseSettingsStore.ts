/**
 * Computer Use settings persistence (audit A21).
 *
 * The fail-closed IPC registration shipped an in-memory store that silently
 * discarded every write: set returned success and the next read returned
 * defaults. This store persists the validated settings through the host's
 * Token service (USERSDBPATH-scoped, the standard host settings path) as a
 * JSON blob, revalidated with Zod at load — a corrupted or partial blob
 * falls back to defaults rather than poisoning the session gate.
 */
import { z } from "zod";
import { Token } from "@/modules/token";
import { log } from "@/modules/Logger";
import {
  DEFAULT_COMPUTER_USE_SETTINGS,
  type ComputerUseSettings,
} from "@/entityTypes/computerUseTypes";
import { isValidStopHotkeyAccelerator } from "@/service/computerUse/ComputerUseStopHotkeyService";
import type { ComputerUseSettingsStore } from "@/main-process/communication/computer-use-ipc";

const SETTINGS_TOKEN_KEY = "COMPUTER_USE_SETTINGS";

const computerUseSettingsSchema = z.object({
  localVisionEnabled: z.boolean(),
  groundingModelRuntimeId: z.string().min(1).max(120).nullable(),
  visualPlannerEnabled: z.boolean(),
  stopHotkey: z.string().min(3).max(120),
  debugCaptureEnabled: z.boolean(),
  debugRetentionDays: z.number().int().min(1).max(365),
});

export class TokenComputerUseSettingsStore implements ComputerUseSettingsStore {
  private readonly token: Token;

  constructor(token: Token = new Token()) {
    this.token = token;
  }

  read(): ComputerUseSettings {
    let raw: string | undefined;
    try {
      raw = this.token.getValue(SETTINGS_TOKEN_KEY);
    } catch (error) {
      log.warn(
        "[computer-use-settings] token read failed; using defaults:",
        error instanceof Error ? error.message : String(error)
      );
      return DEFAULT_COMPUTER_USE_SETTINGS;
    }
    if (!raw) return DEFAULT_COMPUTER_USE_SETTINGS;
    try {
      const parsed = computerUseSettingsSchema.parse(JSON.parse(raw));
      if (!isValidStopHotkeyAccelerator(parsed.stopHotkey)) {
        // A stale/invalid hotkey from an older write must not wedge sessions.
        return { ...parsed, stopHotkey: DEFAULT_COMPUTER_USE_SETTINGS.stopHotkey };
      }
      return parsed;
    } catch {
      // Corrupted or partial blob: defaults, never a broken gate.
      return DEFAULT_COMPUTER_USE_SETTINGS;
    }
  }

  write(settings: ComputerUseSettings): void {
    // Validate before persisting so the stored blob is always loadable.
    const parsed = computerUseSettingsSchema.parse(settings);
    this.token.setValue(SETTINGS_TOKEN_KEY, JSON.stringify(parsed));
  }
}
