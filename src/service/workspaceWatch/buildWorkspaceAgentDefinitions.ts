// src/service/workspaceWatch/buildWorkspaceAgentDefinitions.ts
// AGT-02 (Phase 16 / Plan 02) — MAIN-PROCESS pure converter from the
// Phase-16 worker's raw WorkspaceAgentDraft[] into validated
// AgentDefinitionView[] + diagnostics.
//
// The worker (Phase 16 / Plan 02 Task 2) snapshots agents/*.md into opaque
// WorkspaceAgentDraft objects (frontmatter + body + hash) and ships them
// across the IPC boundary. This converter runs in the MAIN process and routes
// each draft through buildAgentDefinition (Plan 01 — the SINGLE owner of the
// AGT-02 schema), so global and workspace paths share one validator. After a
// successful build, detectUnknownTools emits non-fatal agent-tool-invalid
// (DX-01) warnings for tools outside the registered set — the agent is STILL
// registered (D-ToolDiagnostic). The resulting AgentDefinitionView objects
// are handed to AIFetchlyRuntimeRegistrySync.applySnapshot, which calls
// agentRegistry.replaceSource.
//
// Pure module: imports only types + buildAgentDefinition + detectUnknownTools.
// NO fs / Electron / TypeORM / Vue / other-service imports (verified by the
// gate grep in the plan). Never throws; never mutates the input drafts.

import type { AIFetchlyConfigDiagnostic } from "@/entityTypes/aifetchlyConfigTypes";
import type { AgentDefinitionView } from "@/entityTypes/agentTypes";
import {
  buildAgentDefinition,
  detectUnknownTools,
} from "@/service/slashCommands/agentFrontmatter";
import type { WorkspaceAgentDraft } from "@/service/workspaceWatch/WorkspaceConfigScanner";

/**
 * Result of {@link buildWorkspaceAgentDefinitions} — partitioned into
 * validated definitions and per-draft diagnostics for the failures.
 */
export interface WorkspaceAgentBuildResult {
  readonly definitions: AgentDefinitionView[];
  readonly diagnostics: AIFetchlyConfigDiagnostic[];
}

/**
 * Convert Phase-16 {@link WorkspaceAgentDraft} entries into AGT-02-conformant
 * {@link AgentDefinitionView} objects (source `"workspace"`), partitioning
 * validation failures into diagnostics and emitting non-fatal
 * agent-tool-invalid warnings for unregistered tools (SC workspace path).
 *
 * Each draft's `id` is derived from the VALIDATED frontmatter name (not the
 * filename) via {@link buildAgentDefinition}, producing a stable id of the
 * form `${sourceId}:agent:${name}` where sourceId is `workspace:<workspaceId>`.
 *
 * Never throws — an unexpected error from the validator is wrapped as a
 * diagnostic so one bad draft cannot abort the batch. Never mutates the input
 * drafts (defensive copies come from the validator).
 *
 * @param drafts Raw workspace agent drafts from the worker scanner.
 * @param workspaceId The workspace identifier (scoped into the sourceId).
 * @param registeredToolNames Tool names currently registered with the runtime;
 *   drafts referencing tools outside this set still produce a definition AND
 *   a non-fatal agent-tool-invalid warning (D-ToolDiagnostic). Plan 03 wires
 *   the live SkillRegistry set; tests inject a stub set.
 */
export function buildWorkspaceAgentDefinitions(
  drafts: readonly WorkspaceAgentDraft[],
  workspaceId: string,
  registeredToolNames: ReadonlySet<string>
): WorkspaceAgentBuildResult {
  const definitions: AgentDefinitionView[] = [];
  const diagnostics: AIFetchlyConfigDiagnostic[] = [];
  const sourceMeta = {
    source: "workspace" as const,
    sourceId: `workspace:${workspaceId}`,
    sourceLabel: "Workspace",
    requiresTrust: true,
  };

  for (const draft of drafts) {
    let result: ReturnType<typeof buildAgentDefinition>;
    try {
      result = buildAgentDefinition(
        {
          frontmatter: draft.frontmatter,
          body: draft.body,
          relativePath: draft.relativePath,
        },
        sourceMeta
      );
    } catch (err) {
      // buildAgentDefinition is contracted to never throw, but defense in
      // depth: one adversarial draft must not abort the whole batch.
      diagnostics.push({
        severity: "warning",
        source: "workspace",
        sourceId: sourceMeta.sourceId,
        filePath: draft.relativePath,
        code: "scanner-io-error",
        message: `unexpected error validating agent ${draft.relativePath}: ${
          (err as Error).message
        }`,
        recoverable: true,
      });
      continue;
    }

    if (result.ok) {
      definitions.push(result.definition);
      // DX-01 (D-ToolDiagnostic): non-fatal warnings for tools outside the
      // registered set. The agent is still registered above.
      const toolDiagnostics = detectUnknownTools(
        result.definition,
        registeredToolNames
      );
      for (const d of toolDiagnostics) diagnostics.push(d);
    } else {
      diagnostics.push(result.diagnostic);
    }
  }

  return { definitions, diagnostics };
}
