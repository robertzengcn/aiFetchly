import * as fs from "fs";
import * as path from "path";
import {
  PluginLoaderService,
  type LoadedPlugin,
  type PluginLoadResult,
} from "@/service/PluginLoaderService";
import { PluginRuntimeCache } from "@/service/PluginRuntimeCache";
import { PluginHookRegistrar } from "@/service/pluginCompat/PluginHookRegistrar";
import { PluginCommandSourceReader } from "@/service/pluginCompat/PluginCommandSourceReader";
import { UserPluginAutoInstallService } from "@/service/UserPluginAutoInstallService";
import { SkillRegistry } from "@/config/skillsRegistry";
import { CommandRegistry } from "@/service/slashCommands/CommandRegistry";
import { AgentDefinitionRegistryImpl } from "@/service/AgentDefinitionRegistry";
import { getAIFetchlyConfigManager } from "@/service/aifetchlyConfig/AIFetchlyConfigManager";
import { buildAgentDefinition } from "@/service/slashCommands/agentFrontmatter";
import {
  frontmatterRecord,
  parseRestrictedFrontmatter,
} from "@/service/aifetchlyConfig/AIFetchlyConfigMarkdown";
import { AIFETCHLY_CONFIG_LIMITS } from "@/service/aifetchlyConfig/AIFetchlyConfigConstants";
import type { AIFetchlyConfigDiagnostic } from "@/entityTypes/aifetchlyConfigTypes";
import type { AgentDefinitionView } from "@/entityTypes/agentTypes";
/**
 * Adapts loaded plugin data into the existing skill and MCP runtime systems.
 * Source of truth: Design §7.5.
 *
 * Boundaries (Design §7.5 last paragraph):
 *  - Does NOT execute skill code itself — that's SkillRegistry's job.
 *  - Does NOT spawn MCP processes directly — that's MCPClient's job.
 *  - Writes DB rows only through Modules when enablement must persist.
 *
 * The actual effective-enablement filtering (plugin.enabled && component.enabled)
 * lives in skillsRegistry.ts and MCPToolService.ts. This service is the
 * coordination point that triggers cache invalidation and ensures the loader
 * state is propagated.
 */
export class PluginComponentRegistryService {
  /**
   * Apply the current loader state: clear caches so downstream catalogs
   * re-read owned components with the latest plugin enablement.
   *
   * The skill/MCP catalog queries read owned rows from their own models,
   * then filter by the owning plugin's enabled state — so all this method
   * needs to do is invalidate the caches that would otherwise serve stale
   * catalogs.
   */
  static async applyLoadedPlugins(): Promise<void> {
    PluginRuntimeCache.clear("apply-loaded-plugins");
    await PluginComponentRegistryService.syncUserPluginFolders();
    // Register plugin-declared hooks (Phase 3 plumbing). Re-registration
    // is idempotent per hook id, so calling this on every apply is safe.
    const loaded = await PluginLoaderService.loadAllPlugins();
    PluginHookRegistrar.registerFromLoadedPlugins(loaded.enabled);
    const manager = getAIFetchlyConfigManager();
    await PluginComponentRegistryService.promotePluginCommandsAndAgents(
      manager.getCommandRegistry(),
      manager.getAgentRegistry(),
      [...loaded.enabled, ...loaded.disabled]
    );
  }

  /**
   * Remove a plugin's capabilities from the runtime. Used by the IPC
   * uninstall/disable flow.
   */
  static async unregisterPluginCapabilities(pluginName: string): Promise<void> {
    PluginRuntimeCache.clear(`unregister-${pluginName}`);
    SkillRegistry.unregisterSkillsByPlugin(pluginName);
    const sourceId = `plugin:${pluginName}`;
    const manager = getAIFetchlyConfigManager();
    manager.getCommandRegistry().replaceSource(sourceId, []);
    manager.getAgentRegistry().replaceSource(sourceId, []);
  }

  /**
   * Force a fresh load (clears cache, then reloads). Used by the IPC reload
   * channel.
   */
  static async reload(): Promise<PluginLoadResult> {
    PluginLoaderService.clearCache();
    await PluginComponentRegistryService.syncUserPluginFolders();
    const result = await PluginLoaderService.loadAllPlugins();
    await PluginComponentRegistryService.applyLoadedPlugins();
    return result;
  }

  private static async syncUserPluginFolders(): Promise<void> {
    const result = await UserPluginAutoInstallService.syncDefaultUserPlugins();
    if (result.errors.length > 0) {
      console.warn(
        `[PluginComponentRegistryService] Failed to auto-install ${result.errors.length} user plugin folder(s).`,
        result.errors
      );
    }
  }

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

      if (
        !plugin.enabled ||
        !plugin.installPath ||
        !fs.existsSync(plugin.installPath)
      ) {
        commandRegistry.replaceSource(sourceId, []);
        agentRegistry.replaceSource(sourceId, []);
        continue;
      }

      // Commands: native commands/*.md PLUS Claude manifest declarations
      // (string/array/object/inline), handled by PluginCommandSourceReader.
      const commandResult = await PluginCommandSourceReader.read({
        pluginName: plugin.name,
        installPath: plugin.installPath,
        manifest: plugin.manifest,
      });
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

interface ComponentDraft {
  readonly frontmatter: Readonly<Record<string, string | readonly string[]>>;
  readonly body: string;
  readonly relativePath: string;
}

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
