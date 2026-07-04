/**
 * STUB — RED phase of TDD for the snapshot diff (CFG-06).
 *
 * The real implementation lands in the GREEN commit. This stub always reports
 * "no changes" so the diff assertions fail.
 */

import type {
  AIFetchlyConfigDiff,
  AIFetchlyConfigSnapshot,
} from "@/entityTypes/aifetchlyConfigTypes";

export function computeSnapshotDiff(
  _prev: AIFetchlyConfigSnapshot | null,
  _next: AIFetchlyConfigSnapshot
): AIFetchlyConfigDiff {
  return {
    added: [],
    changed: [],
    removed: [],
    commandsChanged: false,
    agentsChanged: false,
    skillsChanged: false,
    hooksChanged: false,
    instructionsChanged: false,
    diagnosticsChanged: false,
  };
}
