import * as fs from "fs";
import { log } from "@/modules/Logger";
import * as path from "path";
import { PluginManagementModule } from "@/modules/PluginManagementModule";
import { SkillManagementModule } from "@/modules/SkillManagementModule";
import { MCPToolModule } from "@/modules/MCPToolModule";
import { MCPToolEntity } from "@/entity/MCPTool.entity";
import { PluginArchiveService } from "@/service/PluginArchiveService";
import {
  PluginManifestService,
  resolvePluginRoot,
} from "@/service/PluginManifestService";
import {
  parseServersJson,
  normalizeMcpDeclaration,
  normalizeInlineMcpMap,
  type NormalizedMcpServer,
} from "@/service/PluginMcpDeclaration";
import {
  getPluginInstallRoot,
  getPluginOwnedSkillRoot,
} from "@/service/pluginPaths";
import {
  resolvePluginRelativePath,
  type PluginError,
  type PluginManifest,
  type PluginSummary,
  type PluginSource,
  type PluginSourceProvenance,
  type PluginHealth,
  type PluginSourceKind,
} from "@/entityTypes/pluginTypes";
import { MCPToolService } from "@/service/MCPToolService";
import { getPluginToolPolicyRegistry } from "@/service/PluginToolPolicyRegistry";
import { PluginComponentRegistryService } from "@/service/PluginComponentRegistryService";
import { getPluginBrowserCapabilityService } from "@/service/PluginBrowserCapabilityService";
import { SkillImportService } from "@/service/SkillImportService";
import { ClaudeSkillFormatAdapter } from "@/service/pluginCompat/ClaudeSkillFormatAdapter";
import { ClaudePluginAdapter } from "@/service/pluginCompat/ClaudePluginAdapter";
import { AgentDefinitionModule } from "@/modules/AgentDefinitionModule";
import type { AgentDefinitionView } from "@/entityTypes/agentTypes";
import type { InstalledPluginEntity } from "@/entity/InstalledPlugin.entity";
import type { InstalledSkillEntity } from "@/entity/InstalledSkill.entity";
import { PluginAgentImportService } from "@/service/PluginAgentImportService";
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
    if (
      e instanceof Error &&
      "code" in e &&
      (e as { code: string }).code === "ENOENT"
    ) {
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

/**
  * B05: parameters for `runInstallTransactionPhase` — the extracted steps
  * 5–12 of `installFromLocalRoot` (validation → file swap → persistence →
  * discovery → activation) that the plugin lifecycle seal wraps for
  * overwrite updates.
  */
interface InstallTransactionParams {
  readonly localRoot: string;
  readonly manifest: PluginManifest;
  readonly provenance?: PluginSourceProvenance;
  readonly pluginModule: PluginManagementModule;
  readonly isOverwrite: boolean;
  readonly preservedDisabledAgentIds: ReadonlySet<string>;
  /**
   * B06: full snapshot of the previous generation taken BEFORE teardown
   * (plugin row + owned skills, MCP servers, agents). Null for fresh
   * installs. Used to restore rows AND files together on any failure.
   */
  readonly previousGeneration: PreviousGenerationSnapshot | null;
}

/**
 * B06: a complete snapshot of the previous installed generation, captured
 * before the overwrite teardown. Every component's persisted state
 * (enablement, health, manifest, trust relationships via stable server
 * ids) is preserved so a failed update can restore the exact executable
 * configuration.
 */
interface PreviousGenerationSnapshot {
  readonly plugin: InstalledPluginEntity;
  readonly skills: ReadonlyArray<Partial<InstalledSkillEntity>>;
  readonly mcp: readonly MCPToolEntity[];
  readonly agents: readonly AgentDefinitionView[];
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
    // If overwrite, the old generation is uninstalled later in this flow
    // (see the deferred overwrite teardown before the file swap) so a
    // validation failure up to that point aborts without touching it.
    // B05: quiescence no longer happens here — the plugin lifecycle seal
    // (withPluginLifecycleSeal) opens BEFORE any further await below and
    // performs the quiesce itself; a cleanup timeout then propagates as the
    // retryable uninstall-failed result with the previous generation fully
    // intact (no files touched).
    // B06: the whole previous generation is SNAPSHOTTED here (plugin row,
    // owned skills, MCP servers, agents) so any later failure can restore
    // rows and files TOGETHER — an incompatible update can never replace a
    // healthy plugin with a broken one.
    let deferredOverwriteTeardown = false;
    let snapshot: PreviousGenerationSnapshot | null = null;
    let preservedDisabledAgentIds = new Set<string>();
    if (existing && overwrite) {
      const skillModule = new SkillManagementModule();
      const mcpModule = new MCPToolModule();
      const agentModule = new AgentDefinitionModule();
      let ownedSkills: Partial<InstalledSkillEntity>[] = [];
      try {
        ownedSkills = (await skillModule.findSkillsByPluginName(
          manifest.name
        )) as Partial<InstalledSkillEntity>[];
      } catch {
        // best-effort — snapshot what we can
      }
      let ownedMcp: MCPToolEntity[] = [];
      try {
        ownedMcp = await mcpModule.findMcpByPluginName(manifest.name);
      } catch {
        // best-effort — snapshot what we can
      }
      let ownedAgents: AgentDefinitionView[] = [];
      try {
        ownedAgents = await agentModule.findAgentsByPluginName(manifest.name);
        preservedDisabledAgentIds = new Set(
          ownedAgents.filter((a) => a.status === "disabled").map((a) => a.id)
        );
      } catch {
        // best-effort — snapshot what we can
      }
      snapshot = {
        plugin: existing,
        skills: ownedSkills,
        mcp: ownedMcp,
        agents: ownedAgents,
      };
      deferredOverwriteTeardown = true;
    }

    // 5..12: the transactional component-install phase. For an overwrite
    // (B05) the plugin lifecycle SEAL wraps the ENTIRE remainder —
    // validation, staging copy, file swap, DB writes, discovery, rollback
    // AND activation — so no new MCP job can be admitted between
    // quiescence and transaction completion. Fresh installs run the
    // identical phase unsealed (a not-yet-installed plugin cannot own
    // running jobs).
    const previousGeneration: PreviousGenerationSnapshot | null = snapshot;
    const transactionPhase = (): Promise<PluginImportResult> =>
      PluginImportService.runInstallTransactionPhase({
        localRoot,
        manifest,
        provenance,
        pluginModule,
        isOverwrite: deferredOverwriteTeardown,
        preservedDisabledAgentIds,
        previousGeneration,
      });

    if (deferredOverwriteTeardown) {
      try {
        return await PluginComponentRegistryService.withPluginLifecycleSeal(
          manifest.name,
          transactionPhase
        );
      } catch (e: unknown) {
        if (
          e instanceof Error &&
          e.message.includes("AI_FETCHLY_PLUGIN_CLEANUP_TIMEOUT")
        ) {
          return {
            success: false,
            errors: [
              {
                code: "uninstall-failed",
                pluginName: manifest.name,
                message: `Active MCP tool jobs for "${manifest.name}" did not quiesce; the previous generation was left intact. Retry the update.`,
                recoverable: true,
              },
            ],
          };
        }
        throw e;
      }
    }
    return await transactionPhase();
  }

  /**
   * B05: steps 5–12 of `installFromLocalRoot`, extracted so the lifecycle
   * seal can wrap them for overwrites. Component validation + file swap +
   * row persistence + discovery smoke test + activation, with the previous
   * generation preserved on every rolled-back failure.
   */
  private static async runInstallTransactionPhase(p: InstallTransactionParams): Promise<PluginImportResult> {

    // 5. Validate skill components
    const skillPaths = p.manifest.skills ?? [];
    const skills: Array<{
      manifest: SkillManifest;
      relManifestPath: string;
    }> = [];
    const skillErrors: PluginError[] = [];
    const isClaudeFormat = p.manifest.format === "claude";
    for (const skillPath of skillPaths) {
      if (isClaudeFormat) {
        const r = readPluginClaudeSkillsFromPath(p.localRoot, skillPath);
        if (!r.ok) {
          skillErrors.push(...r.errors);
        } else {
          skills.push(...r.skills);
        }
      } else {
        const r = readPluginSkillManifest(p.localRoot, skillPath);
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
    const mcpPaths = p.manifest.mcpServers ?? [];
    const mcpServers: NormalizedMcpServer[] = [];
    const mcpErrors: PluginError[] = [];
    const isClaudeMcp = p.manifest.format === "claude";

    if (isClaudeMcp) {
      // Claude plugins: prefer inline mcp map (alternative B); fall back to
      // sibling .mcp.json (alternative A). Re-adapt here to recover the
      // inlineMcp / mcpServersPaths context the adapter produced.
      const claudeManifestPath = path.join(
        p.localRoot,
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
        pluginRoot: p.localRoot,
      });
      if (!adapted.ok) {
        return { success: false, errors: toErrors([...adapted.errors]) };
      }

      if (adapted.adapted.inlineMcp) {
        const r = normalizeInlineMcpMap(adapted.adapted.inlineMcp, p.localRoot);
        if (!r.ok) mcpErrors.push(...r.errors);
        else mcpServers.push(...r.servers);
      } else {
        // Try sibling .mcp.json at plugin root.
        const siblingMcp = path.join(p.localRoot, ".mcp.json");
        if (fs.existsSync(siblingMcp)) {
          const r = readPluginMcpServers(p.localRoot, ".mcp.json");
          if (!r.ok) mcpErrors.push(...r.errors);
          else mcpServers.push(...r.servers);
        }
      }
    } else {
      // AiFetchly native path: each path is a servers.json file.
      for (const mcpPath of mcpPaths) {
        const r = readPluginMcpServers(p.localRoot, mcpPath);
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

    // 6c. Validate plugin agents (design §12.1). Errors fail import before
    // any files are copied; warnings do not.
    const agentParse = PluginAgentImportService.parsePluginAgents({
      pluginRoot: p.localRoot,
      manifest: p.manifest,
    });
    if (!agentParse.ok) {
      return { success: false, errors: toErrors([...agentParse.errors]) };
    }
    const pluginAgents = agentParse.agents;

    // 6b. Apply name scoping for plugin-owned MCP servers. Two plugins with
    // a server named "linkedin" become "plugin-a__linkedin" and
    // "plugin-b__linkedin" to prevent collisions in the MCP client manager.
    // The original (un-scoped) name is preserved in metadata.serverName.
    if (isClaudeMcp || p.manifest.format === "aifetchly") {
      for (let i = 0; i < mcpServers.length; i += 1) {
        const s = mcpServers[i];
        const scopedName = `${p.manifest.name}__${s.serverName}`;
        mcpServers[i] = {
          ...s,
          serverName: scopedName,
          metadata: {
            ...s.metadata,
            pluginServerName: s.serverName,
            pluginOwner: p.manifest.name,
          },
        };
      }
    }

    // 7. Resolve final install path + copy via sibling temp (atomic-ish rename)
    const installPath = getPluginInstallRoot(p.manifest.name);
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
    const backupDir = `${installPath}.backup-${Date.now()}`;
    try {
      copyDirSync(p.localRoot, stagingDir);
      // H6_update-transaction: the previous generation is moved aside (a
      // rename, not a delete) so a failed swap can restore it. The rename
      // keeps artifacts readable throughout — nothing old is removed until
      // the new generation is fully promoted.
      if (p.isOverwrite && fs.existsSync(installPath)) {
        fs.renameSync(installPath, backupDir);
      }
      fs.renameSync(stagingDir, installPath);
      // Old rows must die after the files swapped so a rename failure never
      // leaves rows pointing at a gone generation.
      if (p.isOverwrite) {
        await p.pluginModule.uninstallPlugin(p.manifest.name);
      }
    } catch (e: unknown) {
      removePath(stagingDir);
      // Restore the previous generation when the swap itself failed.
      if (fs.existsSync(backupDir) && !fs.existsSync(installPath)) {
        try {
          fs.renameSync(backupDir, installPath);
        } catch {
          // best-effort restore — do not mask the original error
        }
      }
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

    // B06: full compensating restore of the previous generation. Invoked on
    // every post-teardown failure path: rows and files are restored
    // TOGETHER, and runtime artifacts the failed generation registered
    // (doc skills, tool policies, hooks) are unregistered first. Note the
    // failed swap branch above handles the pre-teardown window; this
    // covers the window AFTER the previous rows were uninstalled.
    const newlyRegisteredSkills: string[] = [];
    const registerDocStateSkill = (
      skillManifest: SkillManifest,
      relativePath: string,
      installBase: string
    ): void => {
      const skillDir = path.join(installBase, path.dirname(relativePath));
      const skillMdPath = path.join(skillDir, "SKILL.md");
      const execute = buildDocSkillExecuteHandler(skillMdPath);
      let skillMdContent = "";
      try {
        skillMdContent = fs.readFileSync(skillMdPath, "utf-8");
      } catch (e) {
        log.warn(`[PluginImport]   SKILL.md not readable:`, e);
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
        pluginOwner: p.manifest.name,
        execute,
      });
      newlyRegisteredSkills.push(skillManifest.name);
    };

    const restorePreviousGeneration = async (): Promise<void> => {
      const prev = p.previousGeneration;
      if (!prev) return;
      // 1. Unregister artifacts the FAILED generation registered.
      for (const name of newlyRegisteredSkills) {
        try {
          SkillRegistry.unregisterSkill(name);
        } catch {
          // best-effort
        }
      }
      try {
        PluginComponentRegistryService.unregisterPluginCapabilities(
          p.manifest.name
        );
      } catch (e) {
        log.warn(`[PluginImport] B06: failed to unregister capabilities:`, e);
      }
      // 2. Files: drop the failed new generation and move the backup back.
      removePath(installPath);
      if (fs.existsSync(backupDir)) {
        try {
          fs.renameSync(backupDir, installPath);
        } catch (e) {
          log.warn(
            `[PluginImport] B06: failed to restore backup directory:`,
            e
          );
        }
      }
      // 3. Rows: recreate the previous plugin row + owned rows exactly.
      try {
        await p.pluginModule.createPlugin({
          name: prev.plugin.name,
          displayName: prev.plugin.displayName ?? prev.plugin.name,
          version: prev.plugin.version ?? "",
          description: prev.plugin.description ?? "",
          author: prev.plugin.author ?? "",
          source: (prev.plugin.source ?? "local") as PluginSource,
          installPath: prev.plugin.installPath ?? installPath,
          manifestJson: prev.plugin.manifestJson ?? "{}",
          permissionsJson: prev.plugin.permissionsJson ?? "[]",
          componentStateJson: prev.plugin.componentStateJson ?? "{}",
          enabled: prev.plugin.enabled ?? 1,
          health: (prev.plugin.health ?? "healthy") as PluginHealth,
          sourceKind: prev.plugin.sourceKind as PluginSourceKind | undefined,
          sourceUri: prev.plugin.sourceUri,
          sourceRef: prev.plugin.sourceRef,
          sourceMetaJson: prev.plugin.sourceMetaJson ?? "{}",
        });
      } catch (e) {
        log.warn(`[PluginImport] B06: failed to restore plugin row:`, e);
      }
      const restoreSkillModule = new SkillManagementModule();
      for (const oldSkill of prev.skills) {
        try {
          await restoreSkillModule.installSkill({
            name: oldSkill.name ?? "",
            version: oldSkill.version ?? "",
            source: oldSkill.source ?? "user",
            manifest_json: oldSkill.manifest_json ?? "{}",
            permissions_json: oldSkill.permissions_json ?? "[]",
            enabled: oldSkill.enabled ?? 0,
            pluginName: oldSkill.pluginName ?? prev.plugin.name,
            pluginComponentPath: oldSkill.pluginComponentPath ?? undefined,
          });
        } catch (e) {
          log.warn(
            `[PluginImport] B06: failed to restore skill row "${oldSkill.name}":`,
            e
          );
        }
      }
      const restoreMcpModule = new MCPToolModule();
      for (const oldServer of prev.mcp) {
        try {
          // Preserve the ORIGINAL row ids so Token-keyed trust state
          // (MCP_TRUST_<id>) and any references survive the restore.
          await restoreMcpModule.saveMCPTool(oldServer);
        } catch (e) {
          log.warn(
            `[PluginImport] B06: failed to restore MCP row "${oldServer.serverName}":`,
            e
          );
        }
      }
      const restoreAgentModule = new AgentDefinitionModule();
      try {
        await restoreAgentModule.restorePluginAgents(
          prev.plugin.name,
          prev.agents,
          p.preservedDisabledAgentIds
        );
      } catch (e) {
        log.warn(`[PluginImport] B06: failed to restore agent rows:`, e);
      }
      // 4. Re-register the previous generation's runtime artifacts.
      for (const oldSkill of prev.skills) {
        try {
          const manifestJson = oldSkill.manifest_json ?? "{}";
          const oldManifest = JSON.parse(manifestJson) as SkillManifest;
          const relPath = oldSkill.pluginComponentPath ?? "skills/SKILL.md";
          registerDocStateSkill(oldManifest, relPath, installPath);
        } catch (e) {
          log.warn(
            `[PluginImport] B06: failed to re-register doc skill "${oldSkill.name}":`,
            e
          );
        }
      }
      try {
        const oldManifest = JSON.parse(
          prev.plugin.manifestJson ?? "{}"
        ) as PluginManifest;
        const reapply =
          getPluginToolPolicyRegistry().registerFromManifest(
            prev.plugin.name,
            oldManifest
          );
        if (reapply.errors.length > 0) {
          log.warn(
            `[PluginImport] B06: policy re-registration warnings:`,
            reapply.errors.map((e) => e.message).join("; ")
          );
        }
      } catch (e) {
        log.warn(`[PluginImport] B06: policy re-registration failed:`, e);
      }
    };

    // 7b. HOST-04 activation gate: validate the manifest's tool policies and
    // host requirements through the SAME registry the query loop consults.
    // An unknown required host capability or an invalid policy shape is an
    // activation failure: the plugin STILL installs (so the user sees a
    // stable diagnostic), but as `invalid` health with no discoverable MCP
    // servers — the model can never fall through to the 90-second
    // name-inference timeout for a tool the plugin declared managed-async.
    const policyGate = getPluginToolPolicyRegistry().registerFromManifest(
      p.manifest.name,
      p.manifest
    );
    const policyGateBlocked = policyGate.errors.length > 0;

    // B06: on an OVERWRITE, a policy-validated-blocked update is ABANDONED
    // (and the executable previous generation retained) instead of retiring
    // a healthy plugin to install an always-invalid new one. Fresh installs
    // keep the HOST-04 behavior — the plugin persists with `invalid` health
    // so the renderer can show a stable diagnostic.
    if (policyGateBlocked && p.isOverwrite) {
      await rollbackRowsAndFiles(p.manifest.name, installPath);
      await restorePreviousGeneration();
      return {
        success: false,
        errors: [
          {
            code: "dependency-unsatisfied",
            pluginName: p.manifest.name,
            message: `Plugin update blocked by the activation gate: ${policyGate.errors
              .map((err) => err.message)
              .join("; ")}. The previous working version was retained.`,
            recoverable: false,
          },
        ],
      };
    }

    // H6: a plugin that DECLARES browser execution survives a missing
    // browser as `needs_configuration` — a user-resolvable dependency, not
    // an activation failure. Its MCP rows persist DISABLED so the scrape
    // tool is never exposed until the browser resolves; re-enabling happens
    // on the next apply/discovery after the browser dependency flow
    // completes (PluginBrowserCapabilityService).
    const browserMissing =
      !policyGateBlocked &&
      p.manifest.capabilities?.browserExecutable === true &&
      getPluginBrowserCapabilityService().describe() === null;

    // 8. Persist InstalledPlugin row.
    // Per Design §15.5, plugin import never prepares Python environments.
    // Flag the plugin as needs_configuration when any skill uses the Python
    // runtime so the UI can warn the user before first execution. A failed
    // policy / host-requirement registration is worse: the manifest cannot
    // be repaired by configuration, so the plugin is `invalid`.
    const hasPythonSkill = skills.some((s) => s.manifest.runtime === "python");
    let pluginId: number | null = null;
    try {
      pluginId = await p.pluginModule.createPlugin({
        name: p.manifest.name,
        displayName: p.manifest.displayName,
        version: p.manifest.version,
        description: p.manifest.description,
        author: p.manifest.author,
        source: (p.provenance?.source ??
          p.manifest.source ??
          "local") as PluginSource,
        installPath,
        manifestJson: JSON.stringify(p.manifest),
        permissionsJson: JSON.stringify(p.manifest.permissions ?? []),
        componentStateJson: "{}",
        enabled: 1,
        health: policyGateBlocked
          ? "invalid"
          : browserMissing || hasPythonSkill
          ? "needs_configuration"
          : "healthy",
        sourceKind: p.provenance?.sourceKind,
        sourceUri: p.provenance?.sourceUri,
        sourceRef: p.provenance?.sourceRef,
        sourceMetaJson: p.provenance?.sourceMeta
          ? JSON.stringify(p.provenance.sourceMeta)
          : "{}",
      });
      // Persist the stable diagnostic for a blocked activation (HOST-04):
      // the caller sees one machine-readable error per issue, and the plugin
      // row keeps `invalid` health so it is never reported healthy.
      if (policyGateBlocked) {
        await p.pluginModule.updatePluginState({
          name: p.manifest.name,
          health: "invalid",
          lastLoadErrorsJson: JSON.stringify(policyGate.errors),
        });
      }
    } catch (e: unknown) {
      rollbackInstall(installPath);
      await restorePreviousGeneration();
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
          pluginName: p.manifest.name,
          pluginComponentPath: relManifestPath,
        });
      }
    } catch (e: unknown) {
      await rollbackRowsAndFiles(p.manifest.name, installPath);
      await restorePreviousGeneration();
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
        registerDocStateSkill(skillManifest, relManifestPath, installPath);
      } catch (e) {
        log.warn(`Failed to hot-register skill "${skillManifest.name}":`, e);
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
        // HOST-04: a blocked activation persists the server rows DISABLED
        // (kept for diagnostics and future update/re-gate), so effective
        // enablement never offers the plugin's tools. H6: the same applies
        // while the declared browser dependency is unresolvable — the tool
        // stays unexposed until the browser resolves.
        entity.enabled = !policyGateBlocked && !browserMissing;
        entity.authType = server.authType;
        entity.timeout = server.timeout ?? 30000;
        entity.tools = JSON.stringify([]);
        entity.toolConfig = JSON.stringify({});
        entity.metadata = JSON.stringify(server.metadata ?? {});
        entity.pluginName = p.manifest.name;
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
      await rollbackRowsAndFiles(p.manifest.name, installPath);
      await restorePreviousGeneration();
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

    // 10b. H6: the discovery smoke test runs ONLY after trust, and a failed
    // discovery is fatal — the half-installed plugin (rows + files) is rolled
    // back so the renderer can never see a "trusted but tool-less" state.
    // HOST-04: skipped entirely when the activation gate blocked the plugin —
    // discovery must not auto-trust a server whose tool policies failed.
    // H6: skipped for a missing browser dependency as well — discovery with
    // a disabled row would still auto-trust a server whose toolset cannot
    // run; re-discovery happens after the browser dependency resolves.
    if (!policyGateBlocked && !browserMissing) {
      for (const { id, isStdio } of mcpServerIds) {
        try {
          if (isStdio) {
            new MCPToolService().setTrust(id, true);
          }
          await new MCPToolService().discoverTools(id);
        } catch (e) {
          log.warn(`Failed to discover MCP tools for server ${id}:`, e);
          await rollbackRowsAndFiles(p.manifest.name, installPath);
          // B06: full compensating restore (rows AND files TOGETHER) of
          // the previous generation — a failed discovery smoke test can
          // never leave a healthy plugin replaced by a broken one.
          await restorePreviousGeneration();
          return {
            success: false,
            errors: [
              {
                code: "mcp-discovery-failed",
                componentType: "mcpServer",
                pluginName: p.manifest.name,
                message: `MCP discovery smoke test failed for server ${id}: ${
                  e instanceof Error ? e.message : String(e)
                }`,
                recoverable: true,
              },
            ],
          };
        }
      }
    }

    // 10c. Persist plugin-owned agent definitions (design §12.2). Roll back
    // rows + files on failure so no partial agent rows survive.
    const agentModule = new AgentDefinitionModule();
    try {
      await agentModule.upsertPluginAgents(
        p.manifest.name,
        pluginAgents,
        p.preservedDisabledAgentIds
      );
    } catch (e: unknown) {
      await rollbackRowsAndFiles(p.manifest.name, installPath);
      await restorePreviousGeneration();
      return {
        success: false,
        errors: [
          {
            code: "agent-manifest-invalid",
            componentType: "agent",
            pluginName: p.manifest.name,
            message:
              e instanceof Error
                ? `Failed to persist plugin agents: ${e.message}`
                : "Failed to persist plugin agents",
            recoverable: false,
          },
        ],
      };
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
    // HOST-04: skipped for a blocked activation — the policy-gate errors are
    // the authoritative diagnostic and must not be overwritten (or demoted
    // from `invalid` to `partial_load`).
    if (browserMissing && !policyGateBlocked) {
      try {
        await p.pluginModule.setLoadErrors(p.manifest.name, [
          {
            code: "dependency-unsatisfied",
            componentType: "skill",
            pluginName: p.manifest.name,
            message:
              "The plugin requires an approved browser executable. Resolve the browser dependency, then reload or re-run discovery to enable its tools.",
            recoverable: true,
          },
        ]);
      } catch {
        // best-effort — health is already set on the row
      }
    }
    if (hasPythonSkill && !policyGateBlocked && !browserMissing) {
      try {
        await p.pluginModule.setLoadErrors(p.manifest.name, [
          {
            code: "dependency-unsatisfied",
            componentType: "skill",
            pluginName: p.manifest.name,
            message:
              "Plugin bundles a Python skill. Run the skill once to trigger venv setup, or prepare the environment manually before first use.",
            recoverable: true,
          },
        ]);
      } catch {
        // best-effort — health is already set on the row
      }
    }

    // 11c. Surface agent parser warnings (forbidden/unknown fields) as
    // non-fatal load errors so they show in diagnostics. Plugin health stays
    // healthy — warnings never block the runtime (design §12.5).
    if (agentParse.warnings.length > 0 && !policyGateBlocked) {
      try {
        await p.pluginModule.setLoadErrors(p.manifest.name, agentParse.warnings);
      } catch {
        // best-effort
      }
    }

    // 11d. H6/update-transaction: the new generation is fully promoted
    // (rows, discovery, agents) — the previous-generation backup (if any)
    // is retired now.
    if (p.isOverwrite && fs.existsSync(backupDir)) {
      try {
        removePath(backupDir);
      } catch {
        // best-effort — the backup ages out with the next update at worst
      }
    }

    // 12. Return summary
    const summary: PluginSummary = {
      id: pluginId,
      name: p.manifest.name,
      displayName: p.manifest.displayName,
      version: p.manifest.version,
      source: (p.manifest.source ?? "local") as PluginSource,
      enabled: true,
      health: policyGateBlocked
        ? "invalid"
        : browserMissing || hasPythonSkill
        ? "needs_configuration"
        : "healthy",
      skillCount: skills.length,
      mcpServerCount: mcpServers.length,
      agentCount: pluginAgents.length,
      // Commands are promoted post-install by PluginComponentRegistryService,
      // not during import — report 0 here; the live count is read on demand.
      commandCount: 0,
      // Hooks are promoted post-install by PluginComponentRegistryService.
      hookCount: 0,
      permissions: p.manifest.permissions ?? [],
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
      guidance =
        content.length > 8000
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
