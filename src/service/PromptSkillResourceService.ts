/**
 * PromptSkillResourceService — bounded read-only resource operations
 * relative to an invoked prompt skill's canonical root (design §10.8).
 *
 * `skill_resource_list` / `skill_resource_read` reject:
 *   - absolute paths and `..` traversal;
 *   - symlinks whose resolved target escapes the skill root;
 *   - binary-looking content and oversized text;
 * and never grant access to sibling skills merely because they share
 * ~/.aifetchly/skills (PRD §14.4 — per-skill capability, no parent grant).
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { getDefaultPromptSkillCatalog } from "@/service/PromptSkillCatalog";
import type { SkillResourceReadResult } from "@/entityTypes/promptSkillTypes";

export const SKILL_RESOURCE_MAX_BYTES = 256 * 1024;
const BINARY_ZERO_SAMPLE = 8_000;
const MAX_LIST_ENTRIES = 500;

type ToolOutcome = {
  readonly success: boolean;
  readonly result: Record<string, unknown>;
};

function errorOutcome(message: string): ToolOutcome {
  return { success: false, result: { error: message } };
}

/** Resolve a caller-supplied subpath inside a runtime's canonical root. */
function resolveInsideRoot(
  root: string,
  relative: string
): { ok: true; absolute: string } | { ok: false; message: string } {
  if (path.isAbsolute(relative)) {
    return { ok: false, message: "Path must be relative to the skill root." };
  }
  const absolute = path.resolve(root, relative);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (absolute !== root && !absolute.startsWith(rootWithSep)) {
    return { ok: false, message: "Path escapes the skill root." };
  }
  return { ok: true, absolute };
}

function definitionOrError(runtimeId: string): ToolOutcome | null {
  const definition = getDefaultPromptSkillCatalog().get(runtimeId);
  if (!definition) {
    return errorOutcome(
      `Unknown prompt skill runtime id '${runtimeId}'. Invoke it with use_skill first.`
    );
  }
  if (!definition.enabled) {
    return errorOutcome(`Skill '${definition.name}' is disabled.`);
  }
  return null;
}

export async function listSkillResources(
  runtimeId: string,
  subpath?: string
): Promise<ToolOutcome> {
  const err = definitionOrError(runtimeId);
  if (err) return err;
  const definition = getDefaultPromptSkillCatalog().get(runtimeId)!;

  const targetRelative = subpath ?? "";
  const resolved = resolveInsideRoot(definition.canonicalRoot, targetRelative);
  if (!resolved.ok) return errorOutcome(resolved.message);

  let entries: readonly fs.Dirent[];
  try {
    entries = await fs.promises.readdir(resolved.absolute, {
      withFileTypes: true,
    });
  } catch (err2) {
    return errorOutcome(
      `Cannot list '${targetRelative}': ${
        err2 instanceof Error ? err2.message : String(err2)
      }`
    );
  }

  const files: { path: string; size_bytes: number }[] = [];
  const dirs: string[] = [];
  let truncated = false;
  for (const entry of entries) {
    if (files.length + dirs.length >= MAX_LIST_ENTRIES) {
      truncated = true;
      break;
    }
    if (entry.isDirectory() || (entry.isSymbolicLink() && safeIsDir(resolved.absolute, entry.name))) {
      dirs.push(entry.name);
    } else {
      let size = 0;
      try {
        size = fs.statSync(path.join(resolved.absolute, entry.name)).size;
      } catch {
        /* unstatable entries listed with size 0 */
      }
      files.push({ path: entry.name, size_bytes: size });
    }
  }
  return {
    success: true,
    result: {
      runtime_id: runtimeId,
      root_relative_path: targetRelative,
      files,
      dirs,
      ...(truncated ? { truncated: true } : {}),
    },
  };
}

function safeIsDir(parent: string, name: string): boolean {
  try {
    return fs.statSync(path.join(parent, name)).isDirectory();
  } catch {
    return false;
  }
}

export async function readSkillResource(
  runtimeId: string,
  relativePath: string
): Promise<ToolOutcome> {
  const err = definitionOrError(runtimeId);
  if (err) return err;
  const definition = getDefaultPromptSkillCatalog().get(runtimeId)!;

  const resolved = resolveInsideRoot(definition.canonicalRoot, relativePath);
  if (!resolved.ok) return errorOutcome(resolved.message);

  let stat: fs.Stats;
  try {
    // stat (not lstat): a symlinked helper is readable only when its target
    // stays inside the canonical root — realpath check below enforces it.
    stat = fs.statSync(resolved.absolute);
  } catch (err2) {
    return errorOutcome(
      `Cannot read '${relativePath}': ${
        err2 instanceof Error ? err2.message : String(err2)
      }`
    );
  }
  if (!stat.isFile()) {
    return errorOutcome(`'${relativePath}' is not a regular file.`);
  }
  if (stat.size > SKILL_RESOURCE_MAX_BYTES) {
    return errorOutcome(
      `'${relativePath}' is ${stat.size} bytes (limit ${SKILL_RESOURCE_MAX_BYTES}); read a smaller file or section.`
    );
  }

  // Revalidate after resolving symlinks (PRD §20.3).
  const real = fs.realpathSync(resolved.absolute);
  const rootWithSep = definition.canonicalRoot.endsWith(path.sep)
    ? definition.canonicalRoot
    : definition.canonicalRoot + path.sep;
  if (real !== definition.canonicalRoot && !real.startsWith(rootWithSep)) {
    return errorOutcome("Resolved path escapes the skill root.");
  }

  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(real);
  } catch (err2) {
    return errorOutcome(
      `Cannot read '${relativePath}': ${
        err2 instanceof Error ? err2.message : String(err2)
      }`
    );
  }

  // Reject binary-looking content (NUL bytes in the first sample).
  const sample = bytes.subarray(0, Math.min(bytes.length, BINARY_ZERO_SAMPLE));
  if (sample.includes(0)) {
    return errorOutcome(`'${relativePath}' looks binary and cannot be read as text.`);
  }

  const payload: SkillResourceReadResult = {
    relativePath,
    content: bytes.toString("utf-8"),
    contentHash: crypto.createHash("sha256").update(bytes).digest("hex"),
    truncated: false,
    sizeBytes: bytes.length,
  };
  return {
    success: true,
    result: { ...payload },
  };
}
