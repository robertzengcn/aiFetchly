/**
 * WorkspaceConfigScanner — CFG-02 workspace-rooted variant of AIFetchlyConfigLoader.
 *
 * Discovers the explicit workspace file set per design §9.7:
 *   .aifetchly/AGENTS.md          (instruction block; trusted=false — workspace source)
 *   .aifetchly/settings.json      (CFG-03 validated; merged over defaults)
 *   .aifetchly/commands/*.md      (raw frontmatter only — Phase 15 expands $ARGUMENTS)
 *   <root>/AGENTS.md (optional)   (only when includeRootAgentsFile=true)
 *
 * Hard invariants:
 *   - NEVER throws. All filesystem errors surface as recoverable diagnostics
 *     with code "scanner-io-error" and the scan continues.
 *   - Missing `.aifetchly` dir is the happy path: empty snapshot, NO diagnostic.
 *   - All filesystem operations use fs.promises (async) — mirrors Phase 13.
 *   - Path safety: every discovered relative path is validated via
 *     resolveConfigRelativePath (CFG-05). Absolute paths, `..` traversal,
 *     and escaping symlinks are rejected with a "path-outside-root" diagnostic.
 *   - Size limits (CFG-04) checked via fs.stat BEFORE fs.readFile. Oversized
 *     files emit a "file-too-large" diagnostic.
 *   - The worker process calls this scanner via the worker-side wrapper
 *     (workerScanner.ts). The worker NEVER touches the DB or the Electron
 *     main module — this scanner uses only fs/crypto/path and the shared
 *     Phase 13 frontmatter parser + constants, which are pure.
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import type {
  AIFetchlyConfigDiagnostic,
  AIFetchlyConfigFileSnapshot,
  AIFetchlyConfigSettings,
  AIFetchlyConfigSnapshot,
  AIFetchlyInstructionBlock,
} from "@/entityTypes/aifetchlyConfigTypes";
import {
  AIFETCHLY_CONFIG_DIR_NAME,
  AIFETCHLY_CONFIG_LIMITS,
  DEFAULT_AIFETCHLY_CONFIG_SETTINGS,
} from "@/service/aifetchlyConfig/AIFetchlyConfigConstants";
import { resolveConfigRelativePath } from "@/service/aifetchlyConfig/resolveConfigRelativePath";
import { parseRestrictedFrontmatter } from "@/service/aifetchlyConfig/AIFetchlyConfigMarkdown";

/**
 * Per Phase 14, a workspace command snapshot carries the raw frontmatter
 * scalars + the body (un-expanded `$ARGUMENTS`). Phase 15 will tighten
 * this type and replace the placeholder.
 */
export interface WorkspaceCommandDraft {
  readonly id: string;
  readonly source: "workspace";
  readonly sourceId: string;
  readonly relativePath: string;
  readonly frontmatter: Readonly<Record<string, string | readonly string[]>>;
  readonly body: string;
  readonly contentHash: string;
}

/**
 * Phase 16 (Plan 02): a raw workspace agent draft produced by the WORKER.
 *
 * The worker emits parsed frontmatter (scalars + arrays) + body + hash ONLY.
 * NO validation runs here — buildAgentDefinition (Plan 01) runs in the MAIN
 * process via buildWorkspaceAgentDefinitions (Task 3). This keeps the worker
 * scan-only (WAT-02 worker-no-DB / no-registry / no-Electron). An invalid
 * name or unknown tool is carried through unchanged; the main-process
 * converter decides whether to drop or warn.
 */
export interface WorkspaceAgentDraft {
  readonly id: string;
  readonly source: "workspace";
  readonly sourceId: string;
  readonly relativePath: string;
  readonly frontmatter: Readonly<Record<string, string | readonly string[]>>;
  readonly body: string;
  readonly contentHash: string;
}

export interface WorkspaceConfigScanInput {
  readonly workspaceId: string;
  readonly workspaceRoot: string;
  readonly includeRootAgentsFile: boolean;
}

