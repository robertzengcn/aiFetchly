// src/service/workspaceWatch/buildWorkspaceHookDefinitions.ts
// HOK-01 (Phase 17 / Plan 02) — MAIN-PROCESS pure converter from the worker's
// raw WorkspaceHookDraft[] into validated CommandHookDefinition[] +
// diagnostics.
//
// The worker (Phase 17 / Plan 02 Task 1) snapshots .aifetchly/hooks/hooks.json
// into an opaque WorkspaceHookDraft (JSON-parsed blob + hash) and ships it
// across the IPC boundary. This converter runs in the MAIN process: it
// confirms the blob is an array, enforces the CFG-06 maxHooksPerSource count
// cap, and routes each entry through buildHookDefinition (Plan 02 — the SINGLE
// owner of the HOK-01 schema), so global and workspace paths share one
// validator. The resulting CommandHookDefinition objects are handed to
// AIFetchlyRuntimeRegistrySync.applySnapshot (Task 2a), which calls
// hookRegistry.replaceSource.
//
// Pure module: imports only types + buildHookDefinition + AIFetchlyConfigConstants.
// NO fs / Electron / TypeORM / Vue / other-service imports (verified by the
// gate grep in the plan). Never throws; never mutates the input drafts.

import type { AIFetchlyConfigDiagnostic } from "@/entityTypes/aifetchlyConfigTypes";
import type { CommandHookDefinition } from "@/entityTypes/hookTypes";
import { buildHookDefinition } from "@/service/hooks/hookFileFrontmatter";
import { AIFETCHLY_CONFIG_LIMITS } from "@/service/aifetchlyConfig/AIFetchlyConfigConstants";
import type { WorkspaceHookDraft } from "@/service/workspaceWatch/WorkspaceConfigScanner";

/** Result of {@link buildWorkspaceHookDefinitions}. */
export interface WorkspaceHookBuildResult {
  readonly definitions: CommandHookDefinition[];
  readonly diagnostics: AIFetchlyConfigDiagnostic[];
}

/**
 * Convert Phase-17 {@link WorkspaceHookDraft} entries into HOK-01-conformant
 * {@link CommandHookDefinition} objects (source `"project"` for workspace per
 * A3), partitioning validation failures into diagnostics.
 *
 * Each draft carries the JSON-parsed hooks.json blob as opaque `raw`. This
 * converter confirms `raw` is an array (else a hooks-json-invalid diagnostic),
 * then validates each entry via {@link buildHookDefinition} with a stable id
 * of the form `${sourceId}:hook:${index}` where sourceId is
 * `workspace:<workspaceId>`.
 *
 * The CFG-06 maxHooksPerSource count cap drops surplus valid entries with a
 * single count-cap diagnostic (mirrors the global loader's cap).
 *
 * Never throws — an unexpected error from the validator is wrapped as a
 * scanner-io-error diagnostic so one bad draft cannot abort the batch. Never
 * mutates the input drafts (defensive copies come from the validator).
 *
 * @param drafts Raw workspace hook drafts from the worker scanner (one per
 *   hooks.json file; `raw` is the parsed array as `unknown`).
 * @param workspaceId The workspace identifier (scoped into the sourceId).
 */
export function buildWorkspaceHookDefinitions(
  drafts: readonly WorkspaceHookDraft[],
  workspaceId: string
): WorkspaceHookBuildResult {
  const definitions: CommandHookDefinition[] = [];
  const diagnostics: AIFetchlyConfigDiagnostic[] = [];
  const sourceId = `workspace:${workspaceId}`;
  const sourceMeta = {
    source: "workspace" as const,
    sourceId,
    relativePath: "",
  };

  let capped = false;

  for (const draft of drafts) {
    const draftMeta = { ...sourceMeta, relativePath: draft.relativePath };

    // The worker ships the JSON-parsed blob as unknown; confirm it is an array
    // here (main-side validation, WAT-02). null raw means the worker's
    // JSON.parse failed.
    let entries: unknown[];
    try {
      if (draft.raw === null || !Array.isArray(draft.raw)) {
        diagnostics.push({
          severity: "warning",
          source: "workspace",
          sourceId,
          filePath: draft.relativePath,
          code: "hooks-json-invalid",
          message: `${draft.relativePath} is not valid JSON or its top-level is not an array`,
          recoverable: true,
        });
        continue;
      }
      entries = draft.raw as unknown[];
    } catch (err) {
      diagnostics.push({
        severity: "warning",
        source: "workspace",
        sourceId,
        filePath: draft.relativePath,
        code: "scanner-io-error",
        message: `unexpected error reading ${draft.relativePath}: ${
          (err as Error).message
        }`,
        recoverable: true,
      });
      continue;
    }

    for (let index = 0; index < entries.length; index++) {
      // CFG-06: count cap — once maxHooksPerSource valid definitions are
      // accepted, drop the surplus with a single count-cap diagnostic.
      if (definitions.length >= AIFETCHLY_CONFIG_LIMITS.maxHooksPerSource) {
        if (!capped) {
          diagnostics.push({
            severity: "warning",
            source: "workspace",
            sourceId,
            filePath: draft.relativePath,
            code: "count-cap",
            message: `hook count reached the ${AIFETCHLY_CONFIG_LIMITS.maxHooksPerSource}-per-source cap; skipping remaining entries`,
            recoverable: true,
          });
          capped = true;
        }
        break;
      }
      try {
        const result = buildHookDefinition(entries[index], draftMeta, index);
        if (result.ok) {
          definitions.push(result.definition);
        } else {
          diagnostics.push(result.diagnostic);
        }
      } catch (err) {
        // buildHookDefinition is contracted to never throw, but defense in
        // depth: one adversarial entry must not abort the whole batch.
        diagnostics.push({
          severity: "warning",
          source: "workspace",
          sourceId,
          filePath: draft.relativePath,
          code: "scanner-io-error",
          message: `unexpected error validating hook #${index} in ${draft.relativePath}: ${
            (err as Error).message
          }`,
          recoverable: true,
        });
      }
    }
  }

  return { definitions, diagnostics };
}
