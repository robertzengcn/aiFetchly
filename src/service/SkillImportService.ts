/**
 * SkillImportService — imports skill packages from zip files.
 *
 * Flow:
 *  1. Extract zip to a temp directory
 *  2. Validate manifest.json (required fields, semver, unique name, runtime)
 *  3. Copy validated files to userData/installed_skills/<name>/
 *  4. Store metadata in SQLite via SkillManagementModule
 *  5. Hot-register the skill via SkillRegistry
 *  6. Clean up temp files on failure (atomic import)
 */

import AdmZip from "adm-zip";
import * as fs from "fs";
import * as path from "path";
import { app } from "electron";
import { SkillManagementModule } from "@/modules/SkillManagementModule";
import { SkillRegistry } from "@/config/skillsRegistry";
import type {
  SkillExecutionContext,
  SkillExecutionResult,
} from "@/entityTypes/skillTypes";
import { DocumentService } from "@/service/DocumentService";
import { SkillWorkerClient } from "@/service/SkillWorkerClient";

// ---------------------------------------------------------------------------
// Manifest validation
// ---------------------------------------------------------------------------

interface SkillManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  runtime: string;
  entry: string;
  parameters: Record<string, unknown>;
  permissions?: string[];
  supportedFileTypes?: readonly string[];
}

interface SkillMarkdownMetadata {
  name?: string;
  description?: string;
  version?: string;
}

const VALID_PERMISSIONS = new Set(["network", "filesystem", "automation"]);
const VALID_RUNTIMES = new Set(["javascript"]);
const SEMVER_REGEX = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?$/;
const NAME_REGEX = /^[a-z][a-z0-9_-]*$/;

/** Max uncompressed bytes per skill zip (50 MB) */
const MAX_UNCOMPRESSED_SIZE = 50 * 1024 * 1024;
/** Max number of entries in a skill zip */
const MAX_ZIP_ENTRIES = 500;

function parseSkillMarkdownMetadata(content: string): SkillMarkdownMetadata {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return {};
  }

  const metadata: SkillMarkdownMetadata = {};
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (line === "---") {
      break;
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (!value) {
      continue;
    }
    if (key === "name") metadata.name = value;
    if (key === "description") metadata.description = value;
    if (key === "version") metadata.version = value;
  }

  return metadata;
}

function sanitizeSkillName(raw: string): string {
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");

  if (!normalized) {
    return "imported-skill";
  }
  if (/^[a-z]/.test(normalized)) {
    return normalized;
  }
  return `skill-${normalized}`;
}

function buildManifestFromSkillMarkdown(
  skillMdContent: string,
  zipPath: string
): SkillManifest {
  const metadata = parseSkillMarkdownMetadata(skillMdContent);
  const fallbackName = sanitizeSkillName(path.basename(zipPath, ".zip"));
  const name = sanitizeSkillName(metadata.name ?? fallbackName);
  const description = metadata.description ?? "Imported skill from SKILL.md";
  const version = metadata.version ?? "1.0.0";

  return {
    name,
    version,
    description,
    runtime: "javascript",
    entry: "__skill_md_wrapper__.js",
    parameters: {
      type: "object",
      properties: {
        attachment_ref: {
          type: "string",
          description:
            "Optional. When set, loads staged attachment markdown for this conversation (same as read_attachment_content). Use for spreadsheets and documents the user uploaded.",
        },
        max_length: {
          type: "number",
          description:
            "Optional. Max characters of attachment content to return (default 120000, min 1000, max 300000).",
        },
      },
      additionalProperties: true,
    },
    permissions: [],
  };
}

function buildSkillMarkdownWrapperCode(
  skillName: string,
  skillMdPath: string,
  skillMdContent: string
): string {
  const escapedName = JSON.stringify(skillName);
  const escapedPath = JSON.stringify(skillMdPath);
  const escapedContent = JSON.stringify(skillMdContent);
  return `setResult({
  success: true,
  mode: "documentation_skill",
  skillName: ${escapedName},
  skillFile: ${escapedPath},
  guidance: ${escapedContent},
  message: "This skill was imported from SKILL.md. Pass attachment_ref to load uploaded spreadsheet/document data; otherwise only guidance is returned.",
});`;
}

