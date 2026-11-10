// src/service/pluginCompat/PluginCommandSourceReader.ts
// Plugin + Claude-compatible prompt command loader (PRD §8.2, §10; design §10).
//
// Reads a plugin's prompt commands from format-specific sources and returns
// validated SlashCommandDefinitions + diagnostics:
//   1. Native physical `<installPath>/commands/*.md` for AiFetchly plugins.
//   2. Claude manifest `commands` declarations (string / string[] / object map
//      with `source` or inline `content`). `true` or a missing declaration
//      auto-detects the conventional root `commands/` directory.
//   3. Claude user-invocable skills (`skills/<name>/SKILL.md`). Claude Code
//      exposes these as slash commands (`/blog` from `name: blog`). Skills
//      with `user-invocable: false` stay model-only and are not registered.
//
// Native files are STRICT: they must declare `type: prompt` and a valid name
// (buildPromptCommandDefinition rejects otherwise). Claude-sourced commands
// (path files + inline content) are LENIENT: missing fields fall back to the
// mapping key, filename, entry description, and `type` is forced to `prompt`,
// because Claude command files commonly omit them (design §10.4, §17.2). A
// Claude command that explicitly declares an execution type
// (local/local-jsx/shell) is skipped with `claude-format-unsupported-feature`.
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
import { parseFrontmatter as parseClaudeFrontmatter } from "@/service/pluginCompat/claudeFrontmatterParser";
import {
  frontmatterRecord,
  parseRestrictedFrontmatter,
} from "@/service/aifetchlyConfig/AIFetchlyConfigMarkdown";
import { AIFETCHLY_CONFIG_LIMITS, COMMAND_NAME_REGEX } from "@/service/aifetchlyConfig/AIFetchlyConfigConstants";
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
 * Read all prompt commands for a plugin. Native `commands/*.md` is read for
 * AiFetchly plugins. Claude plugins use Claude command declarations, with
 * `commands/` auto-detected when the declaration is missing or `true`, so
 * Claude-style command files can omit AiFetchly-only frontmatter. The same file
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

    if (input.manifest.format === "claude") {
      rawDrafts.push(
        ...(await readClaudeCommandDeclarations(input, sourceId, diagnostics))
      );
    } else {
      rawDrafts.push(
        ...(await readNativeCommandFiles(
          input.installPath,
          sourceId,
          diagnostics
        ))
      );
    }

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

    if (input.manifest.format === "claude") {
      const skillCommands = await readClaudeSkillSlashCommands(
        input,
        sourceMeta,
        diagnostics
      );
      for (const definition of skillCommands) {
        if (definitions.length >= AIFETCHLY_CONFIG_LIMITS.maxCommandsPerSource) {
          diagnostics.push(
            diag(
              sourceId,
              "skills",
              "frontmatter-invalid",
              `Plugin '${input.pluginName}' reached the ${AIFETCHLY_CONFIG_LIMITS.maxCommandsPerSource}-command cap; remaining skills were not registered as slash commands.`
            )
          );
          break;
        }
        if (seenIds.has(definition.id)) {
          diagnostics.push(
            diag(
              sourceId,
              definition.id,
              "frontmatter-invalid",
              `Duplicate command id '${definition.id}' in plugin '${input.pluginName}'; keeping the command file and skipping the skill.`
            )
          );
          continue;
        }
        seenIds.add(definition.id);
        definitions.push(definition);
      }
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
  if (declaration === undefined || declaration === true) {
    return readClaudeAutoDetectedCommandFiles(
      input.installPath,
      sourceId,
      diagnostics
    );
  }

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

async function readClaudeAutoDetectedCommandFiles(
  installPath: string,
  sourceId: string,
  diagnostics: AIFetchlyConfigDiagnostic[]
): Promise<RawCommandDraft[]> {
  const absDir = path.join(installPath, "commands");
  if (!fs.existsSync(absDir)) return [];
  return readMarkdownDir(
    absDir,
    "commands",
    "claude-file",
    {},
    sourceId,
    diagnostics
  );
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
    const fallbackName =
      fallbacks.fallbackName ??
      (kind === "claude-file" ? path.basename(rel, ".md") : undefined);
    return {
      content,
      relativePath: rel,
      absPath: abs,
      kind,
      fallbackName,
      fallbackDescription: fallbacks.fallbackDescription,
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
 * missing frontmatter is tolerated for inline content, missing
 * name/description fall back to the mapping key, filename, or entry
 * description, and `type` is forced to `prompt` — UNLESS the frontmatter
 * explicitly declares an unsupported
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

// --- Claude skills as slash commands ----------------------------------------
//
// Claude Code's getPluginSkills() turns every user-invocable SKILL.md into a
// prompt slash command. The lookup name is the frontmatter `name` (so
// skills/blog/SKILL.md with `name: blog` is `/blog`). `user-invocable: false`
// stays hidden. Explicit commands/*.md entries win when the ids collide.

function claudeSkillPaths(manifest: PluginManifest): readonly string[] {
  if (manifest.skills === undefined) return ["skills/"];
  return manifest.skills;
}

function isUserInvocable(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return !/^(false|no|0)$/i.test(value.trim());
  }
  return true;
}

function clipText(value: string, max: number): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length <= max) return trimmed;
  if (max <= 1) return trimmed.slice(0, max);
  return `${trimmed.slice(0, max - 1)}…`;
}

