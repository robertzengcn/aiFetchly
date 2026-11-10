import * as fs from "fs";
import * as path from "path";
import {
  parseServersJson,
  normalizeMcpDeclaration,
  normalizeInlineMcpMap,
  type NormalizedMcpServer,
} from "@/service/PluginMcpDeclaration";
import { ClaudePluginAdapter } from "@/service/pluginCompat/ClaudePluginAdapter";
import { unscopeServerName } from "@/service/pluginCompat/McpToolNaming";
import { resolvePluginRelativePath } from "@/entityTypes/pluginTypes";
import {
  PLUGIN_MCP_HOST_RUNTIME,
  readRuntimeDescriptorFromMetadata,
  type PluginRuntimeDescriptor,
} from "@/entityTypes/pluginExecutionTypes";

/**
 * PluginMcpOwnershipChecker (B13) — launch-time ownership contract for
 * host-managed plugin MCP runtimes (design §5.3/§14).
 *
 * The persisted MCP tool row is NOT authority on its own: before any launch
 * the host re-derives the runtime descriptor from the CURRENTLY installed
 * plugin record and the CURRENT on-disk manifest, verifying
 *
 *   1. the row carries a structurally valid host-runtime descriptor,
 *   2. the owning plugin row exists, is enabled and healthy,
 *   3. the server declaration still exists in the current manifest,
 *   4. the declaration still names the SAME runtime kind and entry,
 *
 * so stale rows (uninstalled/disabled/unhealthy owner), forged descriptors,
 * modified entries and update races fail BEFORE the spawn. The re-read makes
 * every launch bind to the content that is actually on disk (the effective
 * generation); rows are re-pointed by the import/update flow itself.
 */

export interface McpRuntimeOwnershipRow {
  readonly version: string;
  readonly enabled: number;
  readonly health: string;
  readonly manifestJson: string;
  readonly installPath: string;
}

export interface McpRuntimeOwnershipInputs {
  readonly pluginName: string;
  /** Row `serverName` (scoped for plugin-owned rows, e.g. "plugin__server"). */
  readonly rowServerName: string;
  /** Parsed row metadata (may be a JSON string kept for tolerance). */
  readonly rowMetadata: Record<string, unknown> | string | undefined;
}

export type McpRuntimeOwnershipResult =
  | {
      readonly ok: true;
      readonly descriptor: PluginRuntimeDescriptor;
      readonly pluginVersion: string;
    }
  | { readonly ok: false; readonly error: string };

export interface OwnershipCheckerFs {
  existsSync(p: string): boolean;
  readFileSync(p: string, encoding: "utf-8"): string;
}

export interface OwnershipCheckerDeps {
  readonly pluginByName?: (
    name: string
  ) => Promise<McpRuntimeOwnershipRow | null>;
  readonly fs?: OwnershipCheckerFs;
}

function defaultOwnershipFs(): OwnershipCheckerFs {
  return fs;
}

interface ParsedManifestSurrogate {
  readonly format?: string;
  readonly mcpServers?: readonly string[];
  readonly [extra: string]: unknown;
}

export class PluginMcpOwnershipChecker {
  private readonly pluginByName: (
    name: string
  ) => Promise<McpRuntimeOwnershipRow | null>;
  private readonly checkerFs: OwnershipCheckerFs;

  constructor(deps: OwnershipCheckerDeps = {}) {
    this.pluginByName = deps.pluginByName ?? this.defaultPluginLookup();
    this.checkerFs = deps.fs ?? defaultOwnershipFs();
  }

  private defaultPluginLookup(): (name: string) => Promise<McpRuntimeOwnershipRow | null> {
    return async (name: string) => {
      // Dynamic import: keeps the DB layer lazy for pure-function callers.
      const { PluginManagementModule } = await import(
        "@/modules/PluginManagementModule"
      );
      const row = await new PluginManagementModule().getPluginByName(name);
      if (!row) return null;
      return {
        version: row.version,
        enabled: row.enabled,
        health: row.health,
        manifestJson: row.manifestJson,
        installPath: row.installPath,
      };
    };
  }

