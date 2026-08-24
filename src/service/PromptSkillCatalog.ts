/**
 * PromptSkillCatalog — the separate, scoped registry for prompt skills
 * (design §10.1, §17; PRD §13.5).
 *
 * Prompt skills are NOT forced through the executable SkillRegistry. The
 * catalog:
 *   - registers definitions under scoped runtime ids
 *     (`prompt:user:<installationId>`, `prompt:workspace:<ws>:<id>`, …);
 *   - deduplicates by canonical SKILL.md real path (two entries resolving to
 *     the same file are one skill);
 *   - resolves names by source precedence workspace > user > plugin >
 *     built-in, with ambiguity surfaced instead of guessed;
 *   - never deletes another source's rows or files — collisions are
 *     diagnostics only (§17: native replaceSource semantics);
 *   - exposes a bounded metadata view that never contains instruction bodies.
 */

import type {
  AvailablePromptSkill,
  PromptSkillCatalogDiagnostic,
  PromptSkillDefinition,
  PromptSkillResolutionContext,
  SkillRuntimeId,
  SkillScope,
} from "@/entityTypes/promptSkillTypes";

const SCOPE_PRECEDENCE: readonly SkillScope[] = [
  "workspace",
  "user",
  "plugin",
  "built-in",
];

export const PROMPT_SKILL_CATALOG_MAX_ENTRIES = 100;

export interface CatalogReplaceResult {
  readonly registered: readonly PromptSkillDefinition[];
  readonly diagnostics: readonly PromptSkillCatalogDiagnostic[];
}

export interface CatalogResolveResult {
  readonly definition: PromptSkillDefinition | null;
  readonly diagnostics: readonly PromptSkillCatalogDiagnostic[];
  /** Present when a visible name matches more than one skill. */
  readonly ambiguousCandidates?: readonly AvailablePromptSkill[];
}

export function buildPromptSkillRuntimeId(
  scope: SkillScope,
  installationId: string,
  workspaceId?: number
): SkillRuntimeId {
  if (scope === "workspace") {
    return `prompt:workspace:${workspaceId ?? 0}:${installationId}`;
  }
  return `prompt:${scope}:${installationId}`;
}

export class PromptSkillCatalog {
  private readonly byRuntimeId = new Map<
    SkillRuntimeId,
    PromptSkillDefinition
  >();
  private readonly bySource = new Map<string, SkillRuntimeId[]>();
  /** canonical SKILL.md real path → runtime id (dedup). */
  private readonly byRealPath = new Map<string, SkillRuntimeId>();

