/**
 * Shared types for the Claude plugin compatibility layer.
 *
 * The compat layer translates Claude-format manifests and skills into
 * AiFetchly's internal shapes at load time. Adapters are pure: no I/O,
 * no side effects.
 */

import type { PluginFormat } from "@/entityTypes/pluginTypes";
import type {
  PluginMcpServerDeclaration,
  PluginError,
  PluginManifest,
} from "@/entityTypes/pluginTypes";

/**
 * Result of translating a Claude manifest into AiFetchly's internal shape.
 * `manifest` is what downstream code consumes; the extras carry context
 * needed by the loader (which paths to scan, whether MCP is inline, etc).
 */
export interface AdaptedClaudeManifest {
  readonly manifest: PluginManifest;
  readonly format: Extract<PluginFormat, "claude">;
  /** Normalized relative paths to scan for SKILL.md files. */
  readonly skillsPaths: readonly string[];
  /**
   * Path to a sibling .mcp.json file when alternative A is used.
   * Empty when MCP is inline (alternative B) or absent.
   */
  readonly mcpServersPaths: readonly string[];
  /** Inline MCP server map when alternative B is used; undefined otherwise. */
  readonly inlineMcp?: Record<string, PluginMcpServerDeclaration>;
  /** Path to hooks/hooks.json when declared; Phase 3 will consume this. */
  readonly hooksPath?: string;
  /**
   * Opaque carry-through of fields AiFetchly does not yet consume
   * (commands, agents, outputStyles, lsp). Stored so re-emitting the
   * manifest preserves them.
   */
  readonly opaque: Readonly<Record<string, unknown>>;
}

export interface ClaudeAdaptSuccess {
  readonly ok: true;
  readonly adapted: AdaptedClaudeManifest;
}

export interface ClaudeAdaptFailure {
  readonly ok: false;
  readonly errors: readonly PluginError[];
}

export type ClaudeAdaptResult = ClaudeAdaptSuccess | ClaudeAdaptFailure;
