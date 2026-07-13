import * as fs from "fs";
import * as path from "path";
import {
  PluginLoaderService,
  type LoadedPlugin,
  type PluginLoadResult,
} from "@/service/PluginLoaderService";
import { PluginRuntimeCache } from "@/service/PluginRuntimeCache";
import { CommandRegistry } from "@/service/slashCommands/CommandRegistry";
import { AgentDefinitionRegistryImpl } from "@/service/AgentDefinitionRegistry";
import { getAIFetchlyConfigManager } from "@/service/aifetchlyConfig/AIFetchlyConfigManager";
import { buildPromptCommandDefinition } from "@/service/slashCommands/promptCommandFrontmatter";
import { buildAgentDefinition } from "@/service/slashCommands/agentFrontmatter";
import {
  parseRestrictedFrontmatter,
  type ParsedFrontmatter,
} from "@/service/aifetchlyConfig/AIFetchlyConfigMarkdown";
import { AIFETCHLY_CONFIG_LIMITS } from "@/service/aifetchlyConfig/AIFetchlyConfigConstants";
import type { AIFetchlyConfigDiagnostic } from "@/entityTypes/aifetchlyConfigTypes";
import type { SlashCommandDefinition } from "@/entityTypes/slashCommandTypes";
import type { AgentDefinitionView } from "@/entityTypes/agentTypes";

/**
 * Adapts loaded plugin data into the existing skill and MCP runtime systems,
 * AND (Phase 18 / SKL-02) promotes plugin-authored `commands/*.md` +
 * `agents/*.md` into the native {@link CommandRegistry} /
 * {@link AgentDefinitionRegistryImpl} under `plugin:<name>` source IDs.
 * Source of truth: Design §7.5, §7.3 (plugin rank 3, lowest).
 *
 * Boundaries (Design §7.5 last paragraph):
 *  - Does NOT execute skill code itself — that's SkillRegistry's job.
 *  - Does NOT spawn MCP processes directly — that's MCPClient's job.
 *  - Writes DB rows only through Modules when enablement must persist.
 *
 * The actual effective-enablement filtering (plugin.enabled && component.enabled)
 * for skills/MCP lives in skillsRegistry.ts and MCPToolService.ts. This service
 * is the coordination point that triggers cache invalidation, ensures the
 * loader state is propagated, and reconciles plugin commands/agents into the
 * native registries (T-plugin-poison mitigation is structural: plugin source
 * is rank 3, so built-in/workspace/user always win name collisions).
 */
export class PluginComponentRegistryService {
  /**
   * Apply the current loader state: clear caches so downstream catalogs
   * re-read owned components with the latest plugin enablement, AND (Phase 18)
   * promote plugin commands/agents into the native registries under
   * `plugin:<name>` source IDs.
   *
   * The skill/MCP catalog queries read owned rows from their own models,
   * then filter by the owning plugin's enabled state — so cache invalidation
   * is all that's needed for those. Plugin commands/agents, however, are
   * discovered by filesystem scan of each enabled plugin's installPath (they
   * are NOT declared in PluginManifest per 18-RESEARCH Pattern 5 / Assumption
   * A3), so they must be promoted here on every plugin lifecycle event.
   */
  static async applyLoadedPlugins(): Promise<void> {
    PluginRuntimeCache.clear("apply-loaded-plugins");
    const { enabled, disabled } = await PluginLoaderService.loadAllPlugins();
    const manager = getAIFetchlyConfigManager();
    await PluginComponentRegistryService.promotePluginCommandsAndAgents(
      manager.getCommandRegistry(),
      manager.getAgentRegistry(),
      [...enabled, ...disabled]
    );
  }

  /**
   * Remove a plugin's capabilities from the runtime. Used by the IPC
   * uninstall/disable flow. Clears the runtime cache AND reconciles the
   * plugin's commands/agents to [] on both registries so disable/uninstall
   * takes effect immediately even if {@link applyLoadedPlugins} is not
   * re-invoked (T-18-05: no stale entries survive).
   */
  static async unregisterPluginCapabilities(pluginName: string): Promise<void> {
    PluginRuntimeCache.clear(`unregister-${pluginName}`);
    const sourceId = `plugin:${pluginName}`;
    const manager = getAIFetchlyConfigManager();
    manager.getCommandRegistry().replaceSource(sourceId, []);
    manager.getAgentRegistry().replaceSource(sourceId, []);
  }

