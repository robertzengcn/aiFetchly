/**
 * PortableWorkspaceMemoryBridgeService — optional AGENTS.md / CLAUDE.md
 * instruction bridges for external-agent discoverability (design §17).
 *
 * Managed-block contract:
 *   - Exact delimited markers per target; one block per file.
 *   - Preview computes the unified diff + before-hash WITHOUT writing.
 *   - Apply re-resolves the workspace, compares beforeHash (conflict → new
 *     preview required), and atomically writes the exact managed-block edit.
 *   - Remove deletes exactly the managed block, preserving all other bytes.
 *   - Duplicate/malformed markers → blocked with a diagnostic, never a
 *     heuristic overwrite (AC-010: unrelated content byte-for-byte unchanged).
 */

import * as fsp from "fs/promises";
import path from "path";
import { createHash } from "crypto";
import writeFileAtomic from "write-file-atomic";
import type { PortableMemoryDiagnosticView } from "@/entityTypes/portableWorkspaceMemoryTypes";

export const BRIDGE_START = "<!-- aifetchly:project-memory:start -->";
export const BRIDGE_END = "<!-- aifetchly:project-memory:end -->";

export type BridgeTarget = "AGENTS.md" | "CLAUDE.md";

export interface PortableMemoryBridgePreview {
  readonly target: BridgeTarget;
  readonly exists: boolean;
  readonly action: "create" | "insert" | "replace" | "no-op" | "blocked";
  readonly beforeHash?: string;
  readonly unifiedDiff: string;
  readonly diagnostic?: PortableMemoryDiagnosticView;
}

export interface PortableMemoryBridgeResult {
  readonly target: BridgeTarget;
  readonly applied: boolean;
  readonly message: string;
}

function buildBridgeBlock(): string {
  return [
    BRIDGE_START,
    "",
    "## Project memory",
    "",
    "Read `.aifetchly/memory/INDEX.md` before making project-level decisions.",
    "Open linked memory records when their details are relevant.",
    "Follow `.aifetchly/memory/README.md` when adding durable memory.",
    "",
    BRIDGE_END,
  ].join("\n");
}

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function blockedDiagnostic(
  target: BridgeTarget,
  message: string
): PortableMemoryDiagnosticView {
  return {
    code: "memory-content-invalid",
    relativePath: target,
    message,
    recoverable: false,
  };
}

export class PortableWorkspaceMemoryBridgeService {
  /**
   * Inspect the target file and compute a preview. Never writes.
   */
  async preview(
    canonicalRoot: string,
    target: BridgeTarget
  ): Promise<PortableMemoryBridgePreview> {
    const filePath = path.join(canonicalRoot, target);
    const block = buildBridgeBlock();
    let existing: string | null = null;
    try {
      existing = await fsp.readFile(filePath, "utf8");
    } catch {
      existing = null;
    }

    if (existing === null) {
      return {
        target,
        exists: false,
        action: "create",
        unifiedDiff: unifiedDiff("", `${block}\n`),
      };
    }

    const startCount = existing.split(BRIDGE_START).length - 1;
    const endCount = existing.split(BRIDGE_END).length - 1;
    if (startCount > 1 || endCount > 1) {
      return {
        target,
        exists: true,
        action: "blocked",
        beforeHash: sha256(existing),
        unifiedDiff: "",
        diagnostic: blockedDiagnostic(
          target,
          "file contains duplicate managed blocks; resolve manually first"
        ),
      };
    }
    const startIdx = existing.indexOf(BRIDGE_START);
    const endIdx = existing.indexOf(BRIDGE_END);
    if (startCount === 1 && endCount === 1 && endIdx < startIdx) {
      return {
        target,
        exists: true,
        action: "blocked",
        beforeHash: sha256(existing),
        unifiedDiff: "",
        diagnostic: blockedDiagnostic(
          target,
          "managed block markers are out of order; resolve manually first"
        ),
      };
    }

    if (startIdx >= 0) {
      const afterEnd = endIdx + BRIDGE_END.length;
      const next =
        existing.slice(0, startIdx) +
        block +
        existing.slice(afterEnd).replace(/^\n/, "\n");
      if (next === existing) {
        return {
          target,
          exists: true,
          action: "no-op",
          beforeHash: sha256(existing),
          unifiedDiff: "",
        };
      }
      return {
        target,
        exists: true,
        action: "replace",
        beforeHash: sha256(existing),
        unifiedDiff: unifiedDiff(existing, next),
      };
    }

    const next = `${existing.replace(/\n+$/, "")}\n\n${block}\n`;
    return {
      target,
      exists: true,
      action: "insert",
      beforeHash: sha256(existing),
      unifiedDiff: unifiedDiff(existing, next),
    };
  }

