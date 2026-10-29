/**
 * Host-side trusted action classification (audit F06, CU-PERM-03/04/07).
 *
 * The model/plugin-supplied action class is only a LOWER bound: this
 * classifier inspects the actual gesture — key chord, typed text, and the
 * target's accessible name — and assigns the effective class from host
 * policy. A caller labelling a save/close/delete/overwrite gesture
 * "within_task" cannot downgrade it; observed screen text is never used to
 * EXPAND authority (that direction stays with the task authority).
 */
import type {
  ComputerUseActionClass,
  ComputerUseActionRequest,
} from "@/entityTypes/computerUseTypes";

const CLASS_RANK: Record<ComputerUseActionClass, number> = {
  read_only: 0,
  within_task: 1,
  confirmation_required: 2,
  consequential: 3,
};

/** Patterns that make a gesture consequential regardless of its label. */
const CONSEQUENTIAL_KEY_PATTERNS: ReadonlyArray<{
  key: string;
  modifiers: readonly string[];
}> = [
  // Save / Save As
  { key: "s", modifiers: ["Ctrl"] },
  { key: "s", modifiers: ["Cmd"] },
  // Close window/workbook
  { key: "w", modifiers: ["Ctrl"] },
  { key: "w", modifiers: ["Cmd"] },
  // Delete
  { key: "delete", modifiers: [] },
  { key: "backspace", modifiers: ["Shift"] },
  { key: "f4", modifiers: ["Alt"] },
  // Print (irreversible external side effect)
  { key: "p", modifiers: ["Ctrl"] },
];

/** Typed-text openings that act like commands, not data. */
const CONSEQUENTIAL_TEXT_PREFIXES = [
  "=cmd",
  "=powershell",
  "reg ",
  "del ",
  "rm ",
  "format ",
];

/** Confirmation-needed gestures: risky but reversible within the task. */
const CONFIRMATION_TEXT_MARKERS = [
  "remove duplicates",
  "删除重复项",
  "overwrite",
  "覆盖",
  "replace all",
  "全部替换",
];

function normalizeChord(request: ComputerUseActionRequest): {
  key: string;
  modifiers: Set<string>;
} | null {
  if (request.actionKind === "key" || request.actionKind === "hotkey") {
    if (!request.key) return null;
    return {
      key: request.key.toLowerCase(),
      modifiers: new Set((request.modifiers ?? []).map((m) => m.toLowerCase())),
    };
  }
  return null;
}

/**
 * Classify from the gesture itself. Pointer actions default to
 * within_task (target-name signals are untrusted; the task authority still
 * gates consequential labels), key/text gestures are pattern-checked.
 */
export function classifyActionClass(
  request: ComputerUseActionRequest
): ComputerUseActionClass {
  const chord = normalizeChord(request);
  if (chord) {
    const matches = CONSEQUENTIAL_KEY_PATTERNS.some((pattern) => {
      if (chord.key !== pattern.key.toLowerCase()) return false;
      return pattern.modifiers.every((m) => chord.modifiers.has(m.toLowerCase()));
    });
    if (matches) return "consequential";
    return "within_task";
  }
  if (request.actionKind === "type_text" && request.text) {
    const lower = request.text.toLowerCase();
    if (CONSEQUENTIAL_TEXT_PREFIXES.some((p) => lower.startsWith(p))) {
      return "consequential";
    }
    if (CONFIRMATION_TEXT_MARKERS.some((m) => lower.includes(m))) {
      return "confirmation_required";
    }
    return "within_task";
  }
  if (request.actionKind === "drag") {
    // Drags can reorder/delete rows wholesale; confirm before dispatch.
    return "confirmation_required";
  }
  return "within_task";
}

/** The stricter (higher-rank) of the caller label and the host class wins. */
export function mergeActionClasses(
  callerClass: ComputerUseActionClass,
  hostClass: ComputerUseActionClass
): ComputerUseActionClass {
  return CLASS_RANK[hostClass] > CLASS_RANK[callerClass]
    ? hostClass
    : callerClass;
}