  public async check(
    inputs: McpRuntimeOwnershipInputs
  ): Promise<McpRuntimeOwnershipResult> {
    const metadata =
      typeof inputs.rowMetadata === "string"
        ? this.tryParseJson(inputs.rowMetadata)
        : inputs.rowMetadata;
    const descriptor = readRuntimeDescriptorFromMetadata(metadata ?? null);
    if (!descriptor) {
      return {
        ok: false,
        error:
          "MCP row has no valid host runtime descriptor; refusing to launch.",
      };
    }

    const row = await this.pluginByName(inputs.pluginName);
    if (!row) {
      return {
        ok: false,
        error: `Owner plugin "${inputs.pluginName}" is not installed; refusing to launch its runtime.`,
      };
    }
    if (row.enabled !== 1) {
      return {
        ok: false,
        error: `Owner plugin "${inputs.pluginName}" is disabled; refusing to launch its runtime.`,
      };
    }
    if (row.health !== "healthy") {
      return {
        ok: false,
        error: `Owner plugin "${inputs.pluginName}" is unhealthy (${row.health}); refusing to launch its runtime.`,
      };
    }

    const manifest = this.tryParseJson(row.manifestJson) as
      | ParsedManifestSurrogate
      | null;
    if (!manifest) {
      return {
        ok: false,
        error: `Installed manifest for "${inputs.pluginName}" is unreadable.`,
      };
    }

    const declarations = this.readCurrentRuntimeDeclarations(
      row.installPath,
      manifest
    );
    if (!declarations.ok) {
      return { ok: false, error: declarations.error };
    }

    const metadataRecord = (metadata ?? {}) as Record<string, unknown>;
    const declaredRowName =
      typeof metadataRecord.pluginServerName === "string" &&
      metadataRecord.pluginServerName.length > 0
        ? metadataRecord.pluginServerName
        : unscopeServerName(inputs.pluginName, inputs.rowServerName);
    const current = declarations.servers.find(
      (d) => d.serverName === declaredRowName
    );
    if (!current) {
      return {
        ok: false,
        error: `Server declaration "${declaredRowName}" is not present in the current installed manifest for "${inputs.pluginName}".`,
      };
    }
    if (
      current.runtime !== PLUGIN_MCP_HOST_RUNTIME ||
      typeof current.entry !== "string"
    ) {
      return {
        ok: false,
        error: `Server declaration "${declaredRowName}" no longer declares a host runtime.`,
      };
    }
    if (current.entry !== descriptor.entry) {
      return {
        ok: false,
        error: `Runtime entry "${descriptor.entry}" does not match the current installed declaration "${current.entry}" (modified entry or update race).`,
      };
    }

    return {
      ok: true,
      descriptor,
      pluginVersion: row.version,
    };
  }

  /**
   * Re-derive the CURRENT runtime declarations from disk, mirroring the
   * import-time normalization (PluginImportService readPluginMcpServers +
   * ClaudePluginAdapter paths).
   */
  private readCurrentRuntimeDeclarations(
    installPath: string,
    manifest: ParsedManifestSurrogate
  ):
    | { ok: true; servers: readonly NormalizedMcpServer[] }
    | { ok: false; error: string } {
    const out: NormalizedMcpServer[] = [];
    if (manifest.format === "claude") {
      const claudeManifestPath = path.join(
        installPath,
        ".claude-plugin",
        "plugin.json"
      );
      if (!this.checkerFs.existsSync(claudeManifestPath)) {
        return {
          ok: false,
          error: "Claude manifest (.claude-plugin/plugin.json) is missing.",
        };
      }
      let claudeRaw: unknown;
      try {
        claudeRaw = JSON.parse(
          this.checkerFs.readFileSync(claudeManifestPath, "utf-8")
        );
      } catch {
        return { ok: false, error: "Claude manifest is not valid JSON." };
      }
      const adapted = ClaudePluginAdapter.adapt(claudeRaw, {
        pluginRoot: installPath,
      });
      if (adapted.ok && adapted.adapted.inlineMcp) {
        const normalized = normalizeInlineMcpMap(
          adapted.adapted.inlineMcp,
          installPath
        );
        if (normalized.ok) out.push(...normalized.servers);
      } else if (adapted.ok) {
        // Claude alternative A: sibling .mcp.json at the plugin root.
        out.push(
          ...this.readServersJsonFiles(installPath, [".mcp.json"]).matching
        );
      }
      if (!adapted.ok) {
        return { ok: false, error: "Claude manifest failed re-adaptation." };
      }
      return { ok: true, servers: out };
    }

    // AiFetchly native format: each mcpServers entry is a servers.json path.
    const paths = manifest.mcpServers ?? [];
    const { matching } = this.readServersJsonFiles(installPath, paths);
    out.push(...matching);
    return { ok: true, servers: out };
  }

  private readServersJsonFiles(
    installPath: string,
    paths: readonly string[]
  ): { matching: NormalizedMcpServer[] } {
    const servers: NormalizedMcpServer[] = [];
    for (const relPath of paths) {
      if (typeof relPath !== "string" || relPath.length === 0) continue;
      let absPath: string;
      try {
        absPath = resolvePluginRelativePath(installPath, relPath);
      } catch {
        continue; // path escapes plugin root — no declaration to match
      }
      if (!this.checkerFs.existsSync(absPath)) continue;
      let parsed;
      try {
        parsed = parseServersJson(
          this.checkerFs.readFileSync(absPath, "utf-8"),
          relPath
        );
      } catch {
        continue;
      }
      if (!parsed.ok) continue;
      for (const [key, decl] of Object.entries(parsed.servers)) {
        const normalized = normalizeMcpDeclaration(key, decl, installPath, relPath);
        if (normalized.ok) servers.push(normalized.normalized);
      }
    }
    return { matching: servers };
  }

  private tryParseJson(text: string): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(text) as unknown;
      return parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
}

export function getPluginMcpOwnershipChecker(): PluginMcpOwnershipChecker {
  return new PluginMcpOwnershipChecker();
}
