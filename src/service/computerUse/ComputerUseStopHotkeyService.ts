/**
 * Computer Use stop hotkey (design §10.5.1, CU-SESSION-08).
 *
 * The global shortcut is registered with Electron `globalShortcut` only
 * while a session is in STARTING..STOPPED and unregistered on every exit
 * path, so AiFetchly never permanently takes a combination from other apps.
 * A failed registration blocks the session (`stop_hotkey_unavailable`) — a
 * session never runs without a working hotkey.
 *
 * The accelerator is validated structurally (at least two modifiers) before
 * registration, and the supervisor refuses `type_text`/`key`/`hotkey`
 * actions whose chord matches the active hotkey: adapter-injected SendInput
 * keystrokes must not trigger our own stop.
 */
import type { ComputerUseStopController } from "@/entityTypes/computerUseTypes";

/** Structural validation shared with the IPC schema. */
const HOTKEY_MODIFIERS = new Set([
  "Command",
  "Cmd",
  "Control",
  "Ctrl",
  "CommandOrControl",
  "CmdOrCtrl",
  "Alt",
  "Option",
  "AltGr",
  "Shift",
  "Super",
]);

export function isValidStopHotkeyAccelerator(value: string): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  const parts = value.split("+").map((part) => part.trim());
  if (parts.length < 3 || parts.some((part) => part.length === 0)) return false;
  if (parts.slice(0, -1).some((part) => part.includes(" "))) return false;
  const modifierCount = parts
    .slice(0, -1)
    .filter((part) => HOTKEY_MODIFIERS.has(part)).length;
  return modifierCount >= 2;
}

/** Normalize a modifier name for chord comparison. */
function normalizeModifier(mod: string): string {
  const upper = mod.toUpperCase();
  if (upper === "COMMANDORCONTROL" || upper === "CMDORCTRL") return "CTRL_OR_CMD";
  if (upper === "COMMAND" || upper === "CMD") return "CMD";
  if (upper === "CONTROL" || upper === "CTRL") return "CTRL";
  if (upper === "OPTION" || upper === "ALT") return "ALT";
  if (upper === "ALTGR") return "ALTGR";
  if (upper === "SHIFT") return "SHIFT";
  if (upper === "SUPER") return "SUPER";
  return upper;
}

/** Parse an accelerator into normalized modifier set + key. */
export function parseAccelerator(
  accelerator: string
): { modifiers: Set<string>; key: string } | null {
  const parts = accelerator.split("+").map((part) => part.trim());
  if (parts.length < 2) return null;
  const key = parts[parts.length - 1].toUpperCase();
  const modifiers = expandModifiers(parts.slice(0, -1).map((part) => normalizeModifier(part)));
  return { modifiers, key };
}

/**
 * CommandOrControl matches both Ctrl and Cmd: expand the alias into its two
 * concrete modifiers so subset checks work in either direction.
 */
function expandModifiers(modifiers: readonly string[]): Set<string> {
  const expanded = new Set<string>();
  for (const mod of modifiers) {
    if (mod === "CTRL_OR_CMD") {
      expanded.add("CTRL");
      expanded.add("CMD");
    } else {
      expanded.add(mod);
    }
  }
  return expanded;
}

/** An action as considered by the chord rule. */
export interface ChordActionLike {
  readonly actionKind: "type_text" | "key" | "hotkey" | string;
  readonly text?: string;
  readonly key?: string;
  readonly modifiers?: readonly string[];
}

/**
 * True when the action's keystroke would reproduce the active hotkey chord
 * (design §10.5.1). Applies to key/hotkey actions whose modifier set covers
 * the hotkey's modifiers with the same key, and to single-character
 * type_text only when its modifier set covers the hotkey's modifiers.
 */
