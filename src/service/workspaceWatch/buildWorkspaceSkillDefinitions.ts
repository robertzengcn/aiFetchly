// src/service/workspaceWatch/buildWorkspaceSkillDefinitions.ts
// SKL-01 (Phase 18 / Plan 01 Task 2) — MAIN-PROCESS pure converter from the
// worker's raw WorkspaceSkillDraft[] into validated LocalSkillDraft[] +
// diagnostics.
//
// The worker (Phase 18 / Plan 01 Task 2) snapshots
// `<workspace>/.aifetchly/skills/<name>/manifest.json` into an opaque
// WorkspaceSkillDraft (JSON-parsed blob + hash) and ships it across the IPC
// boundary. This converter runs in the MAIN process: it routes each raw
// manifest through buildLocalSkillDraft (Plan 01 — the SINGLE owner of the
// SKL-01 manifest schema, which delegates to SkillImportService.validateManifest
// + the CFG-05 entry path-safety check), so global and workspace paths share
// one validator. The resulting LocalSkillDraft objects are handed to
// AIFetchlyRuntimeRegistrySync.applySnapshot (Task 3), which calls
// LocalSkillSourceAdapter.replaceSource.
//
// Pure module: imports only types + buildLocalSkillDraft. NO fs / Electron /
// TypeORM / Vue / other-service imports (WAT-02 boundary holds for the worker;
// this converter is main-side but stays dependency-light). Never throws; never
// mutates the input drafts.

import type {
  AIFetchlyConfigDiagnostic,
  WorkspaceSkillDraft,
} from "@/entityTypes/aifetchlyConfigTypes";
import {
  buildLocalSkillDraft,
  type LocalSkillDraft,
} from "@/service/aifetchlyConfig/buildLocalSkillDraft";

/** Result of {@link buildWorkspaceSkillDefinitions}. */
export interface WorkspaceSkillBuildResult {
  readonly definitions: LocalSkillDraft[];
  readonly diagnostics: AIFetchlyConfigDiagnostic[];
}

/**
 * Convert Phase-18 {@link WorkspaceSkillDraft} entries into validated
 * {@link LocalSkillDraft} objects (source `"workspace"`), partitioning
 * validation failures into diagnostics.
 *
 * Each draft carries the JSON-parsed manifest blob as opaque `rawManifest`.
 * This converter routes each through {@link buildLocalSkillDraft} with a
 * stable id of the form `workspace:<workspaceId>:skill:<name>` where the
 * sourceId is `workspace:<workspaceId>`.
 *
 * Never throws — an unexpected error from the validator is wrapped as a
 * manifest-invalid diagnostic so one bad draft cannot abort the batch. Never
 * mutates the input drafts.
 *
 * @param drafts Raw workspace skill drafts from the worker scanner (one per
 *   skill directory; `rawManifest` is the parsed blob as `unknown`, `null`
 *   when the worker's JSON.parse failed).
 * @param workspaceId The workspace identifier (scoped into the sourceId).
 */
export function buildWorkspaceSkillDefinitions(
  drafts: readonly WorkspaceSkillDraft[],
  workspaceId: string
): WorkspaceSkillBuildResult {
  const definitions: LocalSkillDraft[] = [];
  const diagnostics: AIFetchlyConfigDiagnostic[] = [];
  const sourceId = `workspace:${workspaceId}`;

  for (const draft of drafts) {
    const sourceMeta = {
      source: "workspace" as const,
      sourceId,
      relativePath: draft.relativePath,
    };

    try {
      const result = buildLocalSkillDraft(
        draft.rawManifest,
        sourceMeta,
        draft.skillDir,
        draft.contentHash
      );
      if (result.ok) {
        definitions.push(result.draft);
      } else {
        diagnostics.push(result.diagnostic);
      }
    } catch (err) {
      // buildLocalSkillDraft is contracted to never throw, but defense in
      // depth: one adversarial draft must not abort the whole batch.
      diagnostics.push({
        severity: "warning",
        source: "workspace",
        sourceId,
        filePath: draft.relativePath,
        code: "manifest-invalid",
        message: `unexpected error validating skill ${draft.name} in ${draft.relativePath}: ${
          (err as Error).message
        }`,
        recoverable: true,
      });
    }
  }

  return { definitions, diagnostics };
}
