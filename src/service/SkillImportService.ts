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
}

const VALID_PERMISSIONS = new Set(["network", "filesystem", "automation"]);
const VALID_RUNTIMES = new Set(["javascript"]);
const SEMVER_REGEX = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?$/;
const NAME_REGEX = /^[a-z][a-z0-9_-]*$/;

/** Max uncompressed bytes per skill zip (50 MB) */
const MAX_UNCOMPRESSED_SIZE = 50 * 1024 * 1024;
/** Max number of entries in a skill zip */
const MAX_ZIP_ENTRIES = 500;

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

  // 2. Read manifest.json from zip
  const manifestEntry = zip.getEntry("manifest.json");
  if (!manifestEntry) {
    return {
      success: false,
      error: "Missing manifest.json in zip root",
    };
  }

  let rawManifest: unknown;
  try {
    const manifestContent = manifestEntry.getData().toString("utf-8");
    rawManifest = JSON.parse(manifestContent) as unknown;
  } catch {
    return { success: false, error: "manifest.json is not valid JSON" };
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

  const entryFile = zip.getEntry(entryPath);
  if (!entryFile) {
    return {
      success: false,
      error: `Entry file "${entryPath}" not found in zip`,
    };
  }

  // 4b. Zip bomb and path traversal protection
  const zipEntries = zip.getEntries();
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
    zip.extractAllTo(skillDir, true);
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
  const code = fs.readFileSync(entryPath, "utf-8");

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
    execute: async (args: Record<string, unknown>) => {
      // Use SandboxedSkillExecutor for imported skills
      const { SandboxedSkillExecutor } = await import(
        "@/service/SandboxedSkillExecutor"
      );
      return SandboxedSkillExecutor.execute(code, args, {
        conversationId: "",
        toolCallId: "",
      });
    },
  });
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
