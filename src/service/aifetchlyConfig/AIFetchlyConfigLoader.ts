/**
 * AIFetchlyConfigLoader — CFG-01 / CFG-03 / CFG-04 / CFG-05 / CFG-06 / CFG-07 / CMD-06 / DX-01.
 *
 * Async bounded scanner for the global ~/.aifetchly config folder. Resolves
 * the root via os.homedir() + AIFETCHLY_CONFIG_DIR_NAME (NEVER Electron
 * userData — CFG-01), enforces per-file-type size limits before reading
 * (CFG-04, T-13-DoS), hashes content with SHA-256 (CFG-06), validates
 * settings.json against a zod schema with graceful fallback to defaults
 * (CFG-03), scans commands/*.md through the restricted frontmatter parser
 * (CFG-07) + buildPromptCommandDefinition (CMD-06, Plan 15-01), and emits
 * diagnostics using the stable code tuple (DX-01).
 *
 * Pipeline (design §6.4):
 *   fs.readdir -> for each well-known file:
 *     fs.stat (size limit) -> fs.readFile (bounded) ->
 *       AGENTS.md: crypto.createHash('sha256') + AIFetchlyInstructionBlock
 *       settings.json: JSON.parse + zod safeParse + merge over defaults
 *       commands/*.md: frontmatter parse + buildPromptCommandDefinition
 *
 * Hard invariants:
 *   - All filesystem operations use fs.promises (async). The acceptance grep
 *     `grep -n "readFileSync|statSync|readdirSync"` must return nothing.
 *   - scanGlobalRoot NEVER throws; unexpected IO errors surface as
 *     recoverable "scanner-io-error" diagnostics and the scan continues.
 *   - Missing global folder is the happy path on a fresh install: empty
 *     snapshot, NO diagnostic.
 *   - The commands array carries validated SlashCommandDefinition objects
 *     (Phase 15, Plan 02); agents/hooks/skills stay EMPTY until phase 16/17/18.
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { z } from "zod";
import type {
  AIFetchlyConfigDiagnostic,
  AIFetchlyConfigFileSnapshot,
  AIFetchlyConfigSettings,
  AIFetchlyConfigSnapshot,
  AIFetchlyInstructionBlock,
} from "@/entityTypes/aifetchlyConfigTypes";
import type { AgentDefinitionView } from "@/entityTypes/agentTypes";
import type { CommandHookDefinition } from "@/entityTypes/hookTypes";
import type { SlashCommandDefinition } from "@/entityTypes/slashCommandTypes";
import {
  buildAgentDefinition,
  detectUnknownTools,
  type AgentDefinitionSourceMeta,
} from "@/service/slashCommands/agentFrontmatter";
import { buildPromptCommandDefinition } from "@/service/slashCommands/promptCommandFrontmatter";
import {
  buildHookDefinition,
  type HookDefinitionSourceMeta,
} from "@/service/hooks/hookFileFrontmatter";
import {
  buildLocalSkillDraft,
  type LocalSkillDraft,
} from "@/service/aifetchlyConfig/buildLocalSkillDraft";
import { lazySchema } from "@/utils/lazySchema";
import {
  AIFETCHLY_CONFIG_DIR_NAME,
  AIFETCHLY_CONFIG_LIMITS,
  DEFAULT_AIFETCHLY_CONFIG_SETTINGS,
} from "./AIFetchlyConfigConstants";
import { parseRestrictedFrontmatter } from "./AIFetchlyConfigMarkdown";
import { resolveConfigRelativePath } from "./resolveConfigRelativePath";

// Phase-13/15 discovery list (design §6.4). The global loader reads the two
// well-known literals plus the commands/ directory (Phase 15). Workspace-
// scanned files route through resolveConfigRelativePath +
// parseRestrictedFrontmatter in the Phase-14 scanner; the global loader
// mirrors that path for commands/*.md here.
const AGENTS_MD = "AGENTS.md";
const SETTINGS_JSON = "settings.json";
const COMMANDS_DIR = "commands";
const AGENTS_DIR = "agents";
const HOOKS_DIR = "hooks";
const HOOKS_JSON = "hooks.json";
// Phase 18 (SKL-01): skills are DIRECTORIES under skills/<name>/manifest.json.
const SKILLS_DIR = "skills";
const SKILL_MANIFEST = "manifest.json";

const settingsSchema = lazySchema(() =>
  z
    .object({
      commandsEnabled: z.boolean().optional(),
      agentsEnabled: z.boolean().optional(),
      hooksEnabled: z.boolean().optional(),
      workspaceConfigEnabled: z.boolean().optional(),
      watchEnabled: z.boolean().optional(),
    })
    .passthrough()
);

export interface AIFetchlyConfigLoaderOptions {
  /**
   * Tool names currently registered with the runtime. When present, the
   * agent scan emits non-fatal `agent-tool-invalid` (DX-01) warnings for
   * agent files referencing tools outside this set (D-ToolDiagnostic).
   * Defaults to an empty set (all tools flagged) — Plan 03 wires the live
   * SkillRegistry set through the manager.
   */
  readonly registeredToolNames?: ReadonlySet<string>;
}

