// src/service/aifetchlyConfig/buildLocalSkillDraft.ts
// SKL-01 (Phase 18 / Plan 01) — PURE single-owner validator that turns a raw
// `~/.aifetchly/skills/<name>/manifest.json` blob into either a validated
// {@link LocalSkillDraft} or a non-fatal `manifest-invalid` diagnostic.
//
// Pipeline context: AIFetchlyConfigLoader.tryReadSkillFiles (global) and
// buildWorkspaceSkillDefinitions (workspace, main-side converter) both call
// this function. The resulting LocalSkillDraft flows into
// AIFetchlyRuntimeRegistrySync.applySnapshot -> LocalSkillSourceAdapter ->
// SkillImportService.registerImportedSkill(manifest, skillDir) -> SkillRegistry.
//
// Validation ownership (do NOT duplicate rules — 18-RESEARCH Pattern 1):
//   - Name regex, semver version, description length, runtime enum, python
//     blocks, parameters type:object, permissions enum -> all DELEGATED to the
//     EXISTING `SkillImportService.validateManifest` (the single schema owner).
//   - CFG-05 path safety on the `entry` field -> performed HERE, because
//     `validateManifest` does not itself check entry traversal (that check
//     lives in `importFromZip` for the zip path; the local-discovery path
//     needs it at this boundary).
//
// Pure leaf: imports only types + the existing validator + node:path. NO fs /
// Electron / better-sqlite3 / TypeORM / SkillRegistry imports (verified by the
// acceptance grep gate in the plan). Never throws; always returns a result
// discriminated union. Mirrors the Phase-17 buildHookDefinition single-owner
// pattern.
//
// Per D-SkillEnable: no "enable" flag is introduced here — registration is
// immediate, gating is at call time via the existing SkillPermissionService.

import * as path from "path";
import type { AIFetchlyConfigDiagnostic } from "@/entityTypes/aifetchlyConfigTypes";
import type { SkillManifest } from "@/entityTypes/skillTypes";
import { SkillImportService } from "@/service/SkillImportService";

/**
 * A validated local skill draft, ready to hand to
 * `SkillImportService.registerImportedSkill(manifest, skillDir)`.
 *
 * `skillDir` is the ABSOLUTE skill directory (`<rootPath>/skills/<name>`) —
 * resolved by the caller from the config loader's `rootPath`, NEVER from
 * `SkillEnvironmentManager.getInstalledSkillRoot` (Anti-Pattern per
 * 18-RESEARCH).
 */
export interface LocalSkillDraft {
  /** Stable id `${sourceId}:skill:${name}` — consumed by the snapshot diff. */
  readonly id: string;
  /** Skill name (kebab-case, matches `manifest.name`). */
  readonly name: string;
  /** Validated manifest (reused `SkillManifest` type — not redefined). */
  readonly manifest: SkillManifest;
  /** Absolute skill directory (`<rootPath>/skills/<name>`). */
  readonly skillDir: string;
  /** SHA-256 of the manifest.json bytes (CFG-06; sourced from the loader). */
  readonly contentHash: string;
}

/**
 * Source metadata attached to every diagnostic this validator emits.
 * Mirrors the Phase-17 `HookDefinitionSourceMeta` shape.
 */
export interface LocalSkillSourceMeta {
  readonly source: "user" | "workspace";
  readonly sourceId: string;
  readonly relativePath: string;
}

/** Success variant of {@link buildLocalSkillDraft}. */
export interface LocalSkillDraftOk {
  readonly ok: true;
  readonly draft: LocalSkillDraft;
}

/** Failure variant of {@link buildLocalSkillDraft}. */
export interface LocalSkillDraftErr {
  readonly ok: false;
  readonly diagnostic: AIFetchlyConfigDiagnostic;
}

export type LocalSkillDraftResult = LocalSkillDraftOk | LocalSkillDraftErr;

/**
 * Validate a raw `manifest.json` blob and produce a {@link LocalSkillDraft}.
 *
 * Delegates the manifest schema check to the EXISTING
 * `SkillImportService.validateManifest` (single schema owner) and adds the
 * CFG-05 path-safety check on the `entry` field. Returns a non-fatal
 * `manifest-invalid` diagnostic on any failure — never throws.
 *
 * @param raw The JSON-parsed manifest blob (untrusted `unknown`).
 * @param sourceMeta Source attribution for the diagnostic.
 * @param skillDir Absolute skill directory (`<rootPath>/skills/<name>`).
 * @param contentHash SHA-256 of the manifest.json file bytes.
 */
export function buildLocalSkillDraft(
  raw: unknown,
  sourceMeta: LocalSkillSourceMeta,
  skillDir: string,
  contentHash: string
): LocalSkillDraftResult {
  // 1. Delegate the manifest schema check to the single owner.
  const validation = SkillImportService.validateManifest(raw);
  if (!validation.valid) {
    return {
      ok: false,
      diagnostic: manifestInvalid(sourceMeta, validation.error),
    };
  }
  const manifest: SkillManifest = validation.manifest;

  // 2. CFG-05 path safety on the `entry` field. `validateManifest` does NOT
  //    perform this check (it lives in `importFromZip` for the zip path); the
  //    local-discovery path needs it here so a malicious manifest cannot
  //    point at `../../etc/passwd` or an absolute path. 18-RESEARCH Anti-
  //    Pattern / Pitfall: never trust the manifest entry without this check.
  if (manifest.entry.includes("..") || path.isAbsolute(manifest.entry)) {
    return {
      ok: false,
      diagnostic: manifestInvalid(
        sourceMeta,
        `Entry path "${manifest.entry}" must be relative and free of ".." traversal`
      ),
    };
  }

  // 3. Construct the validated draft. The manifest is the reused
  //    SkillManifest type — no redefinition, no re-validation downstream.
  const draft: LocalSkillDraft = {
    id: `${sourceMeta.sourceId}:skill:${manifest.name}`,
    name: manifest.name,
    manifest,
    skillDir,
    contentHash,
  };
  return { ok: true, draft };
}

/** Build a `manifest-invalid` diagnostic carrying source attribution. */
function manifestInvalid(
  sourceMeta: LocalSkillSourceMeta,
  message: string
): AIFetchlyConfigDiagnostic {
  return {
    severity: "warning",
    source: sourceMeta.source,
    sourceId: sourceMeta.sourceId,
    filePath: sourceMeta.relativePath,
    code: "manifest-invalid",
    message,
    recoverable: true,
  };
}