/** Max characters of SKILL.md guidance included in attachment responses. */
const SKILL_GUIDANCE_CAP = 8000;

function isSkillMarkdownDocumentationEntry(manifest: SkillManifest): boolean {
  return manifest.entry === "__skill_md_wrapper__.js";
}

function resolveAttachmentMaxLength(args: Record<string, unknown>): number {
  return typeof args.max_length === "number"
    ? Math.max(1000, Math.min(300000, Math.round(args.max_length)))
    : 120000;
}

function pickSingleEntryByBasename(
  zip: AdmZip,
  basename: "manifest.json" | "SKILL.md"
): AdmZip.IZipEntry | null {
  // Prefer exact root match first
  const root = zip.getEntry(basename);
  if (root) return root;

  // Otherwise accept a single match anywhere in the zip
  const matches = zip
    .getEntries()
    .filter(
      (e) =>
        e.entryName.split("/").pop()?.toLowerCase() === basename.toLowerCase()
    );

  if (matches.length === 1) return matches[0] ?? null;
  return null;
}

function findFirstFileByBasename(
  dir: string,
  basenameLower: string,
  maxFiles = 2000
): string | null {
  const queue: string[] = [dir];
  let seen = 0;

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      seen += 1;
      if (seen > maxFiles) return null;

      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase() === basenameLower) {
        return fullPath;
      }
    }
  }

  return null;
}

function selectZipWithSkillFiles(zip: AdmZip):
  | {
      ok: true;
      zip: AdmZip;
      source: "outer" | "inner";
      innerEntryName?: string;
    }
  | { ok: false; error: string; debug: Record<string, unknown> } {
  const outerHasManifest = Boolean(
    pickSingleEntryByBasename(zip, "manifest.json")
  );
  const outerHasSkillMd = Boolean(pickSingleEntryByBasename(zip, "SKILL.md"));
  if (outerHasManifest || outerHasSkillMd) {
    return { ok: true, zip, source: "outer" };
  }

  const innerZipCandidates = zip
    .getEntries()
    .filter((e) => !e.isDirectory && e.entryName.toLowerCase().endsWith(".zip"))
    .slice(0, 20);

  const matches: {
    entryName: string;
    hasManifest: boolean;
    hasSkillMd: boolean;
  }[] = [];

  for (const entry of innerZipCandidates) {
    try {
      const innerZip = new AdmZip(entry.getData());
      const hasManifest = Boolean(
        pickSingleEntryByBasename(innerZip, "manifest.json")
      );
      const hasSkillMd = Boolean(
        pickSingleEntryByBasename(innerZip, "SKILL.md")
      );
      if (hasManifest || hasSkillMd) {
        matches.push({ entryName: entry.entryName, hasManifest, hasSkillMd });
      }
    } catch {
      // ignore
    }
  }

  if (matches.length === 1) {
    const chosen = matches[0];
    const chosenEntry = zip.getEntry(chosen.entryName);
    if (!chosenEntry) {
      return {
        ok: false,
        error: "Failed to locate selected inner zip entry",
        debug: { matches },
      };
    }
    try {
      const innerZip = new AdmZip(chosenEntry.getData());
      return {
        ok: true,
        zip: innerZip,
        source: "inner",
        innerEntryName: chosen.entryName,
      };
    } catch {
      return {
        ok: false,
        error: "Selected inner zip is corrupted",
        debug: { matches, chosen: chosen.entryName },
      };
    }
  }

  if (matches.length > 1) {
    return {
      ok: false,
      error:
        "This zip contains multiple inner zip packages with SKILL.md/manifest.json. Please import one of the inner zips directly.",
      debug: { matches },
    };
  }

  return {
    ok: false,
    error: "Missing manifest.json in zip root (or SKILL.md fallback)",
    debug: {
      outerEntryCount: zip.getEntries().length,
      innerZipCandidates: innerZipCandidates.map((e) => e.entryName),
      matches,
    },
  };
}

