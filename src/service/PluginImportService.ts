import * as fs from "fs";
import { log } from "@/modules/Logger";
import * as path from "path";
import { PluginManagementModule } from "@/modules/PluginManagementModule";
import { SkillManagementModule } from "@/modules/SkillManagementModule";
import { MCPToolModule } from "@/modules/MCPToolModule";
import { MCPToolEntity } from "@/entity/MCPTool.entity";
import { PluginArchiveService } from "@/service/PluginArchiveService";
import { PluginManifestService, resolvePluginRoot } from "@/service/PluginManifestService";
import {
  parseServersJson,
  normalizeMcpDeclaration,
  normalizeInlineMcpMap,
  type NormalizedMcpServer,
} from "@/service/PluginMcpDeclaration";
import { getPluginInstallRoot, getPluginOwnedSkillRoot } from "@/service/pluginPaths";
import {
  resolvePluginRelativePath,
  type PluginError,
  type PluginSummary,
  type PluginSource,
  type PluginSourceProvenance,
} from "@/entityTypes/pluginTypes";
import { MCPToolService } from "@/service/MCPToolService";
import { SkillImportService } from "@/service/SkillImportService";
import { ClaudeSkillFormatAdapter } from "@/service/pluginCompat/ClaudeSkillFormatAdapter";
import { ClaudePluginAdapter } from "@/service/pluginCompat/ClaudePluginAdapter";
import { SkillRegistry } from "@/config/skillsRegistry";
import type {
  SkillDefinition,
  SkillExecutionContext,
  SkillExecutionResult,
  SkillManifest,
} from "@/entityTypes/skillTypes";

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

/**
 * Read Claude SKILL.md file(s) at a declared skill path.
 *
 * A Claude skills path may be:
 *   - A directory (typically `skills/`): scan for `<name>/SKILL.md` (depth 1).
 *     Each match is a separate skill.
 *   - A direct path to a `SKILL.md` file.
 *
 * Returns one or more translated SkillManifest entries. Errors are
 * collected per skill (one bad skill doesn't fail the rest).
 *
 * See tech design §6 / §7.3.
 */
