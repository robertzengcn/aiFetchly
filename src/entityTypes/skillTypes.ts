/**
 * Type definitions for the AI Skills System.
 *
 * Skills are named, versioned capabilities that the AI can invoke
 * during conversations. They are composed of a manifest (metadata)
 * and executable logic.
 */

import type { ToolFunction } from "@/api/aiChatApi";

/**
 * Result returned by a skill's execute function.
 * The SkillExecutor wraps this into a full ToolExecutionResult.
 */
export interface SkillExecutionResult {
  readonly success: boolean;
  readonly result: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Tier — Where a skill executes
// ---------------------------------------------------------------------------

/** Execution tier determines the runtime environment for a skill. */
export type SkillTier =
  | "renderer" // Pure computation in renderer process (no side effects)
  | "main" // Main process via IPC (filesystem, OS, Puppeteer)
  | "sandboxed"; // Isolated VM for untrusted code (isolated-vm)

// ---------------------------------------------------------------------------
// Permission categories — Risk-based classification
// ---------------------------------------------------------------------------

/**
 * Permission category determines the user-consent policy for a skill.
 *
 * - `pure`        — No side effects. Auto-allowed, never prompts the user.
 * - `network`     — External HTTP calls. Prompts once per domain.
 * - `filesystem`  — Local file read/write. Always prompts.
 * - `automation`  — Puppeteer, social posting, scraping. Always prompts.
 * - `shell`       — Local shell command execution. Always prompts, shows command preview.
 */
export type SkillPermissionCategory =
  | "pure"
  | "network"
  | "filesystem"
  | "automation"
  | "shell";

// ---------------------------------------------------------------------------
// Skill source — Origin of the skill
// ---------------------------------------------------------------------------

/** Where the skill comes from. */
export type SkillSource =
  | "built-in" // Shipped with the app, fully trusted
  | "user" // Personal script written by a power user
  | "marketplace"; // Imported from an external source

// ---------------------------------------------------------------------------
// SkillDefinition — Full runtime representation of a registered skill
// ---------------------------------------------------------------------------

/**
 * Complete definition of a skill in the registry.
 *
 * Each entry maps 1:1 to a `ToolFunction` (the LLM-facing subset:
 * name, description, parameters) plus execution metadata.
 */
export interface SkillDefinition {
  /** Unique kebab-case identifier (e.g., `google_search`). */
  readonly name: string;

  /** Human-readable description shown to the LLM. */
  readonly description: string;

  /** JSON Schema for input validation. */
  readonly parameters: Record<string, unknown>;

  /** Where the skill executes. */
  readonly tier: SkillTier;

  /** Whether user consent is needed before execution. */
  readonly requiresConfirmation: boolean;

  /** Risk-based permission classification. */
  readonly permissionCategory: SkillPermissionCategory;

  /** The function that runs the skill. */
  readonly execute: (
    args: Record<string, unknown>,
    context: SkillExecutionContext
  ) => Promise<SkillExecutionResult>;

  /** Origin of the skill. */
  readonly source: SkillSource;

  /**
   * True when the imported skill is derived from SKILL.md guidance only and
   * does not provide a real executable entrypoint for side-effect operations.
   */
  readonly documentationOnly?: boolean;

  /**
   * File extensions this skill can handle (e.g. [".xlsx", ".csv"]).
   * When an uploaded attachment matches, the AI model is directed to call
   * this skill instead of the generic `read_attachment_content` tool.
   */
  readonly supportedFileTypes?: readonly string[];
}

// ---------------------------------------------------------------------------
// SkillExecutionContext — Context passed to the executor
// ---------------------------------------------------------------------------

/** Runtime context for a single skill execution. */
export interface SkillExecutionContext {
  /** The conversation where this execution originated. */
  readonly conversationId: string;

  /** The skill being invoked. */
  readonly skillName?: string;

  /** Server-assigned tool call ID for correlating request/response. */
  readonly toolCallId: string;

