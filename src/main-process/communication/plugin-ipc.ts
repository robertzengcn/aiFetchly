import { ipcMain } from "electron";
import { Token } from "@/modules/token";
import { USER_AI_ENABLED } from "@/config/usersetting";
import { PluginManagementModule } from "@/modules/PluginManagementModule";
import { SkillManagementModule } from "@/modules/SkillManagementModule";
import { MCPToolModule } from "@/modules/MCPToolModule";
import { MCPToolService } from "@/service/MCPToolService";
import { PluginImportService } from "@/service/PluginImportService";
import { PluginComponentRegistryService } from "@/service/PluginComponentRegistryService";
import { PluginDiagnosticsService } from "@/service/PluginDiagnosticsService";
import { PluginLoaderService } from "@/service/PluginLoaderService";
import { getPluginInstallRoot } from "@/service/pluginPaths";
import type { CommonMessage } from "@/entityTypes/commonType";
import type { PluginSummary } from "@/entityTypes/pluginTypes";
import {
  PLUGIN_IMPORT,
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

/**
 * Plugin Management IPC handlers.
 * Source of truth: Design §10, §10.1, §10.2.
 *
 * Rules:
 *  - Every handler checks AI enable first.
 *  - No direct repository access — everything goes through Modules/Services.
 *  - No `any`. Validate payload shape and path-traversal strings.
 */

interface AiDisabledResponse {
  status: false;
  msg: string;
  data: null;
}

function checkAiEnabled(): AiDisabledResponse | null {
  const tokenService = new Token();
  const aiEnabled = tokenService.getValue(USER_AI_ENABLED);
  if (!aiEnabled || aiEnabled === "false" || aiEnabled === "0") {
    return {
      status: false,
      msg: "AI features are not enabled. Please upgrade your plan to access AI features.",
      data: null,
    };
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractData<T>(args: unknown[]): T {
  return args[1] as T;
}

function validateString(
  value: unknown,
  fieldName: string,
  maxLength = 256
): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return `${fieldName} is required and must be a non-empty string`;
  }
  if (value.length > maxLength) {
    return `${fieldName} exceeds maximum length of ${maxLength}`;
  }
  return null;
}

function toSummary(
  p: import("@/entity/InstalledPlugin.entity").InstalledPluginEntity,
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
    displayName: p.displayName,
    version: p.version,
    source: p.source as PluginSummary["source"],
    enabled: p.enabled === 1,
    health: p.health as PluginSummary["health"],
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

  // List all installed plugins.
  ipcMain.handle(
    PLUGIN_LIST,
    async (): Promise<CommonMessage<PluginSummary[] | null>> => {
      const notEnabled = checkAiEnabled();
      if (notEnabled) return notEnabled;

      try {
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
        return { status: true, msg: "Plugins retrieved", data: summaries };
      } catch (error: unknown) {
        return {
          status: false,
          msg: error instanceof Error ? error.message : "Unknown error",
          data: null,
        };
      }
    }
  );

  // Get detailed plugin info.
  ipcMain.handle(
    PLUGIN_GET,
    async (...args: unknown[]): Promise<CommonMessage<unknown>> => {
      const notEnabled = checkAiEnabled();
      if (notEnabled) return notEnabled;

      const data = extractData<{ name: string }>(args);
      const nameError = validateString(data?.name, "name");
      if (nameError) return { status: false, msg: nameError, data: null };

      try {
        const module = new PluginManagementModule();
        const plugin = await module.getPluginByName(data.name);
        if (!plugin) {
          return { status: false, msg: "Plugin not found", data: null };
        }
        const skillModule = new SkillManagementModule();
        const mcpModule = new MCPToolModule();
        const skills = await skillModule.findSkillsByPluginName(data.name);
        const mcpServers = await mcpModule.findMcpByPluginName(data.name);
        const summary = toSummary(plugin, skills.length, mcpServers.length);
        let manifest = {};
        try {
          manifest = JSON.parse(plugin.manifestJson || "{}");
        } catch {
          manifest = {};
        }
        return {
          status: true,
          msg: "Plugin detail retrieved",
          data: {
            ...summary,
            description: plugin.description,
            author: plugin.author,
            skills: skills.map((s) => ({
              name: s.name,
              enabled: s.enabled === 1,
              manifestPath: s.pluginComponentPath,
              health: "healthy",
            })),
            mcpServers: mcpServers.map((m) => ({
              id: m.id,
              name: m.serverName,
              enabled: m.enabled,
              transport: m.transport,
              health: "healthy",
              toolCount: 0,
            })),
            errors: [],
            manifest,
          },
        };
      } catch (error: unknown) {
        return {
          status: false,
          msg: error instanceof Error ? error.message : "Unknown error",
          data: null,
        };
      }
    }
  );

  // Import a plugin zip.
  ipcMain.handle(
    PLUGIN_IMPORT,
    async (
      ...args: unknown[]
    ): Promise<CommonMessage<PluginSummary | null>> => {
      const notEnabled = checkAiEnabled();
      if (notEnabled) return notEnabled;

      const data = extractData<{ zipPath: string; overwrite?: boolean }>(args);
      const pathError = validateString(data?.zipPath, "zipPath", 4096);
      if (pathError) return { status: false, msg: pathError, data: null };
      // Reject obvious path-traversal input.
      if (data.zipPath.includes("..")) {
        return {
          status: false,
          msg: "zipPath must not contain '..' segments",
          data: null,
        };
      }

      try {
        const result = await PluginImportService.importFromZip({
          zipPath: data.zipPath,
          overwrite: data.overwrite === true,
        });
        if (!result.success) {
          return {
            status: false,
            msg: result.errors.map((e) => e.message).join("; "),
            data: null,
          };
        }
        return {
          status: true,
          msg: "Plugin imported",
          data: result.plugin,
        };
      } catch (error: unknown) {
        return {
          status: false,
          msg: error instanceof Error ? error.message : "Unknown error",
          data: null,
        };
      }
    }
  );

  // Validate a plugin package without installing.
  ipcMain.handle(
    PLUGIN_VALIDATE_PACKAGE,
    async (...args: unknown[]): Promise<CommonMessage<unknown>> => {
      const notEnabled = checkAiEnabled();
      if (notEnabled) return notEnabled;

      const data = extractData<{ zipPath: string }>(args);
      const pathError = validateString(data?.zipPath, "zipPath", 4096);
      if (pathError) return { status: false, msg: pathError, data: null };
      if (data.zipPath.includes("..")) {
        return {
          status: false,
          msg: "zipPath must not contain '..' segments",
          data: null,
        };
      }

      try {
        // Dry-run validation: import with a throwaway overwrite flag would
        // mutate state, so we delegate to the archive + manifest services for
        // a preview only.
        const { PluginArchiveService } = await import(
          "@/service/PluginArchiveService"
        );
        const { PluginManifestService } = await import(
          "@/service/PluginManifestService"
        );
        const extract = await PluginArchiveService.extractZip(data.zipPath);
        if (!extract.success) {
          return {
            status: true,
            msg: "Validation failed",
            data: { valid: false, errors: extract.errors },
          };
        }
        const manifest = await PluginManifestService.loadFromDirectory(
          extract.tempRoot
        );
        await extract.cleanup();
        if (!manifest.success) {
          return {
            status: true,
            msg: "Validation failed",
            data: { valid: false, errors: manifest.errors },
          };
        }
        return {
          status: true,
          msg: "Validation passed",
          data: {
            valid: true,
            name: manifest.manifest.name,
            version: manifest.manifest.version,
          },
        };
      } catch (error: unknown) {
        return {
          status: false,
          msg: error instanceof Error ? error.message : "Unknown error",
          data: null,
        };
      }
    }
  );

  // Toggle plugin enabled.
  ipcMain.handle(
    PLUGIN_TOGGLE,
    async (...args: unknown[]): Promise<CommonMessage<null>> => {
      const notEnabled = checkAiEnabled();
      if (notEnabled) return notEnabled;

      const data = extractData<{ name: string; enabled: boolean }>(args);
      const nameError = validateString(data?.name, "name");
      if (nameError) return { status: false, msg: nameError, data: null };

      try {
        const module = new PluginManagementModule();
        const ok = await module.togglePlugin(data.name, data.enabled === true);
        if (!ok) {
          return { status: false, msg: "Plugin not found", data: null };
        }
        await PluginComponentRegistryService.applyLoadedPlugins();
        return { status: true, msg: "Plugin toggled", data: null };
      } catch (error: unknown) {
        return {
          status: false,
          msg: error instanceof Error ? error.message : "Unknown error",
          data: null,
        };
      }
    }
  );

  // Uninstall a plugin.
  ipcMain.handle(
    PLUGIN_UNINSTALL,
    async (...args: unknown[]): Promise<CommonMessage<null>> => {
      const notEnabled = checkAiEnabled();
      if (notEnabled) return notEnabled;

      const data = extractData<{ name: string }>(args);
      const nameError = validateString(data?.name, "name");
      if (nameError) return { status: false, msg: nameError, data: null };

      try {
        const module = new PluginManagementModule();
        const result = await module.uninstallPlugin(data.name);
        if (!result.removedPlugin) {
          return { status: false, msg: "Plugin not found", data: null };
        }
        // Best-effort remove install path.
        const installPath = getPluginInstallRoot(data.name);
        try {
          const fs = await import("fs");
          fs.rmSync(installPath, { recursive: true, force: true });
        } catch {
          // best-effort
        }
        await PluginComponentRegistryService.unregisterPluginCapabilities(
          data.name
        );
        return { status: true, msg: "Plugin uninstalled", data: null };
      } catch (error: unknown) {
        return {
          status: false,
          msg: error instanceof Error ? error.message : "Unknown error",
          data: null,
        };
      }
    }
  );

  // Reload all plugins.
  ipcMain.handle(PLUGIN_RELOAD, async (): Promise<CommonMessage<unknown>> => {
    const notEnabled = checkAiEnabled();
    if (notEnabled) return notEnabled;

    try {
      const result = await PluginComponentRegistryService.reload();
      return {
        status: true,
        msg: "Plugins reloaded",
        data: {
          enabled: result.enabled.length,
          disabled: result.disabled.length,
          errors: result.errors.length,
        },
      };
    } catch (error: unknown) {
      return {
        status: false,
        msg: error instanceof Error ? error.message : "Unknown error",
        data: null,
      };
    }
  });

  // Export diagnostics bundle.
  ipcMain.handle(
    PLUGIN_EXPORT_DIAGNOSTICS,
    async (...args: unknown[]): Promise<CommonMessage<unknown>> => {
      const notEnabled = checkAiEnabled();
      if (notEnabled) return notEnabled;

      const data = extractData<{ name: string }>(args);
      const nameError = validateString(data?.name, "name");
      if (nameError) return { status: false, msg: nameError, data: null };

      try {
        const bundle = await PluginDiagnosticsService.buildBundle(data.name);
        if (!bundle) {
          return { status: false, msg: "Plugin not found", data: null };
        }
        return { status: true, msg: "Diagnostics exported", data: bundle };
      } catch (error: unknown) {
        return {
          status: false,
          msg: error instanceof Error ? error.message : "Unknown error",
          data: null,
        };
      }
    }
  );

  // Toggle a plugin-owned skill.
  ipcMain.handle(
    PLUGIN_TOGGLE_SKILL,
    async (...args: unknown[]): Promise<CommonMessage<null>> => {
      const notEnabled = checkAiEnabled();
      if (notEnabled) return notEnabled;

      const data = extractData<{ skillName: string; enabled: boolean }>(args);
      const nameError = validateString(data?.skillName, "skillName");
      if (nameError) return { status: false, msg: nameError, data: null };

      try {
        const skillModule = new SkillManagementModule();
        const ok = await skillModule.toggleSkill(
          data.skillName,
          data.enabled === true
        );
        if (!ok) {
          return { status: false, msg: "Skill not found", data: null };
        }
        await PluginComponentRegistryService.applyLoadedPlugins();
        return { status: true, msg: "Skill toggled", data: null };
      } catch (error: unknown) {
        return {
          status: false,
          msg: error instanceof Error ? error.message : "Unknown error",
          data: null,
        };
      }
    }
  );

  // Toggle a plugin-owned MCP server.
  ipcMain.handle(
    PLUGIN_TOGGLE_MCP_SERVER,
    async (...args: unknown[]): Promise<CommonMessage<null>> => {
      const notEnabled = checkAiEnabled();
      if (notEnabled) return notEnabled;

      const data = extractData<{ serverId: number; enabled: boolean }>(args);
      if (typeof data?.serverId !== "number") {
        return { status: false, msg: "serverId is required", data: null };
      }

      try {
        const mcpModule = new MCPToolModule();
        await mcpModule.toggleServerEnabled(
          data.serverId,
          data.enabled === true
        );
        await PluginComponentRegistryService.applyLoadedPlugins();
        return { status: true, msg: "MCP server toggled", data: null };
      } catch (error: unknown) {
        return {
          status: false,
          msg: error instanceof Error ? error.message : "Unknown error",
          data: null,
        };
      }
    }
  );

  // Toggle a plugin-owned MCP tool.
  ipcMain.handle(
    PLUGIN_TOGGLE_MCP_TOOL,
    async (...args: unknown[]): Promise<CommonMessage<null>> => {
      const notEnabled = checkAiEnabled();
      if (notEnabled) return notEnabled;

      const data = extractData<{
        serverId: number;
        toolName: string;
        enabled: boolean;
      }>(args);
      if (typeof data?.serverId !== "number") {
        return { status: false, msg: "serverId is required", data: null };
      }
      const toolError = validateString(data?.toolName, "toolName");
      if (toolError) return { status: false, msg: toolError, data: null };

      try {
        const service = new MCPToolService();
        await service.toggleToolEnabled(
          data.serverId,
          data.toolName,
          data.enabled === true
        );
        return { status: true, msg: "MCP tool toggled", data: null };
      } catch (error: unknown) {
        return {
          status: false,
          msg: error instanceof Error ? error.message : "Unknown error",
          data: null,
        };
      }
    }
  );

  // Test MCP connection.
  ipcMain.handle(
    PLUGIN_TEST_MCP_CONNECTION,
    async (...args: unknown[]): Promise<CommonMessage<boolean | null>> => {
      const notEnabled = checkAiEnabled();
      if (notEnabled) return notEnabled;

      const data = extractData<{ serverId: number }>(args);
      if (typeof data?.serverId !== "number") {
        return { status: false, msg: "serverId is required", data: false };
      }

      try {
        const service = new MCPToolService();
        const ok = await service.testConnection(data.serverId);
        return { status: true, msg: "Connection test completed", data: ok };
      } catch (error: unknown) {
        return {
          status: false,
          msg: error instanceof Error ? error.message : "Unknown error",
          data: false,
        };
      }
    }
  );

  // Discover MCP tools for a plugin-owned server.
  ipcMain.handle(
    PLUGIN_DISCOVER_MCP_TOOLS,
    async (...args: unknown[]): Promise<CommonMessage<unknown>> => {
      const notEnabled = checkAiEnabled();
      if (notEnabled) return notEnabled;

      const data = extractData<{ serverId: number }>(args);
      if (typeof data?.serverId !== "number") {
        return { status: false, msg: "serverId is required", data: null };
      }

      try {
        const service = new MCPToolService();
        const tools = await service.discoverTools(data.serverId);
        await PluginComponentRegistryService.applyLoadedPlugins();
        return {
          status: true,
          msg: "Tools discovered",
          data: tools,
        };
      } catch (error: unknown) {
        return {
          status: false,
          msg: error instanceof Error ? error.message : "Unknown error",
          data: null,
        };
      }
    }
  );

  // Silence unused-import warnings for symbols reserved for future handlers.
  void PluginLoaderService;
}