function validateManifest(raw: unknown):
  | {
      valid: true;
      manifest: SkillManifest;
    }
  | {
      valid: false;
      error: string;
    } {
  if (!raw || typeof raw !== "object") {
    return { valid: false, error: "Manifest must be a JSON object" };
  }

  const m = raw as Record<string, unknown>;

  // Required string fields
  for (const field of ["name", "version", "description", "runtime", "entry"]) {
    if (typeof m[field] !== "string" || (m[field] as string).length === 0) {
      return {
        valid: false,
        error: `Missing or empty required field: ${field}`,
      };
    }
  }

  // Name format
  if (!NAME_REGEX.test(m.name as string)) {
    return {
      valid: false,
      error: `Invalid skill name "${
        m.name as string
      }". Must be lowercase alphanumeric with hyphens/underscores, starting with a letter.`,
    };
  }

  // Version — semver
  if (!SEMVER_REGEX.test(m.version as string)) {
    return {
      valid: false,
      error: `Invalid version "${
        m.version as string
      }". Must be semver (e.g., 1.0.0).`,
    };
  }

  // Description length
  if ((m.description as string).length > 500) {
    return {
      valid: false,
      error: "Description must be 500 characters or fewer",
    };
  }

  // Runtime
  if (!VALID_RUNTIMES.has(m.runtime as string)) {
    return {
      valid: false,
      error: `Unsupported runtime "${
        m.runtime as string
      }". Must be "javascript".`,
    };
  }

  // Parameters — must be valid JSON Schema with type: object
  if (!m.parameters || typeof m.parameters !== "object") {
    return {
      valid: false,
      error: "Missing required field: parameters",
    };
  }
  const params = m.parameters as Record<string, unknown>;
  if (params.type !== "object") {
    return {
      valid: false,
      error: 'Parameters must have "type": "object"',
    };
  }

  // Permissions — optional array
  if (m.permissions !== undefined) {
    if (!Array.isArray(m.permissions)) {
      return { valid: false, error: "Permissions must be an array" };
    }
    for (const perm of m.permissions as string[]) {
      if (!VALID_PERMISSIONS.has(perm)) {
        return {
          valid: false,
          error: `Invalid permission: ${perm}. Must be one of: ${[
            ...VALID_PERMISSIONS,
          ].join(", ")}`,
        };
      }
    }
  }

  return {
    valid: true,
    manifest: m as unknown as SkillManifest,
  };
}

// ---------------------------------------------------------------------------
// Import logic
// ---------------------------------------------------------------------------

function getInstalledSkillsDir(): string {
  const userDataPath = app.getPath("userData");
  const skillsDir = path.join(userDataPath, "installed_skills");
  if (!fs.existsSync(skillsDir)) {
    fs.mkdirSync(skillsDir, { recursive: true });
  }
  return skillsDir;
}

async function importFromZip(zipPath: string): Promise<
  | {
      success: true;
      name: string;
    }
  | {
      success: false;
      error: string;
    }