  /**
   * Force a fresh load (clears loader cache, reloads), then re-applies the
   * loaded state (which re-promotes plugin commands/agents after the reload).
   * Used by the IPC reload channel.
   */
  static async reload(): Promise<PluginLoadResult> {
    PluginLoaderService.clearCache();
    const result = await PluginLoaderService.loadAllPlugins();
    await PluginComponentRegistryService.applyLoadedPlugins();
    return result;
  }

  /**
   * Promote each plugin's `commands/*.md` and `agents/*.md` into the native
   * registries under sourceId `plugin:<name>` (SKL-02 SC2 / D-PluginBadge).
   *
   * For each plugin:
   *   - disabled OR missing install dir → `replaceSource("plugin:<name>", [])`
   *     on BOTH registries (reconcile away, no stale entries; 18-RESEARCH
   *     Pitfall 5 — a missing install dir is skipped without throwing).
   *   - enabled with an existing install dir → scan `<installPath>/commands` +
   *     `<installPath>/agents`, route every `.md` through the SINGLE CMD-06 /
   *     AGT-02 schema owner ({@link buildPromptCommandDefinition} /
   *     {@link buildAgentDefinition}) with source `"plugin"`, and atomically
   *     reconcile via `replaceSource("plugin:<name>", defs)`.
   *
   * Plugin commands/agents are discovered by FILE SCAN of the installPath
   * (PluginManifest has skills/mcpServers only — no commands/agents field per
   * 18-RESEARCH Pattern 5 / Assumption A3). This reads ONLY the plugin's
   * installPath; it never scans `~/.aifetchly` (plugins are installed packages,
   * not config files). The restricted frontmatter parser + the existing
   * builders are reused — no new parser is written (CFG-07 safe-schema
   * invariant preserved).
   *
   * Registry instances are passed in (dependency injection) so the promotion
   * core is unit-testable without the singleton or the DB; production callers
   * pass the {@link getAIFetchlyConfigManager} singletons so promotion targets
   * the SAME instances every other code path reads.
   *
   * Never throws — file IO / parse failures become non-fatal diagnostics so
   * one bad plugin file cannot abort the whole batch.
   */
  static async promotePluginCommandsAndAgents(
    commandRegistry: CommandRegistry,
    agentRegistry: AgentDefinitionRegistryImpl,
    plugins: readonly LoadedPlugin[]
  ): Promise<{ readonly diagnostics: readonly AIFetchlyConfigDiagnostic[] }> {
    const allDiagnostics: AIFetchlyConfigDiagnostic[] = [];

    for (const plugin of plugins) {
      const sourceId = `plugin:${plugin.name}`;
      const sourceMeta = {
        source: "plugin" as const,
        sourceId,
        sourceLabel: "Plugin",
        requiresTrust: false,
      };

      // Disabled or missing-install plugins reconcile to empty (no stale
      // entries). fs.existsSync keeps this branch from ever touching a
      // non-existent install dir (Pitfall 5).
      if (
        !plugin.enabled ||
        !plugin.installPath ||
        !fs.existsSync(plugin.installPath)
      ) {
        commandRegistry.replaceSource(sourceId, []);
        agentRegistry.replaceSource(sourceId, []);
        continue;
      }

      const commandResult =
        await PluginComponentRegistryService.readComponentFiles<SlashCommandDefinition>(
          plugin.installPath,
          "commands",
          AIFETCHLY_CONFIG_LIMITS.commandMdBytes,
          sourceId,
          (draft) => buildPromptCommandDefinition(draft, sourceMeta)
        );
      allDiagnostics.push(...commandResult.diagnostics);
      commandRegistry.replaceSource(sourceId, commandResult.definitions);

      const agentResult =
        await PluginComponentRegistryService.readComponentFiles<AgentDefinitionView>(
          plugin.installPath,
          "agents",
          AIFETCHLY_CONFIG_LIMITS.agentMdBytes,
          sourceId,
          (draft) => buildAgentDefinition(draft, sourceMeta)
        );
      allDiagnostics.push(...agentResult.diagnostics);
      agentRegistry.replaceSource(sourceId, agentResult.definitions);
    }

    return { diagnostics: allDiagnostics };
  }