/**
 * Phase 17 (Plan 02): a raw workspace hook draft produced by the WORKER.
 *
 * The worker reads the SINGLE `.aifetchly/hooks/hooks.json` file, JSON.parses
 * it, and ships the parsed blob as opaque `raw` (expected to be an array of
 * entries). NO validation runs here — the HOK-01 validator (Plan 02) runs in
 * the MAIN process via the workspace hook converter. This keeps the worker
 * scan-only (WAT-02 worker-no-DB / no-registry / no-Electron / no-zod). A
 * structurally invalid file is carried through unchanged; the main-process
 * converter decides whether to drop or warn.
 */
export interface WorkspaceHookDraft {
  readonly id: string;
  readonly source: "workspace";
  readonly sourceId: string;
  readonly relativePath: string;
  readonly raw: unknown;
  readonly contentHash: string;
}

const AGENTS_MD = "AGENTS.md";
const SETTINGS_JSON = "settings.json";
const COMMANDS_DIR = "commands";
const AGENTS_DIR = "agents";
const HOOKS_DIR = "hooks";
const HOOKS_JSON = "hooks.json";

/** Build a deterministic diagnostic for a single file failure. */
function diagnostic(
  source: "workspace",
  sourceId: string,
  filePath: string,
  code: string,
  message: string,
  recoverable: boolean,
  severity: "warning" | "error" | "info" = "warning"
): AIFetchlyConfigDiagnostic {
  return { severity, source, sourceId, filePath, code, message, recoverable };
}

/** IO error helper — used at the root + per-file catch sites. */
function ioDiagnostic(
  sourceId: string,
  filePath: string,
  err: unknown
): AIFetchlyConfigDiagnostic {
  return diagnostic(
    "workspace",
    sourceId,
    filePath,
    "scanner-io-error",
    `filesystem error scanning ${filePath}: ${(err as Error).message}`,
    true
  );
}

/**
 * Scanner class. Stateless across calls (no cached state). The watch
 * worker constructs one per scan; the main-process WorkspaceConfigScanner
 * (used by tests + the initial-load IPC) does the same.
 *
 * Construction is intentionally cheap; do not retain instances across
 * scans — the worker uses one scan() call per rescan.
 */
export class WorkspaceConfigScanner {
  async scan(
    input: WorkspaceConfigScanInput
  ): Promise<AIFetchlyConfigSnapshot> {
    const workspaceId = input.workspaceId;
    const workspaceRoot = input.workspaceRoot;
    const sourceId = `workspace:${workspaceId}`;
    const dotAifetchly = path.join(workspaceRoot, AIFETCHLY_CONFIG_DIR_NAME);

    const files: AIFetchlyConfigFileSnapshot[] = [];
    const instructions: AIFetchlyInstructionBlock[] = [];
    const commands: WorkspaceCommandDraft[] = [];
    const agents: WorkspaceAgentDraft[] = [];
    const hooks: WorkspaceHookDraft[] = [];
    const diagnostics: AIFetchlyConfigDiagnostic[] = [];
    const settings: AIFetchlyConfigSettings = {
      ...DEFAULT_AIFETCHLY_CONFIG_SETTINGS,
    };

    // 1. Scan .aifetchly/ if it exists.
    let dotAifetchlyExists = false;
    try {
      await fs.promises.access(dotAifetchly, fs.constants.R_OK);
      dotAifetchlyExists = true;
    } catch {
      dotAifetchlyExists = false;
    }

    if (dotAifetchlyExists) {
      await this.scanAifetchlyRoot(
        dotAifetchly,
        workspaceId,
        sourceId,
        files,
        instructions,
        commands,
        agents,
        hooks,
        diagnostics,
        settings
      );
    }

    // 2. Optional root AGENTS.md (separate from .aifetchly/AGENTS.md).
    if (input.includeRootAgentsFile) {
      await this.scanRootAgents(
        workspaceRoot,
        workspaceId,
        sourceId,
        files,
        instructions,
        diagnostics
      );
    }

    return {
      source: "workspace",
      sourceId,
      rootPath: workspaceRoot,
      workspaceId,
      version: 1,
      files,
      instructions,
      // The capability arrays are typed readonly unknown[] in Phase 13/14.
      // We carry the typed command drafts via a side channel is not feasible,
      // so we cast through unknown — the runtime shape is what matters for the
      // diff (id-keyed) and Plan 14-02's apply filter.
      commands: commands as readonly unknown[],
      // Phase 16 (Plan 02): raw WorkspaceAgentDrafts (worker-side, no
      // validation). Cast through unknown mirroring commands — the main-
      // process converter (buildWorkspaceAgentDefinitions, Task 3) validates.
      agents: agents as readonly unknown[],
      // Phase 17 (Plan 02): raw WorkspaceHookDrafts (worker-side, no
      // validation). Cast through unknown mirroring agents/commands — the
      // main-process converter (buildWorkspaceHookDefinitions) validates.
      hooks: hooks as readonly unknown[],
      skills: [],
      diagnostics,
    };
  }