> {
  // 1. Validate zip exists
  if (!fs.existsSync(zipPath)) {
    return { success: false, error: `Zip file not found: ${zipPath}` };
  }

  let zip: AdmZip;
  try {
    zip = new AdmZip(zipPath);
  } catch {
    return { success: false, error: "Invalid or corrupted zip file" };
  }

  const selectedZip = selectZipWithSkillFiles(zip);
  if (!selectedZip.ok) {
    return { success: false, error: selectedZip.error };
  }

  const effectiveZip = selectedZip.zip;

  // 2. Read manifest.json from zip, or fallback to SKILL.md-only package
  const manifestEntry = pickSingleEntryByBasename(
    effectiveZip,
    "manifest.json"
  );
  let generatedFromSkillMd = false;
  let rawManifest: unknown;
  if (manifestEntry) {
    try {
      const manifestContent = manifestEntry.getData().toString("utf-8");
      rawManifest = JSON.parse(manifestContent) as unknown;
    } catch {
      return { success: false, error: "manifest.json is not valid JSON" };
    }
  } else {
    const skillMdEntry = pickSingleEntryByBasename(effectiveZip, "SKILL.md");

    if (!skillMdEntry) {
      return {
        success: false,
        error: "Missing manifest.json in zip root (or SKILL.md fallback)",
      };
    }
    const skillMdContent = skillMdEntry.getData().toString("utf-8");
    rawManifest = buildManifestFromSkillMarkdown(skillMdContent, zipPath);
    generatedFromSkillMd = true;
  }

  // 3. Validate manifest
  const validation = validateManifest(rawManifest);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }
  const manifest = validation.manifest;

  // 4. Verify entry file exists in zip
  const entryPath = manifest.entry;

  // Validate entry path does not contain traversal sequences
  if (entryPath.includes("..") || path.isAbsolute(entryPath)) {
    return {
      success: false,
      error: `Entry path "${entryPath}" contains invalid characters`,
    };
  }

  const entryFile = effectiveZip.getEntry(entryPath);
  if (!generatedFromSkillMd && !entryFile) {
    return {
      success: false,
      error: `Entry file "${entryPath}" not found in zip`,
    };
  }

  // 4b. Zip bomb and path traversal protection
  const zipEntries = effectiveZip.getEntries();
  if (zipEntries.length > MAX_ZIP_ENTRIES) {
    return {
      success: false,
      error: `Zip contains too many entries (${zipEntries.length}, max ${MAX_ZIP_ENTRIES})`,
    };
  }

  let totalUncompressed = 0;
  for (const entry of zipEntries) {
    totalUncompressed += entry.header.size;
    if (totalUncompressed > MAX_UNCOMPRESSED_SIZE) {
      return {
        success: false,
        error: `Zip uncompressed size exceeds limit (${
          MAX_UNCOMPRESSED_SIZE / 1024 / 1024
        } MB)`,
      };
    }
    // Path traversal check — entry names must not escape the skill directory
    const normalised = path.normalize(entry.entryName);
    if (normalised.startsWith("..") || path.isAbsolute(normalised)) {
      return {
        success: false,
        error: `Zip entry "${entry.entryName}" contains path traversal`,
      };
    }
  }

  // 5. Check for duplicate name in DB
  const module = new SkillManagementModule();
  const existing = await module.getSkillByName(manifest.name);
  if (existing) {
    // Allow re-import (update) — delete the old one first
    await module.uninstallSkill(manifest.name);
  }

  // 6. Extract to installed_skills/<name>/
  const skillsDir = getInstalledSkillsDir();
  const skillDir = path.join(skillsDir, manifest.name);

  // Clean up existing directory if present
  if (fs.existsSync(skillDir)) {
    fs.rmSync(skillDir, { recursive: true, force: true });
  }
  fs.mkdirSync(skillDir, { recursive: true });

  try {
    effectiveZip.extractAllTo(skillDir, true);
  } catch (extractError) {
    // Atomic cleanup on failure
    fs.rmSync(skillDir, { recursive: true, force: true });
    return {
      success: false,
      error: `Failed to extract zip: ${
        extractError instanceof Error ? extractError.message : "Unknown error"
      }`,
    };
  }

  // 7. Verify entry file exists after extraction
  const extractedEntry = path.join(skillDir, entryPath);
  if (generatedFromSkillMd) {
    try {
      const skillMdPathForWrapper =
        findFirstFileByBasename(skillDir, "skill.md") ??
        path.join(skillDir, "SKILL.md");
      const skillMdContent = fs.readFileSync(skillMdPathForWrapper, "utf-8");
      const wrapperCode = buildSkillMarkdownWrapperCode(
        manifest.name,
        skillMdPathForWrapper,
        skillMdContent
      );
      fs.writeFileSync(extractedEntry, wrapperCode, "utf-8");
    } catch (writeError) {
      fs.rmSync(skillDir, { recursive: true, force: true });
      return {
        success: false,
        error: `Failed to generate entry file: ${
          writeError instanceof Error ? writeError.message : "Unknown error"
        }`,
      };
    }
  }
  if (!fs.existsSync(extractedEntry)) {
    // Cleanup and fail
    fs.rmSync(skillDir, { recursive: true, force: true });
    return {
      success: false,
      error: `Entry file "${entryPath}" not found after extraction`,
    };
  }

  // 8. Store metadata in SQLite
  try {
    await module.installSkill({
      name: manifest.name,
      version: manifest.version,
      source: "user",
      manifest_json: JSON.stringify(manifest),
      permissions_json: JSON.stringify(manifest.permissions ?? []),
      enabled: 1,
    });
  } catch (dbError) {
    // Atomic cleanup — remove extracted files
    fs.rmSync(skillDir, { recursive: true, force: true });
    return {
      success: false,
      error: `Failed to save skill to database: ${
        dbError instanceof Error ? dbError.message : "Unknown error"
      }`,
    };
  }

  // 9. Hot-register the skill
  try {
    registerImportedSkill(manifest, skillDir);
  } catch (regError) {
    console.warn(
      `[SkillImport] Failed to hot-register skill "${manifest.name}": ${
        regError instanceof Error ? regError.message : regError
      }`
    );
    // Non-fatal — skill is persisted and will load on next startup
  }

  return { success: true, name: manifest.name };
}

