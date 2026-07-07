// src/service/workspaceWatch/buildWorkspaceCommandDefinitions.ts
// CMD-06 (Phase 15 / Plan 02) — MAIN-PROCESS pure converter from the
// Phase-14 worker's raw WorkspaceCommandDraft[] into validated
// SlashCommandDefinition[] + diagnostics.
//
// The worker (Phase 14) snapshots commands/*.md into opaque drafts and ships
// them across the IPC boundary. Phase 15 converts those drafts in the MAIN
// process by routing each through buildPromptCommandDefinition (Plan 01) — the
// SINGLE owner of the CMD-06 schema — so global and workspace paths share one
// validator. The resulting SlashCommandDefinition objects are then handed to
// AIFetchlyRuntimeRegistrySync.applyWorkspaceSnapshot, where the unchanged
// Phase-14 trust filter still drops commands for untrusted workspaces.
//
// Pure module: imports only types + buildPromptCommandDefinition. NO fs /
// Electron / TypeORM / Vue / other-service imports (verified by the gate grep
// in the plan). Never throws; never mutates the input drafts.

import type { AIFetchlyConfigDiagnostic } from "@/entityTypes/aifetchlyConfigTypes";
import type { SlashCommandDefinition } from "@/entityTypes/slashCommandTypes";
import { buildPromptCommandDefinition } from "@/service/slashCommands/promptCommandFrontmatter";
import type { WorkspaceCommandDraft } from "@/service/workspaceWatch/WorkspaceConfigScanner";

/**
 * Workspace source attribution applied to every produced definition.
 *
 * `source` is always `"workspace"` here (WorkspaceCommandDraft.source is
 * workspace-only); the helper hardcodes it so callers cannot accidentally tag
 * workspace commands as user/plugin.
 */
export interface WorkspaceCommandSourceMeta {
  /** Stable workspace source id, e.g. `workspace:ws1`. */
  readonly sourceId: string;
  /** Human-readable label surfaced in the suggestions badge. */
  readonly sourceLabel: string;
  /** Whether the definition requires workspace trust (true for workspace). */
  readonly requiresTrust: boolean;
}

/**
 * Result of {@link buildWorkspaceCommandDefinitions} — partitioned into
 * validated definitions and per-draft diagnostics for the failures.
 */
export interface WorkspaceCommandBuildResult {
  readonly definitions: SlashCommandDefinition[];
  readonly diagnostics: AIFetchlyConfigDiagnostic[];
}

/**
 * Convert Phase-14 {@link WorkspaceCommandDraft} entries into CMD-06-conformant
 * {@link SlashCommandDefinition} objects (source `"workspace"`), partitioning
 * failures into diagnostics (SC4 workspace path).
 *
 * Each draft's `id` is derived from the VALIDATED frontmatter name (not the
 * filename) via {@link buildPromptCommandDefinition}, producing a stable id of
 * the form `${sourceMeta.sourceId}:command:${name}`.
 *
 * Never throws — an unexpected error from the validator is wrapped as a
 * `scanner-io-error`-style diagnostic so one bad draft cannot abort the batch.
 * Never mutates the input drafts (defensive copies come from the validator).
 */
export function buildWorkspaceCommandDefinitions(
  drafts: readonly WorkspaceCommandDraft[],
  sourceMeta: WorkspaceCommandSourceMeta
): WorkspaceCommandBuildResult {
  const definitions: SlashCommandDefinition[] = [];
  const diagnostics: AIFetchlyConfigDiagnostic[] = [];

  for (const draft of drafts) {
    let result: ReturnType<typeof buildPromptCommandDefinition>;
    try {
      result = buildPromptCommandDefinition(
        {
          frontmatter: draft.frontmatter,
          body: draft.body,
          relativePath: draft.relativePath,
        },
        {
          source: "workspace",
          sourceId: sourceMeta.sourceId,
          sourceLabel: sourceMeta.sourceLabel,
          requiresTrust: sourceMeta.requiresTrust,
        }
      );
    } catch (err) {
      // buildPromptCommandDefinition is contracted to never throw, but defense
      // in depth: one adversarial draft must not abort the whole batch.
      diagnostics.push({
        severity: "warning",
        source: "workspace",
        sourceId: sourceMeta.sourceId,
        filePath: draft.relativePath,
        code: "scanner-io-error",
        message: `unexpected error validating command ${draft.relativePath}: ${
          (err as Error).message
        }`,
        recoverable: true,
      });
      continue;
    }

    if (result.ok) {
      definitions.push(result.definition);
    } else {
      diagnostics.push(result.diagnostic);
    }
  }

  return { definitions, diagnostics };
}