export class AIFetchlyConfigLoader {
  private readonly rootPath: string;
  private settings: AIFetchlyConfigSettings = {
    ...DEFAULT_AIFETCHLY_CONFIG_SETTINGS,
  };
  /**
   * Tool names currently registered with the runtime (SkillRegistry +
   * MCP tools). Used by {@link tryReadAgentFiles} to emit non-fatal
   * `agent-tool-invalid` (DX-01) warnings via {@link detectUnknownTools}
   * for agent files that reference unregistered tools.
   *
   * Plan 02 leaves this empty in the default manager wiring; Plan 03
   * populates it from `SkillRegistry.getAllToolFunctions()` at startup
   * and on skill reload so warnings reflect the live tool set. Tests
   * inject a stub set directly (D-ToolDiagnostic).
   */
  private readonly registeredToolNames: ReadonlySet<string>;

  /**
   * @param rootPath Optional override for the config root (tests). Defaults
   * to path.join(os.homedir(), AIFETCHLY_CONFIG_DIR_NAME) per CFG-01.
   * @param options Optional bag; {@link AIFetchlyConfigLoaderOptions.registeredToolNames}
   * feeds the non-fatal unknown-tool warning path (D-ToolDiagnostic).
   */
  constructor(rootPath?: string, options: AIFetchlyConfigLoaderOptions = {}) {
    this.rootPath =
      rootPath ?? path.join(os.homedir(), AIFETCHLY_CONFIG_DIR_NAME);
    this.registeredToolNames = options.registeredToolNames ?? new Set();
  }

  /** The most recently parsed settings (DEFAULT until a successful scan). */
  getSettings(): AIFetchlyConfigSettings {
    return this.settings;
  }