/**
 * Register an imported skill into the runtime SkillRegistry.
 */
function registerImportedSkill(
  manifest: SkillManifest,
  skillDir: string
): void {
  const entryPath = path.join(skillDir, manifest.entry);
  let code = fs.readFileSync(entryPath, "utf-8");
  const isLegacyDocsOnlyWrapper =
    manifest.entry === "__skill_md_wrapper__.js" &&
    code.includes("documentation-only in this app");
  if (isLegacyDocsOnlyWrapper) {
    const skillMdPath =
      findFirstFileByBasename(skillDir, "skill.md") ??
      path.join(skillDir, "SKILL.md");
    try {
      const skillMdContent = fs.readFileSync(skillMdPath, "utf-8");
      code = buildSkillMarkdownWrapperCode(
        manifest.name,
        skillMdPath,
        skillMdContent
      );
      fs.writeFileSync(entryPath, code, "utf-8");
    } catch {
      // Keep legacy wrapper if SKILL.md cannot be read/written.
    }
  }

  SkillRegistry.registerSkill({
    name: manifest.name,
    description: manifest.description,
    parameters: manifest.parameters,
    tier: "sandboxed",
    permissionCategory:
      (manifest.permissions?.[0] as "network" | "filesystem" | "automation") ??
      "pure",
    requiresConfirmation: (manifest.permissions?.length ?? 0) > 0,
    source: "user",
    supportedFileTypes: manifest.supportedFileTypes,
    execute: buildImportedSkillExecuteHandler(manifest, skillDir, code),
  });
}

/**
 * Lazily-initialized DocumentService shared across all skill executions.
 *
 * Instantiating DocumentService allocates RAGDocumentModule,
 * HtmlConversionService, and SpreadsheetConversionService — caching avoids
 * re-creating these on every skill invocation.
 */
let sharedDocumentService: DocumentService | null = null;

function getSharedDocumentService(): DocumentService {
  if (!sharedDocumentService) {
    sharedDocumentService = new DocumentService();
  }
  return sharedDocumentService;
}

/**
 * Creates the `execute` handler for an imported skill.
 *
 * Captures `manifest` and `skillDir` as explicit frozen copies so the
 * closure is immune to any later mutation of the outer variables.
 */