function readPluginClaudeSkillsFromPath(
  pluginRoot: string,
  skillPath: string
):
  | {
      ok: true;
      skills: Array<{ manifest: SkillManifest; relManifestPath: string }>;
    }
  | { ok: false; errors: PluginError[] } {
  let absPath: string;
  try {
    absPath = resolvePluginRelativePath(pluginRoot, skillPath);
  } catch {
    return {
      ok: false,
      errors: [
        {
          code: "path-outside-plugin",
          componentType: "skill",
          path: skillPath,
          message: `Claude skill path "${skillPath}" escapes the plugin directory.`,
          recoverable: false,
        },
      ],
    };
  }

  // Build the list of SKILL.md files to translate.
  const mdFiles: Array<{ abs: string; rel: string }> = [];
  try {
    const stat = fs.statSync(absPath);
    if (stat.isDirectory()) {
      // Depth-1 scan: <dir>/<skill-name>/SKILL.md
      const entries = fs.readdirSync(absPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const candidateAbs = path.join(absPath, entry.name, "SKILL.md");
        if (fs.existsSync(candidateAbs)) {
          mdFiles.push({
            abs: candidateAbs,
            rel: `${skillPath.replace(/\/$/, "")}/${entry.name}/SKILL.md`,
          });
        }
      }
      // Also accept a SKILL.md directly inside the scanned directory
      // (Claude plugins occasionally ship a single skill at skills/SKILL.md).
      const direct = path.join(absPath, "SKILL.md");
      if (fs.existsSync(direct)) {
        mdFiles.push({
          abs: direct,
          rel: `${skillPath.replace(/\/$/, "")}/SKILL.md`,
        });
      }
    } else {
      mdFiles.push({ abs: absPath, rel: skillPath });
    }
  } catch (e: unknown) {
    if (e instanceof Error && "code" in e && (e as { code: string }).code === "ENOENT") {
      return { ok: true, skills: [] };
    }
    return {
      ok: false,
      errors: [
        {
          code: "component-not-found",
          componentType: "skill",
          componentName: skillPath,
          path: absPath,
          message:
            e instanceof Error
              ? `Claude skill path not accessible: ${e.message}`
              : `Claude skill path not accessible: ${skillPath}`,
          recoverable: false,
        },
      ],
    };
  }

  if (mdFiles.length === 0) {
    return {
      ok: false,
      errors: [
        {
          code: "component-not-found",
          componentType: "skill",
          componentName: skillPath,
          path: absPath,
          message: `No SKILL.md files found under Claude skill path: ${skillPath}`,
          recoverable: false,
        },
      ],
    };
  }

  const skills: Array<{ manifest: SkillManifest; relManifestPath: string }> =
    [];
  const errors: PluginError[] = [];

  for (const mdFile of mdFiles) {
    let content: string;
    try {
      content = fs.readFileSync(mdFile.abs, "utf-8");
    } catch (e: unknown) {
      errors.push({
        code: "skill-manifest-invalid",
        componentType: "skill",
        componentName: mdFile.rel,
        message:
          e instanceof Error
            ? `Failed to read SKILL.md: ${e.message}`
            : "Failed to read SKILL.md",
        recoverable: false,
      });
      continue;
    }
    const adapted = ClaudeSkillFormatAdapter.adapt(content, mdFile.rel);
    if (!adapted.ok) {
      errors.push(adapted.error);
      continue;
    }
    skills.push({ manifest: adapted.manifest, relManifestPath: mdFile.rel });
  }

  if (skills.length === 0) {
    return { ok: false, errors };
  }
  return { ok: true, skills };
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

/**
 * Directories stripped from plugin copies at install time.
 *
 * `.git` is stripped because plugin archives fetched from git sources may
 * contain a `.git/hooks/` directory with attacker-controlled hook scripts
 * (post-checkout, etc.) that would execute on subsequent git operations.
 * `.github` workflows similarly contain arbitrary shell. We never want
 * this content on disk inside an installed plugin.
 */
const STRIPPED_DIR_NAMES: ReadonlySet<string> = new Set([".git", ".github"]);

function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && STRIPPED_DIR_NAMES.has(entry.name)) {
      continue;
    }
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
    try {
      return await this.installFromLocalRoot(extract.tempRoot, {
        overwrite,
        provenance: { sourceKind: "local-zip" },
      });
    } finally {
      await extract.cleanup();
    }
  }

  /**
   * Run the existing manifest → skill → MCP → persist pipeline against a
   * local directory that already contains the plugin root (e.g. an
   * extracted zip, a cloned git repo, an unpacked npm tarball).
   *
   * Caller owns `localRoot` and is responsible for cleanup. This method
   * performs compensating rollback only on persisted rows and the copied
   * install path — it never deletes the caller's `localRoot`.
   *
   * Source of truth: Spec §4.2 and Design §7.3.
   */
  static async installFromLocalRoot(
    localRoot: string,
    opts: { overwrite?: boolean; provenance?: PluginSourceProvenance } = {}
  ): Promise<PluginImportResult> {
    const { overwrite = false, provenance } = opts;

    // 3. Resolve effective root (unwrap single-wrapper-directory zips)
    localRoot = resolvePluginRoot(localRoot);

    // 4. Load + validate plugin manifest
    const manifestResult = await PluginManifestService.loadFromDirectory(
      localRoot
    );
    if (!manifestResult.success) {
      return { success: false, errors: manifestResult.errors };
    }
    const manifest = manifestResult.manifest;

    // 4. Check name conflict
    const pluginModule = new PluginManagementModule();
    const existing = await pluginModule.getPluginByName(manifest.name);
    if (existing && !overwrite) {
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
    const isClaudeFormat = manifest.format === "claude";
    for (const skillPath of skillPaths) {
      if (isClaudeFormat) {
        const r = readPluginClaudeSkillsFromPath(localRoot, skillPath);
        if (!r.ok) {
          skillErrors.push(...r.errors);
        } else {
          skills.push(...r.skills);
        }
      } else {
        const r = readPluginSkillManifest(localRoot, skillPath);
        if (!r.ok) {
          skillErrors.push(r.error);
        } else {
          skills.push({
            manifest: r.manifest,
            relManifestPath: skillPath,
          });
        }
      }
    }
    if (skillErrors.length > 0) {
      return { success: false, errors: toErrors(skillErrors) };
    }

    // 6. Validate MCP components
    const mcpPaths = manifest.mcpServers ?? [];
    const mcpServers: NormalizedMcpServer[] = [];
    const mcpErrors: PluginError[] = [];
    const isClaudeMcp = manifest.format === "claude";

    if (isClaudeMcp) {
      // Claude plugins: prefer inline mcp map (alternative B); fall back to
      // sibling .mcp.json (alternative A). Re-adapt here to recover the
      // inlineMcp / mcpServersPaths context the adapter produced.
      const claudeManifestPath = path.join(
        localRoot,
        ".claude-plugin",
        "plugin.json"
      );
      let claudeRaw: unknown;
      try {
        claudeRaw = JSON.parse(fs.readFileSync(claudeManifestPath, "utf-8"));
      } catch (e: unknown) {
        return {
          success: false,
          errors: toErrors([
            {
              code: "manifest-invalid-json",
              path: claudeManifestPath,
              message:
                e instanceof Error
                  ? `Failed to re-read Claude manifest: ${e.message}`
                  : "Failed to re-read Claude manifest",
              recoverable: false,
            },
          ]),
        };
      }
      const adapted = ClaudePluginAdapter.adapt(claudeRaw, {
        pluginRoot: localRoot,
      });
      if (!adapted.ok) {
        return { success: false, errors: toErrors([...adapted.errors]) };
      }

      if (adapted.adapted.inlineMcp) {
        const r = normalizeInlineMcpMap(adapted.adapted.inlineMcp, localRoot);
        if (!r.ok) mcpErrors.push(...r.errors);
        else mcpServers.push(...r.servers);
      } else {
        // Try sibling .mcp.json at plugin root.
        const siblingMcp = path.join(localRoot, ".mcp.json");
        if (fs.existsSync(siblingMcp)) {
          const r = readPluginMcpServers(localRoot, ".mcp.json");
          if (!r.ok) mcpErrors.push(...r.errors);
          else mcpServers.push(...r.servers);
        }
      }
    } else {
      // AiFetchly native path: each path is a servers.json file.
      for (const mcpPath of mcpPaths) {
        const r = readPluginMcpServers(localRoot, mcpPath);
        if (!r.ok) {
          mcpErrors.push(...r.errors);
        } else {
          mcpServers.push(...r.servers);
        }
      }
    }
    if (mcpErrors.length > 0) {
      return { success: false, errors: toErrors(mcpErrors) };
    }

    // 6b. Apply name scoping for plugin-owned MCP servers. Two plugins with
    // a server named "linkedin" become "plugin-a__linkedin" and
    // "plugin-b__linkedin" to prevent collisions in the MCP client manager.
    // The original (un-scoped) name is preserved in metadata.serverName.
    if (isClaudeMcp || manifest.format === "aifetchly") {
      for (let i = 0; i < mcpServers.length; i += 1) {
        const s = mcpServers[i];
        const scopedName = `${manifest.name}__${s.serverName}`;
        mcpServers[i] = {
          ...s,
          serverName: scopedName,
          metadata: {
            ...s.metadata,
            pluginServerName: s.serverName,
            pluginOwner: manifest.name,
          },
        };
      }
    }

    // 7. Resolve final install path + copy via sibling temp (atomic-ish rename)
    const installPath = getPluginInstallRoot(manifest.name);
    const parentDir = path.dirname(installPath);
    try {
      fs.mkdirSync(parentDir, { recursive: true });
    } catch (e: unknown) {
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
      copyDirSync(localRoot, stagingDir);
      // Remove any pre-existing install path (shouldn't exist after overwrite
      // handling, but be safe).
      removePath(installPath);
      fs.renameSync(stagingDir, installPath);
    } catch (e: unknown) {
      removePath(stagingDir);
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
        source: (provenance?.source ??
          manifest.source ??
          "local") as PluginSource,
        installPath,
        manifestJson: JSON.stringify(manifest),
        permissionsJson: JSON.stringify(manifest.permissions ?? []),
        componentStateJson: "{}",
        enabled: 1,
        health: hasPythonSkill ? "needs_configuration" : "healthy",
        sourceKind: provenance?.sourceKind,
        sourceUri: provenance?.sourceUri,
        sourceRef: provenance?.sourceRef,
        sourceMetaJson: provenance?.sourceMeta
          ? JSON.stringify(provenance.sourceMeta)
          : "{}",
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

    // 9b. Hot-register plugin skills in SkillRegistry so they're available
    // immediately without requiring an app restart. Also write the
    // __skill_md_wrapper__.js file so loadPersistedSkills() can find it
    // on restart.
    for (const { manifest: skillManifest, relManifestPath } of skills) {
      try {
        const skillDir = path.join(installPath, path.dirname(relManifestPath));
        const skillMdPath = path.join(skillDir, "SKILL.md");
        const execute = buildDocSkillExecuteHandler(skillMdPath);

        // Write the wrapper JS so registerImportedSkill() works on restart
        let skillMdContent = "";
        try {
          skillMdContent = fs.readFileSync(skillMdPath, "utf-8");
        } catch (e) {
          log.warn(
            `[PluginImport]   SKILL.md not readable:`,
            e
          );
        }
        const wrapperCode = `setResult({
  success: true,
  mode: "documentation_skill",
  skillName: ${JSON.stringify(skillManifest.name)},
  skillFile: ${JSON.stringify(skillMdPath)},
  guidance: ${JSON.stringify(skillMdContent)},
  message: "This skill was imported from SKILL.md and runs in documentation-only mode.",
});`;
        const wrapperPath = path.join(skillDir, "__skill_md_wrapper__.js");
        fs.writeFileSync(wrapperPath, wrapperCode, "utf-8");

        // Idempotent: if the plugin-owned skill is already registered
        // (e.g. from a prior install in the same session, because
        // globalThis.__aifetchlySkillRegistry survives HMR), unregister
        // it first so the reinstall doesn't throw.
        if (SkillRegistry.isRegistered(skillManifest.name)) {
          SkillRegistry.unregisterSkill(skillManifest.name);
        }
        SkillRegistry.registerSkill({
          name: skillManifest.name,
          description: skillManifest.description,
          parameters: skillManifest.parameters ?? {},
          tier: "sandboxed",
          permissionCategory: "pure",
          requiresConfirmation: false,
          source: "user",
          documentationOnly: true,
          supportedFileTypes: skillManifest.supportedFileTypes,
          pluginOwner: manifest.name,
          execute,
        });
      } catch (e) {
        log.warn(
          `Failed to hot-register skill "${skillManifest.name}":`,
          e
        );
      }
    }

    // 10. Persist plugin-owned MCP rows
    const mcpModule = new MCPToolModule();
    const mcpServerIds: Array<{ id: number; isStdio: boolean }> = [];
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
        const id = await mcpModule.saveMCPTool(entity);
        mcpServerIds.push({ id, isStdio: server.transport === "stdio" });
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

    // 10b. Auto-trust and discover MCP tools so they're available immediately.
    for (const { id, isStdio } of mcpServerIds) {
      try {
        if (isStdio) {
          new MCPToolService().setTrust(id, true);
        }
        await new MCPToolService().discoverTools(id);
      } catch (e) {
        log.warn(
          `Failed to discover MCP tools for server ${id}:`,
          e
        );
      }
    }

    // 11. Cache invalidation (best-effort).
    try {
      const { PluginRuntimeCache } = await import(
        "@/service/PluginRuntimeCache"
      );
      PluginRuntimeCache.clear("plugin-import");
    } catch {
      // PluginRuntimeCache not yet registered; safe to ignore.
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

/**
 * Build an execute handler for a documentation-only (SKILL.md) skill.
 * Reads the SKILL.md on each invocation to pick up live edits.
 */
function buildDocSkillExecuteHandler(
  skillMdPath: string
): (
  args: Record<string, unknown>,
  context: SkillExecutionContext
) => Promise<SkillExecutionResult> {
  return async (): Promise<SkillExecutionResult> => {
    let guidance = "";
    try {
      const content = fs.readFileSync(skillMdPath, "utf-8");
      guidance = content.length > 8000
        ? `${content.slice(0, 8000)}\n...[skill guidance truncated]`
        : content;
    } catch {
      // SKILL.md not readable; return empty guidance
    }
    return {
      success: true,
      result: {
        mode: "documentation_skill",
        skillFile: skillMdPath,
        guidance,
      },
    };
  };
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
