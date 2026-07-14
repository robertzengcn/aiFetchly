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
// SkillImportService.registerImportedSkill). On successful registration the
// skill is also persisted to the DB (fire-and-forget) so the skills UI
// (skill:list-installed IPC → SkillManagementModule.listInstalledSkills)
// sees auto-discovered skills alongside zip-imported ones.
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
 * hold a single instance across rescans so the index persists. The adapter
 * manages the in-memory SkillRegistry; DB persistence is delegated to the
 * SkillManagementModule via fire-and-forget writes so the skills UI stays in
 * sync. DB write failures are non-fatal (the skill is already registered
 * in-memory and functional at the tool-call level).
 */
export class LocalSkillSourceAdapter {
  private readonly sourceIndex = new Map<string, Set<string>>();

  /**
   * Atomically replace the skill set registered for `sourceId`.
   *
   * 1. Read the previously-tracked names for `sourceId`.
   * 2. For each old name, call `SkillRegistry.unregisterSkill(name)` (best-
   *    effort — guard against already-gone; Pitfall 4 / stale entries).
   *    Also remove from DB (fire-and-forget) so the skills UI stays in sync.
   * 3. For each draft, try `SkillImportService.registerImportedSkill(
   *    draft.manifest, draft.skillDir)`:
   *      - success -> add the name to the next Set and persist to DB
   *        (fire-and-forget).
   *      - throw (duplicate-name collision with a built-in or concurrently-
   *        registered skill) -> catch and push a manifest-invalid diagnostic.
   * 4. Set the index to the next Set. Return the diagnostics array.
   */
  replaceSource(
    sourceId: string,
    drafts: readonly LocalSkillDraft[]
  ): AIFetchlyConfigDiagnostic[] {
    const diagnostics: AIFetchlyConfigDiagnostic[] = [];

    const oldNames = this.sourceIndex.get(sourceId);
    if (oldNames) {
      for (const name of oldNames) {
        try {
          SkillRegistry.unregisterSkill(name);
        } catch {
          // Already gone — best-effort.
        }
        this.removeFromDb(name).catch(() => {
          /* DB persistence is best-effort — non-fatal */
        });
      }
    }

    const nextNames = new Set<string>();
    for (const draft of drafts) {
      try {
        SkillImportService.registerImportedSkill(
          draft.manifest,
          draft.skillDir
        );
        nextNames.add(draft.name);
        this.persistToDb(draft).catch(() => {
          /* DB persistence is best-effort — non-fatal */
        });
      } catch (err) {
        const message = (err as Error)?.message ?? String(err);
        diagnostics.push({
          severity: "warning",
          source: sourceId.startsWith("workspace:") ? "workspace" : "user",
          sourceId,
          filePath: `${sourceId}:skill:${draft.name}`,
          code: "manifest-invalid",
          message: `skill name collides with an existing skill: ${draft.name} (${message})`,
          recoverable: true,
        });
      }
    }

    this.sourceIndex.set(sourceId, nextNames);
    return diagnostics;
  }

  /** Persist an auto-discovered skill to the DB (best-effort, fire-and-forget). */
  private async persistToDb(draft: LocalSkillDraft): Promise<void> {
    const { SkillManagementModule } = await import(
      "@/modules/SkillManagementModule"
    );
    const module = new SkillManagementModule();
    await module.ensureConnection();
    await module.installSkill({
      name: draft.manifest.name,
      version: draft.manifest.version,
      source: "user",
      manifest_json: JSON.stringify(draft.manifest),
      enabled: 1,
    });
  }

  /** Remove a skill from the DB (best-effort, fire-and-forget). */
  private async removeFromDb(name: string): Promise<void> {
    const { SkillManagementModule } = await import(
      "@/modules/SkillManagementModule"
    );
    const module = new SkillManagementModule();
    await module.ensureConnection();
    await module.uninstallSkill(name);
  }
}
