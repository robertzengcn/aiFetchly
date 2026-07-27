import { PluginManagementModule } from "@/modules/PluginManagementModule";
import { AgentDefinitionModule } from "@/modules/AgentDefinitionModule";
import { SkillManagementModule } from "@/modules/SkillManagementModule";
import { MCPToolModule } from "@/modules/MCPToolModule";
import { MCPToolService } from "@/service/MCPToolService";
import { PluginImportService } from "@/service/PluginImportService";
import { PluginOptionsStore } from "@/service/pluginCompat/PluginOptionsStore";
import { PluginComponentRegistryService } from "@/service/PluginComponentRegistryService";
import { PluginDiagnosticsService } from "@/service/PluginDiagnosticsService";
import { UserPluginAutoInstallService } from "@/service/UserPluginAutoInstallService";
import { getPluginInstallRoot } from "@/service/pluginPaths";
import { getAIFetchlyConfigManager } from "@/service/aifetchlyConfig/AIFetchlyConfigManager";
import { HookRegistry } from "@/service/hooks/HookRegistry";
import { broadcastAifetchlyConfigChanged } from "@/main-process/communication/aifetchlyConfigEvents";
import type { SlashCommandView } from "@/entityTypes/slashCommandTypes";
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
  PLUGIN_GET_MCP_OPTIONS,
  PLUGIN_SET_MCP_OPTION,
} from "@/config/channellist";
import { registerValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
import type { MCPToolEntity } from "@/entity/MCPTool.entity";
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
  pluginGetMcpOptionsInputSchema,
  pluginSetMcpOptionInputSchema,
} from "@/schemas/ipc/plugin";

/**
 * Plugin Management IPC handlers — all migrated to registerValidatedHandler
 * (plugin management is NOT an AI feature).
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
  mcpServerCount: number,
  agentCount: number,
  commandCount: number,
  hookCount: number
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
    agentCount,
    commandCount,
    hookCount,
    permissions,
    lastUpdated: p.updatedAt
      ? new Date(p.updatedAt).toISOString()
      : new Date().toISOString(),
    sourceKind: p.sourceKind as PluginSummary["sourceKind"],
    sourceUri: p.sourceUri,
    sourceRef: p.sourceRef,
    installPath: p.installPath,
  };
}

/**
 * Renderer-safe projection of one plugin command for the Plugin Manager detail
 * surface. Picks only the inspectable fields — the raw prompt body and
 * arbitrary metadata are NEVER included (PRD §11.1 / AC-9). `sourceId` is
 * exposed so users can see the canonical `plugin:<name>` identity.
 */
interface PluginCommandViewEntry {
  readonly name: string;
  readonly description: string;
  readonly aliases: readonly string[];
  readonly argumentHint?: string;
  readonly enabled: boolean;
  readonly sourceId: string;
}

function toPluginCommandView(
  view: SlashCommandView,
  sourceId: string
): PluginCommandViewEntry {
  return {
    name: view.name,
    description: view.description,
    aliases: view.aliases,
    ...(view.argumentHint !== undefined
      ? { argumentHint: view.argumentHint }
      : {}),
    enabled: view.enabled,
    sourceId,
  };
}

interface PluginMcpServerViewEntry {
  readonly id: number;
  readonly name: string;
  readonly serverName: string;
  readonly enabled: boolean;
  readonly transport: MCPToolEntity["transport"];
  readonly health: "healthy" | "needs_configuration";
  readonly toolCount: number;
  readonly error?: string;
}

function parseJsonObject(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Malformed metadata should not make the plugin detail surface unusable.
  }
  return {};
}