  /**
   * Scan .aifetchly/{AGENTS.md, settings.json, commands/*.md, agents/*.md}.
   * NEVER throws — all per-file errors surface as recoverable diagnostics.
   */
  private async scanAifetchlyRoot(
    dotAifetchly: string,
    workspaceId: string,
    sourceId: string,
    files: AIFetchlyConfigFileSnapshot[],
    instructions: AIFetchlyInstructionBlock[],
    commands: WorkspaceCommandDraft[],
    agents: WorkspaceAgentDraft[],
    hooks: WorkspaceHookDraft[],
    diagnostics: AIFetchlyConfigDiagnostic[],
    settings: AIFetchlyConfigSettings
  ): Promise<void> {
    const rootRel = path.relative(path.dirname(dotAifetchly), dotAifetchly); // ".aifetchly"

    // AGENTS.md
    await this.tryReadInstructionFile(
      dotAifetchly,
      workspaceId,
      sourceId,
      AGENTS_MD,
      `${rootRel}/${AGENTS_MD}`,
      AIFETCHLY_CONFIG_LIMITS.agentsMdBytes,
      files,
      instructions,
      diagnostics
    );

    // settings.json
    await this.tryReadSettingsFile(
      dotAifetchly,
      sourceId,
      SETTINGS_JSON,
      `${rootRel}/${SETTINGS_JSON}`,
      settings,
      diagnostics
    );

    // commands/*.md
    await this.tryReadCommandFiles(
      dotAifetchly,
      workspaceId,
      sourceId,
      COMMANDS_DIR,
      `${rootRel}/${COMMANDS_DIR}`,
      files,
      commands,
      diagnostics
    );

    // agents/*.md (Phase 16 / Plan 02) — RAW drafts only; the worker does NOT
    // validate (WAT-02). buildWorkspaceAgentDefinitions validates main-side.
    await this.tryReadAgentFiles(
      dotAifetchly,
      workspaceId,
      sourceId,
      AGENTS_DIR,
      `${rootRel}/${AGENTS_DIR}`,
      files,
      agents,
      diagnostics
    );

    // hooks/hooks.json (Phase 17 / Plan 02) — ONE raw draft carrying the
    // JSON-parsed blob; the worker does NOT validate (WAT-02).
    // buildWorkspaceHookDefinitions validates main-side.
    await this.tryReadHookFiles(
      dotAifetchly,
      workspaceId,
      sourceId,
      HOOKS_DIR,
      `${rootRel}/${HOOKS_DIR}`,
      files,
      hooks,
      diagnostics
    );
  }

  /** Read AGENTS.md from the workspace root (only when includeRootAgentsFile=true). */
  private async scanRootAgents(
    workspaceRoot: string,
    workspaceId: string,
    sourceId: string,
    files: AIFetchlyConfigFileSnapshot[],
    instructions: AIFetchlyInstructionBlock[],
    diagnostics: AIFetchlyConfigDiagnostic[]
  ): Promise<void> {
    await this.tryReadInstructionFile(
      workspaceRoot,
      workspaceId,
      sourceId,
      AGENTS_MD,
      AGENTS_MD,
      AIFETCHLY_CONFIG_LIMITS.agentsMdBytes,
      files,
      instructions,
      diagnostics
    );
  }