  /**
   * Atomically replace the skills contributed by one source (design §17:
   * native replaceSource — never async unregister/delete of other sources).
   */
  replaceSource(
    sourceId: string,
    skills: readonly PromptSkillDefinition[]
  ): CatalogReplaceResult {
    const diagnostics: PromptSkillCatalogDiagnostic[] = [];
    const registered: PromptSkillDefinition[] = [];

    // Drop the source's previous registrations.
    for (const runtimeId of this.bySource.get(sourceId) ?? []) {
      const existing = this.byRuntimeId.get(runtimeId);
      if (existing) {
        this.byRuntimeId.delete(runtimeId);
        if (this.byRealPath.get(existing.skillMarkdownPath) === runtimeId) {
          this.byRealPath.delete(existing.skillMarkdownPath);
        }
      }
    }
    this.bySource.set(sourceId, []);

    for (const skill of skills) {
      if (registered.length >= PROMPT_SKILL_CATALOG_MAX_ENTRIES) {
        diagnostics.push({
          code: "prompt-skill-limit-exceeded",
          message: `source ${sourceId} reached the ${PROMPT_SKILL_CATALOG_MAX_ENTRIES}-skill catalog cap; skipping remaining`,
          sourceId,
          runtimeId: skill.runtimeId,
        });
        break;
      }

      // Same-name registration from the same source replaces its own entry.
      const nameKey = this.nameKey(skill.scope, skill.name);
      for (const [rid, def] of this.byRuntimeId) {
        if (
          rid !== skill.runtimeId &&
          def.sourceId === sourceId &&
          this.nameKey(def.scope, def.name) === nameKey
        ) {
          this.byRuntimeId.delete(rid);
        }
      }

      // Deduplicate by canonical SKILL.md real path across sources.
      const twinRuntimeId = this.byRealPath.get(skill.skillMarkdownPath);
      if (twinRuntimeId && twinRuntimeId !== skill.runtimeId) {
        const twin = this.byRuntimeId.get(twinRuntimeId);
        if (twin) {
          const twinWins =
            this.scopeRank(twin.scope) <= this.scopeRank(skill.scope);
          diagnostics.push({
            code: "prompt-skill-duplicate-realpath",
            message:
              `skills '${twin.name}' (${twin.runtimeId}) and '${skill.name}' ` +
              `(${skill.runtimeId}) resolve to the same SKILL.md; ` +
              `${
                twinWins ? `'${twin.name}'` : `'${skill.name}'`
              } wins by scope precedence`,
            sourceId,
            runtimeId: skill.runtimeId,
          });
          if (twinWins) continue;
          this.byRuntimeId.delete(twinRuntimeId);
        }
      }

      this.byRuntimeId.set(skill.runtimeId, skill);
      this.byRealPath.set(skill.skillMarkdownPath, skill.runtimeId);
      this.bySource.get(sourceId)?.push(skill.runtimeId);
      registered.push(skill);

      // Report visible-name collisions across sources: the winner is chosen
      // by scope precedence, and every shadowed twin becomes a diagnostic
      // (PRD §13.5 — never silently replaced).
      for (const [rid, other] of this.byRuntimeId) {
        if (rid === skill.runtimeId) continue;
        if (other.name.toLowerCase() !== skill.name.toLowerCase()) continue;
        const skillWins =
          this.scopeRank(skill.scope) < this.scopeRank(other.scope);
        const winner = skillWins ? skill : other;
        const loser = skillWins ? other : skill;
        diagnostics.push({
          code: "prompt-skill-name-collision",
          message:
            `skill name '${skill.name}' is declared by both ` +
            `'${skill.runtimeId}' and '${other.runtimeId}'; ` +
            `'${winner.runtimeId}' wins by scope precedence and ` +
            `'${loser.runtimeId}' requires its runtime id for invocation`,
          sourceId,
          runtimeId: loser.runtimeId,
        });
      }
    }

    return { registered, diagnostics };
  }

  /** Resolve by runtime id or visible name with precedence + ambiguity. */
  resolve(
    nameOrRuntimeId: string,
    context: PromptSkillResolutionContext
  ): CatalogResolveResult {
    const diagnostics: PromptSkillCatalogDiagnostic[] = [];

    if (nameOrRuntimeId.startsWith("prompt:")) {
      const def = this.byRuntimeId.get(nameOrRuntimeId);
      if (!def) {
        return { definition: null, diagnostics };
      }
      if (def.scope === "workspace" && !this.matchesWorkspace(def, context)) {
        return {
          definition: null,
          diagnostics: [
            {
              code: "prompt-skill-name-collision",
              message: `runtime id ${nameOrRuntimeId} belongs to another workspace scope`,
              sourceId: def.sourceId,
              runtimeId: def.runtimeId,
            },
          ],
        };
      }
      return { definition: def, diagnostics };
    }

    // Name resolution: workspace skills first, then user/plugin/built-in.
    const visible = this.list(context).filter(
      (s) => s.name.toLowerCase() === nameOrRuntimeId.toLowerCase()
    );
    if (visible.length === 0) {
      return { definition: null, diagnostics };
    }
    // list() already applies precedence ordering and marks collisions.
    const sameScope = visible.filter((s) => !s.sourceLabel?.includes("·"));
    if (visible.length > 1) {
      const candidates = visible.map((s) => ({
        runtimeId: s.runtimeId,
        name: s.name,
        description: s.description,
        sourceLabel: s.sourceLabel,
        userInvocable: s.userInvocable,
        modelInvocable: s.modelInvocable,
      }));
      // Unambiguous when a single highest-precedence scope wins.
      const topRank = Math.min(
        ...visible.map((s) =>
          SCOPE_PRECEDENCE.indexOf(this.scopeOfRuntimeId(s.runtimeId))
        )
      );
      const topScope = visible.filter(
        (s) =>
          SCOPE_PRECEDENCE.indexOf(this.scopeOfRuntimeId(s.runtimeId)) ===
          topRank
      );
      if (topScope.length > 1) {
        return {
          definition: null,
          diagnostics,
          ambiguousCandidates: candidates,
        };
      }
      diagnostics.push({
        code: "prompt-skill-name-collision",
        message: `name '${nameOrRuntimeId}' exists in multiple scopes; highest-precedence scope wins`,
        sourceId: topScope[0].runtimeId,
      });
      void sameScope;
      const winner = this.byRuntimeId.get(topScope[0].runtimeId);
      return {
        definition: winner ?? null,
        diagnostics,
        ambiguousCandidates: candidates,
      };
    }

    const def = this.byRuntimeId.get(visible[0].runtimeId);
    return { definition: def ?? null, diagnostics };
  }

