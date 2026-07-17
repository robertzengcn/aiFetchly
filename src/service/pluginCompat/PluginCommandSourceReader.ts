// src/service/pluginCompat/PluginCommandSourceReader.ts
// Plugin + Claude-compatible prompt command loader (PRD §8.2, §10; design §10).
//
// Reads a plugin's prompt commands from TWO sources and returns validated
// SlashCommandDefinitions + diagnostics:
//   1. Native physical `<installPath>/commands/*.md` (every format).
//   2. Claude manifest `commands` declarations (string / string[] / object map
//      with `source` or inline `content`). `true` auto-detects the directory,
//      which source #1 already covers, so it adds nothing.
//
// Native files are STRICT: they must declare `type: prompt` and a valid name
// (buildPromptCommandDefinition rejects otherwise). Claude-sourced commands
// (path files + inline content) are LENIENT: missing fields fall back to the
// mapping key / entry description and `type` is forced to `prompt`, because
// Claude command files commonly omit them (design §10.4, §17.2). A Claude
// command that explicitly declares an execution type (local/local-jsx/shell)
// is skipped with `claude-format-unsupported-feature`.
//
// SECURITY (design §11.4, §14.5):
//   - All file paths resolve through resolvePluginRelativePath (path traversal
//     blocked lexically AND via symlink realpath check).
//   - Inline `content` never touches the filesystem — it is parsed as a virtual
//     command body.
//   - Every draft is validated through buildPromptCommandDefinition and expanded
//     purely as text at dispatch time. No command code is executed here.

import * as fs from "fs";
import * as path from "path";
import {
  resolvePluginRelativePath,
  type PluginCommandDeclarationEntry,
  type PluginManifest,
} from "@/entityTypes/pluginTypes";
import { getClaudeCommandDeclaration } from "@/service/pluginCompat/ClaudePluginAdapter";
import {
  frontmatterRecord,
  parseRestrictedFrontmatter,
} from "@/service/aifetchlyConfig/AIFetchlyConfigMarkdown";
import { AIFETCHLY_CONFIG_LIMITS } from "@/service/aifetchlyConfig/AIFetchlyConfigConstants";
import {
  buildPromptCommandDefinition,
  type PromptCommandDraft,
  type PromptCommandSourceMeta,
} from "@/service/slashCommands/promptCommandFrontmatter";
import type { AIFetchlyConfigDiagnostic } from "@/entityTypes/aifetchlyConfigTypes";
import type { SlashCommandDefinition } from "@/entityTypes/slashCommandTypes";

export interface PluginCommandSourceReadInput {
  readonly pluginName: string;
  readonly installPath: string;
  readonly manifest: PluginManifest;
}

export interface PluginCommandSourceReadResult {
  readonly definitions: readonly SlashCommandDefinition[];
  readonly diagnostics: readonly AIFetchlyConfigDiagnostic[];
}

/** Where a raw draft came from — drives strict vs lenient normalization. */
type DraftKind = "native" | "claude-file" | "claude-inline";

/** A raw command markdown body + optional fallback identity, pre-validation. */
interface RawCommandDraft {
  readonly content: string;
  readonly relativePath: string;
  /** Resolved absolute path for file-sourced drafts (for dedup); undefined for inline. */
  readonly absPath?: string;
  readonly kind: DraftKind;
  readonly fallbackName?: string;
  readonly fallbackDescription?: string;
}

/** Command types that imply execution / UI behavior AiFetchly does not run. */
const UNSUPPORTED_COMMAND_TYPES = new Set(["local", "local-jsx", "shell"]);

function diag(
  sourceId: string,
  filePath: string,
  code: string,
  message: string
): AIFetchlyConfigDiagnostic {
  return {
    severity: "warning",
    source: "plugin",
    sourceId,
    filePath,
    code,
    message,
    recoverable: true,
  };
}

function ioDiag(
  sourceId: string,
  filePath: string,
  err: unknown
): AIFetchlyConfigDiagnostic {
  return diag(
    sourceId,
    filePath,
    "scanner-io-error",
    `unexpected error reading ${filePath}: ${(err as Error).message}`
  );
}

