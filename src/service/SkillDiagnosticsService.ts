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
}

const MODULE_NOT_FOUND =
  /ModuleNotFoundError:\s*No module named ['"]([^'"]+)['"]/i;
const PIP_HASH_FAIL = /THESE PACKAGES DO NOT MATCH THE HASHES/i;
const INTERPRETER_FAIL =
  /No Python interpreter satisfies|Failed to create venv|venv python missing/i;

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
  diagnoseStderr(stderr: string, manifest?: SkillManifest): SkillDiagnoseResult {
    const text = stderr.trim();
    if (PIP_HASH_FAIL.test(text)) {
      return { cause: "lock_hash_mismatch" };
    }
    if (INTERPRETER_FAIL.test(text)) {
      return { cause: "interpreter_missing", install_hint: manifest ? pickSystemHint(manifest) : undefined };
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
      };
    }
    return { cause: "unknown" };
  },
} as const;
