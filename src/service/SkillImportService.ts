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
import { SkillManagementModule } from "@/modules/SkillManagementModule";
import { SkillRegistry } from "@/config/skillsRegistry";
import type {
  SkillExecutionContext,
  SkillExecutionResult,
  SkillManifest,
} from "@/entityTypes/skillTypes";
import { DocumentService } from "@/service/DocumentService";
import {
  SkillEnvironmentManager,
  getElectronUserDataPath,
  assertRequirementsFileHasHashes,
} from "@/service/SkillEnvironmentManager";
import { PythonSkillRuntimeService } from "@/service/PythonSkillRuntimeService";
import { SkillWorkerClient } from "@/service/SkillWorkerClient";

// ---------------------------------------------------------------------------
// Manifest validation
// ---------------------------------------------------------------------------

/**
 * When SKILL.md (or a persisted manifest) omits `supportedFileTypes`, map a
 * few known Anthropic-style skill names to extensions so staged uploads get
 * `attachment_ref` routing in the system prompt (see findSkillForFileExtension).
 */
const SKILL_ONLY_FALLBACK_TYPES_BY_SANITIZED_NAME: Readonly<
  Record<string, readonly string[]>
> = {
  pdf: [".pdf"],
};

interface SkillMarkdownMetadata {
  name?: string;
  description?: string;
  version?: string;
  /** Normalized extensions with leading dot, e.g. [".pdf"]. */
  supportedFileTypes?: string[];
}

const VALID_PERMISSIONS = new Set(["network", "filesystem", "automation"]);
const VALID_RUNTIMES = new Set(["javascript", "python"]);
const SEMVER_REGEX = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?$/;
const NAME_REGEX = /^[a-z][a-z0-9_-]*$/;

function resolvePermissionCategory(
  permissions: readonly string[] | undefined
): "pure" | "network" | "filesystem" | "automation" {
  if (!permissions || permissions.length === 0) {
    return "pure";
  }
  const first = permissions[0];
  if (typeof first === "string" && VALID_PERMISSIONS.has(first)) {
    return first as "network" | "filesystem" | "automation";
  }
  return "pure";
}

function validateZipDoesNotShipPythonEnv(zip: AdmZip): string | null {
  for (const entry of zip.getEntries()) {
    const normalized = entry.entryName.replace(/\\/g, "/");
    if (normalized === ".env" || normalized.startsWith(".env/")) {
      return (
        "Skill zip must not ship a pre-built .env directory; " +
        "environments are created locally after import."
      );
    }
  }
  return null;
}