/** Return the value only when it is a non-empty string. */
function stringOr(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Read all prompt commands for a plugin. Native `commands/*.md` is always read;
 * Claude manifest declarations are read on top when present. The same file
 * referenced twice (e.g. native dir + manifest path) is silently deduplicated
 * by source; distinct declarations that collapse to the same command id keep
 * the first and emit a duplicate diagnostic (design §17.3).
 */
export class PluginCommandSourceReader {
  static async read(
    input: PluginCommandSourceReadInput
  ): Promise<PluginCommandSourceReadResult> {
    const sourceMeta: PromptCommandSourceMeta = {
      source: "plugin",
      sourceId: `plugin:${input.pluginName}`,
      sourceLabel: "Plugin",
      requiresTrust: false,
    };
    const sourceId = sourceMeta.sourceId;
    const diagnostics: AIFetchlyConfigDiagnostic[] = [];
    const rawDrafts: RawCommandDraft[] = [];

    rawDrafts.push(
      ...(await readNativeCommandFiles(input.installPath, sourceId, diagnostics))
    );
    rawDrafts.push(
      ...(await readClaudeCommandDeclarations(input, sourceId, diagnostics))
    );

    const definitions: SlashCommandDefinition[] = [];
    const seenSources = new Set<string>();
    const seenIds = new Set<string>();

    for (const raw of rawDrafts) {
      // Level-1 dedup: same file/content declared twice -> silent skip.
      const sourceKey = raw.absPath ?? raw.relativePath;
      if (seenSources.has(sourceKey)) continue;
      seenSources.add(sourceKey);

      const normalized = normalizeRawDraft(raw, sourceId, diagnostics);
      if (!normalized) continue;

      const result = buildPromptCommandDefinition(normalized, sourceMeta);
      if (!result.ok) {
        diagnostics.push(result.diagnostic);
        continue;
      }
      // Level-2 dedup: distinct sources, same command id -> keep first, warn.
      if (seenIds.has(result.definition.id)) {
        diagnostics.push(
          diag(
            sourceId,
            raw.relativePath,
            "frontmatter-invalid",
            `Duplicate command id '${result.definition.id}' in plugin '${input.pluginName}'; keeping the first declaration and skipping the rest.`
          )
        );
        continue;
      }
      seenIds.add(result.definition.id);
      definitions.push(result.definition);
    }

    return { definitions, diagnostics };
  }
}

// --- Native commands/*.md ----------------------------------------------------

async function readNativeCommandFiles(
  installPath: string,
  sourceId: string,
  diagnostics: AIFetchlyConfigDiagnostic[]
): Promise<RawCommandDraft[]> {
  const absDir = path.join(installPath, "commands");
  if (!fs.existsSync(absDir)) return [];
  return readMarkdownDir(absDir, "commands", "native", {}, sourceId, diagnostics);
}

// --- Claude manifest declarations --------------------------------------------

async function readClaudeCommandDeclarations(
  input: PluginCommandSourceReadInput,
  sourceId: string,
  diagnostics: AIFetchlyConfigDiagnostic[]
): Promise<RawCommandDraft[]> {
  const declaration = getClaudeCommandDeclaration(input.manifest);
  // undefined (no commands field) or true (auto-detect dir, already covered by
  // the native read) add no extra drafts.
  if (declaration === undefined || declaration === true) return [];

  const out: RawCommandDraft[] = [];

  if (typeof declaration === "string") {
    out.push(
      ...(await collectFromDeclarationPath(
        declaration,
        {},
        input.installPath,
        sourceId,
        diagnostics
      ))
    );
    return out;
  }

  if (Array.isArray(declaration)) {
    for (const entry of declaration) {
      if (typeof entry === "string") {
        out.push(
          ...(await collectFromDeclarationPath(
            entry,
            {},
            input.installPath,
            sourceId,
            diagnostics
          ))
        );
      } else {
        diagnostics.push(
          diag(
            sourceId,
            "commands",
            "claude-frontmatter-invalid",
            `Commands array entry is not a string path; skipped.`
          )
        );
      }
    }
    return out;
  }

  if (typeof declaration === "object" && declaration !== null) {
    for (const [key, entry] of Object.entries(declaration)) {
      const e = entry as PluginCommandDeclarationEntry | undefined;
      const fallbacks = {
        fallbackName: key,
        fallbackDescription: stringOr(e?.description),
      };
      const hasSource = stringOr(e?.source) !== undefined;
      const hasContent = typeof e?.content === "string";
      if (hasSource && hasContent) {
        diagnostics.push(
          diag(
            sourceId,
            key,
            "claude-frontmatter-invalid",
            `Command '${key}' declares both source and content; choose one.`
          )
        );
        continue;
      }
      if (hasSource) {
        out.push(
          ...(await collectFromDeclarationPath(
            e!.source!,
            fallbacks,
            input.installPath,
            sourceId,
            diagnostics
          ))
        );
        continue;
      }
      if (hasContent) {
        // Inline content never touches the filesystem.
        out.push({
          content: e!.content!,
          relativePath: `<inline:${input.pluginName}:${key}>`,
          kind: "claude-inline",
          ...fallbacks,
        });
        continue;
      }
      diagnostics.push(
        diag(
          sourceId,
          key,
          "frontmatter-invalid",
          `Command '${key}' declares neither source nor content; skipped.`
        )
      );
    }
    return out;
  }

  diagnostics.push(
    diag(
      sourceId,
      "commands",
      "claude-frontmatter-invalid",
      `Unsupported Claude 'commands' declaration shape; skipped.`
    )
  );
  return out;
}

/** Resolve a manifest-declared relative path and collect markdown drafts. */
async function collectFromDeclarationPath(
  relPath: string,
  fallbacks: {
    readonly fallbackName?: string;
    readonly fallbackDescription?: string;
  },
  installPath: string,
  sourceId: string,
  diagnostics: AIFetchlyConfigDiagnostic[]
): Promise<RawCommandDraft[]> {
  let abs: string;
  try {
    abs = resolvePluginRelativePath(installPath, relPath);
  } catch {
    diagnostics.push(
      diag(
        sourceId,
        relPath,
        "path-outside-plugin",
        `Command path "${relPath}" escapes the plugin directory.`
      )
    );
    return [];
  }
  try {
    const stat = await fs.promises.stat(abs);
    if (stat.isDirectory()) {
      return readMarkdownDir(
        abs,
        relPath,
        "claude-file",
        fallbacks,
        sourceId,
        diagnostics
      );
    }
    const draft = await readMarkdownFile(
      abs,
      relPath,
      "claude-file",
      fallbacks,
      sourceId,
      diagnostics
    );
    return draft ? [draft] : [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      diagnostics.push(
        diag(
          sourceId,
          relPath,
          "scanner-io-error",
          `Command path "${relPath}" does not exist.`
        )
      );
      return [];
    }
    diagnostics.push(ioDiag(sourceId, relPath, err));
    return [];
  }
}

async function readMarkdownDir(
  absDir: string,
  relDir: string,
  kind: DraftKind,
  fallbacks: {
    readonly fallbackName?: string;
    readonly fallbackDescription?: string;
  },
  sourceId: string,
  diagnostics: AIFetchlyConfigDiagnostic[]
): Promise<RawCommandDraft[]> {
  const out: RawCommandDraft[] = [];
  let entries: string[];
  try {
    entries = await fs.promises.readdir(absDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return out;
    diagnostics.push(ioDiag(sourceId, relDir, err));
    return out;
  }
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const abs = path.join(absDir, entry);
    const rel = `${relDir}/${entry}`;
    const draft = await readMarkdownFile(
      abs,
      rel,
      kind,
      fallbacks,
      sourceId,
      diagnostics
    );
    if (draft) out.push(draft);
  }
  return out;
}

async function readMarkdownFile(
  abs: string,
  rel: string,
  kind: DraftKind,
  fallbacks: {
    readonly fallbackName?: string;
    readonly fallbackDescription?: string;
  },
  sourceId: string,
  diagnostics: AIFetchlyConfigDiagnostic[]
): Promise<RawCommandDraft | null> {
  try {
    const stat = await fs.promises.stat(abs);
    if (!stat.isFile()) return null;
    if (stat.size > AIFETCHLY_CONFIG_LIMITS.commandMdBytes) {
      diagnostics.push(
        diag(
          sourceId,
          rel,
          "file-too-large",
          `${rel} is ${stat.size} bytes which exceeds the ${AIFETCHLY_CONFIG_LIMITS.commandMdBytes}-byte limit; skipped.`
        )
      );
      return null;
    }
    const content = await fs.promises.readFile(abs, "utf8");
    return {
      content,
      relativePath: rel,
      absPath: abs,
      kind,
      ...fallbacks,
    };
  } catch (err) {
    diagnostics.push(ioDiag(sourceId, rel, err));
    return null;
  }
}

// --- Normalization (design §17.2) --------------------------------------------

/**
 * Turn a raw command markdown draft into a CMD-06 prompt-command draft, or
 * return null with a diagnostic.
 *
 * Native drafts are strict: frontmatter is required and the validator enforces
 * `type: prompt` + a valid name (no fallbacks). Claude drafts are lenient:
 * missing frontmatter is tolerated for inline content, missing name/description
 * fall back to the mapping key / entry description, and `type` is forced to
 * `prompt` — UNLESS the frontmatter explicitly declares an unsupported
 * execution type (local/local-jsx/shell), which is skipped with
 * `claude-format-unsupported-feature`.
 */
function normalizeRawDraft(
  raw: RawCommandDraft,
  sourceId: string,
  diagnostics: AIFetchlyConfigDiagnostic[]
): PromptCommandDraft | null {
  const parsed = parseRestrictedFrontmatter(raw.content);
  // Real files (native + Claude path declarations) MUST start with valid
  // frontmatter. Inline content may legitimately omit it.
  if (!parsed && raw.kind !== "claude-inline") {
    diagnostics.push(
      diag(
        sourceId,
        raw.relativePath,
        "frontmatter-unparseable",
        `${raw.relativePath} has malformed or missing restricted frontmatter; skipped.`
      )
    );
    return null;
  }
  const fm: Record<string, string | readonly string[]> = parsed
    ? frontmatterRecord(parsed)
    : {};
  const body = parsed ? parsed.body : raw.content;

  // Native drafts: pass through strict — let buildPromptCommandDefinition own
  // all validation (type, name, description). No forcing, no fallbacks.
  if (raw.kind === "native") {
    return { relativePath: raw.relativePath, body, frontmatter: fm };
  }

  // Claude drafts: skip explicitly-declared unsupported execution types.
  const rawType = typeof fm.type === "string" ? (fm.type as string) : undefined;
  if (rawType !== undefined && rawType !== "prompt") {
    const code = UNSUPPORTED_COMMAND_TYPES.has(rawType)
      ? "claude-format-unsupported-feature"
      : "frontmatter-invalid";
    diagnostics.push(
      diag(
        sourceId,
        raw.relativePath,
        code,
        `Command '${raw.fallbackName ?? raw.relativePath}' declares type '${rawType}'; only 'prompt' commands are supported.`
      )
    );
    return null;
  }

  const frontmatter: Record<string, string | readonly string[]> = { ...fm };
  frontmatter.type = "prompt";
  if (!stringOr(frontmatter.name) && raw.fallbackName) {
    frontmatter.name = raw.fallbackName;
  }
  if (!stringOr(frontmatter.description) && raw.fallbackDescription) {
    frontmatter.description = raw.fallbackDescription;
  }
  const argumentHint =
    stringOr(frontmatter.argumentHint) ??
    stringOr(frontmatter["argument-hint"]);
  if (argumentHint !== undefined) {
    frontmatter.argumentHint = argumentHint;
  }

  return { relativePath: raw.relativePath, body, frontmatter };
}
