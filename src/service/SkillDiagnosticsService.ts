/**
 * Read-only classification of Python skill / environment failures for agent tools.
 */

import type { SkillManifest } from "@/entityTypes/skillTypes";

export type SkillDiagnoseCause =
  | "missing_python_module"
  | "missing_system_tool"
  | "interpreter_missing"
  | "lock_hash_mismatch"
  | "unknown";

export interface SkillDiagnoseResult {
  readonly cause: SkillDiagnoseCause;
  readonly missing?: string;
  readonly install_hint?: string;
  /** Normalized dependency ID (e.g. "poppler") when cause is missing_system_tool. */
  readonly dependency_id?: string;
  /** The binary that was not found (e.g. "pdfinfo"). */
  readonly missing_binary?: string;
}

const MODULE_NOT_FOUND =
  /ModuleNotFoundError:\s*No module named ['"]([^'"]+)['"]/i;
const PIP_HASH_FAIL = /THESE PACKAGES DO NOT MATCH THE HASHES/i;
const INTERPRETER_FAIL =
  /No Python interpreter satisfies|Failed to create venv|venv python missing/i;

/**
 * Known stderr patterns for specific system tools.
 * Maps regex → { dependency_id, missing_binary }.
 */
const KNOWN_TOOL_PATTERNS: readonly {
  readonly pattern: RegExp;
  readonly dependency_id: string;
  readonly missing_binary: string;
}[] = [
  {
    pattern: /PDFInfoNotInstalledError/i,
    dependency_id: "poppler",
    missing_binary: "pdfinfo",
  },
  {
    pattern: /TesseractNotFoundError/i,
    dependency_id: "tesseract",
    missing_binary: "tesseract",
  },
  {
    pattern: /ffmpeg:\s*command not found|ffmpeg not found|which:\s*no ffmpeg/i,
    dependency_id: "ffmpeg",
    missing_binary: "ffmpeg",
  },
  {
    pattern: /pdftotext.*not found|pdfinfo.*not found|pdftoppm.*not found/i,
    dependency_id: "poppler",
    missing_binary: "pdfinfo",
  },
  {
    pattern: /tesseract.*not found|tesseract is not installed/i,
    dependency_id: "tesseract",
    missing_binary: "tesseract",
  },
];

function pickSystemHint(manifest: SkillManifest): string | undefined {
  if (manifest.runtime !== "python" || !manifest.python?.system?.length) {
    return undefined;
  }
  const platform =
    process.platform === "darwin"
      ? "darwin"
      : process.platform === "win32"
      ? "win32"
      : "linux";
  const first = manifest.python.system[0];
  return (
    first.install_hint?.[platform] ??
    first.install_hint?.linux ??
    `Install system dependency: ${first.name} (${first.probe})`
  );
}

export const SkillDiagnosticsService = {
  diagnoseStderr(
    stderr: string,
    manifest?: SkillManifest
  ): SkillDiagnoseResult {
    const text = stderr.trim();
    if (PIP_HASH_FAIL.test(text)) {
      return { cause: "lock_hash_mismatch" };
    }
    if (INTERPRETER_FAIL.test(text)) {
      return {
        cause: "interpreter_missing",
        install_hint: manifest ? pickSystemHint(manifest) : undefined,
      };
    }
    const modMatch = MODULE_NOT_FOUND.exec(text);
    if (modMatch) {
      return {
        cause: "missing_python_module",
        missing: modMatch[1],
      };
    }
    if (/Missing system dependency/i.test(text)) {
      return {
        cause: "missing_system_tool",
        install_hint: manifest ? pickSystemHint(manifest) : undefined,
        ...resolveToolFields(text, manifest),
      };
    }

    // Check known tool patterns even without "Missing system dependency" prefix
    for (const tp of KNOWN_TOOL_PATTERNS) {
      if (tp.pattern.test(text)) {
        return {
          cause: "missing_system_tool",
          dependency_id: tp.dependency_id,
          missing_binary: tp.missing_binary,
          install_hint: manifest ? pickSystemHint(manifest) : undefined,
        };
      }
    }

    return { cause: "unknown" };
  },
} as const;

/**
 * Try to resolve dependency_id and missing_binary from manifest system deps
 * and known tool patterns when the generic "Missing system dependency" text is matched.
 */
function resolveToolFields(
  text: string,
  manifest?: SkillManifest
): { dependency_id?: string; missing_binary?: string } {
  // First: use manifest system deps when available (authoritative)
  if (manifest?.python?.system?.length) {
    for (const dep of manifest.python.system) {
      // Check if the probe binary appears in the error text
      if (text.toLowerCase().includes(dep.probe.toLowerCase())) {
        return {
          dependency_id: dep.name,
          missing_binary: dep.probe,
        };
      }
    }
    // Manifest exists but no probe matched — use first dep as best guess
    const first = manifest.python.system[0];
    return {
      dependency_id: first.name,
      missing_binary: first.probe,
    };
  }

  // Fallback: check known stderr patterns
  for (const tp of KNOWN_TOOL_PATTERNS) {
    if (tp.pattern.test(text)) {
      return {
        dependency_id: tp.dependency_id,
        missing_binary: tp.missing_binary,
      };
    }
  }

  return {};
}
