import * as fs from "fs";
import * as path from "path";
import { log } from "@/modules/Logger";
import {
  PluginLoaderService,
  type LoadedPlugin,
  type PluginLoadResult,
} from "@/service/PluginLoaderService";
import { PluginRuntimeCache } from "@/service/PluginRuntimeCache";
import { PluginHookRegistrar } from "@/service/pluginCompat/PluginHookRegistrar";
import { PluginCommandSourceReader } from "@/service/pluginCompat/PluginCommandSourceReader";
import { PluginCommandDiagnosticsStore } from "@/service/pluginCompat/PluginCommandDiagnosticsStore";
import { UserPluginAutoInstallService } from "@/service/UserPluginAutoInstallService";
import { PluginAgentImportService } from "@/service/PluginAgentImportService";
import { SkillRegistry } from "@/config/skillsRegistry";
import {
  buildPluginPolicyTargetUniverse,
  getPluginToolPolicyRegistry,
  type PluginPolicyTargetUniverse,
} from "@/service/PluginToolPolicyRegistry";
import {
  getDefaultToolJobRegistry,
  TOOL_JOB_SETTLE_GRACE_MS,
} from "@/service/ToolJobRegistry";
import { CommandRegistry } from "@/service/slashCommands/CommandRegistry";
import { AgentDefinitionRegistryImpl } from "@/service/AgentDefinitionRegistry";
import { getAIFetchlyConfigManager } from "@/service/aifetchlyConfig/AIFetchlyConfigManager";
import {
  PluginManagementModule,
} from "@/modules/PluginManagementModule";
import { MCPToolModule } from "@/modules/MCPToolModule";
import { MCPToolService } from "@/service/MCPToolService";
import { getPluginBrowserCapabilityService } from "@/service/PluginBrowserCapabilityService";
import { buildAgentDefinition } from "@/service/slashCommands/agentFrontmatter";
import {
  frontmatterRecord,
  parseRestrictedFrontmatter,
} from "@/service/aifetchlyConfig/AIFetchlyConfigMarkdown";
import { AIFETCHLY_CONFIG_LIMITS } from "@/service/aifetchlyConfig/AIFetchlyConfigConstants";
import type { AIFetchlyConfigDiagnostic } from "@/entityTypes/aifetchlyConfigTypes";
import type { AgentDefinitionView } from "@/entityTypes/agentTypes";
import type { PluginError } from "@/entityTypes/pluginTypes";
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
    // G01: hook registration moves AFTER the policy gate below — a plugin
    // that fails activation must not expose hooks, skills, commands or
    // agents, and its previously registered hooks/skills return empty.
    // Register validated MCP tool policies for enabled plugins and drop them
    // for disabled ones (HOST-01/HOST-03 wiring: policy resolution in the
    // query loop consults this registry between skill lookup and name
    // inference). Activation errors are logged, never thrown — a broken
    // plugin must not break applying the rest.
    const policyRegistry = getPluginToolPolicyRegistry();
    const gateFailedPlugins: string[] = [];
    for (const plugin of loaded.enabled) {
      // G01/HOST-04: validate policy targets against the plugin's persisted
      // MCP rows (scoped row name → unscoped policy name) plus its declared
      // discovered tool lists. A policy referencing a server the plugin
      // does not own — or a tool the row never declared/discovered — fails
      // activation exactly like an invalid policy shape.
      let declaredTargets: PluginPolicyTargetUniverse | undefined;
      try {
        const ownedMcp = await new MCPToolModule().findMcpByPluginName(
          plugin.name
        );
        declaredTargets = buildPluginPolicyTargetUniverse(
          plugin.name,
          ownedMcp.map((row) => ({
            serverName: row.serverName,
            metadata: row.metadata ?? null,
            tools: row.tools ?? null,
          }))
        );
      } catch (dbErr) {
        log.warn(
          `[PluginComponentRegistryService] declared-target lookup failed for "${plugin.name}":`,
          dbErr
        );
        declaredTargets = undefined;
      }
      const result = policyRegistry.registerFromManifest(
        plugin.name,
        plugin.manifest,
        declaredTargets
      );
      if (result.errors.length > 0) {
        gateFailedPlugins.push(plugin.name);
        log.warn(
          `[PluginComponentRegistryService] tool policy registration failed for "${plugin.name}":`,
          result.errors.map((e) => e.message).join("; ")
        );
        // HOST-04 activation gate (re-evaluated on every apply): a manifest
        // whose tool policies / host requirements fail registration must
        // never leave its MCP servers discoverable. Persist a stable
        // diagnostic, flip health to `invalid`, and disable the owned
        // server rows so the model cannot reach them (and therefore cannot
        // fall through to the 90-second name-inference timeout).
        try {
          const pluginModule = new PluginManagementModule();
          await pluginModule.updatePluginState({
            name: plugin.name,
            health: "invalid",
            lastLoadErrorsJson: JSON.stringify([...result.errors]),
          });
          const disabledCount = await new MCPToolModule().setPluginServersEnabled(
            plugin.name,
            false
          );
          log.warn(
            `[PluginComponentRegistryService] HOST-04: disabled ${disabledCount} MCP server(s) for "${plugin.name}".`
          );
        } catch (gateErr) {
          log.warn(
            `[PluginComponentRegistryService] HOST-04: failed to disable "${plugin.name}":`,
            gateErr
          );
        }
      }
    }
    // G01: the ENTIRE activation gate must succeed before ANY non-MCP
    // capability registers. Hooks follow policy validation, and a
    // gate-failed plugin loses its skills, commands, agents, hooks and
    // policy leases until its manifest passes again (the DB rows stay; the
    // next successful apply re-registers everything).
    // B11/HOST-15: BEFORE hooks, re-evaluate browser-blocked server rows.
    // Import disabled them (metadata `hostDisabledReason: browser-missing`)
    // while the browser dependency was unresolved and promised that a
    // reload/apply would repair them once it resolved — without this hook
    // that promise was never kept. Only HOST-disabled rows are repaired;
    // explicit user disables have no marker and stay untouched, and a
    // failing discovery keeps the row disabled with a fresh diagnostic.
    for (const plugin of loaded.enabled.filter(
      (p) => !gateFailedPlugins.includes(p.name)
    )) {
      try {
        const usable = getPluginBrowserCapabilityService().testBrowserUsable(
          plugin.manifest.capabilities
        );
        if (!usable.compatible) continue;
        const repaired =
          await PluginComponentRegistryService.repairBrowserBlockedServers(
            plugin.name
          );
        if (repaired.disabledCount > 0) {
          log.info(
            `[PluginComponentRegistryService] B11: re-enabled ${repaired.enabledCount}/${repaired.disabledCount} browser-blocked MCP server(s) for "${plugin.name}".`
          );
        }
        if (repaired.failureCount > 0) {
          log.warn(
            `[PluginComponentRegistryService] B11: discovery failed for ${repaired.failureCount} repaired server(s) "${plugin.name}" — those rows stay disabled.`
          );
        }
      } catch (repairErr) {
        log.warn(
          `[PluginComponentRegistryService] B11: browser repair for "${plugin.name}" failed:`,
          repairErr
        );
      }
    }
    PluginHookRegistrar.registerFromLoadedPlugins(
      loaded.enabled.filter(
        (plugin) => !gateFailedPlugins.includes(plugin.name)
      )
    );
    for (const pluginName of gateFailedPlugins) {
      await PluginComponentRegistryService.unregisterPluginCapabilities(
        pluginName
      );
    }
    for (const plugin of loaded.disabled) {
      PluginHookRegistrar.unregisterPlugin(plugin.name);
      policyRegistry.unregisterPlugin(plugin.name);
    }
    const manager = getAIFetchlyConfigManager();
    const gatePromotable = loaded.enabled.filter(
      (plugin) => !gateFailedPlugins.includes(plugin.name)
    );
    await PluginComponentRegistryService.promotePluginCommandsAndAgents(
      manager.getCommandRegistry(),
      manager.getAgentRegistry(),
      [...gatePromotable, ...loaded.disabled]
    );
  }

  /**
   * Remove a plugin's capabilities from the runtime. Used by the IPC
   * uninstall/disable flow.
   */
  /**
   * B11/HOST-15: re-enable a plugin's HOST-disabled MCP rows (import
   * persisted them disabled while the declared browser dependency was
   * unresolved, marker `hostDisabledReason: "browser-missing"` in the
   * host-owned metadata) once the browser dependency resolves. Each
   * repaired row re-runs the trust+discovery smoke test; rows whose
   * discovery fails stay disabled with their marker so a later apply
   * retries. Explicit user disables (no marker) are never touched.
   */
  static async repairBrowserBlockedServers(
    pluginName: string
  ): Promise<{
    disabledCount: number;
    enabledCount: number;
    failureCount: number;
  }> {
    const mcpModule = new MCPToolModule();
    const candidates = await mcpModule.findBrowserDisabledByPluginName(
      pluginName
    );
    if (candidates.length === 0) {
      return { disabledCount: 0, enabledCount: 0, failureCount: 0 };
    }
    let enabledCount = 0;
    let failureCount = 0;
    for (const row of candidates) {
      try {
        if (row.transport === "stdio") {
          new MCPToolService().setTrust(row.id, true);
        }
        await new MCPToolService().discoverTools(row.id);
        await mcpModule.clearBrowserDisabledMarker(row.id);
        enabledCount += 1;
      } catch (e) {
        failureCount += 1;
        log.warn(
          `[PluginComponentRegistryService] B11: repair discovery failed for server ${row.id} ("${pluginName}"):`,
          e
        );
      }
    }
    return {
      disabledCount: candidates.length,
      enabledCount,
      failureCount,
    };
  }

  static async unregisterPluginCapabilities(pluginName: string): Promise<void> {
    PluginRuntimeCache.clear(`unregister-${pluginName}`);
    SkillRegistry.unregisterSkillsByPlugin(pluginName);
    getPluginToolPolicyRegistry().unregisterPlugin(pluginName);
    const sourceId = `plugin:${pluginName}`;
    const manager = getAIFetchlyConfigManager();
    manager.getCommandRegistry().replaceSource(sourceId, []);
    manager.getAgentRegistry().replaceSource(sourceId, []);
    PluginHookRegistrar.unregisterPlugin(pluginName);
    PluginCommandDiagnosticsStore.clear(pluginName);
  }

  /**
   * H5 (lifecycle) + B05: quiesce every active MCP tool job owned by a
   * plugin WITHOUT owning the admission seal.
   *
   * Sealing is the caller's job now (`withPluginLifecycleSeal`): the seal
   * must remain held across the ENTIRE lifecycle transaction (disable /
   * uninstall / update state changes, file removal, staging swap, DB rows)
   * — not merely while jobs are being torn down. Releasing it here would
   * let a new job enter during the async gaps between quiescence and the
   * destructive part of the operation.
   *
   * Throws the retryable AI_FETCHLY_PLUGIN_CLEANUP_TIMEOUT error when jobs
   * are still unwinding (or quarantined by B04) past the grace window —
   * no files have been removed at that point.
   */
  static async stopActiveJobsForPlugin(
    pluginName: string,
    graceMs: number = TOOL_JOB_SETTLE_GRACE_MS
  ): Promise<void> {
    const registry = getDefaultToolJobRegistry();
    const prefix = `mcp__${pluginName}__`;
    const jobIds = registry.listActiveJobIdsByToolPrefix(prefix);
    if (jobIds.length === 0) return;
    log.info(
      `[PluginComponentRegistryService] aborting ${jobIds.length} active MCP job(s) for "${pluginName}".`
    );
    await registry.abortAndAwaitJobs(jobIds, graceMs);
    const remaining = registry.listActiveJobIdsByToolPrefix(prefix).length;
    if (remaining > 0) {
      throw new Error(
        `AI_FETCHLY_PLUGIN_CLEANUP_TIMEOUT: ${remaining} MCP tool job(s) for "${pluginName}" are still unwinding; no files were removed — retry the operation.`
      );
    }
  }

  /**
   * B05: hold the plugin admission seal for the ENTIRE lifecycle
   * transaction. The seal is taken synchronously BEFORE any await, the
   * plugin's active jobs are quiesced while sealed, and `operation` runs
   * with admission suppressed for every one of its awaited boundaries —
   * state toggles, file deletion/replacement, DB writes and re-activation
   * alike. The seal is released only after `operation` settles (including
   * its rollback path), so no job can be admitted between quiescence and
   * the safe end of the transaction.
   *
   * When quiescence FAILS (jobs outlive the grace window / B04 quarantine),
   * `operation` is never invoked — no binary is deleted under live work.
   */
  static async withPluginLifecycleSeal<T>(
    pluginName: string,
    operation: () => Promise<T>,
    graceMs: number = TOOL_JOB_SETTLE_GRACE_MS
  ): Promise<T> {
    const registry = getDefaultToolJobRegistry();
    const prefix = `mcp__${pluginName}__`;
    registry.sealAdmission(prefix);
    try {
      await PluginComponentRegistryService.stopActiveJobsForPlugin(
        pluginName,
        graceMs
      );
      return await operation();
    } finally {
      registry.releaseAdmissionSeal(prefix);
    }
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
      log.warn(
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
        // Reconcile to an empty diagnostics set so a now-clean (disabled /
        // uninstalled / missing-dir) plugin never lingers stale warnings.
        PluginCommandDiagnosticsStore.set(plugin.name, []);
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
        plugin.manifest.format === "claude"
          ? PluginComponentRegistryService.readClaudePluginAgents(
              plugin,
              sourceId
            )
          : await PluginComponentRegistryService.readComponentFiles<AgentDefinitionView>(
              plugin.installPath,
              "agents",
              AIFETCHLY_CONFIG_LIMITS.agentMdBytes,
              sourceId,
              (draft) => buildAgentDefinition(draft, sourceMeta)
            );
      allDiagnostics.push(...agentResult.diagnostics);
      agentRegistry.replaceSource(sourceId, agentResult.definitions);

      // Cache this plugin's command+agent diagnostics so the diagnostics
      // bundle can surface WHY individual command/agent files were skipped.
      // (Commands/agents have no DB row; the live registry is the truth, so
      // diagnostics live in memory here.)
      PluginCommandDiagnosticsStore.set(plugin.name, [
        ...commandResult.diagnostics,
        ...agentResult.diagnostics,
      ]);
    }

    return { diagnostics: allDiagnostics };
  }

  private static readClaudePluginAgents(
    plugin: LoadedPlugin,
    sourceId: string
  ): {
    readonly definitions: readonly AgentDefinitionView[];
    readonly diagnostics: readonly AIFetchlyConfigDiagnostic[];
  } {
    const parsed = PluginAgentImportService.parsePluginAgents({
      pluginRoot: plugin.installPath,
      manifest: plugin.manifest,
    });
    if (!parsed.ok) {
      return {
        definitions: [],
        diagnostics: parsed.errors.map((error) =>
          pluginErrorToDiagnostic(sourceId, error)
        ),
      };
    }
    return {
      definitions: parsed.agents.map((agent) => agent.definition),
      diagnostics: parsed.warnings.map((warning) =>
        pluginErrorToDiagnostic(sourceId, warning)
      ),
    };
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
  message: string,
  severity: AIFetchlyConfigDiagnostic["severity"] = "warning",
  recoverable = true
): AIFetchlyConfigDiagnostic {
  return {
    severity,
    source: "plugin",
    sourceId,
    filePath,
    code,
    message,
    recoverable,
  };
}

function pluginErrorToDiagnostic(
  sourceId: string,
  error: PluginError
): AIFetchlyConfigDiagnostic {
  return pluginDiagnostic(
    sourceId,
    error.path ?? error.componentName ?? error.componentType ?? "plugin",
    error.code,
    error.message,
    error.recoverable ? "warning" : "error",
    error.recoverable
  );
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