  /**
   * Bounded, precedence-ordered metadata view (NFR-9: discovery never
   * includes instruction bodies).
   */
  list(context: PromptSkillResolutionContext): readonly AvailablePromptSkill[] {
    const all = [...this.byRuntimeId.values()].filter(
      (d) => d.enabled && this.matchesWorkspace(d, context)
    );
    all.sort(
      (a, b) =>
        this.scopeRank(a.scope) - this.scopeRank(b.scope) ||
        a.name.localeCompare(b.name)
    );
    return all.map((d) => ({
      runtimeId: d.runtimeId,
      name: d.name,
      description: d.description,
      sourceLabel: scopeLabel(d.scope),
      userInvocable: d.manifest.userInvocable !== false,
      modelInvocable: d.manifest.disableModelInvocation !== true,
    }));
  }

  get(runtimeId: SkillRuntimeId): PromptSkillDefinition | null {
    return this.byRuntimeId.get(runtimeId) ?? null;
  }

  setEnabled(runtimeId: SkillRuntimeId, enabled: boolean): boolean {
    const def = this.byRuntimeId.get(runtimeId);
    if (!def) return false;
    this.byRuntimeId.set(runtimeId, { ...def, enabled });
    return true;
  }

  /** Remove one registration (disable/uninstall support). */
  remove(runtimeId: SkillRuntimeId): boolean {
    const def = this.byRuntimeId.get(runtimeId);
    if (!def) return false;
    this.byRuntimeId.delete(runtimeId);
    if (this.byRealPath.get(def.skillMarkdownPath) === runtimeId) {
      this.byRealPath.delete(def.skillMarkdownPath);
    }
    const list = this.bySource.get(def.sourceId);
    if (list) {
      this.bySource.set(
        def.sourceId,
        list.filter((id) => id !== runtimeId)
      );
    }
    return true;
  }

  size(): number {
    return this.byRuntimeId.size;
  }

  private matchesWorkspace(
    def: PromptSkillDefinition,
    context: PromptSkillResolutionContext
  ): boolean {
    if (def.scope !== "workspace") return true;
    return def.runtimeId.startsWith(
      `prompt:workspace:${context.workspaceId ?? -1}:`
    );
  }

  private scopeOfRuntimeId(runtimeId: SkillRuntimeId): SkillScope {
    if (runtimeId.startsWith("prompt:workspace:")) return "workspace";
    if (runtimeId.startsWith("prompt:user:")) return "user";
    if (runtimeId.startsWith("prompt:plugin:")) return "plugin";
    return "built-in";
  }

  private scopeRank(scope: SkillScope): number {
    const rank = SCOPE_PRECEDENCE.indexOf(scope);
    return rank === -1 ? SCOPE_PRECEDENCE.length : rank;
  }

  private nameKey(scope: SkillScope, name: string): string {
    return `${scope}:${name.toLowerCase()}`;
  }
}

function scopeLabel(scope: SkillScope): string {
  switch (scope) {
    case "workspace":
      return "workspace skill";
    case "plugin":
      return "plugin skill";
    case "built-in":
      return "built-in skill";
    default:
      return "user skill";
  }
}

// ---------------------------------------------------------------------------
// Process-wide singleton
// ---------------------------------------------------------------------------

let defaultCatalog: PromptSkillCatalog | null = null;

export function getDefaultPromptSkillCatalog(): PromptSkillCatalog {
  if (!defaultCatalog) {
    defaultCatalog = new PromptSkillCatalog();
  }
  return defaultCatalog;
}