  async scanGlobalRoot(): Promise<AIFetchlyConfigSnapshot> {
    const source = "user" as const;
    const sourceId = "user";

    const files: AIFetchlyConfigFileSnapshot[] = [];
    const instructions: AIFetchlyInstructionBlock[] = [];
    const commands: SlashCommandDefinition[] = [];
    const agents: AgentDefinitionView[] = [];
    const hooks: CommandHookDefinition[] = [];
    const skills: LocalSkillDraft[] = [];
    const diagnostics: AIFetchlyConfigDiagnostic[] = [];

    let entries: readonly string[];
    try {
      entries = await fs.promises.readdir(this.rootPath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        // Missing folder is the happy path on a fresh install — no diagnostic.
        return this.buildSnapshot(
          source,
          sourceId,
          files,
          instructions,
          commands,
          agents,
          hooks,
          skills,
          diagnostics
        );
      }
      // Any other IO error (EACCES, ENOTDIR, EIO) — recoverable diagnostic.
      diagnostics.push(this.ioError("(root)", err));
      return this.buildSnapshot(
        source,
        sourceId,
        files,
        instructions,
        commands,
        agents,
        hooks,
        skills,
        diagnostics
      );
    }

    const entryNames = new Set(entries);

    for (const name of [AGENTS_MD, SETTINGS_JSON] as const) {
      if (!entryNames.has(name)) continue;
      const abs = path.join(this.rootPath, name);
      try {
        const stat = await fs.promises.stat(abs);
        const limit =
          name === AGENTS_MD
            ? AIFETCHLY_CONFIG_LIMITS.agentsMdBytes
            : AIFETCHLY_CONFIG_LIMITS.settingsJsonBytes;

        // CFG-04: size limit BEFORE readFile (T-13-DoS mitigation).
        if (stat.size > limit) {
          diagnostics.push({
            severity: "warning",
            source,
            sourceId,
            filePath: name,
            code: "file-too-large",
            message: `${name} is ${stat.size} bytes which exceeds the ${limit}-byte limit; skipped`,
            recoverable: true,
          });
          continue;
        }

        const content = await fs.promises.readFile(abs);
        // CFG-06: SHA-256 content hash (utf-8 normalisation handled by Node).
        const contentHash = crypto
          .createHash("sha256")
          .update(content)
          .digest("hex");

        files.push({
          relativePath: name,
          kind: name === AGENTS_MD ? "instructions" : "settings",
          mtimeMs: stat.mtimeMs,
          sizeBytes: stat.size,
          contentHash,
        });

        if (name === AGENTS_MD) {
          instructions.push({
            id: "user:instructions:AGENTS.md",
            source: "user",
            sourceId: "user",
            // The context loader (Plan 03) formats the user-facing label
            // per design §12.2; the loader stores relativePath and leaves
            // the label empty here so the assembler owns wording.
            label: "",
            relativePath: name,
            content: content.toString("utf8"),
            contentHash,
            // Global user-owned instructions are always-on (TRS-01). Workspace
            // instructions get trusted=false and require approval (phase 14).
            trusted: true,
          });
        } else {
          this.parseSettings(name, content, source, sourceId, diagnostics);
        }
      } catch (err) {
        diagnostics.push(this.ioError(name, err));
      }
    }

    // Phase 15 (Plan 02): scan commands/*.md through the restricted frontmatter
    // parser (CFG-07) + buildPromptCommandDefinition (CMD-06). Mirrors the
    // Phase-14 WorkspaceConfigScanner.tryReadCommandFiles structure.
    await this.tryReadCommandFiles(files, commands, diagnostics);

    // Phase 16 (Plan 02): scan agents/*.md through the restricted frontmatter
    // parser (CFG-07) + buildAgentDefinition (AGT-06). Mirrors
    // tryReadCommandFiles above; source is "user", sourceId "user".
    await this.tryReadAgentFiles(files, agents, diagnostics);

    // Phase 17 (Plan 02): read the SINGLE hooks/hooks.json file, JSON.parse it,
    // validate each entry via buildHookDefinition (HOK-01), and push validated
    // CommandHookDefinition[] into `hooks` (source "user"). Mirrors the
    // agents path but for one JSON file instead of a directory of .md.
    await this.tryReadHookFiles(files, hooks, diagnostics);

    // Phase 18 (Plan 01 / SKL-01): scan skills/<name>/manifest.json — one
    // DIRECTORY per skill — validate each via buildLocalSkillDraft, and push
    // validated LocalSkillDraft[] into `skills` (source "user"). Mirrors the
    // hooks path but for a directory of manifests instead of one JSON file.
    await this.tryReadSkillFiles(files, skills, diagnostics);

    return this.buildSnapshot(
      source,
      sourceId,
      files,
      instructions,
      commands,
      agents,
      hooks,
      skills,
      diagnostics
    );
  }

  /**
   * CFG-03: parse + validate settings.json. On JSON or schema failure the
   * settings reset to DEFAULT and a "settings-json-invalid" warning is
   * emitted. On success the parsed values are merged over the defaults.
   */
  private parseSettings(
    filePath: string,
    content: Buffer,
    source: "user" | "workspace",
    sourceId: string,
    diagnostics: AIFetchlyConfigDiagnostic[]
  ): void {
    let raw: unknown;
    try {
      raw = JSON.parse(content.toString("utf8")) as unknown;
    } catch (err) {
      this.settings = { ...DEFAULT_AIFETCHLY_CONFIG_SETTINGS };
      diagnostics.push({
        severity: "warning",
        source,
        sourceId,
        filePath,
        code: "settings-json-invalid",
        message: `${filePath} is not valid JSON: ${(err as Error).message}`,
        recoverable: true,
      });
      return;
    }

    const parsed = settingsSchema().safeParse(raw);
    if (!parsed.success) {
      this.settings = { ...DEFAULT_AIFETCHLY_CONFIG_SETTINGS };
      diagnostics.push({
        severity: "warning",
        source,
        sourceId,
        filePath,
        code: "settings-json-invalid",
        message: `${filePath} failed schema validation: ${parsed.error.message}`,
        recoverable: true,
      });
      return;
    }

    // Merge parsed values over defaults (CFG-03: unknown fields ignored via
    // .passthrough(); missing fields inherit defaults).
    this.settings = { ...DEFAULT_AIFETCHLY_CONFIG_SETTINGS, ...parsed.data };
  }