  /**
   * Shared bounded-read pipeline for an instruction file (AGENTS.md).
   * Updates files[] + instructions[] on success; pushes a diagnostic on any
   * failure (size, path-safety, IO, parse). NEVER throws.
   */
  private async tryReadInstructionFile(
    parentDir: string,
    workspaceId: string,
    sourceId: string,
    name: string,
    relativePath: string,
    sizeLimit: number,
    files: AIFetchlyConfigFileSnapshot[],
    instructions: AIFetchlyInstructionBlock[],
    diagnostics: AIFetchlyConfigDiagnostic[]
  ): Promise<void> {
    // CFG-05 path safety — even though we built the path ourselves, route
    // it through the helper so any future caller mistake (e.g. an absolute
    // root) is caught structurally.
    const safe = resolveConfigRelativePath(parentDir, name);
    if (!safe.ok) {
      diagnostics.push(
        diagnostic(
          "workspace",
          sourceId,
          relativePath,
          "path-outside-root",
          `rejected AGENTS.md path: ${safe.reason}`,
          true
        )
      );
      return;
    }
    try {
      const abs = safe.absolutePath;
      const stat = await fs.promises.stat(abs);
      if (stat.size > sizeLimit) {
        diagnostics.push(
          diagnostic(
            "workspace",
            sourceId,
            relativePath,
            "file-too-large",
            `${relativePath} is ${stat.size} bytes which exceeds the ${sizeLimit}-byte limit; skipped`,
            true
          )
        );
        return;
      }
      const content = await fs.promises.readFile(abs);
      const contentHash = crypto
        .createHash("sha256")
        .update(content)
        .digest("hex");
      files.push({
        relativePath,
        kind: "instructions",
        mtimeMs: stat.mtimeMs,
        sizeBytes: stat.size,
        contentHash,
      });
      instructions.push({
        id: `workspace:${workspaceId}:instructions:${relativePath}`,
        source: "workspace",
        sourceId,
        label: "",
        relativePath,
        content: content.toString("utf8"),
        contentHash,
        // Workspace instructions are untrusted until Plan 14-02's
        // applyWorkspaceSnapshot(snapshot, trust) drop-filter runs in main.
        trusted: false,
      });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return; // missing is OK
      diagnostics.push(ioDiagnostic(sourceId, relativePath, err));
    }
  }

  /** Read + parse settings.json, merging over defaults (CFG-03). NEVER throws. */
  private async tryReadSettingsFile(
    parentDir: string,
    sourceId: string,
    name: string,
    relativePath: string,
    settings: AIFetchlyConfigSettings,
    diagnostics: AIFetchlyConfigDiagnostic[]
  ): Promise<void> {
    const safe = resolveConfigRelativePath(parentDir, name);
    if (!safe.ok) {
      diagnostics.push(
        diagnostic(
          "workspace",
          sourceId,
          relativePath,
          "path-outside-root",
          `rejected settings.json path: ${safe.reason}`,
          true
        )
      );
      return;
    }
    try {
      const abs = safe.absolutePath;
      const stat = await fs.promises.stat(abs);
      if (stat.size > AIFETCHLY_CONFIG_LIMITS.settingsJsonBytes) {
        diagnostics.push(
          diagnostic(
            "workspace",
            sourceId,
            relativePath,
            "file-too-large",
            `${relativePath} is ${stat.size} bytes which exceeds the ${AIFETCHLY_CONFIG_LIMITS.settingsJsonBytes}-byte limit; skipped`,
            true
          )
        );
        return;
      }
      const content = await fs.promises.readFile(abs);
      const text = content.toString("utf8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch (err) {
        diagnostics.push(
          diagnostic(
            "workspace",
            sourceId,
            relativePath,
            "settings-json-invalid",
            `${relativePath} is not valid JSON: ${(err as Error).message}`,
            true
          )
        );
        return;
      }
      // Best-effort merge over defaults — ignore non-boolean fields (mirror Phase 13 behaviour).
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const obj = parsed as Record<string, unknown>;
        const merged = { ...DEFAULT_AIFETCHLY_CONFIG_SETTINGS };
        for (const key of Object.keys(
          merged
        ) as (keyof AIFetchlyConfigSettings)[]) {
          const v = obj[key];
          if (typeof v === "boolean") {
            merged[key] = v;
          }
        }
        // Mutate the in-place settings object (caller passes a per-scan instance).
        Object.assign(settings, merged);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      diagnostics.push(ioDiagnostic(sourceId, relativePath, err));
    }
  }