function validatePythonRequirementsInZip(
  zip: AdmZip,
  requirementsRelative: string
): string | null {
  if (
    requirementsRelative.includes("..") ||
    path.isAbsolute(requirementsRelative)
  ) {
    return "Invalid python.requirements_file path.";
  }
  const entry = zip.getEntry(requirementsRelative);
  if (!entry || entry.isDirectory) {
    return `requirements file not found in zip: ${requirementsRelative}`;
  }
  let content: string;
  try {
    content = entry.getData().toString("utf-8");
  } catch {
    return "Failed to read requirements file from zip.";
  }
  try {
    assertRequirementsFileHasHashes(content);
  } catch (error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
  return null;
}

function validatePythonSystemDepsArray(
  system: unknown,
  labelPrefix: string
): string | null {
  if (system === undefined) {
    return null;
  }
  if (!Array.isArray(system)) {
    return `${labelPrefix}.system must be an array when present.`;
  }
  for (const dep of system as unknown[]) {
    if (!dep || typeof dep !== "object") {
      return `Each ${labelPrefix}.system entry must be an object.`;
    }
    const d = dep as Record<string, unknown>;
    if (typeof d.name !== "string" || typeof d.probe !== "string") {
      return `Each ${labelPrefix}.system entry requires string name and probe.`;
    }
    if (d.install_hint !== undefined) {
      if (typeof d.install_hint !== "object" || d.install_hint === null) {
        return `${labelPrefix}.system[].install_hint must be an object when present.`;
      }
    }
  }
  return null;
}

function validatePythonManifestFields(
  m: Record<string, unknown>
): string | null {
  if (m.runtime !== "python") {
    return null;
  }
  if (m.documentationOnly === true) {
    return "Python skills cannot use documentationOnly.";
  }
  const py = m.python;
  if (!py || typeof py !== "object") {
    return 'Python skills require a top-level "python" object in manifest.json.';
  }
  const p = py as Record<string, unknown>;
  if (typeof p.version !== "string" || p.version.trim().length === 0) {
    return "python.version is required and must be a non-empty string.";
  }
  if (
    typeof p.requirements_file !== "string" ||
    p.requirements_file.trim().length === 0
  ) {
    return "python.requirements_file is required.";
  }
  const rf = p.requirements_file as string;
  if (rf.includes("..") || path.isAbsolute(rf)) {
    return "python.requirements_file must be a relative path without '..'.";
  }
  if (typeof m.entry === "string" && !m.entry.toLowerCase().endsWith(".py")) {
    return 'Python skill entry must be a ".py" file.';
  }
  const systemErr = validatePythonSystemDepsArray(p.system, "python");
  if (systemErr) {
    return systemErr;
  }
  return null;
}

function validatePythonAttachmentExecutionFields(
  m: Record<string, unknown>
): string | null {
  if (m.python_attachment_execution === undefined) {
    return null;
  }
  if (m.runtime === "python") {
    return (
      'Field "python_attachment_execution" is only allowed when runtime is ' +
      '"javascript"; use the top-level "python" block for Python skills.'
    );
  }
  if (m.runtime !== "javascript") {
    return null;
  }
  const block = m.python_attachment_execution;
  if (!block || typeof block !== "object") {
    return "python_attachment_execution must be an object when present.";
  }
  const b = block as Record<string, unknown>;
  if (typeof b.version !== "string" || b.version.trim().length === 0) {
    return "python_attachment_execution.version is required and must be a non-empty string.";
  }
  if (
    typeof b.requirements_file !== "string" ||
    b.requirements_file.trim().length === 0
  ) {
    return "python_attachment_execution.requirements_file is required.";
  }
  const rf = b.requirements_file as string;
  if (rf.includes("..") || path.isAbsolute(rf)) {
    return "python_attachment_execution.requirements_file must be a relative path without '..'.";
  }
  if (typeof b.entry !== "string" || !b.entry.toLowerCase().endsWith(".py")) {
    return 'python_attachment_execution.entry must be a relative path to a ".py" file.';
  }
  const ent = b.entry as string;
  if (ent.includes("..") || path.isAbsolute(ent)) {
    return "python_attachment_execution.entry must be a relative path without '..'.";
  }
  return validatePythonSystemDepsArray(
    b.system,
    "python_attachment_execution"
  );
}

/**
 * Validates Python-specific zip rules (no shipped .env, hash-pinned requirements).
 * Returns an error message or null when OK. No-op for JavaScript skills.
 */
export function validatePythonSkillZip(
  effectiveZip: AdmZip,
  manifest: SkillManifest
): string | null {
  if (manifest.runtime === "python") {
    const envErr = validateZipDoesNotShipPythonEnv(effectiveZip);
    if (envErr) {
      return envErr;
    }
    if (!manifest.python) {
      return "Python manifest block missing.";
    }
    return validatePythonRequirementsInZip(
      effectiveZip,
      manifest.python.requirements_file
    );
  }

  if (
    manifest.runtime === "javascript" &&
    manifest.python_attachment_execution
  ) {
    const envErr = validateZipDoesNotShipPythonEnv(effectiveZip);
    if (envErr) {
      return envErr;
    }
    const block = manifest.python_attachment_execution;
    const reqErr = validatePythonRequirementsInZip(
      effectiveZip,
      block.requirements_file
    );
    if (reqErr) {
      return reqErr;
    }
    const pyRel = block.entry;
    const pyEntry = effectiveZip.getEntry(pyRel);
    if (!pyEntry || pyEntry.isDirectory) {
      return `python_attachment_execution.entry not found in zip: ${pyRel}`;
    }
  }

  return null;
}

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
    if (key === "supported_file_types" || key === "supportedFileTypes") {
      const parts = value.split(",").map((p) => {
        const t = p
          .trim()
          .toLowerCase()
          .replace(/^["'[]+|["'\]]+$/g, "");
        if (!t) {
          return "";
        }
        return t.startsWith(".") ? t : `.${t}`;
      });
      const normalized = parts.filter((p) => p.length > 0);
      if (normalized.length > 0) {
        metadata.supportedFileTypes = normalized;
      }
    }
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
  const rawDescription = metadata.description ?? "Imported skill from SKILL.md";
  const description = `${rawDescription} [documentation-only in aiFetchly]`;
  const version = metadata.version ?? "1.0.0";

  const supportedFileTypes =
    metadata.supportedFileTypes && metadata.supportedFileTypes.length > 0
      ? metadata.supportedFileTypes
      : SKILL_ONLY_FALLBACK_TYPES_BY_SANITIZED_NAME[name];

  return {
    name,
    version,
    description,
    runtime: "javascript",
    entry: "__skill_md_wrapper__.js",
    ...(supportedFileTypes && supportedFileTypes.length > 0
      ? { supportedFileTypes: [...supportedFileTypes] }
      : {}),
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
    documentationOnly: true,
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
  message: "This skill was imported from SKILL.md and runs in documentation-only mode. Pass attachment_ref to load converted attachment content and guidance; no file transformations are executed.",
});`;
}

/** Max characters of SKILL.md guidance included in attachment responses. */
const SKILL_GUIDANCE_CAP = 8000;

function isSkillMarkdownDocumentationEntry(manifest: SkillManifest): boolean {
  return manifest.documentationOnly === true;
}

function isLegacyDocumentationWrapper(
  manifest: SkillManifest,
  code: string
): boolean {
  return (
    manifest.entry === "__skill_md_wrapper__.js" &&
    code.includes('mode: "documentation_skill"')
  );
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
      }". Must be "javascript" or "python".`,
    };
  }

  const pythonFieldError = validatePythonManifestFields(m);
  if (pythonFieldError) {
    return { valid: false, error: pythonFieldError };
  }

  const attachmentPythonError = validatePythonAttachmentExecutionFields(m);
  if (attachmentPythonError) {
    return { valid: false, error: attachmentPythonError };
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
  const userDataPath = getElectronUserDataPath();
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

  const pythonZipError = validatePythonSkillZip(effectiveZip, manifest);
  if (pythonZipError) {
    return { success: false, error: pythonZipError };
  }

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

  if (manifest.runtime === "python") {
    try {
      await SkillEnvironmentManager.prepare(skillDir, manifest);
    } catch (prepError: unknown) {
      fs.rmSync(skillDir, { recursive: true, force: true });
      return {
        success: false,
        error: `Python environment setup failed: ${
          prepError instanceof Error ? prepError.message : String(prepError)
        }`,
      };
    }
  } else if (manifest.python_attachment_execution) {
    try {
      await SkillEnvironmentManager.prepare(
        skillDir,
        buildSyntheticPythonManifestForAttachmentExecution(manifest)
      );
    } catch (prepError: unknown) {
      fs.rmSync(skillDir, { recursive: true, force: true });
      return {
        success: false,
        error: `Python attachment execution environment setup failed: ${
          prepError instanceof Error ? prepError.message : String(prepError)
        }`,
      };
    }
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
 * Register an imported Python skill (manifest-driven; no bundled script names).
 */
function registerImportedPythonSkill(
  manifest: SkillManifest,
  skillDir: string
): void {
  if (manifest.runtime !== "python" || !manifest.python) {
    throw new Error("registerImportedPythonSkill requires runtime python");
  }
  const entryFsPath = path.join(skillDir, manifest.entry);
  if (!fs.existsSync(entryFsPath)) {
    throw new Error(`Python entry file not found: ${manifest.entry}`);
  }

  SkillRegistry.registerSkill({
    name: manifest.name,
    description: manifest.description,
    parameters: manifest.parameters,
    tier: "sandboxed",
    permissionCategory: resolvePermissionCategory(manifest.permissions),
    requiresConfirmation: (manifest.permissions?.length ?? 0) > 0,
    source: "user",
    documentationOnly: false,
    supportedFileTypes: manifest.supportedFileTypes,
    execute: async (
      args: Record<string, unknown>,
      context: SkillExecutionContext
    ): Promise<SkillExecutionResult> => {
      return await PythonSkillRuntimeService.executePythonSkill({
        manifest,
        skillDir,
        args,
        context,
      });
    },
  });
}

/**
 * Register an imported skill into the runtime SkillRegistry.
 */
function registerImportedSkill(
  manifest: SkillManifest,
  skillDir: string
): void {
  if (manifest.runtime === "python") {
    registerImportedPythonSkill(manifest, skillDir);
    return;
  }

  const entryPath = path.join(skillDir, manifest.entry);
  let code = fs.readFileSync(entryPath, "utf-8");
  const isDocumentationOnly =
    manifest.documentationOnly === true ||
    isLegacyDocumentationWrapper(manifest, code);
  const mergedSupportedTypes =
    manifest.supportedFileTypes && manifest.supportedFileTypes.length > 0
      ? manifest.supportedFileTypes
      : SKILL_ONLY_FALLBACK_TYPES_BY_SANITIZED_NAME[manifest.name];
  const resolvedManifest: SkillManifest = {
    ...manifest,
    documentationOnly: isDocumentationOnly,
    ...(mergedSupportedTypes && mergedSupportedTypes.length > 0
      ? { supportedFileTypes: [...mergedSupportedTypes] }
      : {}),
  };
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
    name: resolvedManifest.name,
    description: resolvedManifest.description,
    parameters: resolvedManifest.parameters,
    tier: "sandboxed",
    permissionCategory: resolvePermissionCategory(resolvedManifest.permissions),
    requiresConfirmation: (resolvedManifest.permissions?.length ?? 0) > 0,
    source: "user",
    documentationOnly: isDocumentationOnly,
    supportedFileTypes: resolvedManifest.supportedFileTypes,
    execute: buildImportedSkillExecuteHandler(resolvedManifest, skillDir, code),
  });
}

