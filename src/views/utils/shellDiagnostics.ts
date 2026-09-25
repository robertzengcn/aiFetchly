/**
 * Structured, content-free shell diagnostics (technical design §22, PRD §29).
 *
 * Every event is a bounded object of enums, booleans, counts, and HASHED
 * identifiers — never prompts, transcripts, workspace paths, voice audio,
 * tokens, or raw exception text. Events are kept in a small ring buffer for
 * development inspection and emitted on the debug console; nothing leaves the
 * renderer process.
 */

export type ShellDiagnosticEvent =
  | {
      readonly type: "shell.mounted";
      readonly duplicateCount: number;
    }
  | {
      readonly type: "shell.route_changed";
      readonly from: string | null;
      readonly to: string | null;
    }
  | {
      readonly type: "shell.navigation_overlay_changed";
      readonly mode: string;
      readonly open: boolean;
    }
  | {
      readonly type: "chat.selection_loaded";
      readonly conversationHash: string;
      readonly generation: number;
      readonly latencyMs: number;
      readonly outcome: "ok" | "error" | "superseded";
    }
  | {
      readonly type: "chat.workspace_loaded";
      readonly conversationHash: string;
      readonly assigned: boolean;
      readonly approved: boolean;
      readonly latencyMs: number;
    }
  | {
      readonly type: "chat.workspace_load_failed";
      readonly conversationHash: string;
      /** Bounded failure category only — never the raw error text. */
      readonly category: "network" | "unknown";
    }
  | {
      readonly type: "voice.settings_loaded";
      readonly inputEnabled: boolean;
      readonly spokenEnabled: boolean;
      readonly runtimeReady: boolean;
      readonly outcome: "ok" | "error";
    };

/** Development ring buffer bound — diagnostics never grow unbounded. */
const RING_CAP = 100;

const ring: ShellDiagnosticEvent[] = [];

/** Non-cryptographic correlation hash (djb2) — identifiers stay opaque. */
export function hashConversationId(id: string | null): string {
  if (!id) return "none";
  let hash = 5381;
  for (let i = 0; i < id.length; i += 1) {
    hash = ((hash << 5) + hash + id.charCodeAt(i)) | 0;
  }
  return `h${(hash >>> 0).toString(36)}`;
}

/** Classify an unknown failure into a bounded public category. */
export function workspaceFailureCategory(err: unknown): "network" | "unknown" {
  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : "";
  if (
    name === "TypeError" ||
    /network|fetch|timeout|ECONN|ENOTFOUND|abort/i.test(message)
  ) {
    return "network";
  }
  return "unknown";
}

export function emitShellDiagnostic(event: ShellDiagnosticEvent): void {
  ring.push(event);
  if (ring.length > RING_CAP) ring.shift();
  // Debug-level structured line: content-free by construction. The renderer
  // cannot import the Node logger (renderer node-leak guard), so the debug
  // console is the transport; nothing is persisted or sent off-process.
  console.debug("[shell-diagnostic]", JSON.stringify(event));
}

/** Read-only snapshot for development inspection and tests. */
export function getShellDiagnostics(): readonly ShellDiagnosticEvent[] {
  return [...ring];
}

/** Test-only reset of the ring buffer. */
export function resetShellDiagnosticsForTesting(): void {
  ring.length = 0;
}

// --- Development duplicate-shell detection (design §22 / PRD §29) -----------

let liveShellCount = 0;
let duplicateShellWarned = false;

/** Track authenticated-shell mounts; >1 live instance is a shell bug. */
export function trackShellMounted(): { readonly duplicates: number } {
  liveShellCount += 1;
  if (liveShellCount > 1 && !duplicateShellWarned) {
    duplicateShellWarned = true;
    console.warn(
      `[shell-diagnostic] duplicate shell detected: ${liveShellCount} live instances`
    );
  }
  return { duplicates: liveShellCount - 1 };
}

export function trackShellUnmounted(): void {
  liveShellCount = Math.max(0, liveShellCount - 1);
  if (liveShellCount === 0) duplicateShellWarned = false;
}