function parseToolCount(raw: string | undefined): number {
  if (!raw) return 0;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function toPluginMcpServerView(
  server: MCPToolEntity
): PluginMcpServerViewEntry {
  const metadata = parseJsonObject(server.metadata);
  const pluginServerName = metadata.pluginServerName;
  const name =
    typeof pluginServerName === "string" && pluginServerName.length > 0
      ? pluginServerName
      : server.serverName;
  const hasConfig =
    (server.transport === "stdio" && !!server.command) ||
    ((server.transport === "sse" || server.transport === "websocket") &&
      (!!server.host || !!server.url));
  const error = hasConfig
    ? undefined
    : `MCP server "${server.serverName}" is missing required configuration.`;
  return {
    id: server.id,
    name,
    serverName: server.serverName,
    enabled: server.enabled,
    transport: server.transport,
    health: hasConfig ? "healthy" : "needs_configuration",
    toolCount: parseToolCount(server.tools),
    ...(error ? { error } : {}),
  };
}

/** Live slash commands promoted by a plugin, as renderer-safe views. */
function pluginCommandViews(pluginName: string): {
  readonly views: readonly PluginCommandViewEntry[];
  readonly count: number;
} {
  const sourceId = `plugin:${pluginName}`;
  const defs = getAIFetchlyConfigManager()
    .getCommandRegistry()
    .listViewsBySource(sourceId);
  return {
    views: defs.map((v) => toPluginCommandView(v, sourceId)),
    count: defs.length,
  };
}

interface PluginHookViewEntry {
  readonly id: string;
  readonly eventName: string;
  readonly matcher?: string;
  readonly enabled: boolean;
  readonly type: string;
  readonly health: "healthy" | "disabled";
}

function pluginHookViews(pluginName: string): {
  readonly views: readonly PluginHookViewEntry[];
  readonly count: number;
} {
  const prefix = `plugin:${pluginName}:`;
  const hooks = HookRegistry.listAll({ source: "plugin" }).filter((hook) =>
    hook.id.startsWith(prefix)
  );
  return {
    views: hooks.map((hook) => ({
      id: hook.id,
      eventName: hook.eventName,
      ...(hook.matcher !== undefined ? { matcher: hook.matcher } : {}),
      enabled: hook.enabled,
      type: hook.type,
      health: hook.enabled ? "healthy" : "disabled",
    })),
    count: hooks.length,
  };
}

export function registerPluginIpcHandlers(): void {
  console.log("Plugin IPC handlers registered");

  registerValidatedHandler(PLUGIN_LIST, pluginNoInputSchema, async () => {
    await syncUserPluginFoldersForList();
    const module = new PluginManagementModule();
    const skillModule = new SkillManagementModule();
    const mcpModule = new MCPToolModule();
    const agentModule = new AgentDefinitionModule();
    const plugins = await module.listInstalledPlugins();
    const summaries: PluginSummary[] = [];
    for (const p of plugins) {
      const skills = await skillModule.findSkillsByPluginName(p.name);
      const mcpServers = await mcpModule.findMcpByPluginName(p.name);
      const agents = await agentModule.findAgentsByPluginName(p.name);
      const commandCount = pluginCommandViews(p.name).count;
      const hookCount = pluginHookViews(p.name).count;
      summaries.push(
        toSummary(
          p,
          skills.length,
          mcpServers.length,
          agents.length,
          commandCount,
          hookCount
        )
      );
    }
    return summaries;
  });

  registerValidatedHandler(
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
      const agentModule = new AgentDefinitionModule();
      const skills = await skillModule.findSkillsByPluginName(input.name);
      const mcpServers = await mcpModule.findMcpByPluginName(input.name);
      const agents = await agentModule.findAgentsByPluginName(input.name);
      const commandInfo = pluginCommandViews(input.name);
      const hookInfo = pluginHookViews(input.name);
      const summary = toSummary(
        plugin,
        skills.length,
        mcpServers.length,
        agents.length,
        commandInfo.count,
        hookInfo.count
      );
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
        mcpServers: mcpServers.map((s) => toPluginMcpServerView(s)),
        agents: agents.map((a) => ({
          id: a.id,
          name: a.name,
          description: a.description,
          enabled: a.status === "active",
          mode: a.mode,
          toolCount: a.allowedTools.length,
          componentPath: a.pluginComponentPath ?? "",
          health: a.health,
          ...(a.lastError ? { error: a.lastError } : {}),
        })),
        // Renderer-safe command list — body/metadata stripped (PRD §11.1/AC-9).
        commands: commandInfo.views,
        hooks: hookInfo.views,
        manifest,
      };
    }
  );

  registerValidatedHandler(
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
      // Promote the plugin's commands/agents immediately so they are usable in
      // AiChatV2 without an app restart or manual reload (PRD §9.4 / design
      // §11). Recoverable: a promotion failure must NOT fail an otherwise-
      // successful install — the plugin is already persisted and a subsequent
      // reload re-promotes. Invalid commands surface as diagnostics, not errors.
      try {
        await PluginComponentRegistryService.applyLoadedPlugins();
      } catch (promotionError) {
        console.warn(
          "[plugin-ipc] command promotion after import failed (recoverable):",
          promotionError
        );
      }
      // Plugin set changed — refresh any open slash suggestions (PRD Problem 2).
      broadcastAifetchlyConfigChanged({ source: "plugin" });
      return result.plugin;
    }
  );

  // Install from various sources (zip, folder, git, github, npm, url)
  // Merged from dev branch. Uses registerValidatedHandler + passthrough schema.
  registerValidatedHandler(
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
      // Promote the plugin's commands/agents immediately so they are usable in
      // AiChatV2 without an app restart or manual reload (PRD §9.4 / design
      // §11). Recoverable: a promotion failure must NOT fail an otherwise-
      // successful install — the plugin is already persisted and a subsequent
      // reload re-promotes.
      try {
        await PluginComponentRegistryService.applyLoadedPlugins();
      } catch (promotionError) {
        console.warn(
          "[plugin-ipc] command promotion after install-from-source failed (recoverable):",
          promotionError
        );
      }
      // Plugin set changed — refresh any open slash suggestions (PRD Problem 2).
      broadcastAifetchlyConfigChanged({ source: "plugin" });
      return r.plugin;
    }
  );

  registerValidatedHandler(
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
      const { PluginManifestService, resolvePluginRoot } = await import(
        "@/service/PluginManifestService"
      );
      const extract = await PluginArchiveService.extractZip(input.zipPath);
      if (!extract.success) {
        return { valid: false, errors: extract.errors };
      }
      const effectiveRoot = resolvePluginRoot(extract.tempRoot);
      const manifest = await PluginManifestService.loadFromDirectory(
        effectiveRoot
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

  registerValidatedHandler(
    PLUGIN_TOGGLE,
    pluginToggleInputSchema,
    async (input) => {
      const module = new PluginManagementModule();
      const ok = await module.togglePlugin(input.name, input.enabled);
      if (!ok) {
        throw new Error("Plugin not found");
      }
      await PluginComponentRegistryService.applyLoadedPlugins();
      // Enable/disable changed the effective command set — refresh suggestions.
      broadcastAifetchlyConfigChanged({ source: "plugin" });
      return null;
    }
  );

  registerValidatedHandler(
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
      // Plugin removed — refresh any open slash suggestions (PRD Problem 2).
      broadcastAifetchlyConfigChanged({ source: "plugin" });
      return null;
    }
  );

  registerValidatedHandler(PLUGIN_RELOAD, pluginNoInputSchema, async () => {
    const result = await PluginComponentRegistryService.reload();
    // Reload re-ran command promotion — refresh any open slash suggestions.
    broadcastAifetchlyConfigChanged({ source: "plugin" });
    return {
      enabled: result.enabled.length,
      disabled: result.disabled.length,
      errors: result.errors.length,
    };
  });

  registerValidatedHandler(
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

  registerValidatedHandler(
    PLUGIN_TOGGLE_SKILL,
    pluginToggleSkillInputSchema,
    async (input) => {
      const skillModule = new SkillManagementModule();
      const ok = await skillModule.toggleSkill(input.skillName, input.enabled);
      if (!ok) {
        throw new Error("Skill not found");
      }
      await PluginComponentRegistryService.applyLoadedPlugins();
      // Capability set changed — refresh any subscribed renderer cache.
      broadcastAifetchlyConfigChanged({ source: "plugin" });
      return null;
    }
  );

  registerValidatedHandler(
    PLUGIN_TOGGLE_MCP_SERVER,
    pluginToggleMcpServerInputSchema,
    async (input) => {
      const mcpModule = new MCPToolModule();
      await mcpModule.toggleServerEnabled(input.serverId, input.enabled);
      await PluginComponentRegistryService.applyLoadedPlugins();
      return null;
    }
  );

  registerValidatedHandler(
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

  registerValidatedHandler(
    PLUGIN_TEST_MCP_CONNECTION,
    pluginByServerIdInputSchema,
    async (input) => {
      const service = new MCPToolService();
      return service.testConnection(input.serverId);
    }
  );

  registerValidatedHandler(
    PLUGIN_DISCOVER_MCP_TOOLS,
    pluginByServerIdInputSchema,
    async (input) => {
      const service = new MCPToolService();
      const tools = await service.discoverTools(input.serverId);
      await PluginComponentRegistryService.applyLoadedPlugins();
      return tools;
    }
  );

  // MCP option read/write — config-only, NOT AI-gated. Users can edit
  // MCP option values regardless of AI enable state; the values take
  // effect at next MCP spawn (which IS AI-gated).
  registerValidatedHandler(
    PLUGIN_GET_MCP_OPTIONS,
    pluginGetMcpOptionsInputSchema,
    async (input) => {
      return PluginOptionsStore.read(input.pluginName);
    }
  );

  registerValidatedHandler(
    PLUGIN_SET_MCP_OPTION,
    pluginSetMcpOptionInputSchema,
    async (input) => {
      PluginOptionsStore.setOption(
        input.pluginName,
        input.scopedServerName,
        input.varName,
        input.value
      );
      return { ok: true as const };
    }
  );
}

async function syncUserPluginFoldersForList(): Promise<void> {
  const result = await UserPluginAutoInstallService.syncDefaultUserPlugins();
  if (result.errors.length > 0) {
    console.warn(
      `[Plugin IPC] Failed to auto-install ${result.errors.length} user plugin folder(s).`,
      result.errors
    );
  }
}
