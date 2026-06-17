import * as fs from "fs";
import * as path from "path";
import { PluginManagementModule } from "@/modules/PluginManagementModule";
import { SkillManagementModule } from "@/modules/SkillManagementModule";
import { MCPToolModule } from "@/modules/MCPToolModule";
import { MCPToolEntity } from "@/entity/MCPTool.entity";
import { PluginArchiveService } from "@/service/PluginArchiveService";
import { PluginManifestService } from "@/service/PluginManifestService";
import {
  parseServersJson,
  normalizeMcpDeclaration,
  type NormalizedMcpServer,
} from "@/service/PluginMcpDeclaration";
import { getPluginInstallRoot } from "@/service/pluginPaths";
import {
  resolvePluginRelativePath,
  type PluginError,
  type PluginSummary,
  type PluginSource,
} from "@/entityTypes/pluginTypes";
import { SkillImportService } from "@/service/SkillImportService";
import type { SkillManifest } from "@/entityTypes/skillTypes";

/**
 * Atomic plugin import from a local zip package.
 * Source of truth: Design §7.3 (sequence + rollback), §8.1, §9.1, §15.5.
 *
 * CRITICAL: this service must NEVER execute plugin code (skill entry files,
 * MCP commands, shell, pip). It only validates, copies files, and persists
 * ownership metadata.
 */

export interface PluginImportOptions {
  readonly zipPath: string;
  readonly overwrite?: boolean;
}

export interface PluginImportSuccess {
  readonly success: true;
  readonly plugin: PluginSummary;
}

export interface PluginImportFailure {
  readonly success: false;
  readonly errors: readonly PluginError[];
}

export type PluginImportResult = PluginImportSuccess | PluginImportFailure;

function toErrors(errors: PluginError[]): readonly PluginError[] {
  return errors;
}

/** Read and validate a skill manifest declared by a plugin. */
function readPluginSkillManifest(
  pluginRoot: string,
  skillManifestPath: string
):
  | { ok: true; manifest: SkillManifest; absPath: string }
  | { ok: false; error: PluginError } {
  let absPath: string;
  try {
    absPath = resolvePluginRelativePath(pluginRoot, skillManifestPath);
  } catch {
    return {
      ok: false,
      error: {
        code: "path-outside-plugin",
        componentType: "skill",
        path: skillManifestPath,
        message: `Skill manifest path "${skillManifestPath}" escapes the plugin directory.`,
        recoverable: false,
      },
    };
  }
  if (!fs.existsSync(absPath)) {
    return {
      ok: false,
      error: {
        code: "component-not-found",
        componentType: "skill",
        componentName: skillManifestPath,
        path: absPath,
        message: `Declared skill manifest not found: ${skillManifestPath}`,
        recoverable: false,
      },
    };
  }
  let content: string;
  try {
    content = fs.readFileSync(absPath, "utf-8");
  } catch (e: unknown) {
    return {
      ok: false,
      error: {
        code: "skill-manifest-invalid",
        componentType: "skill",
        componentName: skillManifestPath,
        message:
          e instanceof Error
            ? `Failed to read skill manifest: ${e.message}`
            : "Failed to read skill manifest",
        recoverable: false,
      },
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e: unknown) {
    return {
      ok: false,
      error: {
        code: "skill-manifest-invalid",
        componentType: "skill",
        componentName: skillManifestPath,
        message:
          e instanceof Error
            ? `Skill manifest is not valid JSON: ${e.message}`
            : "Skill manifest is not valid JSON",
        recoverable: false,
      },
    };
  }
  const validation = SkillImportService.validateManifest(parsed);
  if (!validation.valid) {
    return {
      ok: false,
      error: {
        code: "skill-manifest-invalid",
        componentType: "skill",
        componentName: skillManifestPath,
        message: validation.error,
        recoverable: false,
      },
    };
  }
  // Verify entry file exists inside the plugin (relative to the skill dir).
  const skillDir = path.dirname(absPath);
  if (
    !validation.manifest.documentationOnly &&
    validation.manifest.entry &&
    validation.manifest.entry !== "__skill_md_wrapper__.js"
  ) {
    const entryAbs = path.join(skillDir, validation.manifest.entry);
    if (!fs.existsSync(entryAbs)) {
      return {
        ok: false,
        error: {
          code: "component-not-found",
          componentType: "skill",
          componentName: validation.manifest.name,
          path: validation.manifest.entry,
          message: `Skill entry file not found in plugin: ${validation.manifest.entry}`,
          recoverable: false,
        },
      };
    }
  }
  return { ok: true, manifest: validation.manifest, absPath };
}

/** Read and normalize an MCP servers.json declared by a plugin. */
function readPluginMcpServers(
  pluginRoot: string,
  mcpFilePath: string
):
  | { ok: true; servers: readonly NormalizedMcpServer[] }
  | { ok: false; errors: PluginError[] } {
  let absPath: string;
  try {
    absPath = resolvePluginRelativePath(pluginRoot, mcpFilePath);
  } catch {
    return {
      ok: false,
      errors: [
        {
          code: "path-outside-plugin",
          componentType: "mcpServer",
          path: mcpFilePath,
          message: `MCP path "${mcpFilePath}" escapes the plugin directory.`,
          recoverable: false,
        },
      ],
    };
  }
  if (!fs.existsSync(absPath)) {
    return {
      ok: false,
      errors: [
        {
          code: "component-not-found",
          componentType: "mcpServer",
          componentName: mcpFilePath,
          path: absPath,
          message: `Declared MCP servers file not found: ${mcpFilePath}`,
          recoverable: false,
        },
      ],
    };
  }
  const content = fs.readFileSync(absPath, "utf-8");
  const parsed = parseServersJson(content, mcpFilePath);
  if (!parsed.ok) {
    return { ok: false, errors: [parsed.error] };
  }
  const out: NormalizedMcpServer[] = [];
  const errors: PluginError[] = [];
  for (const [key, decl] of Object.entries(parsed.servers)) {
    const norm = normalizeMcpDeclaration(key, decl, pluginRoot, mcpFilePath);
    if (norm.ok) {
      out.push(norm.normalized);
    } else {
      errors.push(norm.error);
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, servers: out };
}

function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(s, d);
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d);
    }
  }
}