function clipHint(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max);
}

function substituteSkillPaths(
  body: string,
  pluginRoot: string,
  skillDir: string
): string {
  const normalize = (p: string): string => p.replace(/\\/g, "/");
  const root = normalize(pluginRoot);
  const dir = normalize(skillDir);
  return body
    .replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, root)
    .replace(/\$\{CLAUDE_SKILL_DIR\}/g, dir)
    .replace(/\$\{AIFETCHLY_SKILL_DIR\}/g, dir);
}

async function readClaudeSkillSlashCommands(
  input: PluginCommandSourceReadInput,
  sourceMeta: PromptCommandSourceMeta,
  diagnostics: AIFetchlyConfigDiagnostic[]
): Promise<SlashCommandDefinition[]> {
  const definitions: SlashCommandDefinition[] = [];
  const files = await collectClaudeSkillFiles(
    input.installPath,
    claudeSkillPaths(input.manifest),
    sourceMeta.sourceId,
    diagnostics
  );

  for (const file of files) {
    const definition = skillFileToCommand(
      file,
      input.installPath,
      sourceMeta,
      diagnostics
    );
    if (!definition) continue;
    if (definitions.some((existing) => existing.id === definition.id)) {
      diagnostics.push(
        diag(
          sourceMeta.sourceId,
          file.rel,
          "frontmatter-invalid",
          `Duplicate command id '${definition.id}' in plugin '${input.pluginName}'; keeping the first skill and skipping the rest.`
        )
      );
      continue;
    }
    definitions.push(definition);
  }
  return definitions;
}

interface SkillMarkdownFile {
  readonly abs: string;
  readonly rel: string;
  readonly skillDir: string;
  readonly dirName: string;
}

async function collectClaudeSkillFiles(
  installPath: string,
  skillPaths: readonly string[],
  sourceId: string,
  diagnostics: AIFetchlyConfigDiagnostic[]
): Promise<SkillMarkdownFile[]> {
  const out: SkillMarkdownFile[] = [];
  const seen = new Set<string>();

  for (const skillPath of skillPaths) {
    if (typeof skillPath !== "string" || skillPath.length === 0) continue;
    let abs: string;
    try {
      abs = resolvePluginRelativePath(installPath, skillPath);
    } catch {
      diagnostics.push(
        diag(
          sourceId,
          skillPath,
          "path-outside-plugin",
          `Skill path "${skillPath}" escapes the plugin directory.`
        )
      );
      continue;
    }

    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(abs);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      diagnostics.push(ioDiag(sourceId, skillPath, err));
      continue;
    }

    const found: Array<{ abs: string; rel: string }> = [];
    if (stat.isDirectory()) {
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(abs, { withFileTypes: true });
      } catch (err) {
        diagnostics.push(ioDiag(sourceId, skillPath, err));
        continue;
      }
      const relDir = skillPath.replace(/\/$/, "");
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const candidate = path.join(abs, entry.name, "SKILL.md");
        try {
          const candidateStat = await fs.promises.stat(candidate);
          if (!candidateStat.isFile()) continue;
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
          diagnostics.push(
            ioDiag(sourceId, `${relDir}/${entry.name}/SKILL.md`, err)
          );
          continue;
        }
        found.push({
          abs: candidate,
          rel: `${relDir}/${entry.name}/SKILL.md`,
        });
      }
      const direct = path.join(abs, "SKILL.md");
      try {
        const directStat = await fs.promises.stat(direct);
        if (directStat.isFile()) {
          found.push({ abs: direct, rel: `${relDir}/SKILL.md` });
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          diagnostics.push(ioDiag(sourceId, `${relDir}/SKILL.md`, err));
        }
      }
    } else if (stat.isFile()) {
      found.push({ abs, rel: skillPath });
    }

    for (const file of found) {
      if (seen.has(file.abs)) continue;
      seen.add(file.abs);
      out.push({
        abs: file.abs,
        rel: file.rel,
        skillDir: path.dirname(file.abs),
        dirName: path.basename(path.dirname(file.abs)),
      });
    }
  }

  out.sort((a, b) => a.rel.localeCompare(b.rel));
  return out;
}