  /**
   * Scan `commands/` for *.md files. Each file is parsed with the restricted
   * frontmatter parser (CFG-07 — no js-yaml). Phase 15 expands `$ARGUMENTS`
   * and tightens the command type; Phase 14 only persists raw frontmatter +
   * body, keyed by an id derived from the filename.
   *
   * NEVER throws — per-file failures push diagnostics and the scan continues.
   */
  private async tryReadCommandFiles(
    dotAifetchly: string,
    workspaceId: string,
    sourceId: string,
    commandsDirName: string,
    commandsRelativeDir: string,
    files: AIFetchlyConfigFileSnapshot[],
    commands: WorkspaceCommandDraft[],
    diagnostics: AIFetchlyConfigDiagnostic[]
  ): Promise<void> {
    const commandsDir = path.join(dotAifetchly, commandsDirName);
    let entries: readonly string[] | readonly fs.Dirent[];
    try {
      // Use withFileTypes for an accurate isDirectory check without a
      // follow-up stat per entry.
      entries = await fs.promises.readdir(commandsDir, { withFileTypes: true });
    } catch (err) {
      // Missing commands/ dir is the happy path (most workspaces have none).
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      diagnostics.push(ioDiagnostic(sourceId, commandsRelativeDir, err));
      return;
    }

    for (const entry of entries) {
      const name = entry.name;
      if (!name.endsWith(".md")) continue;
      // CFG-05: reject any `..` or absolute-seeming name.
      const safeRel = resolveConfigRelativePath(commandsDir, name);
      if (!safeRel.ok) {
        diagnostics.push(
          diagnostic(
            "workspace",
            sourceId,
            `${commandsRelativeDir}/${name}`,
            "path-outside-root",
            `rejected command path: ${safeRel.reason}`,
            true
          )
        );
        continue;
      }
      try {
        // `entry.isDirectory()` exists on Dirent; if the platform returns
        // strings (it shouldn't with withFileTypes), treat as file and let
        // stat catch it.
        if (typeof (entry as fs.Dirent).isDirectory === "function") {
          if ((entry as fs.Dirent).isDirectory()) continue;
        }
        const abs = safeRel.absolutePath;
        const stat = await fs.promises.stat(abs);
        if (stat.size > AIFETCHLY_CONFIG_LIMITS.commandMdBytes) {
          diagnostics.push(
            diagnostic(
              "workspace",
              sourceId,
              `${commandsRelativeDir}/${name}`,
              "file-too-large",
              `${name} is ${stat.size} bytes which exceeds the ${AIFETCHLY_CONFIG_LIMITS.commandMdBytes}-byte limit; skipped`,
              true
            )
          );
          continue;
        }
        const content = await fs.promises.readFile(abs);
        const contentHash = crypto
          .createHash("sha256")
          .update(content)
          .digest("hex");
        const relativePath = `${commandsRelativeDir}/${name}`;
        files.push({
          relativePath,
          kind: "command",
          mtimeMs: stat.mtimeMs,
          sizeBytes: stat.size,
          contentHash,
        });
        // CFG-07 restricted frontmatter parse. On failure, surface a
        // diagnostic and skip — but still keep the file in the files[] list
        // (CFG-06 hashing applies to the bytes, regardless of frontmatter).
        const text = content.toString("utf8");
        const parsed = parseRestrictedFrontmatter(text);
        if (parsed === null) {
          diagnostics.push(
            diagnostic(
              "workspace",
              sourceId,
              relativePath,
              "frontmatter-invalid",
              `${name} frontmatter failed restricted parse; treating as raw body`,
              true
            )
          );
        }
        const scalars: Record<string, string> = {};
        const arrays: Record<string, readonly string[]> = {};
        if (parsed) {
          for (const [k, v] of parsed.scalars) scalars[k] = v;
          for (const [k, v] of parsed.arrays) arrays[k] = v;
        }
        const cmdId = `workspace:${workspaceId}:command:${name.replace(
          /\.md$/i,
          ""
        )}`;
        commands.push({
          id: cmdId,
          source: "workspace",
          sourceId,
          relativePath,
          frontmatter: { ...scalars, ...arrays },
          body: parsed ? parsed.body : text,
          contentHash,
        });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
        diagnostics.push(
          ioDiagnostic(sourceId, `${commandsRelativeDir}/${name}`, err)
        );
      }
    }
  }

