/**
 * AIFetchlyConfigLoader — CFG-01 / CFG-03 / CFG-04 / CFG-06 / DX-01.
 *
 * Async bounded scanner for the global ~/.aifetchly config folder. Resolves
 * the root via os.homedir() + AIFETCHLY_CONFIG_DIR_NAME (NEVER Electron
 * userData — CFG-01), enforces per-file-type size limits before reading
 * (CFG-04, T-13-DoS), hashes content with SHA-256 (CFG-06), validates
 * settings.json against a zod schema with graceful fallback to defaults
 * (CFG-03), and emits diagnostics using the stable code tuple (DX-01).
 *
 * Pipeline (per design §6.4 phase-1 list):
 *   fs.readdir -> for each well-known file:
 *     fs.stat (size limit) -> fs.readFile (bounded) ->
 *       AGENTS.md: crypto.createHash('sha256') + AIFetchlyInstructionBlock
 *       settings.json: JSON.parse + zod safeParse + merge over defaults
 *
 * Hard invariants:
 *   - All filesystem operations use fs.promises (async). The acceptance grep
 *     `grep -n "readFileSync|statSync|readdirSync"` must return nothing.
 *   - scanGlobalRoot NEVER throws; unexpected IO errors surface as
 *     recoverable "scanner-io-error" diagnostics and the scan continues.
 *   - Missing global folder is the happy path on a fresh install: empty
 *     snapshot, NO diagnostic.
 *   - The commands/agents/hooks/skills arrays are EMPTY in phase 13 (phase
 *     15+ populates commands; phase 16 agents; etc.). The type is stable.
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
import { lazySchema } from "@/utils/lazySchema";
import {
  AIFETCHLY_CONFIG_DIR_NAME,
  AIFETCHLY_CONFIG_LIMITS,
  DEFAULT_AIFETCHLY_CONFIG_SETTINGS,
} from "./AIFetchlyConfigConstants";

// Phase-13 discovery list (design §6.4). Workspace-scanned files (phase 14+)
// will route through resolveConfigRelativePath + parseRestrictedFrontmatter;
// the global loader only needs the two well-known literals below.
const AGENTS_MD = "AGENTS.md";
const SETTINGS_JSON = "settings.json";

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

export class AIFetchlyConfigLoader {
  private readonly rootPath: string;
  private settings: AIFetchlyConfigSettings = {
    ...DEFAULT_AIFETCHLY_CONFIG_SETTINGS,
  };

  /**
   * @param rootPath Optional override for the config root (tests). Defaults
   * to path.join(os.homedir(), AIFETCHLY_CONFIG_DIR_NAME) per CFG-01.
   */
  constructor(rootPath?: string) {
    this.rootPath =
      rootPath ?? path.join(os.homedir(), AIFETCHLY_CONFIG_DIR_NAME);
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

    return this.buildSnapshot(
      source,
      sourceId,
      files,
      instructions,
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
    diagnostics: readonly AIFetchlyConfigDiagnostic[]
  ): AIFetchlyConfigSnapshot {
    return {
      source,
      sourceId,
      rootPath: this.rootPath,
      version: 1,
      files,
      instructions,
      commands: [],
      agents: [],
      hooks: [],
      skills: [],
      diagnostics,
    };
  }
}