  /**
   * Read every `*.md` file under `<installPath>/<subdir>`, enforce the byte
   * cap, parse the restricted frontmatter, and route each draft through the
   * supplied builder. Returns validated definitions + per-file diagnostics for
   * the failures. Never throws — IO/parse errors become diagnostics.
   *
   * A missing subdir is the happy path (a plugin with no commands/ or agents/
   * dir) → empty result, no diagnostic.
   */
  private static async readComponentFiles<T>(
    installPath: string,
    subdir: string,
    sizeLimit: number,
    sourceId: string,
    build: (
      draft: ComponentDraft
    ) =>
      | { readonly ok: true; readonly definition: T }
      | { readonly ok: false; readonly diagnostic: AIFetchlyConfigDiagnostic }
  ): Promise<{
    readonly definitions: readonly T[];
    readonly diagnostics: readonly AIFetchlyConfigDiagnostic[];
  }> {
    const definitions: T[] = [];
    const diagnostics: AIFetchlyConfigDiagnostic[] = [];
    const dir = path.join(installPath, subdir);

    if (!fs.existsSync(dir)) {
      return { definitions, diagnostics };
    }

    let entries: string[];
    try {
      entries = await fs.promises.readdir(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { definitions, diagnostics };
      }
      diagnostics.push(pluginIoDiagnostic(sourceId, subdir, err));
      return { definitions, diagnostics };
    }

    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      const relativePath = `${subdir}/${entry}`;
      const abs = path.join(dir, entry);
      try {
        const stat = await fs.promises.stat(abs);
        if (stat.size > sizeLimit) {
          diagnostics.push(
            pluginDiagnostic(
              sourceId,
              relativePath,
              "file-too-large",
              `${relativePath} is ${stat.size} bytes which exceeds the ${sizeLimit}-byte limit; skipped`
            )
          );
          continue;
        }
        const content = await fs.promises.readFile(abs, "utf8");
        const parsed = parseRestrictedFrontmatter(content);
        if (parsed === null) {
          diagnostics.push(
            pluginDiagnostic(
              sourceId,
              relativePath,
              "frontmatter-unparseable",
              `${relativePath} has malformed or missing restricted frontmatter; skipped`
            )
          );
          continue;
        }
        const draft: ComponentDraft = {
          frontmatter: frontmatterRecord(parsed),
          body: parsed.body,
          relativePath,
        };
        const result = build(draft);
        if (result.ok) {
          definitions.push(result.definition);
        } else {
          diagnostics.push(result.diagnostic);
        }
      } catch (err) {
        diagnostics.push(pluginIoDiagnostic(sourceId, relativePath, err));
      }
    }

    return { definitions, diagnostics };
  }
}

/**
 * Parsed-draft shape shared by the CMD-06 / AGT-02 builders: already-parsed
 * frontmatter (scalar | string-array record) + body + relative path. Both
 * {@link PromptCommandDraft} and {@link AgentDefinitionDraft} are structurally
 * assignable from this.
 */
interface ComponentDraft {
  readonly frontmatter: Readonly<Record<string, string | readonly string[]>>;
  readonly body: string;
  readonly relativePath: string;
}

/**
 * Merge a {@link ParsedFrontmatter}'s scalar + array maps into the flat
 * `Record<string, string | readonly string[]>` shape the CMD-06 / AGT-02
 * builders consume. Returns a fresh record (immutability rule).
 */
function frontmatterRecord(
  parsed: ParsedFrontmatter
): Record<string, string | readonly string[]> {
  const record: Record<string, string | readonly string[]> = {};
  for (const [key, value] of parsed.scalars) record[key] = value;
  for (const [key, value] of parsed.arrays) record[key] = value;
  return record;
}

/** Build a non-fatal plugin-sourced diagnostic with the project's stable shape. */
function pluginDiagnostic(
  sourceId: string,
  filePath: string,
  code: string,
  message: string
): AIFetchlyConfigDiagnostic {
  return {
    severity: "warning",
    source: "plugin",
    sourceId,
    filePath,
    code,
    message,
    recoverable: true,
  };
}

/** Wrap an unexpected IO error as a `scanner-io-error` diagnostic (never throws). */
function pluginIoDiagnostic(
  sourceId: string,
  filePath: string,
  err: unknown
): AIFetchlyConfigDiagnostic {
  return pluginDiagnostic(
    sourceId,
    filePath,
    "scanner-io-error",
    `unexpected error reading ${filePath}: ${(err as Error).message}`
  );
}