export function actionMatchesHotkeyChord(
  action: ChordActionLike,
  accelerator: string
): boolean {
  const parsed = parseAccelerator(accelerator);
  if (!parsed) return false;

  let key: string | undefined;
  let modifiers: ReadonlySet<string>;
  if (action.actionKind === "key" || action.actionKind === "hotkey") {
    key = action.key?.toUpperCase();
    modifiers = expandModifiers((action.modifiers ?? []).map(normalizeModifier));
  } else if (action.actionKind === "type_text") {
    // Typing multiple characters cannot hold a chord; only a lone character
    // with held modifiers could re-trigger the hotkey.
    if (!action.text || action.text.length !== 1) return false;
    key = action.text.toUpperCase();
    modifiers = expandModifiers((action.modifiers ?? []).map(normalizeModifier));
  } else {
    return false;
  }
  if (!key || key !== parsed.key) return false;
  for (const required of parsed.modifiers) {
    if (!modifiers.has(required)) return false;
  }
  return true;
}

/** Registration seam over Electron globalShortcut (injected for tests). */
export interface AcceleratorRegistry {
  register(accelerator: string): boolean;
  unregister(accelerator: string): void;
  unregisterAll(): void;
}

export interface StopHotkeyDeps {
  /** Electron globalShortcut wrapper; defaults to a lazy electron import. */
  registry?: AcceleratorRegistry;
  /** Default accelerator (open decision 8; Ctrl+Alt+Shift+S candidate). */
  defaultAccelerator?: string;
  /** Stop callback invoked from the main process when the hotkey fires. */
  onStop: (sessionId: string) => void;
}

export class ComputerUseStopHotkeyService implements ComputerUseStopController {
  private readonly registry: AcceleratorRegistry;
  private readonly defaultAccelerator: string;
  private readonly onStop: (sessionId: string) => void;
  /** Active accelerator -> session id (one session owns the desktop). */
  private active: { accelerator: string; sessionId: string } | null = null;

  constructor(deps: StopHotkeyDeps) {
    this.registry =
      deps.registry ??
      ({
        register: (accelerator) => {
          // Lazy electron require keeps this module importable in tests and
          // in non-electron tooling.
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { globalShortcut } = require("electron");
          return globalShortcut.register(accelerator, () => {
            if (this.active) this.onStop(this.active.sessionId);
          });
        },
        unregister: (accelerator) => {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { globalShortcut } = require("electron");
          globalShortcut.unregister(accelerator);
        },
        unregisterAll: () => {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { globalShortcut } = require("electron");
          globalShortcut.unregisterAll();
        },
      } satisfies AcceleratorRegistry);
    this.defaultAccelerator = deps.defaultAccelerator ?? "Ctrl+Alt+Shift+S";
    this.onStop = deps.onStop;
  }

  /**
   * Register the session's stop hotkey. Returns the registered accelerator,
   * or null when registration failed (the session must not start).
   */
  async register(sessionId: string, accelerator?: string): Promise<string | null> {
    if (this.active) {
      return null;
    }
    const candidate = accelerator ?? this.defaultAccelerator;
    if (!isValidStopHotkeyAccelerator(candidate)) {
      return null;
    }
    const ok = this.registry.register(candidate);
    if (!ok) return null;
    this.active = { accelerator: candidate, sessionId };
    return candidate;
  }

  /** Unregister on every session exit path (STOPPED / FAILED / aborted start). */
  async unregister(sessionId: string): Promise<void> {
    if (this.active?.sessionId !== sessionId) return;
    this.registry.unregister(this.active.accelerator);
    this.active = null;
  }

  /** Hotkey callback path: revokes the same way the Stop button does. */
  triggerStop(sessionId: string): void {
    if (this.active?.sessionId === sessionId) {
      this.onStop(sessionId);
    }
  }

  /** The active hotkey accelerator, or null. */
  get activeAccelerator(): string | null {
    return this.active?.accelerator ?? null;
  }

  /** Whether the given action's chord matches the active hotkey. */
  isActionForbidden(action: ChordActionLike): boolean {
    if (!this.active) return false;
    return actionMatchesHotkeyChord(action, this.active.accelerator);
  }
}