function buildImportedSkillExecuteHandler(
  manifest: SkillManifest,
  skillDir: string,
  code: string
): (
  args: Record<string, unknown>,
  context: SkillExecutionContext
) => Promise<SkillExecutionResult> {
  // Freeze a snapshot of manifest fields used inside the closure.
  const capturedName = manifest.name;
  const capturedIsDocSkill = isSkillMarkdownDocumentationEntry(manifest);
  const capturedSkillDir = skillDir;
  const capturedCode = code;

  return async (
    args: Record<string, unknown>,
    context: SkillExecutionContext
  ): Promise<SkillExecutionResult> => {
    const attachmentRef =
      typeof args.attachment_ref === "string" ? args.attachment_ref.trim() : "";
    const conversationId = context.conversationId?.trim() ?? "";

    if (capturedIsDocSkill && attachmentRef) {
      if (!conversationId) {
        return {
          success: false,
          result: {
            error:
              "attachment_ref was set but conversationId is missing; cannot load staged attachment.",
            mode: "documentation_skill_attachment_error",
          },
        };
      }
      const maxLength = resolveAttachmentMaxLength(args);
      try {
        const documentService = getSharedDocumentService();
        const staged = await documentService.readStagedAttachment(
          conversationId,
          attachmentRef
        );
        const isTruncated = staged.markdown.length > maxLength;
        const content = isTruncated
          ? staged.markdown.slice(0, maxLength)
          : staged.markdown;

        const skillMdPath =
          findFirstFileByBasename(capturedSkillDir, "skill.md") ??
          path.join(capturedSkillDir, "SKILL.md");
        let skillGuidance = "";
        try {
          const fullGuidance = fs.readFileSync(skillMdPath, "utf-8");
          skillGuidance =
            fullGuidance.length > SKILL_GUIDANCE_CAP
              ? `${fullGuidance.slice(
                  0,
                  SKILL_GUIDANCE_CAP
                )}\n...[skill guidance truncated]`
              : fullGuidance;
        } catch {
          skillGuidance = "";
        }

        return {
          success: true,
          result: {
            mode: "documentation_skill_with_attachment",
            skillName: capturedName,
            skillFile: skillMdPath,
            fileName: staged.fileName,
            content,
            truncated: isTruncated,
            skillGuidance,
            message:
              "Loaded staged attachment as markdown. `content` is the spreadsheet/document data; use `skillGuidance` for analysis patterns from SKILL.md.",
          },
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          result: {
            error: errorMsg,
            mode: "documentation_skill_attachment_error",
            hint: "Ensure the file was attached in this chat and attachment_ref matches the value from the system prompt.",
          },
        };
      }
    }

    return SkillWorkerClient.getInstance().execute(capturedCode, args, {
      conversationId: context.conversationId,
      toolCallId: context.toolCallId,
    });
  };
}

/**
 * Load all persisted skills from DB into SkillRegistry on app startup.
 */
async function loadPersistedSkills(): Promise<void> {
  const module = new SkillManagementModule();
  const skills = await module.listEnabledSkills();

  for (const skill of skills) {
    try {
      const manifest = JSON.parse(skill.manifest_json) as SkillManifest;
      const skillsDir = getInstalledSkillsDir();
      const skillDir = path.join(skillsDir, skill.name);

      if (!fs.existsSync(skillDir)) {
        console.warn(
          `[SkillImport] Skill directory missing for "${skill.name}", skipping`
        );
        continue;
      }

      registerImportedSkill(manifest, skillDir);
      console.log(`[SkillImport] Loaded persisted skill: ${skill.name}`);
    } catch (error) {
      console.warn(
        `[SkillImport] Failed to load skill "${skill.name}": ${
          error instanceof Error ? error.message : error
        }`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const SkillImportService = {
  importFromZip,
  loadPersistedSkills,
  validateManifest,
} as const;