  /**
   * CMD-06 (Phase 15 / Plan 02): read `<rootPath>/commands/*.md`, parse each
   * with the restricted frontmatter parser (CFG-07), apply CFG-05 path safety
   * + CFG-04 size/count caps, validate via buildPromptCommandDefinition (the
   * single CMD-06 schema owner), and push successful definitions into
   * `commands` with failures into `diagnostics`. Mirrors Phase-14
   * WorkspaceConfigScanner.tryReadCommandFiles. Missing commands/ dir is the
   * happy path — no diagnostic.
   */
  private async tryReadCommandFiles(
    files: AIFetchlyConfigFileSnapshot[],
    commands: SlashCommandDefinition[],
    diagnostics: AIFetchlyConfigDiagnostic[]
  ): Promise<void> {
    const source = "user" as const;
    const sourceId = "user";
    const commandsDir = path.join(this.rootPath, COMMANDS_DIR);

    let entries: readonly (string | fs.Dirent)[];
    try {
      entries = await fs.promises.readdir(commandsDir, { withFileTypes: true });
    } catch (err) {
      // Missing commands/ dir is the happy path (most installs have none).
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      diagnostics.push(this.ioError(`${COMMANDS_DIR}/`, err));
      return;
    }

    const sourceMeta = {
      source,
      sourceId,
      sourceLabel: "User",
      requiresTrust: false,
    };

    for (const entry of entries) {
      const name = typeof entry === "string" ? entry : entry.name;
      if (!name.endsWith(".md")) continue;
      const relativePath = `${COMMANDS_DIR}/${name}`;
      const safeRel = resolveConfigRelativePath(commandsDir, name);
      // CFG-05: reject absolute or `..`-traversing names.
      if (!safeRel.ok) {
        diagnostics.push({
          severity: "warning",
          source,
          sourceId,
          filePath: relativePath,
          code: "path-outside-root",
          message: `rejected command path: ${safeRel.reason}`,
          recoverable: true,
        });
        continue;
      }
      try {
        // Skip subdirectories (withFileTypes returns Dirent).
        if (
          typeof entry !== "string" &&
          typeof entry.isDirectory === "function" &&
          entry.isDirectory()
        ) {
          continue;
        }

        // CFG-04: count cap — once maxCommandsPerSource files have been added,
        // skip the rest with a single diagnostic.
        if (commands.length >= AIFETCHLY_CONFIG_LIMITS.maxCommandsPerSource) {
          diagnostics.push({
            severity: "warning",
            source,
            sourceId,
            filePath: relativePath,
            code: "file-too-large",
            message: `command count reached the ${AIFETCHLY_CONFIG_LIMITS.maxCommandsPerSource}-file cap; skipping remaining files`,
            recoverable: true,
          });
          break;
        }

        const abs = safeRel.absolutePath;
        const stat = await fs.promises.stat(abs);
        if (stat.size > AIFETCHLY_CONFIG_LIMITS.commandMdBytes) {
          diagnostics.push({
            severity: "warning",
            source,
            sourceId,
            filePath: relativePath,
            code: "file-too-large",
            message: `${name} is ${stat.size} bytes which exceeds the ${AIFETCHLY_CONFIG_LIMITS.commandMdBytes}-byte limit; skipped`,
            recoverable: true,
          });
          continue;
        }

        const content = await fs.promises.readFile(abs);
        const contentHash = crypto
          .createHash("sha256")
          .update(content)
          .digest("hex");
        files.push({
          relativePath,
          kind: "command",
          mtimeMs: stat.mtimeMs,
          sizeBytes: stat.size,
          contentHash,
        });

        // CFG-07 restricted frontmatter parse. On failure, surface a
        // diagnostic and skip — the file is still counted in files[].
        const text = content.toString("utf8");
        const parsed = parseRestrictedFrontmatter(text);
        if (parsed === null) {
          diagnostics.push({
            severity: "warning",
            source,
            sourceId,
            filePath: relativePath,
            code: "frontmatter-invalid",
            message: `${name} frontmatter failed restricted parse; skipped`,
            recoverable: true,
          });
          continue;
        }

        const scalars: Record<string, string> = {};
        const arrays: Record<string, readonly string[]> = {};
        for (const [k, v] of parsed.scalars) scalars[k] = v;
        for (const [k, v] of parsed.arrays) arrays[k] = v;

        // CMD-06 validation via the single schema owner (Plan 15-01).
        const result = buildPromptCommandDefinition(
          {
            frontmatter: { ...scalars, ...arrays },
            body: parsed.body,
            relativePath,
          },
          sourceMeta
        );
        if (result.ok) {
          commands.push(result.definition);
        } else {
          diagnostics.push(result.diagnostic);
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
        diagnostics.push(this.ioError(relativePath, err));
      }
    }
  }

  /**
   * AGT-02 (Phase 16 / Plan 02): read `<rootPath>/agents/*.md`, parse each
   * with the restricted frontmatter parser (CFG-07), apply CFG-05 path safety
   * + CFG-04 size/count caps, validate via buildAgentDefinition (the single
   * AGT-02 schema owner from Plan 01), and push successful definitions into
   * `agents`. After each successful build, detectUnknownTools emits non-fatal
   * `agent-tool-invalid` (DX-01) warnings for tools outside the registered
   * set — the agent is STILL registered (D-ToolDiagnostic). Mirrors
   * {@link tryReadCommandFiles}. Missing agents/ dir is the happy path — no
   * diagnostic.
   *
   * Pure file I/O + Plan-01 pure logic — NO DB / Electron / Module imports
   * (CLAUDE.md three-layer; the loader never touches the registry directly).
   */
  private async tryReadAgentFiles(
    files: AIFetchlyConfigFileSnapshot[],
    agents: AgentDefinitionView[],
    diagnostics: AIFetchlyConfigDiagnostic[]
  ): Promise<void> {
    const source = "user" as const;
    const sourceId = "user";
    const agentsDir = path.join(this.rootPath, AGENTS_DIR);

    let entries: readonly (string | fs.Dirent)[];
    try {
      entries = await fs.promises.readdir(agentsDir, { withFileTypes: true });
    } catch (err) {
      // Missing agents/ dir is the happy path (most installs have none).
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      diagnostics.push(this.ioError(`${AGENTS_DIR}/`, err));
      return;
    }

    const sourceMeta: AgentDefinitionSourceMeta = {
      source,
      sourceId,
      sourceLabel: "User",
      requiresTrust: false,
    };

    for (const entry of entries) {
      const name = typeof entry === "string" ? entry : entry.name;
      if (!name.endsWith(".md")) continue;
      const relativePath = `${AGENTS_DIR}/${name}`;
      const safeRel = resolveConfigRelativePath(agentsDir, name);
      // CFG-05: reject absolute or `..`-traversing names.
      if (!safeRel.ok) {
        diagnostics.push({
          severity: "warning",
          source,
          sourceId,
          filePath: relativePath,
          code: "path-outside-root",
          message: `rejected agent path: ${safeRel.reason}`,
          recoverable: true,
        });
        continue;
      }
      try {
        // Skip subdirectories (withFileTypes returns Dirent).
        if (
          typeof entry !== "string" &&
          typeof entry.isDirectory === "function" &&
          entry.isDirectory()
        ) {
          continue;
        }

        // CFG-04: count cap — once maxAgentsPerSource files have been added,
        // skip the rest with a single diagnostic (mirrors commands cap).
        if (agents.length >= AIFETCHLY_CONFIG_LIMITS.maxAgentsPerSource) {
          diagnostics.push({
            severity: "warning",
            source,
            sourceId,
            filePath: relativePath,
            code: "file-too-large",
            message: `agent count reached the ${AIFETCHLY_CONFIG_LIMITS.maxAgentsPerSource}-file cap; skipping remaining files`,
            recoverable: true,
          });
          break;
        }

        const abs = safeRel.absolutePath;
        const stat = await fs.promises.stat(abs);
        if (stat.size > AIFETCHLY_CONFIG_LIMITS.agentMdBytes) {
          diagnostics.push({
            severity: "warning",
            source,
            sourceId,
            filePath: relativePath,
            code: "file-too-large",
            message: `${name} is ${stat.size} bytes which exceeds the ${AIFETCHLY_CONFIG_LIMITS.agentMdBytes}-byte limit; skipped`,
            recoverable: true,
          });
          continue;
        }

        const content = await fs.promises.readFile(abs);
        const contentHash = crypto
          .createHash("sha256")
          .update(content)
          .digest("hex");
        files.push({
          relativePath,
          kind: "agent",
          mtimeMs: stat.mtimeMs,
          sizeBytes: stat.size,
          contentHash,
        });

        // CFG-07 restricted frontmatter parse. On failure, surface a
        // diagnostic and skip — the file is still counted in files[].
        const text = content.toString("utf8");
        const parsed = parseRestrictedFrontmatter(text);
        if (parsed === null) {
          diagnostics.push({
            severity: "warning",
            source,
            sourceId,
            filePath: relativePath,
            code: "frontmatter-invalid",
            message: `${name} frontmatter failed restricted parse; skipped`,
            recoverable: true,
          });
          continue;
        }

        const scalars: Record<string, string> = {};
        const arrays: Record<string, readonly string[]> = {};
        for (const [k, v] of parsed.scalars) scalars[k] = v;
        for (const [k, v] of parsed.arrays) arrays[k] = v;

        // AGT-02 validation via the single schema owner (Plan 01).
        const result = buildAgentDefinition(
          {
            frontmatter: { ...scalars, ...arrays },
            body: parsed.body,
            relativePath,
          },
          sourceMeta
        );
        if (result.ok) {
          agents.push(result.definition);
          // DX-01 (D-ToolDiagnostic): non-fatal warnings for tools outside the
          // registered set. The agent is still registered above; these only
          // surface author-facing early feedback.
          const toolDiagnostics = detectUnknownTools(
            result.definition,
            this.registeredToolNames
          );
          for (const d of toolDiagnostics) diagnostics.push(d);
        } else {
          diagnostics.push(result.diagnostic);
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
        diagnostics.push(this.ioError(relativePath, err));
      }
    }
  }

  /**
   * HOK-01 (Phase 17 / Plan 02): read the SINGLE `<rootPath>/hooks/hooks.json`
   * file (NOT a directory), enforce CFG-04 size cap, JSON.parse it, validate
   * each entry via buildHookDefinition (the single HOK-01 schema owner), apply
   * the CFG-06 maxHooksPerSource count cap, and push validated
   * {@link CommandHookDefinition} objects into `hooks` with failures into
   * `diagnostics`. Missing hooks/hooks.json is the happy path — no diagnostic.
   *
   * Pure file I/O + Plan-02 pure logic — NO DB / Electron / Module imports.
   */
  private async tryReadHookFiles(
    files: AIFetchlyConfigFileSnapshot[],
    hooks: CommandHookDefinition[],
    diagnostics: AIFetchlyConfigDiagnostic[]
  ): Promise<void> {
    const source = "user" as const;
    const sourceId = "user";
    const relativePath = `${HOOKS_DIR}/${HOOKS_JSON}`;
    const hooksFile = path.join(this.rootPath, HOOKS_DIR, HOOKS_JSON);

    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(hooksFile);
    } catch (err) {
      // Missing hooks/hooks.json is the happy path (most installs have none).
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      diagnostics.push(this.ioError(relativePath, err));
      return;
    }

    // CFG-04: size cap before read (T-13-DoS mitigation).
    if (stat.size > AIFETCHLY_CONFIG_LIMITS.hooksJsonBytes) {
      diagnostics.push({
        severity: "warning",
        source,
        sourceId,
        filePath: relativePath,
        code: "file-too-large",
        message: `${HOOKS_JSON} is ${stat.size} bytes which exceeds the ${AIFETCHLY_CONFIG_LIMITS.hooksJsonBytes}-byte limit; skipped`,
        recoverable: true,
      });
      return;
    }

    let content: Buffer;
    try {
      content = await fs.promises.readFile(hooksFile);
    } catch (err) {
      diagnostics.push(this.ioError(relativePath, err));
      return;
    }
    const contentHash = crypto
      .createHash("sha256")
      .update(content)
      .digest("hex");
    files.push({
      relativePath,
      kind: "hook",
      mtimeMs: stat.mtimeMs,
      sizeBytes: stat.size,
      contentHash,
    });

    // JSON.parse the whole file; a parse failure yields a single
    // hooks-json-invalid diagnostic (no definitions).
    let parsed: unknown;
    try {
      parsed = JSON.parse(content.toString("utf8")) as unknown;
    } catch (err) {
      diagnostics.push({
        severity: "warning",
        source,
        sourceId,
        filePath: relativePath,
        code: "hooks-json-invalid",
        message: `${HOOKS_JSON} is not valid JSON: ${(err as Error).message}`,
        recoverable: true,
      });
      return;
    }
    if (!Array.isArray(parsed)) {
      diagnostics.push({
        severity: "warning",
        source,
        sourceId,
        filePath: relativePath,
        code: "hooks-json-invalid",
        message: `${HOOKS_JSON} top-level must be an array of hook entries`,
        recoverable: true,
      });
      return;
    }

    const sourceMeta: HookDefinitionSourceMeta = {
      source,
      sourceId,
      relativePath,
    };

    for (let index = 0; index < parsed.length; index++) {
      // CFG-06: count cap — once maxHooksPerSource valid definitions are
      // accepted, drop the surplus with a single count-cap diagnostic.
      if (hooks.length >= AIFETCHLY_CONFIG_LIMITS.maxHooksPerSource) {
        diagnostics.push({
          severity: "warning",
          source,
          sourceId,
          filePath: relativePath,
          code: "count-cap",
          message: `hook count reached the ${AIFETCHLY_CONFIG_LIMITS.maxHooksPerSource}-per-source cap; skipping remaining entries`,
          recoverable: true,
        });
        break;
      }
      const result = buildHookDefinition(parsed[index], sourceMeta, index);
      if (result.ok) {
        hooks.push(result.definition);
      } else {
        diagnostics.push(result.diagnostic);
      }
    }
  }

  /**
   * Phase 18 (SKL-01): scan `skills/<name>/manifest.json` — one DIRECTORY per
   * skill — validate each via {@link buildLocalSkillDraft}, and push validated
   * {@link LocalSkillDraft} objects into `skills` (source "user", sourceId
   * "user"). Mirrors {@link tryReadHookFiles} but adapted for directories.
   *
   * Pipeline per skill dir:
   *   readdir(skills/) -> for each directory entry:
   *     count-cap check -> stat(<name>/manifest.json) (CFG-04 size cap) ->
   *     readFile -> sha256 -> push file snapshot (kind "skill") ->
   *     JSON.parse (failure -> manifest-invalid) ->
   *     buildLocalSkillDraft(parsed, sourceMeta, skillDir, hash) ->
   *       ok -> push draft; !ok -> push diagnostic
   *
   * Missing `skills/` dir is the happy path (no diagnostic). Non-directory
   * entries are skipped. `skillDir` is resolved from `this.rootPath` (NEVER
   * from `SkillEnvironmentManager.getInstalledSkillRoot` — 18-RESEARCH
   * Anti-Pattern).
   */
  private async tryReadSkillFiles(
    files: AIFetchlyConfigFileSnapshot[],
    skills: LocalSkillDraft[],
    diagnostics: AIFetchlyConfigDiagnostic[]
  ): Promise<void> {
    const source = "user" as const;
    const sourceId = "user";
    const skillsDir = path.join(this.rootPath, SKILLS_DIR);

    let entries: readonly fs.Dirent[];
    try {
      entries = await fs.promises.readdir(skillsDir, { withFileTypes: true });
    } catch (err) {
      // Missing skills/ dir is the happy path (most installs have none).
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      diagnostics.push(this.ioError(SKILLS_DIR, err));
      return;
    }

    const sourceMeta = {
      source,
      sourceId,
      relativePath: "",
    };

    for (const entry of entries) {
      // Only directories are skill candidates; stray files are ignored.
      if (!entry.isDirectory()) continue;

      // CFG-06: count cap — once maxSkillsPerSource valid drafts are accepted,
      // drop the surplus with a single count-cap diagnostic.
      if (skills.length >= AIFETCHLY_CONFIG_LIMITS.maxSkillsPerSource) {
        diagnostics.push({
          severity: "warning",
          source,
          sourceId,
          filePath: `${SKILLS_DIR}/${entry.name}`,
          code: "count-cap",
          message: `skill count reached the ${AIFETCHLY_CONFIG_LIMITS.maxSkillsPerSource}-per-source cap; skipping remaining entries`,
          recoverable: true,
        });
        break;
      }

      const skillName = entry.name;
      const relativePath = `${SKILLS_DIR}/${skillName}/${SKILL_MANIFEST}`;
      const manifestPath = path.join(skillsDir, skillName, SKILL_MANIFEST);

      let stat: fs.Stats;
      try {
        stat = await fs.promises.stat(manifestPath);
      } catch (err) {
        // Missing manifest.json for a skill dir is a soft skip (the directory
        // may be a WIP); surface as a manifest-invalid so the user notices.
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          diagnostics.push({
            severity: "warning",
            source,
            sourceId,
            filePath: relativePath,
            code: "manifest-invalid",
            message: `skills/${skillName}/ is missing a manifest.json; skipped`,
            recoverable: true,
          });
          continue;
        }
        diagnostics.push(this.ioError(relativePath, err));
        continue;
      }

      // CFG-04: size cap before read (T-13-DoS mitigation).
      if (stat.size > AIFETCHLY_CONFIG_LIMITS.skillManifestBytes) {
        diagnostics.push({
          severity: "warning",
          source,
          sourceId,
          filePath: relativePath,
          code: "file-too-large",
          message: `${SKILL_MANIFEST} is ${stat.size} bytes which exceeds the ${AIFETCHLY_CONFIG_LIMITS.skillManifestBytes}-byte limit; skipped`,
          recoverable: true,
        });
        continue;
      }

      let content: Buffer;
      try {
        content = await fs.promises.readFile(manifestPath);
      } catch (err) {
        diagnostics.push(this.ioError(relativePath, err));
        continue;
      }
      const contentHash = crypto
        .createHash("sha256")
        .update(content)
        .digest("hex");
      files.push({
        relativePath,
        kind: "skill",
        mtimeMs: stat.mtimeMs,
        sizeBytes: stat.size,
        contentHash,
      });

      // JSON.parse; a parse failure yields a single manifest-invalid diagnostic.
      let parsed: unknown;
      try {
        parsed = JSON.parse(content.toString("utf8")) as unknown;
      } catch (err) {
        diagnostics.push({
          severity: "warning",
          source,
          sourceId,
          filePath: relativePath,
          code: "manifest-invalid",
          message: `${SKILL_MANIFEST} is not valid JSON: ${
            (err as Error).message
          }`,
          recoverable: true,
        });
        continue;
      }

      // skillDir is resolved from this.rootPath — NEVER from
      // SkillEnvironmentManager.getInstalledSkillRoot (18-RESEARCH Anti-Pattern).
      const skillDir = path.join(skillsDir, skillName);
      const result = buildLocalSkillDraft(
        parsed,
        { ...sourceMeta, relativePath },
        skillDir,
        contentHash
      );
      if (result.ok) {
        skills.push(result.draft);
      } else {
        diagnostics.push(result.diagnostic);
      }
    }
  }

  private ioError(filePath: string, err: unknown): AIFetchlyConfigDiagnostic {
    return {
      severity: "warning",
      source: "user",
      sourceId: "user",
      filePath,
      code: "scanner-io-error",
      message: `filesystem error scanning ${filePath}: ${
        (err as Error).message
      }`,
      recoverable: true,
    };
  }

  private buildSnapshot(
    source: "user" | "workspace",
    sourceId: string,
    files: readonly AIFetchlyConfigFileSnapshot[],
    instructions: readonly AIFetchlyInstructionBlock[],
    commands: readonly SlashCommandDefinition[],
    agents: readonly AgentDefinitionView[],
    hooks: readonly CommandHookDefinition[],
    skills: readonly LocalSkillDraft[],
    diagnostics: readonly AIFetchlyConfigDiagnostic[]
  ): AIFetchlyConfigSnapshot {
    return {
      source,
      sourceId,
      rootPath: this.rootPath,
      version: 1,
      files,
      instructions,
      commands,
      agents,
      hooks,
      skills,
      diagnostics,
    };
  }
}