function skillFileToCommand(
  file: SkillMarkdownFile,
  pluginRoot: string,
  sourceMeta: PromptCommandSourceMeta,
  diagnostics: AIFetchlyConfigDiagnostic[]
): SlashCommandDefinition | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file.abs);
  } catch (err) {
    diagnostics.push(ioDiag(sourceMeta.sourceId, file.rel, err));
    return null;
  }
  if (stat.size > AIFETCHLY_CONFIG_LIMITS.agentsMdBytes) {
    diagnostics.push(
      diag(
        sourceMeta.sourceId,
        file.rel,
        "file-too-large",
        `${file.rel} is ${stat.size} bytes which exceeds the ${AIFETCHLY_CONFIG_LIMITS.agentsMdBytes}-byte limit; skipped.`
      )
    );
    return null;
  }

  let content: string;
  try {
    content = fs.readFileSync(file.abs, "utf8");
  } catch (err) {
    diagnostics.push(ioDiag(sourceMeta.sourceId, file.rel, err));
    return null;
  }

  const parsed = parseClaudeFrontmatter(content);
  if (!isUserInvocable(parsed.frontmatter["user-invocable"])) {
    return null;
  }

  const rawName =
    typeof parsed.frontmatter.name === "string" &&
    parsed.frontmatter.name.length > 0
      ? parsed.frontmatter.name
      : file.dirName;
  const name = rawName.trim().toLowerCase();
  if (!COMMAND_NAME_REGEX.test(name)) {
    diagnostics.push(
      diag(
        sourceMeta.sourceId,
        file.rel,
        "command-name-invalid",
        `Skill '${file.rel}' name '${rawName}' is not a valid slash command name.`
      )
    );
    return null;
  }

  const rawDescription =
    typeof parsed.frontmatter.description === "string"
      ? parsed.frontmatter.description
      : "";
  const description = clipText(
    rawDescription.length > 0 ? rawDescription : `Plugin skill ${name}`,
    AIFETCHLY_CONFIG_LIMITS.commandDescriptionLength
  );

  const rawHint = parsed.frontmatter["argument-hint"];
  const argumentHint =
    typeof rawHint === "string" && rawHint.trim().length > 0
      ? clipHint(rawHint, AIFETCHLY_CONFIG_LIMITS.commandArgumentHintLength)
      : undefined;

  const body = parsed.body.trim();
  if (body.length === 0) {
    diagnostics.push(
      diag(
        sourceMeta.sourceId,
        file.rel,
        "frontmatter-invalid",
        `Skill '${name}' has an empty body — slash commands require instructions.`
      )
    );
    return null;
  }

  const aliases: string[] = [];
  if (
    file.dirName !== name &&
    COMMAND_NAME_REGEX.test(file.dirName) &&
    aliases.length < AIFETCHLY_CONFIG_LIMITS.commandAliases
  ) {
    aliases.push(file.dirName);
  }

  const substituted = substituteSkillPaths(body, pluginRoot, file.skillDir);
  const promptBody = `Base directory for this skill: ${file.skillDir.replace(/\\/g, "/")}\n\n${substituted}`;

  const built = buildPromptCommandDefinition(
    {
      relativePath: file.rel,
      body: promptBody,
      frontmatter: {
        name,
        description,
        type: "prompt",
        ...(argumentHint !== undefined ? { argumentHint } : {}),
        ...(aliases.length > 0 ? { aliases } : {}),
      },
    },
    sourceMeta
  );
  if (!built.ok) {
    diagnostics.push(built.diagnostic);
    return null;
  }
  return built.definition;
}