  /** Arguments from the LLM's tool_call event. */
  readonly args?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// SkillManifest — JSON structure within a skill package zip
// ---------------------------------------------------------------------------

/** Non-pip system dependency declared by a Python skill (e.g. Poppler). */
export interface SkillPythonSystemDep {
  readonly name: string;
  readonly probe: string;
  readonly install_hint?: {
    readonly darwin?: string;
    readonly linux?: string;
    readonly win32?: string;
  };
}

/** Python runtime block in manifest.json when `runtime` is `"python"`. */
export interface SkillPythonManifestBlock {
  /** Interpreter constraint (e.g. `">=3.10"`). Only `>=M.m` is strictly enforced. */
  readonly version: string;
  /** Relative path to a hash-pinned requirements file inside the skill zip. */
  readonly requirements_file: string;
  /** Optional binaries that must exist on PATH (probed via `probe --version`). */
  readonly system?: readonly SkillPythonSystemDep[];
}

/**
 * Optional Python sidecar for `runtime: "javascript"` documentation skills.
 * When present and the tool is invoked with `attachment_ref`, aiFetchly may
 * run the listed `.py` entry with a per-skill venv (same rules as `python` block)
 * instead of only returning SKILL.md + converted attachment markdown.
 */
export interface SkillPythonAttachmentExecutionBlock {
  readonly version: string;
  readonly requirements_file: string;
  /** Relative path to the `.py` script (not the JS documentation entry). */
  readonly entry: string;
  readonly system?: readonly SkillPythonSystemDep[];
}

/** Supported skill package runtimes. */
export type SkillManifestRuntime = "javascript" | "python";

/**
 * Manifest for importable skill packages.
 * Stored in `manifest.json` at the root of the zip.
 */
export interface SkillManifest {
  /** Unique kebab-case identifier. */
  readonly name: string;

  /** Semver version string (e.g., `1.0.0`). */
  readonly version: string;

  /** Human-readable description (max 500 characters). */
  readonly description: string;

  /** Skill author (optional). */
  readonly author?: string;

  /** Runtime type — `javascript` (sandboxed VM) or `python` (per-skill venv). */
  readonly runtime: SkillManifestRuntime;

  /** Relative path within the zip to the entry file (.js or .py). */
  readonly entry: string;

  /** JSON Schema for inputs. */
  readonly parameters: Record<string, unknown>;

  /** Declared permission requirements. */
  readonly permissions?: SkillPermissionCategory[];

  /**
   * File extensions this skill can handle (e.g. [".xlsx", ".csv"]).
   * Used to route uploaded attachments to the right skill automatically.
   */
  readonly supportedFileTypes?: readonly string[];

  /**
   * When true, skill is documentation-only (SKILL.md wrapper); no JS/Python
   * execution for side effects.
   */
  readonly documentationOnly?: boolean;

  /** Required when `runtime` is `"python"`; ignored for JavaScript skills. */
  readonly python?: SkillPythonManifestBlock;

  /**
   * Optional Python execution for documentation-only JavaScript skills when
   * `attachment_ref` is set. Requires hash-pinned `requirements_file` and a
   * `.py` entry inside the skill zip; venv is prepared on import like Python skills.
   */
  readonly python_attachment_execution?: SkillPythonAttachmentExecutionBlock;
}

// ---------------------------------------------------------------------------
// Helper: convert SkillDefinition → ToolFunction
// ---------------------------------------------------------------------------

/**
 * Extracts the LLM-facing subset of a `SkillDefinition`.
 *
 * This is the shape that gets sent to the AI server as `client_tools`.
 */
export function skillDefinitionToToolFunction(
  skill: SkillDefinition
): ToolFunction {
  const description = skill.documentationOnly
    ? `[documentation-only skill] ${skill.description} NOTE: This skill does not execute external scripts or mutate files in aiFetchly.`
    : skill.description;

  return {
    type: "function",
    name: skill.name,
    description,
    parameters: skill.parameters,
  };
}