  /**
   * Phase 16 (Plan 02): scan `agents/` for *.md files and emit RAW
   * {@link WorkspaceAgentDraft}s. Mirrors {@link tryReadCommandFiles} with
   * two intentional differences:
   *   1. Size cap is `agentMdBytes` (128KB, CFG-04) and count cap is
   *      `maxAgentsPerSource` (100).
   *   2. NO validation runs here. The worker is scan-only (WAT-02): parsed
   *      frontmatter + body + hash are carried through unchanged, including
   *      drafts with invalid names or unknown tools. The main-process
   *      converter (buildWorkspaceAgentDefinitions, Task 3) calls
   *      buildAgentDefinition to validate; the trust filter in
   *      applyWorkspaceSnapshot drops untrusted workspace agents before they
   *      reach the registry.
   *
   * NEVER throws — per-file failures push diagnostics and the scan continues.
   * Imports ONLY pure helpers (parseRestrictedFrontmatter,
   * resolveConfigRelativePath, constants, diagnostic/ioDiagnostic) — no
   * Module/Model/registry/Electron/TypeORM (WAT-02 WorkerNoDbBoundary).
   */
  private async tryReadAgentFiles(
    dotAifetchly: string,
    workspaceId: string,
    sourceId: string,
    agentsDirName: string,
    agentsRelativeDir: string,
    files: AIFetchlyConfigFileSnapshot[],
    agents: WorkspaceAgentDraft[],
    diagnostics: AIFetchlyConfigDiagnostic[]
  ): Promise<void> {
    const agentsDir = path.join(dotAifetchly, agentsDirName);
    let entries: readonly string[] | readonly fs.Dirent[];
    try {
      entries = await fs.promises.readdir(agentsDir, { withFileTypes: true });
    } catch (err) {
      // Missing agents/ dir is the happy path (most workspaces have none).
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      diagnostics.push(ioDiagnostic(sourceId, agentsRelativeDir, err));
      return;
    }

    for (const entry of entries) {
      const name = entry.name;
      if (!name.endsWith(".md")) continue;
      // CFG-05: reject any `..` or absolute-seeming name.
      const safeRel = resolveConfigRelativePath(agentsDir, name);
      if (!safeRel.ok) {
        diagnostics.push(
          diagnostic(
            "workspace",
            sourceId,
            `${agentsRelativeDir}/${name}`,
            "path-outside-root",
            `rejected agent path: ${safeRel.reason}`,
            true
          )
        );
        continue;
      }
      try {
        if (typeof (entry as fs.Dirent).isDirectory === "function") {
          if ((entry as fs.Dirent).isDirectory()) continue;
        }
        // CFG-04: count cap — once maxAgentsPerSource drafts have been added,
        // skip the rest with a single diagnostic (mirrors commands cap).
        if (agents.length >= AIFETCHLY_CONFIG_LIMITS.maxAgentsPerSource) {
          diagnostics.push(
            diagnostic(
              "workspace",
              sourceId,
              `${agentsRelativeDir}/${name}`,
              "file-too-large",
              `agent count reached the ${AIFETCHLY_CONFIG_LIMITS.maxAgentsPerSource}-file cap; skipping remaining files`,
              true
            )
          );
          break;
        }
        const abs = safeRel.absolutePath;
        const stat = await fs.promises.stat(abs);
        if (stat.size > AIFETCHLY_CONFIG_LIMITS.agentMdBytes) {
          diagnostics.push(
            diagnostic(
              "workspace",
              sourceId,
              `${agentsRelativeDir}/${name}`,
              "file-too-large",
              `${name} is ${stat.size} bytes which exceeds the ${AIFETCHLY_CONFIG_LIMITS.agentMdBytes}-byte limit; skipped`,
              true
            )
          );
          continue;
        }
        const content = await fs.promises.readFile(abs);
        const contentHash = crypto
          .createHash("sha256")
          .update(content)
          .digest("hex");
        const relativePath = `${agentsRelativeDir}/${name}`;
        files.push({
          relativePath,
          kind: "agent",
          mtimeMs: stat.mtimeMs,
          sizeBytes: stat.size,
          contentHash,
        });
        // CFG-07 restricted frontmatter parse. On failure, surface a
        // diagnostic and carry the raw text as the body — the draft still
        // flows through (validation is main-process; the converter drops it
        // if the frontmatter is unusable).
        const text = content.toString("utf8");
        const parsed = parseRestrictedFrontmatter(text);
        if (parsed === null) {
          diagnostics.push(
            diagnostic(
              "workspace",
              sourceId,
              relativePath,
              "frontmatter-invalid",
              `${name} frontmatter failed restricted parse; carrying raw body`,
              true
            )
          );
        }
        const scalars: Record<string, string> = {};
        const arrays: Record<string, readonly string[]> = {};
        if (parsed) {
          for (const [k, v] of parsed.scalars) scalars[k] = v;
          for (const [k, v] of parsed.arrays) arrays[k] = v;
        }
        const agentId = `workspace:${workspaceId}:agent:${name.replace(
          /\.md$/i,
          ""
        )}`;
        agents.push({
          id: agentId,
          source: "workspace",
          sourceId,
          relativePath,
          frontmatter: { ...scalars, ...arrays },
          body: parsed ? parsed.body : text,
          contentHash,
        });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
        diagnostics.push(
          ioDiagnostic(sourceId, `${agentsRelativeDir}/${name}`, err)
        );
      }
    }
  }

