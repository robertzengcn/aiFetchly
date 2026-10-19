import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { randomUUID } from "crypto";
import type { PluginError } from "@/entityTypes/pluginTypes";
import { resolvePluginRelativePath } from "@/entityTypes/pluginTypes";
import type { PluginHostContextV1 } from "@/entityTypes/pluginExecutionTypes";
import { getPluginInstallRoot } from "@/service/pluginPaths";

/**
 * PluginMcpRuntimeResolver — trusted launch preparation for host-managed
 * plugin MCP runtimes (plugin PRD §19.5–19.6, design §6.1–6.2).
 *
 * The resolver is the ONLY source of the internal launch descriptor: it maps
 * a validated plugin runtime declaration (runtime kind + plugin-relative
 * entry) to { executable: process.execPath, entryFile, cwd } and writes the
 * permission-restricted host context file. The descriptor cannot be
 * constructed from renderer or package data — there is no "trusted" boolean
 * input anywhere.
 *
 * Environment assembly happens inside SupervisedStdioTransport:
 *   1. buildSanitizedChildEnv(config.env) — rejects declaration-supplied
 *      ELECTRON_ and NODE_ variables
 *   2. inject ELECTRON_RUN_AS_NODE=1 from trusted host code AFTER sanitization
 *   3. spawn with shell:false and piped stdio
 */

export interface ResolvedPluginLaunch {
  readonly pluginName: string;
  readonly runtime: "aifetchly-node";
  /** Host executable (process.execPath) — never sourced from plugin data. */
  readonly executable: string;
  /** Absolute, host-validated entry file inside the plugin install root. */
  readonly entryFile: string;
  /** Plugin install root used as the child cwd. */
  readonly cwd: string;
  /** Owned-process family id for supervised tree shutdown. */
  readonly ownerId: string;
  /** Fixed host-generated argv appended after the entry file. */
  readonly extraArgs: readonly string[];
  /** Absolute path of the written host-context JSON file (when present). */
  readonly hostContextFile: string | null;
  /** Execution id the launch (and its released map entry) is bound to. */
  readonly executionId: string;
}

export type RuntimeResolveResult =
  | { readonly ok: true; readonly launch: ResolvedPluginLaunch }
  | { readonly ok: false; readonly error: PluginError };

/** Structural fs subset so tests never touch the real filesystem. */
export interface ResolverFs {
  existsSync(p: string): boolean;
  statSync(p: string): { isFile(): boolean; isDirectory(): boolean };
  realpathSync(p: string): string;
  mkdirSync(p: string, options?: { recursive: boolean; mode?: number }): string | undefined;
  writeFileSync(p: string, data: string, options?: { mode: number }): void;
  renameSync(from: string, to: string): void;
  unlinkSync(p: string): void;
}

export interface PluginMcpRuntimeResolverDeps {
  readonly execPath?: string;
  readonly fs?: ResolverFs;
  readonly tmpRoot?: string;
  readonly installRootFor?: (pluginName: string) => string;
  readonly executionIdFactory?: () => string;
}

const HOST_CONTEXT_ARG = "--host-context-file";

function defaultFs(): ResolverFs {
  return fs;
}

export class PluginMcpRuntimeResolver {
  private readonly execPath: string;
  private readonly fs: ResolverFs;
  private readonly tmpRoot: string;
  private readonly installRootFor: (pluginName: string) => string;
  private readonly newExecutionId: () => string;
  private readonly launched = new Map<string, ResolvedPluginLaunch>();

  constructor(deps: PluginMcpRuntimeResolverDeps = {}) {
    this.execPath = deps.execPath ?? process.execPath;
    this.fs = deps.fs ?? defaultFs();
    this.tmpRoot =
      deps.tmpRoot ?? path.join(os.tmpdir(), "aifetchly-plugin-ctx");
    this.installRootFor = deps.installRootFor ?? getPluginInstallRoot;
    this.newExecutionId = deps.executionIdFactory ?? randomUUID;
  }

  /**
   * Resolve a launch for discovery (initialize / tools/list). No browser,
   * no output directory — the plugin must support tool discovery without
   * launching Chrome (design §6.2).
   */
  public resolveForDiscovery(
    pluginName: string,
    entry: string,
    pluginVersion = "unknown"
  ): RuntimeResolveResult {
    return this.resolve(pluginName, entry, {
      version: 1,
      mode: "discovery",
      executionId: this.newExecutionId(),
      pluginName,
      pluginVersion,
    });
  }

  /**
   * Resolve a launch for execution, carrying the host context (deadline,
   * browser executable, output directory). All context fields are
   * host-generated; none may originate from model tool arguments.
   */
  public resolveForExecute(
    pluginName: string,
    entry: string,
    context: Omit<PluginHostContextV1, "version" | "pluginName">
  ): RuntimeResolveResult {
    return this.resolve(pluginName, entry, {
      version: 1,
      pluginName,
      ...context,
    });
  }