function buildSyntheticPythonManifestForAttachmentExecution(
  base: SkillManifest
): SkillManifest {
  const block = base.python_attachment_execution;
  if (!block) {
    throw new Error("python_attachment_execution block missing");
  }
  return {
    name: base.name,
    version: base.version,
    description: base.description,
    author: base.author,
    runtime: "python",
    entry: block.entry,
    parameters: base.parameters,
    permissions: base.permissions,
    supportedFileTypes: base.supportedFileTypes,
    documentationOnly: false,
    python: {
      version: block.version,
      requirements_file: block.requirements_file,
      system: block.system,
    },
  };
}

function stagedFileMatchesSupportedTypes(
  supported: readonly string[] | undefined,
  fileName: string
): boolean {
  const ext = path.extname(fileName).toLowerCase();
  if (!supported || supported.length === 0) {
    return true;
  }
  return supported.some((t) => {
    const raw = t.trim().toLowerCase();
    const normalized = raw.startsWith(".") ? raw : `.${raw}`;
    return ext === normalized;
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
  const capturedPythonAttachment = manifest.python_attachment_execution;
  const capturedSupported = manifest.supportedFileTypes;

  return async (
    args: Record<string, unknown>,
    context: SkillExecutionContext
  ): Promise<SkillExecutionResult> => {
    const attachmentRef =
      typeof args.attachment_ref === "string" ? args.attachment_ref.trim() : "";
    const conversationId = context.conversationId?.trim() ?? "";

    if (
      capturedIsDocSkill &&
      capturedPythonAttachment &&
      attachmentRef.length > 0
    ) {
      if (!conversationId) {
        return {
          success: false,
          result: {
            error:
              "attachment_ref was set but conversationId is missing; cannot run Python sidecar or load staged attachment.",
            mode: "documentation_skill_attachment_error",
          },
        };
      }
      try {
        const documentService = getSharedDocumentService();
        const stagedPeek = await documentService.readStagedAttachment(
          conversationId,
          attachmentRef
        );
        if (
          stagedFileMatchesSupportedTypes(
            capturedSupported,
            stagedPeek.fileName
          )
        ) {
          const synthetic = buildSyntheticPythonManifestForAttachmentExecution(
            manifest
          );
          return await PythonSkillRuntimeService.executePythonSkill({
            manifest: synthetic,
            skillDir: capturedSkillDir,
            args,
            context,
          });
        }
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          result: {
            error: errorMsg,
            mode: "documentation_skill_attachment_error",
            hint:
              "Python attachment sidecar could not read the staged file. Ensure attachment_ref matches the system prompt.",
          },
        };
      }
    }

    if (capturedIsDocSkill) {
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

      if (!attachmentRef) {
        return {
          success: true,
          result: {
            mode: "documentation_skill",
            documentationOnly: true,
            skillName: capturedName,
            skillFile: skillMdPath,
            skillGuidance,
            message:
              "Documentation-only skill loaded guidance from SKILL.md. Attach a supported file and pass attachment_ref to load content.",
          },
        };
      }

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

        return {
          success: true,
          result: {
            mode: "documentation_skill_with_attachment",
            documentationOnly: true,
            skillName: capturedName,
            skillFile: skillMdPath,
            fileName: staged.fileName,
            content,
            truncated: isTruncated,
            skillGuidance,
            message:
              "Documentation-only skill loaded staged attachment as markdown. `content` and `skillGuidance` are provided for analysis; no external scripts were executed and no files were transformed.",
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
  validatePythonSkillZip,
} as const;