  /**
   * Phase 17 (Plan 02): read the SINGLE `<dotAifetchly>/hooks/hooks.json`
   * file, JSON.parse it, and push ONE raw {@link WorkspaceHookDraft} carrying
   * the parsed blob (opaque `unknown`). SCAN-ONLY — the worker performs NO
   * schema validation, NO count cap, NO array-shape check (WAT-02). The main-
   * process converter (buildWorkspaceHookDefinitions) owns all validation.
   *
   * CFG-04 size cap + CFG-05 path safety are enforced here (they are I/O-level
   * protections, not schema validation). Missing hooks/hooks.json is the happy
   * path — no diagnostic. Mirrors {@link tryReadAgentFiles} for a single file.
   */
  private async tryReadHookFiles(
    dotAifetchly: string,
    workspaceId: string,
    sourceId: string,
    hooksDirName: string,
    hooksRelativeDir: string,
    files: AIFetchlyConfigFileSnapshot[],
    hooks: WorkspaceHookDraft[],
    diagnostics: AIFetchlyConfigDiagnostic[]
  ): Promise<void> {
    const hooksFile = path.join(dotAifetchly, hooksDirName, HOOKS_JSON);
    const relativePath = `${hooksRelativeDir}/${HOOKS_JSON}`;

    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(hooksFile);
    } catch (err) {
      // Missing hooks/hooks.json is the happy path (most workspaces have none).
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      diagnostics.push(ioDiagnostic(sourceId, relativePath, err));
      return;
    }

    // CFG-04: size cap before read (T-13-DoS mitigation).
    if (stat.size > AIFETCHLY_CONFIG_LIMITS.hooksJsonBytes) {
      diagnostics.push(
        diagnostic(
          "workspace",
          sourceId,
          relativePath,
          "file-too-large",
          `${HOOKS_JSON} is ${stat.size} bytes which exceeds the ${AIFETCHLY_CONFIG_LIMITS.hooksJsonBytes}-byte limit; skipped`,
          true
        )
      );
      return;
    }

    let content: Buffer;
    try {
      content = await fs.promises.readFile(hooksFile);
    } catch (err) {
      diagnostics.push(ioDiagnostic(sourceId, relativePath, err));
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

    // SCAN-ONLY: JSON.parse and ship the opaque blob. A parse failure is
    // carried as a raw draft with `raw = null` so the main-side converter can
    // still emit a hooks-json-invalid diagnostic with full source attribution;
    // the worker never decides validity (WAT-02).
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(content.toString("utf8")) as unknown;
    } catch {
      parsed = null;
    }

    hooks.push({
      id: `workspace:${workspaceId}:hooks`,
      source: "workspace",
      sourceId,
      relativePath,
      raw: parsed,
      contentHash,
    });
  }
}