  private resolve(
    pluginName: string,
    entry: string,
    context: PluginHostContextV1
  ): RuntimeResolveResult {
    const failure = (
      code: PluginError["code"],
      message: string
    ): RuntimeResolveResult => ({
      ok: false,
      error: {
        code,
        componentType: "mcpServer",
        componentName: pluginName,
        message,
        recoverable: false,
      },
    });

    if (typeof entry !== "string" || entry.length === 0) {
      return failure("mcp-config-invalid", "Runtime entry is empty.");
    }
    // path.join absorbs an absolute path into the root, so the absolute and
    // traversal shapes are rejected explicitly BEFORE containment resolution.
    if (path.isAbsolute(entry) || entry.includes("..") || entry.includes("\0")) {
      return failure(
        "path-outside-plugin",
        `Entry "${entry}" must be a relative path inside the plugin root.`
      );
    }
    const installRoot = this.installRootFor(pluginName);

    // Lexical containment (throws on "../" escape), then realpath resistance.
    let entryFile: string;
    try {
      entryFile = resolvePluginRelativePath(installRoot, entry);
    } catch (e) {
      return failure(
        "path-outside-plugin",
        e instanceof Error ? e.message : "Entry escapes plugin root."
      );
    }

    let realRoot: string;
    try {
      realRoot = this.fs.realpathSync(installRoot);
    } catch {
      return failure(
        "missing_files",
        `Plugin "${pluginName}" install root is not present.`
      );
    }
    try {
      const realEntry = this.fs.realpathSync(entryFile);
      if (
        realEntry !== realRoot &&
        !realEntry.startsWith(`${realRoot}${path.sep}`)
      ) {
        return failure(
          "path-outside-plugin",
          `Entry "${entry}" resolves outside the plugin install root (symlink escape).`
        );
      }
      if (!this.fs.statSync(realEntry).isFile()) {
        return failure("missing_files", `Entry "${entry}" is not a file.`);
      }
      entryFile = realEntry;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "EACCES") {
        return failure(
          "missing_files",
          `Entry "${entry}" could not be validated: ${String(e)}`
        );
      }
      return failure("missing_files", `Entry "${entry}" does not exist.`);
    }

    // Write the host context file atomically with restrictive permissions.
    let hostContextFile: string | null = null;
    const extraArgs: string[] = [];
    try {
      // The transient directory is host-owned and permission-restricted
      // (0700) — plugins and other local users must never read the
      // host-context contents (design §5.3).
      this.fs.mkdirSync(this.tmpRoot, { recursive: true, mode: 0o700 });
      const finalPath = path.join(
        this.tmpRoot,
        `${context.executionId}.json`
      );
      const stagingPath = `${finalPath}.tmp`;
      try {
        this.fs.writeFileSync(
          stagingPath,
          JSON.stringify(context),
          { mode: 0o600 }
        );
        this.fs.renameSync(stagingPath, finalPath);
      } catch (e) {
        // A failed rename would otherwise leave the .tmp file behind and
        // grow the temporary root on every retry (B13).
        try {
          this.fs.unlinkSync(stagingPath);
        } catch {
          /* already gone */
        }
        throw e;
      }
      hostContextFile = finalPath;
      extraArgs.push(HOST_CONTEXT_ARG, finalPath);
    } catch (e) {
      return failure(
        "install-io-failed",
        `Failed to write host context file: ${String(e)}`
      );
    }

    const launch: ResolvedPluginLaunch = {
      pluginName,
      runtime: "aifetchly-node",
      executable: this.execPath,
      entryFile,
      cwd: installRoot,
      ownerId: `plugin-mcp:${pluginName}`,
      extraArgs,
      hostContextFile,
      executionId: context.executionId,
    };
    this.launched.set(context.executionId, launch);
    return { ok: true, launch };
  }

  /**
   * Release a launch: delete the transient host-context file AND the
   * launched-map entry, so repeated discovery/executions cannot grow state
   * without bound (B13). Idempotent and safe on every terminal path
   * (completion, failure, cancellation, timeout).
   */
  public release(launch: ResolvedPluginLaunch): void {
    if (launch.hostContextFile) {
      try {
        this.fs.unlinkSync(launch.hostContextFile);
      } catch {
        // best-effort: file may already be gone
      }
    }
    try {
      this.launched.delete(launch.executionId);
    } catch {
      /* structural map — cannot fail in practice */
    }
  }
}

let defaultResolver: PluginMcpRuntimeResolver | undefined;

export function getPluginMcpRuntimeResolver(): PluginMcpRuntimeResolver {
  if (!defaultResolver) defaultResolver = new PluginMcpRuntimeResolver();
  return defaultResolver;
}

export function setPluginMcpRuntimeResolverForTest(
  resolver: PluginMcpRuntimeResolver | undefined
): void {
  defaultResolver = resolver;
}

export { HOST_CONTEXT_ARG };

// Re-export for transport consumers without reaching into private fields.
export type { PluginHostContextV1 };
