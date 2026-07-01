import { PluginManagementModule } from "@/modules/PluginManagementModule";
import { SkillManagementModule } from "@/modules/SkillManagementModule";
import { MCPToolModule } from "@/modules/MCPToolModule";
import { MCPToolService } from "@/service/MCPToolService";
import { PluginImportService } from "@/service/PluginImportService";
import { PluginComponentRegistryService } from "@/service/PluginComponentRegistryService";
import { PluginDiagnosticsService } from "@/service/PluginDiagnosticsService";
import { getPluginInstallRoot } from "@/service/pluginPaths";
import type {
  PluginSummary,
  PluginSourceKind,
} from "@/entityTypes/pluginTypes";
import type { InstalledPluginEntity } from "@/entity/InstalledPlugin.entity";
import {
  PLUGIN_IMPORT,
  PLUGIN_INSTALL_FROM_SOURCE,
  PLUGIN_VALIDATE_PACKAGE,
  PLUGIN_LIST,
  PLUGIN_GET,
  PLUGIN_TOGGLE,
  PLUGIN_UNINSTALL,
  PLUGIN_RELOAD,
  PLUGIN_EXPORT_DIAGNOSTICS,
  PLUGIN_TOGGLE_SKILL,
  PLUGIN_TOGGLE_MCP_SERVER,
  PLUGIN_TOGGLE_MCP_TOOL,
  PLUGIN_TEST_MCP_CONNECTION,
  PLUGIN_DISCOVER_MCP_TOOLS,
} from "@/config/channellist";
import { registerAiValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
import {
  pluginNoInputSchema,
  pluginByNameInputSchema,
  pluginImportInputSchema,
  pluginInstallFromSourceInputSchema,
  pluginValidatePackageInputSchema,
  pluginToggleInputSchema,
  pluginToggleSkillInputSchema,
  pluginToggleMcpServerInputSchema,
  pluginToggleMcpToolInputSchema,
  pluginByServerIdInputSchema,
} from "@/schemas/ipc/plugin";

/**
 * Plugin Management IPC handlers — all 13 migrated to registerAiValidatedHandler.
 *
 * Original code called checkAiEnabled() at the top of every handler; now
 * centralized in the wrapper. Bespoke extractData/validateString helpers
 * removed (zod schema handles both).
 *
 * Security: zipPath traversal check ('..' rejection) stays inside IMPORT
 * and VALIDATE_PACKAGE handlers — platform-dependent rule, not a schema concern.
 */

function toSummary(
  p: InstalledPluginEntity,
  skillCount: number,
  mcpServerCount: number
): PluginSummary {
  let permissions: string[] = [];
  try {
    permissions = JSON.parse(p.permissionsJson || "[]") as string[];
  } catch {
    permissions = [];
  }
  return {
    id: p.id,
    name: p.name,
    version: p.version,
    // Entity stores source/health as text; cast to the literal unions
    // expected by PluginSummary. Defaults to 'local' / 'healthy' when
    // the columns are blank (legacy rows).
    source: ((p as { source?: string }).source ||
      "local") as PluginSummary["source"],
    enabled: p.enabled === 1,
    health: ((p as { health?: string }).health ||
      "healthy") as PluginSummary["health"],
    skillCount,
    mcpServerCount,
    permissions,
    lastUpdated: p.updatedAt
      ? new Date(p.updatedAt).toISOString()
      : new Date().toISOString(),
  };
}

export function registerPluginIpcHandlers(): void {
  console.log("Plugin IPC handlers registered");

  registerAiValidatedHandler(PLUGIN_LIST, pluginNoInputSchema, async () => {
    const module = new PluginManagementModule();
    const skillModule = new SkillManagementModule();
    const mcpModule = new MCPToolModule();
    const plugins = await module.listInstalledPlugins();
    const summaries: PluginSummary[] = [];
    for (const p of plugins) {
      const skills = await skillModule.findSkillsByPluginName(p.name);
      const mcpServers = await mcpModule.findMcpByPluginName(p.name);
      summaries.push(toSummary(p, skills.length, mcpServers.length));
    }
    return summaries;
  });

  registerAiValidatedHandler(
    PLUGIN_GET,
    pluginByNameInputSchema,
    async (input) => {
      const module = new PluginManagementModule();
      const plugin = await module.getPluginByName(input.name);
      if (!plugin) {
        throw new Error("Plugin not found");
      }
      const skillModule = new SkillManagementModule();
      const mcpModule = new MCPToolModule();
      const skills = await skillModule.findSkillsByPluginName(input.name);
      const mcpServers = await mcpModule.findMcpByPluginName(input.name);
      const summary = toSummary(plugin, skills.length, mcpServers.length);
      let manifest = {};
      try {
        manifest = JSON.parse(plugin.manifestJson || "{}");
      } catch {
        manifest = {};
      }
      return {
        ...summary,
        description: plugin.description,
        author: plugin.author,
        skills: skills.map((s) => ({
          name: s.name,
          enabled: s.enabled === 1,
          manifestPath: s.pluginComponentPath,
          health: "healthy",
        })),
        mcpServers: mcpServers.map((s) => ({
          id: s.id,
          serverName: s.serverName,
          enabled: s.enabled,
        })),
        manifest,
      };
    }
  );

  registerAiValidatedHandler(
    PLUGIN_IMPORT,
    pluginImportInputSchema,
    async (input) => {
      // Security: reject path traversal (rule depends on filesystem semantics,
      // kept in handler rather than schema).
      if (input.zipPath.includes("..")) {
        throw new Error("zipPath must not contain '..' segments");
      }
      const result = await PluginImportService.importFromZip({
        zipPath: input.zipPath,
        overwrite: input.overwrite === true,
      });
      if (!result.success) {
        throw new Error(result.errors.map((e) => e.message).join("; "));
      }
      return result.plugin;
    }
  );

  // Install from various sources (zip, folder, git, github, npm, url)
  // Merged from dev branch. Uses registerAiValidatedHandler + passthrough schema.
  registerAiValidatedHandler(
    PLUGIN_INSTALL_FROM_SOURCE,
    pluginInstallFromSourceInputSchema,
    async (input) => {
      const data = input as {
        kind: string;
        overwrite?: boolean;
        zipPath?: string;
        folderPath?: string;
        uri?: string;
        ref?: string;
        npmPackage?: string;
        npmVersion?: string;
        npmRegistry?: string;
        npmAuthScope?: string;
        npmAuthToken?: string;
      };

      const ALLOWED_KINDS = [
        "local-zip",
        "local-folder",
        "git",
        "github",
        "npm",
        "url",
      ];
      if (!ALLOWED_KINDS.includes(data.kind)) {
        throw new Error("Invalid or missing source kind.");
      }

      // Reject CRLF / control chars in any string field that may reach spawn.
      const stringFields = [
        data.uri,
        data.zipPath,
        data.folderPath,
        data.npmPackage,
        data.npmVersion,
        data.npmRegistry,
        data.npmAuthScope,
        data.ref,
      ];
      for (const v of stringFields) {
        if (typeof v === "string" && /[\r\n]/.test(v)) {
          throw new Error("Invalid characters in source field.");
        }
      }

      const { PluginInstallService } = await import(
        "@/service/PluginInstallService"
      );
      const svc = new PluginInstallService();
      const r = await svc.installFromSource({
        kind: data.kind as PluginSourceKind,
        overwrite: data.overwrite === true,
        zipPath: data.zipPath,
        folderPath: data.folderPath,
        uri: data.uri,
        ref: data.ref,
        npmPackage: data.npmPackage,
        npmVersion: data.npmVersion,
        npmRegistry: data.npmRegistry,
        npmAuthScope: data.npmAuthScope,
        npmAuthToken: data.npmAuthToken,
      });
      if (!r.success) {
        throw new Error(r.errors.map((e) => e.message).join("; "));
      }
      return r.plugin;
    }
  );

  registerAiValidatedHandler(
    PLUGIN_VALIDATE_PACKAGE,
    pluginValidatePackageInputSchema,
    async (input) => {
      if (input.zipPath.includes("..")) {
        throw new Error("zipPath must not contain '..' segments");
      }
      // Dry-run validation: extract + load manifest, then cleanup.
      const { PluginArchiveService } = await import(
        "@/service/PluginArchiveService"
      );
      const { PluginManifestService } = await import(
        "@/service/PluginManifestService"
      );
      const extract = await PluginArchiveService.extractZip(input.zipPath);
      if (!extract.success) {
        return { valid: false, errors: extract.errors };
      }
      const manifest = await PluginManifestService.loadFromDirectory(
        extract.tempRoot
      );
      await extract.cleanup();
      if (!manifest.success) {
        return { valid: false, errors: manifest.errors };
      }
      return {
        valid: true,
        name: manifest.manifest.name,
        version: manifest.manifest.version,
      };
    }
  );

  registerAiValidatedHandler(
    PLUGIN_TOGGLE,
    pluginToggleInputSchema,
    async (input) => {
      const module = new PluginManagementModule();
      const ok = await module.togglePlugin(input.name, input.enabled);
      if (!ok) {
        throw new Error("Plugin not found");
      }
      await PluginComponentRegistryService.applyLoadedPlugins();
      return null;
    }
  );

  registerAiValidatedHandler(
    PLUGIN_UNINSTALL,
    pluginByNameInputSchema,
    async (input) => {
      const module = new PluginManagementModule();
      const result = await module.uninstallPlugin(input.name);
      if (!result.removedPlugin) {
        throw new Error("Plugin not found");
      }
      // Best-effort remove install path.
      const installPath = getPluginInstallRoot(input.name);
      try {
        const fs = await import("fs");
        fs.rmSync(installPath, { recursive: true, force: true });
      } catch {
        // best-effort
      }
      await PluginComponentRegistryService.unregisterPluginCapabilities(
        input.name
      );
      return null;
    }
  );

  registerAiValidatedHandler(PLUGIN_RELOAD, pluginNoInputSchema, async () => {
    const result = await PluginComponentRegistryService.reload();
    return {
      enabled: result.enabled.length,
      disabled: result.disabled.length,
      errors: result.errors.length,
    };
  });

  registerAiValidatedHandler(
    PLUGIN_EXPORT_DIAGNOSTICS,
    pluginByNameInputSchema,
    async (input) => {
      const bundle = await PluginDiagnosticsService.buildBundle(input.name);
      if (!bundle) {
        throw new Error("Plugin not found");
      }
      return bundle;
    }
  );

  registerAiValidatedHandler(
    PLUGIN_TOGGLE_SKILL,
    pluginToggleSkillInputSchema,
    async (input) => {
      const skillModule = new SkillManagementModule();
      const ok = await skillModule.toggleSkill(input.skillName, input.enabled);
      if (!ok) {
        throw new Error("Skill not found");
      }
      await PluginComponentRegistryService.applyLoadedPlugins();
      return null;
    }
  );

  registerAiValidatedHandler(
    PLUGIN_TOGGLE_MCP_SERVER,
    pluginToggleMcpServerInputSchema,
    async (input) => {
      const mcpModule = new MCPToolModule();
      await mcpModule.toggleServerEnabled(input.serverId, input.enabled);
      await PluginComponentRegistryService.applyLoadedPlugins();
      return null;
    }
  );

  registerAiValidatedHandler(
    PLUGIN_TOGGLE_MCP_TOOL,
    pluginToggleMcpToolInputSchema,
    async (input) => {
      const service = new MCPToolService();
      await service.toggleToolEnabled(
        input.serverId,
        input.toolName,
        input.enabled
      );
      return null;
    }
  );

  registerAiValidatedHandler(
    PLUGIN_TEST_MCP_CONNECTION,
    pluginByServerIdInputSchema,
    async (input) => {
      const service = new MCPToolService();
      return service.testConnection(input.serverId);
    }
  );

  registerAiValidatedHandler(
    PLUGIN_DISCOVER_MCP_TOOLS,
    pluginByServerIdInputSchema,
    async (input) => {
      const service = new MCPToolService();
      const tools = await service.discoverTools(input.serverId);
      await PluginComponentRegistryService.applyLoadedPlugins();
      return tools;
    }
  );
}
