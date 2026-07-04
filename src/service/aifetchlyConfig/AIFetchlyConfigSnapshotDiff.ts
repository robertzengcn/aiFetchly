/**
 * computeSnapshotDiff — CFG-06 snapshot diff.
 *
 * Pure function that compares two AIFetchlyConfigSnapshots and produces an
 * AIFetchlyConfigDiff for UI/logging use (design §5.7). Runtime correctness
 * MUST come from source replacement using the full snapshot — the diff is a
 * signal, not a patch.
 *
 * Comparison rules:
 *   - files: identity = relativePath, equality = contentHash
 *     -> added / changed / removed path arrays (sorted for determinism)
 *   - instructions: identity = id, equality = contentHash
 *     -> instructionsChanged boolean
 *   - commands / agents / hooks / skills: identity = id
 *     -> per-capability Changed boolean (forward-compat: empty in phase 13)
 *   - diagnostics: structural key (severity + code + filePath + message)
 *     -> diagnosticsChanged boolean
 *
 * prev = null is the initial scan: every next file is "added".
 */

import type {
  AIFetchlyConfigDiagnostic,
  AIFetchlyConfigDiff,
  AIFetchlyConfigFileSnapshot,
  AIFetchlyConfigSnapshot,
  AIFetchlyInstructionBlock,
} from "@/entityTypes/aifetchlyConfigTypes";

export function computeSnapshotDiff(
  prev: AIFetchlyConfigSnapshot | null,
  next: AIFetchlyConfigSnapshot
): AIFetchlyConfigDiff {
  const prevFiles = indexFiles(prev ? prev.files : []);
  const nextFiles = indexFiles(next.files);

  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];

  for (const [relativePath, nextFile] of nextFiles) {
    const prevFile = prevFiles.get(relativePath);
    if (!prevFile) {
      added.push(relativePath);
    } else if (prevFile.contentHash !== nextFile.contentHash) {
      changed.push(relativePath);
    }
  }
  for (const relativePath of prevFiles.keys()) {
    if (!nextFiles.has(relativePath)) {
      removed.push(relativePath);
    }
  }
  added.sort();
  changed.sort();
  removed.sort();

  return {
    added,
    changed,
    removed,
    instructionsChanged: instructionsChanged(
      prev ? prev.instructions : [],
      next.instructions
    ),
    commandsChanged: capabilityChanged(
      prev ? prev.commands : [],
      next.commands
    ),
    agentsChanged: capabilityChanged(prev ? prev.agents : [], next.agents),
    hooksChanged: capabilityChanged(prev ? prev.hooks : [], next.hooks),
    skillsChanged: capabilityChanged(prev ? prev.skills : [], next.skills),
    diagnosticsChanged: diagnosticsChanged(
      prev ? prev.diagnostics : [],
      next.diagnostics
    ),
  };
}

function indexFiles(
  files: readonly AIFetchlyConfigFileSnapshot[]
): Map<string, AIFetchlyConfigFileSnapshot> {
  const m = new Map<string, AIFetchlyConfigFileSnapshot>();
  for (const f of files) m.set(f.relativePath, f);
  return m;
}

function instructionsChanged(
  prev: readonly AIFetchlyInstructionBlock[],
  next: readonly AIFetchlyInstructionBlock[]
): boolean {
  if (prev.length !== next.length) return true;
  const prevHashes = new Map<string, string>();
  for (const b of prev) prevHashes.set(b.id, b.contentHash);
  for (const n of next) {
    const prevHash = prevHashes.get(n.id);
    if (prevHash === undefined) return true; // new id
    if (prevHash !== n.contentHash) return true; // content changed
  }
  return false;
}

/**
 * Compare a capability array (commands/agents/hooks/skills) by id set.
 * In phase 13 these arrays are always empty, so this always returns false;
 * the logic is forward-compatible for when Plans 02/16/17/18 populate them.
 */
function capabilityChanged(
  prev: readonly unknown[],
  next: readonly unknown[]
): boolean {
  if (prev.length !== next.length) return true;
  const prevIds = new Set<unknown>();
  for (const x of prev) prevIds.add((x as { id?: unknown })?.id);
  const nextIds = new Set<unknown>();
  for (const x of next) nextIds.add((x as { id?: unknown })?.id);
  if (prevIds.size !== nextIds.size) return true;
  for (const id of nextIds) {
    if (!prevIds.has(id)) return true;
  }
  return false;
}

function diagnosticsChanged(
  prev: readonly AIFetchlyConfigDiagnostic[],
  next: readonly AIFetchlyConfigDiagnostic[]
): boolean {
  if (prev.length !== next.length) return true;
  const key = (d: AIFetchlyConfigDiagnostic) =>
    `${d.severity}|${d.code}|${d.filePath}|${d.message}`;
  const prevKeys = new Set(prev.map(key));
  const nextKeys = new Set(next.map(key));
  if (prevKeys.size !== nextKeys.size) return true;
  for (const k of nextKeys) {
    if (!prevKeys.has(k)) return true;
  }
  return false;
}
