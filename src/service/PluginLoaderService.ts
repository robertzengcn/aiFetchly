import * as fs from "fs";
import { PluginManagementModule } from "@/modules/PluginManagementModule";
import { SkillManagementModule } from "@/modules/SkillManagementModule";
import { MCPToolModule } from "@/modules/MCPToolModule";
import { InstalledSkillEntity } from "@/entity/InstalledSkill.entity";
import { MCPToolEntity } from "@/entity/MCPTool.entity";
import { PluginManifestService } from "@/service/PluginManifestService";
import {
  getPluginInstallRoot,
  getPluginOwnedSkillRoot,
} from "@/service/pluginPaths";
import type {
  PluginError,
  PluginManifest,
  PluginSource,
} from "@/entityTypes/pluginTypes";

/**
 * Loads installed plugins from disk + database and produces a structured
 * result splitting enabled vs disabled plugins with per-component health.
 * Source of truth: Design §7.4.
 *
 * Memoized: first call reads from disk/DB; subsequent calls return cached.
 * Cache is invalidated by PluginRuntimeCache.clear() after any state change.
 */

export interface LoadedPluginSkill {
  readonly name: string;
  readonly enabled: boolean;
  readonly manifestPath: string;
  readonly skillDir: string;
  readonly health: "healthy" | "missing_files";
  readonly error?: string;
}

export interface LoadedPluginMcpServer {
  readonly serverName: string;
  readonly enabled: boolean;
  readonly transport: "stdio" | "sse" | "websocket";
  readonly health: "healthy" | "needs_configuration" | "missing_files";
  readonly error?: string;
}

export interface LoadedPlugin {
  readonly name: string;
  readonly displayName?: string;
  readonly version: string;
  readonly source: PluginSource;
  readonly enabled: boolean;
  readonly installPath: string;
  readonly manifest: PluginManifest;
  readonly skills: readonly LoadedPluginSkill[];
  readonly mcpServers: readonly LoadedPluginMcpServer[];
  readonly errors: readonly PluginError[];
}

export interface PluginLoadResult {
  readonly enabled: readonly LoadedPlugin[];
  readonly disabled: readonly LoadedPlugin[];
  readonly errors: readonly PluginError[];
}

interface CachedLoad {
  result: PluginLoadResult;
  loadedAt: number;
}

let cached: CachedLoad | null = null;

export class PluginLoaderService {
  /**
   * Load all installed plugins. Memoized. One bad plugin does not stop
   * others from loading — errors are collected per-plugin.
   */
  static async loadAllPlugins(): Promise<PluginLoadResult> {
    if (cached) {
      return cached.result;
    }
    const result = await this.forceLoad();
    cached = { result, loadedAt: Date.now() };
    return result;
  }

  static clearCache(): void {
    if (cached) {
      cached = null;
    }
  }

  private static async forceLoad(): Promise<PluginLoadResult> {
    const pluginModule = new PluginManagementModule();
    const skillModule = new SkillManagementModule();
    const mcpModule = new MCPToolModule();

    const all = await pluginModule.listInstalledPlugins();
    const globalErrors: PluginError[] = [];

    // Index owned skills + MCP rows by owner plugin name for quick lookup.
    const skillsByPlugin = new Map<string, InstalledSkillEntity[]>();
    const mcpByPlugin = new Map<string, MCPToolEntity[]>();
    for (const plugin of all) {
      const ownedSkills = await skillModule.findSkillsByPluginName(plugin.name);
      skillsByPlugin.set(plugin.name, ownedSkills);
      const ownedMcp = await mcpModule.findMcpByPluginName(plugin.name);
      mcpByPlugin.set(plugin.name, ownedMcp);
    }

    const enabled: LoadedPlugin[] = [];
    const disabled: LoadedPlugin[] = [];

    for (const plugin of all) {
      const errors: PluginError[] = [];
      const installPath =
        plugin.installPath || getPluginInstallRoot(plugin.name);

      if (!fs.existsSync(installPath)) {
        errors.push({
          code: "missing_files",
          pluginName: plugin.name,
          path: installPath,
          message: `Install path missing: ${installPath}`,
          recoverable: true,
        });
        // Still record the plugin as disabled-loadable but with missing_files.
        const loaded: LoadedPlugin = {
          name: plugin.name,
          displayName: plugin.displayName,
          version: plugin.version,
          source: plugin.source as PluginSource,
          enabled: plugin.enabled === 1,
          installPath,
          manifest: JSON.parse(plugin.manifestJson || "{}") as PluginManifest,
          skills: [],
          mcpServers: [],
          errors,
        };
        if (loaded.enabled) enabled.push(loaded);
        else disabled.push(loaded);
        globalErrors.push(...errors);
        continue;
      }

      // Re-read manifest from disk (source of truth, not the DB blob).
      const manifestResult = await PluginManifestService.loadFromDirectory(
        installPath
      );
      let manifest: PluginManifest;
      if (manifestResult.success) {
        manifest = manifestResult.manifest;
      } else {
        manifest = JSON.parse(plugin.manifestJson || "{}") as PluginManifest;
        for (const e of manifestResult.errors) {
          errors.push({ ...e, pluginName: plugin.name, recoverable: true });
        }
      }

      // Resolve owned skills.
      const ownedSkills = skillsByPlugin.get(plugin.name) ?? [];
      const loadedSkills: LoadedPluginSkill[] = ownedSkills.map((s) => {
        const skillDir = getPluginOwnedSkillRoot(plugin.name, s.name);
        const manifestPath = s.pluginComponentPath ?? "";
        const manifestAbs = manifestPath
          ? `${installPath}/${manifestPath}`
          : `${skillDir}/manifest.json`;
        const dirExists = fs.existsSync(skillDir);
        return {
          name: s.name,
          enabled: s.enabled === 1,
          manifestPath: manifestAbs,
          skillDir,
          health: dirExists ? "healthy" : "missing_files",
          error: dirExists ? undefined : `Skill directory missing: ${skillDir}`,
        };
      });

      // Resolve owned MCP servers.
      const ownedMcp = mcpByPlugin.get(plugin.name) ?? [];
      const loadedMcp: LoadedPluginMcpServer[] = ownedMcp.map((m) => {
        const hasConfig =
          (m.transport === "stdio" && !!m.command) ||
          ((m.transport === "sse" || m.transport === "websocket") &&
            (!!m.host || !!m.url));
        return {
          serverName: m.serverName,
          enabled: m.enabled,
          transport: m.transport,
          health: hasConfig ? "healthy" : "needs_configuration",
          error: hasConfig
            ? undefined
            : `MCP server "${m.serverName}" is missing required configuration.`,
        };
      });

      const loaded: LoadedPlugin = {
        name: plugin.name,
        displayName: plugin.displayName,
        version: plugin.version,
        source: plugin.source as PluginSource,
        enabled: plugin.enabled === 1,
        installPath,
        manifest,
        skills: loadedSkills,
        mcpServers: loadedMcp,
        errors,
      };
      if (loaded.enabled) enabled.push(loaded);
      else disabled.push(loaded);
      globalErrors.push(...errors);
    }

    return { enabled, disabled, errors: globalErrors };
  }
}
