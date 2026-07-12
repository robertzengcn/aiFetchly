// src/service/LocalSkillSourceAdapter.ts
// SKL-01 (Phase 18 / Plan 01 Task 3) — source-reconciliation adapter that
// gives SkillRegistry replaceSource-style semantics WITHOUT rewriting it.
//
// Background (18-RESEARCH Pattern 8 / Finding #6): SkillRegistry has
// `registerSkill` (throws on duplicate name) and `unregisterSkill`, but NO
// `replaceSource` method (unlike CommandRegistry / AgentDefinitionRegistry /
// HookRegistry). CONTEXT.md locks "do not rewrite SkillRegistry". This
// adapter bridges the gap: it tracks sourceId -> Set<skillName> and performs
// unregister-then-register reconciliation on every rescan, mirroring the
// atomic delete-then-insert semantics of CommandRegistry.replaceSource.
//
// Lifecycle: constructed ONCE and held by AIFetchlyRuntimeRegistrySync as a
// private field, so the sourceId -> names index persists across rescans.
// Each call to {@link replaceSource} is an atomic replace for that sourceId:
// the previously-tracked names for that sourceId are dropped (via
// SkillRegistry.unregisterSkill), then the new draft set is registered (via
// SkillImportService.registerImportedSkill). Collisions with built-in or
// concurrently-registered skills are caught and surfaced as manifest-invalid
// diagnostics (T-spoof-builtin / T-18-02 — built-in names ALWAYS win).
//
// Per D-SkillEnable: no per-skill "enable" flag — registration is immediate,
// gating is at call time via the existing SkillPermissionService.

import type { AIFetchlyConfigDiagnostic } from "@/entityTypes/aifetchlyConfigTypes";
import type { LocalSkillDraft } from "@/service/aifetchlyConfig/buildLocalSkillDraft";
import { SkillRegistry } from "@/config/skillsRegistry";
import { SkillImportService } from "@/service/SkillImportService";

/**
 * Source-reconciliation adapter bridging SkillRegistry's missing `replaceSource`.
 *
 * Stateless across instances EXCEPT for the private sourceIndex; callers MUST
 * hold a single instance across rescans so the index persists. Construct via
 * `new LocalSkillSourceAdapter()` (the AIFetchlyRuntimeRegistrySync owns one).
 */
export class LocalSkillSourceAdapter {
  /**
   * sourceId -> Set of skill names currently registered for that source.
   * Tracks what THIS adapter has registered so rescans can reconcile.
   */
  private readonly sourceIndex = new Map<string, Set<string>>();

  /**
   * Atomically replace the skill set registered for `sourceId`.
   *
   * 1. Read the previously-tracked names for `sourceId`.
   * 2. For each old name, call `SkillRegistry.unregisterSkill(name)` (best-
   *    effort — guard against already-gone; Pitfall 4 / stale entries).
   * 3. For each draft, try `SkillImportService.registerImportedSkill(
   *    draft.manifest, draft.skillDir)`:
   *      - success -> add the name to the next Set.
   *      - throw (duplicate-name collision with a built-in or concurrently-
   *        registered skill) -> catch and push a manifest-invalid diagnostic
   *        ("skill name collides with an existing skill: <name>"); built-in
   *        names ALWAYS win (T-spoof-builtin).
   * 4. Set the index to the next Set. Return the diagnostics array.
   *
   * NEVER throws — every registration failure is caught and surfaced as a
   * non-fatal diagnostic so one bad draft cannot abort the batch.
   */
  replaceSource(
    sourceId: string,
    drafts: readonly LocalSkillDraft[]
  ): AIFetchlyConfigDiagnostic[] {
    const diagnostics: AIFetchlyConfigDiagnostic[] = [];

    // 1. Unregister the old set for this source (reconciliation).
    const oldNames = this.sourceIndex.get(sourceId);
    if (oldNames) {
      for (const name of oldNames) {
        try {
          SkillRegistry.unregisterSkill(name);
        } catch {
          // Already gone (e.g. manually uninstalled) — best-effort.
        }
      }
    }

    // 2. Register the new set, catching collisions.
    const nextNames = new Set<string>();
    for (const draft of drafts) {
      try {
        SkillImportService.registerImportedSkill(draft.manifest, draft.skillDir);
        nextNames.add(draft.name);
      } catch (err) {
        // Collisions with built-in / concurrently-registered skills surface as
        // manifest-invalid diagnostics. Built-in names ALWAYS win.
        const message = (err as Error)?.message ?? String(err);
        diagnostics.push({
          severity: "warning",
          // source/sourceId derived from the sourceId; LocalSkillDraft does not
          // carry a sourceKind, so infer from the sourceId namespace.
          source: sourceId.startsWith("workspace:") ? "workspace" : "user",
          sourceId,
          filePath: `${sourceId}:skill:${draft.name}`,
          code: "manifest-invalid",
          message: `skill name collides with an existing skill: ${draft.name} (${message})`,
          recoverable: true,
        });
      }
    }

    // 3. Commit the new set.
    this.sourceIndex.set(sourceId, nextNames);
    return diagnostics;
  }
}