  /**
   * Apply a previewed bridge. Requires the expected beforeHash; a changed
   * file returns a conflict-style result instead of overwriting.
   */
  async apply(input: {
    readonly canonicalRoot: string;
    readonly target: BridgeTarget;
    readonly expectedBeforeHash?: string;
  }): Promise<PortableMemoryBridgeResult> {
    const filePath = path.join(input.canonicalRoot, input.target);
    const block = buildBridgeBlock();
    let existing: string | null = null;
    try {
      existing = await fsp.readFile(filePath, "utf8");
    } catch {
      existing = null;
    }
    const currentHash = existing === null ? undefined : sha256(existing);
    if (
      input.expectedBeforeHash !== undefined &&
      input.expectedBeforeHash !== currentHash
    ) {
      return {
        target: input.target,
        applied: false,
        message: "file changed since preview; request a new preview",
      };
    }

    const preview = await this.preview(input.canonicalRoot, input.target);
    if (preview.action === "blocked") {
      return {
        target: input.target,
        applied: false,
        message: preview.diagnostic?.message ?? "bridge blocked",
      };
    }
    if (preview.action === "no-op") {
      return { target: input.target, applied: true, message: "bridge already present" };
    }

    let next: string;
    if (existing === null) {
      next = `${block}\n`;
    } else {
      const startIdx = existing.indexOf(BRIDGE_START);
      if (startIdx >= 0) {
        const endIdx = existing.indexOf(BRIDGE_END);
        const afterEnd = endIdx + BRIDGE_END.length;
        next =
          existing.slice(0, startIdx) +
          block +
          existing.slice(afterEnd).replace(/^\n/, "\n");
      } else {
        next = `${existing.replace(/\n+$/, "")}\n\n${block}\n`;
      }
    }
    await writeFileAtomic(filePath, next, "utf8");
    return { target: input.target, applied: true, message: "bridge installed" };
  }

  /**
   * Remove the managed block, preserving all other bytes. Unknown content
   * without a block is a no-op.
   */
  async remove(input: {
    readonly canonicalRoot: string;
    readonly target: BridgeTarget;
    readonly expectedBeforeHash?: string;
  }): Promise<PortableMemoryBridgeResult> {
    const filePath = path.join(input.canonicalRoot, input.target);
    let existing: string | null = null;
    try {
      existing = await fsp.readFile(filePath, "utf8");
    } catch {
      return { target: input.target, applied: false, message: "file not found" };
    }
    if (input.expectedBeforeHash !== undefined) {
      if (input.expectedBeforeHash !== sha256(existing)) {
        return {
          target: input.target,
          applied: false,
          message: "file changed since preview; request a new preview",
        };
      }
    }
    const startIdx = existing.indexOf(BRIDGE_START);
    const endIdx = existing.indexOf(BRIDGE_END);
    if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) {
      return { target: input.target, applied: false, message: "no managed block" };
    }
    const afterEnd = endIdx + BRIDGE_END.length;
    let next =
      existing.slice(0, startIdx) + existing.slice(afterEnd);
    next = next.replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "").replace(/\n+$/, "\n");
    if (next === "\n" || next.trim() === "") {
      // Only the block existed — remove the file entirely.
      await fsp.unlink(filePath);
    } else {
      await writeFileAtomic(filePath, next, "utf8");
    }
    return { target: input.target, applied: true, message: "bridge removed" };
  }
}

/** Minimal deterministic unified-diff rendering for previews. */
function unifiedDiff(before: string, after: string): string {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const output: string[] = ["--- a", "+++ b"];
  let i = 0;
  let j = 0;
  while (i < beforeLines.length || j < afterLines.length) {
    if (
      i < beforeLines.length &&
      j < afterLines.length &&
      beforeLines[i] === afterLines[j]
    ) {
      i += 1;
      j += 1;
      continue;
    }
    // Emit a hunk around the divergence.
    const hunkStart = Math.max(0, i - 3);
    output.push(`@@ -${hunkStart + 1} +${Math.max(0, j - 3) + 1} @@`);
    for (let k = Math.max(0, i - 3); k < i; k++) {
      output.push(` ${beforeLines[k]}`);
    }
    while (
      i < beforeLines.length &&
      (j >= afterLines.length || beforeLines[i] !== afterLines[j])
    ) {
      output.push(`-${beforeLines[i]}`);
      i += 1;
    }
    while (
      j < afterLines.length &&
      (i >= beforeLines.length || beforeLines[i] !== afterLines[j])
    ) {
      output.push(`+${afterLines[j]}`);
      j += 1;
    }
  }
  return output.join("\n");
}