function removePath(p: string): void {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

export class PluginImportService {
  /**
   * Import a plugin from a local zip. Atomic: on any failure after files
   * have been copied or rows inserted, performs compensating rollback.
   */
  static async importFromZip(
    options: PluginImportOptions
  ): Promise<PluginImportResult> {
    const { zipPath, overwrite = false } = options;

    // 1. Validate path string
    if (
      typeof zipPath !== "string" ||
      zipPath.length === 0 ||
      zipPath.includes("..")
    ) {
      return {
        success: false,
        errors: [
          {
            code: "install-io-failed",
            message: `Invalid zip path: ${zipPath}`,
            recoverable: false,
          },
        ],
      };
    }

    // 2. Extract zip
    const extract = await PluginArchiveService.extractZip(zipPath);
    if (!extract.success) {
      return { success: false, errors: extract.errors };
    }
    const tempRoot = extract.tempRoot;
    const tempCleanup = extract.cleanup;

    // 3. Load + validate plugin manifest
    const manifestResult = await PluginManifestService.loadFromDirectory(
      tempRoot
    );
    if (!manifestResult.success) {
      await tempCleanup();
      return { success: false, errors: manifestResult.errors };
    }
    const manifest = manifestResult.manifest;

    // 4. Check name conflict
    const pluginModule = new PluginManagementModule();
    const existing = await pluginModule.getPluginByName(manifest.name);
    if (existing && !overwrite) {
      await tempCleanup();
      return {
        success: false,
        errors: [
          {
            code: "plugin-name-conflict",
            pluginName: manifest.name,
            message: `A plugin named "${manifest.name}" is already installed. Use overwrite to replace it.`,
            recoverable: false,
          },
        ],
      };
    }
    // If overwrite, uninstall the old one first (rows + files).
    if (existing && overwrite) {
      await pluginModule.uninstallPlugin(manifest.name);
      removePath(getPluginInstallRoot(manifest.name));
    }

    // 5. Validate skill components
    const skillPaths = manifest.skills ?? [];
    const skills: Array<{
      manifest: SkillManifest;
      relManifestPath: string;
    }> = [];
    const skillErrors: PluginError[] = [];
    for (const skillPath of skillPaths) {
      const r = readPluginSkillManifest(tempRoot, skillPath);
      if (!r.ok) {
        skillErrors.push(r.error);
      } else {
        skills.push({
          manifest: r.manifest,
          relManifestPath: skillPath,
        });
      }
    }
    if (skillErrors.length > 0) {
      await tempCleanup();
      return { success: false, errors: toErrors(skillErrors) };
    }

    // 6. Validate MCP components
    const mcpPaths = manifest.mcpServers ?? [];
    const mcpServers: NormalizedMcpServer[] = [];
    const mcpErrors: PluginError[] = [];
    for (const mcpPath of mcpPaths) {
      const r = readPluginMcpServers(tempRoot, mcpPath);
      if (!r.ok) {
        mcpErrors.push(...r.errors);
      } else {
        mcpServers.push(...r.servers);
      }
    }
    if (mcpErrors.length > 0) {
      await tempCleanup();
      return { success: false, errors: toErrors(mcpErrors) };
    }

    // 7. Resolve final install path + copy via sibling temp (atomic-ish rename)
    const installPath = getPluginInstallRoot(manifest.name);
    const parentDir = path.dirname(installPath);
    try {
      fs.mkdirSync(parentDir, { recursive: true });
    } catch (e: unknown) {
      await tempCleanup();
      return {
        success: false,
        errors: [
          {
            code: "install-io-failed",
            message:
              e instanceof Error
                ? `Failed to create plugins directory: ${e.message}`
                : "Failed to create plugins directory",
            recoverable: false,
          },
        ],
      };
    }
    const stagingDir = `${installPath}.staging-${Date.now()}`;
    try {
      copyDirSync(tempRoot, stagingDir);
      // Remove any pre-existing install path (shouldn't exist after overwrite
      // handling, but be safe).
      removePath(installPath);
      fs.renameSync(stagingDir, installPath);
    } catch (e: unknown) {
      removePath(stagingDir);
      await tempCleanup();
      return {
        success: false,
        errors: [
          {
            code: "install-io-failed",
            message:
              e instanceof Error
                ? `Failed to copy plugin files: ${e.message}`
                : "Failed to copy plugin files",
            recoverable: false,
          },
        ],
      };
    } finally {
      await tempCleanup();
    }

    // 8. Persist InstalledPlugin row.
    // Per Design §15.5, plugin import never prepares Python environments.
    // Flag the plugin as needs_configuration when any skill uses the Python
    // runtime so the UI can warn the user before first execution.
    const hasPythonSkill = skills.some((s) => s.manifest.runtime === "python");
    let pluginId: number | null = null;
    try {
      pluginId = await pluginModule.createPlugin({
        name: manifest.name,
        displayName: manifest.displayName,
        version: manifest.version,
        description: manifest.description,
        author: manifest.author,
        source: (manifest.source ?? "local") as PluginSource,
        installPath,
        manifestJson: JSON.stringify(manifest),
        permissionsJson: JSON.stringify(manifest.permissions ?? []),
        componentStateJson: "{}",
        enabled: 1,
        health: hasPythonSkill ? "needs_configuration" : "healthy",
      });
    } catch (e: unknown) {
      rollbackInstall(installPath);
      return {
        success: false,
        errors: [
          {
            code: "install-io-failed",
            message:
              e instanceof Error
                ? `Failed to persist plugin row: ${e.message}`
                : "Failed to persist plugin row",
            recoverable: false,
          },
        ],
      };
    }

    // 9. Persist plugin-owned InstalledSkill rows
    const skillModule = new SkillManagementModule();
    try {
      for (const { manifest: skillManifest, relManifestPath } of skills) {
        await skillModule.installSkill({
          name: skillManifest.name,
          version: skillManifest.version,
          source: "user",
          manifest_json: JSON.stringify(skillManifest),
          permissions_json: JSON.stringify(skillManifest.permissions ?? []),
          enabled: 1,
          pluginName: manifest.name,
          pluginComponentPath: relManifestPath,
        });
      }
    } catch (e: unknown) {
      await rollbackRowsAndFiles(manifest.name, installPath);
      return {
        success: false,
        errors: [
          {
            code: "skill-import-failed",
            message:
              e instanceof Error
                ? `Failed to persist plugin skills: ${e.message}`
                : "Failed to persist plugin skills",
            recoverable: false,
          },
        ],
      };
    }

    // 10. Persist plugin-owned MCP rows
    const mcpModule = new MCPToolModule();
    try {
      for (const server of mcpServers) {
        const entity = new MCPToolEntity();
        entity.serverName = server.serverName;
        entity.transport = server.transport;
        entity.enabled = true;
        entity.authType = server.authType;
        entity.timeout = server.timeout ?? 30000;
        entity.tools = JSON.stringify([]);
        entity.toolConfig = JSON.stringify({});
        entity.metadata = JSON.stringify(server.metadata ?? {});
        entity.pluginName = manifest.name;
        entity.pluginComponentPath = server.componentPath;
        entity.origin = "plugin";
        if (server.command) entity.command = server.command;
        entity.argsJson = JSON.stringify(server.args ?? []);
        entity.envJson = JSON.stringify(server.env ?? {});
        if (server.url) entity.url = server.url;
        if (server.host) entity.host = server.host;
        if (server.port) entity.port = server.port;
        await mcpModule.saveMCPTool(entity);
      }
    } catch (e: unknown) {
      await rollbackRowsAndFiles(manifest.name, installPath);
      return {
        success: false,
        errors: [
          {
            code: "mcp-config-invalid",
            message:
              e instanceof Error
                ? `Failed to persist plugin MCP servers: ${e.message}`
                : "Failed to persist plugin MCP servers",
            recoverable: false,
          },
        ],
      };
    }

    // 11. Cache invalidation (best-effort; loader service added in Phase 4)
    // PluginRuntimeCache.clear is wired in Phase 4 — call via dynamic import
    // to avoid a circular dependency at module load time.
    try {
      const { PluginRuntimeCache } = await import(
        "@/service/PluginRuntimeCache"
      );
      PluginRuntimeCache.clear("plugin-import");
    } catch {
      // PluginRuntimeCache not yet registered; safe to ignore during Phase 3.
    }

    // 11b. Record needs_configuration notice for Python skills (Design §15.5).
    if (hasPythonSkill) {
      try {
        await pluginModule.setLoadErrors(manifest.name, [
          {
            code: "dependency-unsatisfied",
            componentType: "skill",
            pluginName: manifest.name,
            message:
              "Plugin bundles a Python skill. Run the skill once to trigger venv setup, or prepare the environment manually before first use.",
            recoverable: true,
          },
        ]);
      } catch {
        // best-effort — health is already set on the row
      }
    }

    // 12. Return summary
    const summary: PluginSummary = {
      id: pluginId,
      name: manifest.name,
      displayName: manifest.displayName,
      version: manifest.version,
      source: (manifest.source ?? "local") as PluginSource,
      enabled: true,
      health: hasPythonSkill ? "needs_configuration" : "healthy",
      skillCount: skills.length,
      mcpServerCount: mcpServers.length,
      permissions: manifest.permissions ?? [],
      lastUpdated: new Date().toISOString(),
    };
    return { success: true, plugin: summary };
  }
}

/** Best-effort rollback of files only. */
function rollbackInstall(installPath: string): void {
  removePath(installPath);
}

/** Best-effort rollback of inserted rows + files (Design §7.3 rollback). */
async function rollbackRowsAndFiles(
  pluginName: string,
  installPath: string
): Promise<void> {
  const pluginModule = new PluginManagementModule();
  try {
    // uninstallPlugin removes the plugin row plus all owned skill and MCP
    // rows keyed by pluginName.
    await pluginModule.uninstallPlugin(pluginName);
  } catch {
    // best-effort
  }
  removePath(installPath);
}
