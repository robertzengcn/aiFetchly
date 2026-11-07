import * as path from "path";
import type {
  PluginMcpServerDeclaration,
  PluginMcpTransport,
  PluginError,
} from "@/entityTypes/pluginTypes";
import {
  HOST_RUNTIME_METADATA_FIELD,
  PLUGIN_MCP_HOST_RUNTIME,
} from "@/entityTypes/pluginExecutionTypes";

/**
 * Parse and normalize MCP server declarations from a plugin's mcp/servers.json.
 * Source of truth: Design §4.3 normalization rules.
 *
 * Pure functions — no I/O, no process spawning. The plugin import service
 * reads the file content and hands it here.
 */

export interface NormalizedMcpServer {
  readonly serverName: string;
  readonly transport: PluginMcpTransport;
  readonly command?: string;
  readonly args: readonly string[];
  readonly env: Record<string, string>;
  readonly host?: string;
  readonly port?: number;
  readonly url?: string;
  readonly timeout?: number;
  readonly description?: string;
  readonly authType: "none" | "api_key" | "bearer_token" | "custom";
  readonly metadata: Record<string, unknown>;
  /** Relative path of the servers.json file inside the plugin (for diagnostics). */
  readonly componentPath: string;
  /** Host-managed runtime kind (design §5.2). Present ⇒ no command/args. */
  readonly runtime?: typeof PLUGIN_MCP_HOST_RUNTIME;
  /** Plugin-relative entry path validated at normalize AND launch time. */
  readonly entry?: string;
}

export interface ParseServersJsonOk {
  readonly ok: true;
  readonly servers: Record<string, PluginMcpServerDeclaration>;
}

export interface ParseServersJsonError {
  readonly ok: false;
  readonly error: PluginError;
}

export type ParseServersJsonResult = ParseServersJsonOk | ParseServersJsonError;

/**
 * Parse the raw JSON content of a mcp/servers.json file.
 * Returns the `mcpServers` object or a structured error.
 */
export function parseServersJson(
  content: string,
  componentPath: string
): ParseServersJsonResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e: unknown) {
    return {
      ok: false,
      error: {
        code: "mcp-config-invalid",
        componentType: "mcpServer",
        componentName: componentPath,
        message:
          e instanceof Error
            ? `servers.json is not valid JSON: ${e.message}`
            : "servers.json is not valid JSON",
        recoverable: false,
      },
    };
  }

  if (!parsed || typeof parsed !== "object") {
    return {
      ok: false,
      error: {
        code: "mcp-config-invalid",
        componentType: "mcpServer",
        componentName: componentPath,
        message: "servers.json must be an object with an mcpServers field.",
        recoverable: false,
      },
    };
  }

  const obj = parsed as Record<string, unknown>;
  const serversField = obj.mcpServers;
  if (!serversField || typeof serversField !== "object") {
    return {
      ok: false,
      error: {
        code: "mcp-config-invalid",
        componentType: "mcpServer",
        componentName: componentPath,
        message: 'servers.json must contain an "mcpServers" object.',
        recoverable: false,
      },
    };
  }

  const servers = serversField as Record<string, PluginMcpServerDeclaration>;
  return { ok: true, servers };
}

export interface NormalizeOk {
  readonly ok: true;
  readonly normalized: NormalizedMcpServer;
}

export interface NormalizeError {
  readonly ok: false;
  readonly error: PluginError;
}

export type NormalizeResult = NormalizeOk | NormalizeError;

/**
 * Normalize a single MCP server declaration.
 * Applies Design §4.3 normalization rules:
 *  - Missing transport defaults to "stdio" when command is present.
 *  - stdio requires command; sse/websocket require host or url.
 *  - args must be an array of strings.
 *  - Relative command paths resolve inside plugin root only.
 *  - env values are preserved (placeholders resolved at connect time).
 */
export function normalizeMcpDeclaration(
  key: string,
  decl: PluginMcpServerDeclaration,
  pluginRoot: string,
  componentPath: string
): NormalizeResult {
  // Host-managed runtime variant (plugin PRD §19.5 / design §5.2): the plugin
  // declares JavaScript code + a required host runtime instead of an OS
  // executable. runtime/entry and command/args are mutually exclusive; the
  // normalized descriptor rides in metadata under the reserved host-owned key
  // and is revalidated at every launch.
  if (decl.runtime !== undefined) {
    return normalizeHostRuntimeDeclaration(key, decl, componentPath);
  }

  const transport: PluginMcpTransport =
    decl.transport ?? (decl.command ? "stdio" : "stdio");

  // Validate args
  let args: readonly string[] = [];
  if (decl.args !== undefined) {
    if (
      !Array.isArray(decl.args) ||
      !decl.args.every((a) => typeof a === "string")
    ) {
      return {
        ok: false,
        error: {
          code: "mcp-config-invalid",
          componentType: "mcpServer",
          componentName: key,
          message: `"args" for server "${key}" must be an array of strings.`,
          recoverable: false,
        },
      };
    }
    args = decl.args;
  }

  // Validate env
  let env: Record<string, string> = {};
  if (decl.env !== undefined) {
    if (typeof decl.env !== "object" || decl.env === null) {
      return {
        ok: false,
        error: {
          code: "mcp-config-invalid",
          componentType: "mcpServer",
          componentName: key,
          message: `"env" for server "${key}" must be an object.`,
          recoverable: false,
        },
      };
    }
    env = decl.env as Record<string, string>;
  }

  if (transport === "stdio") {
    if (typeof decl.command !== "string" || decl.command.length === 0) {
      return {
        ok: false,
        error: {
          code: "mcp-config-invalid",
          componentType: "mcpServer",
          componentName: key,
          message: `stdio server "${key}" requires a non-empty "command".`,
          recoverable: false,
        },
      };
    }
    // Relative command paths must resolve inside plugin root.
    if (decl.command.includes("..") || path.isAbsolute(decl.command)) {
      return {
        ok: false,
        error: {
          code: "path-outside-plugin",
          componentType: "mcpServer",
          componentName: key,
          message: `command "${decl.command}" for server "${key}" must be an absolute executable or a path inside the plugin root.`,
          recoverable: false,
        },
      };
    }
  } else {
    // sse / websocket require host or url
    const hasHost = typeof decl.host === "string" && decl.host.length > 0;
    const hasUrl = typeof decl.url === "string" && decl.url.length > 0;
    if (!hasHost && !hasUrl) {
      return {
        ok: false,
        error: {
          code: "mcp-config-invalid",
          componentType: "mcpServer",
          componentName: key,
          message: `${transport} server "${key}" requires "host" or "url".`,
          recoverable: false,
        },
      };
    }
  }

  const normalized: NormalizedMcpServer = {
    serverName: key,
    transport,
    command: decl.command,
    args,
    env,
    host: decl.host,
    port: decl.port,
    url: decl.url,
    timeout: decl.timeout,
    description: decl.description,
    authType: decl.authType ?? "none",
    metadata: decl.metadata ?? {},
    componentPath,
  };
  // H6: the reserved runtime-descriptor key is HOST-owned. A package that
  // declares it on a (non-runtime) server is rejected outright — keeping it
  // would let `createServerBase` resolve a host runtime whose entry
  // confinement was never validated at import.
  if (
    (decl.metadata as Record<string, unknown> | undefined)?.[
      HOST_RUNTIME_METADATA_FIELD
    ] !== undefined
  ) {
    return {
      ok: false,
      error: {
        code: "mcp-config-invalid",
        componentType: "mcpServer",
        componentName: key,
        message: `server "${key}" may not declare the reserved "${HOST_RUNTIME_METADATA_FIELD}" metadata key; only the host normalizer writes it.`,
        recoverable: false,
      },
    };
  }
  return { ok: true, normalized };
}

/**
 * Normalize a host-managed runtime declaration (`runtime` + `entry`).
 * Rules (design §5.2):
 *  - Only "aifetchly-node" is a known runtime.
 *  - runtime/entry and command/args are mutually exclusive.
 *  - entry must be a relative path that cannot lexically escape the plugin
 *    root (launch revalidates against the real filesystem).
 *  - The normalized descriptor is stored under the reserved host-owned
 *    metadata key; a package that declares that key is rejected (it is
 *    never adapted from package metadata — only the host writes it).
 */
function normalizeHostRuntimeDeclaration(
  key: string,
  decl: PluginMcpServerDeclaration,
  componentPath: string
): NormalizeResult {
  const invalid = (
    message: string,
    code: "mcp-config-invalid" | "path-outside-plugin" = "mcp-config-invalid"
  ): NormalizeError => ({
    ok: false,
    error: {
      code,
      componentType: "mcpServer",
      componentName: key,
      message,
      recoverable: false,
    },
  });

  if (decl.runtime !== PLUGIN_MCP_HOST_RUNTIME) {
    return invalid(
      `server "${key}" declares unknown runtime "${String(decl.runtime)}"; supported: "${PLUGIN_MCP_HOST_RUNTIME}".`
    );
  }
  if (decl.command !== undefined || (decl.args ?? []).length > 0) {
    return invalid(
      `server "${key}" cannot declare both a host runtime and a command/args; they are mutually exclusive.`
    );
  }
  if (decl.transport !== undefined && decl.transport !== "stdio") {
    return invalid(
      `host-managed runtime server "${key}" must use stdio transport.`
    );
  }
  if (typeof decl.entry !== "string" || decl.entry.length === 0) {
    return invalid(
      `runtime server "${key}" requires a non-empty plugin-relative "entry".`
    );
  }
  if (path.isAbsolute(decl.entry) || decl.entry.includes("..")) {
    return invalid(
      `entry "${decl.entry}" for server "${key}" must be a relative path inside the plugin root.`,
      "path-outside-plugin"
    );
  }
  if (decl.entry.includes("\0")) {
    return invalid(
      `entry for server "${key}" contains a null byte.`,
      "path-outside-plugin"
    );
  }

  // Section 5.3: the package may not supply the reserved runtime key AT
  // ALL — the host rejects it instead of silently overwriting it, exactly
  // like the non-runtime branch, and then writes its own normalized value.
  if (
    (decl.metadata as Record<string, unknown> | undefined)?.[
      HOST_RUNTIME_METADATA_FIELD
    ] !== undefined
  ) {
    return invalid(
      `server "${key}" may not declare the reserved "${HOST_RUNTIME_METADATA_FIELD}" metadata key; only the host writes it.`
    );
  }
  // Host-owned descriptor: the only place the reserved key is written.
  const metadata: Record<string, unknown> = { ...(decl.metadata ?? {}) };
  metadata[HOST_RUNTIME_METADATA_FIELD] = {
    contractVersion: 1,
    runtime: PLUGIN_MCP_HOST_RUNTIME,
    entry: decl.entry,
  };

  const normalized: NormalizedMcpServer = {
    serverName: key,
    transport: "stdio",
    args: [],
    env: {},
    authType: decl.authType ?? "none",
    timeout: decl.timeout,
    description: decl.description,
    metadata,
    componentPath,
    runtime: PLUGIN_MCP_HOST_RUNTIME,
    entry: decl.entry,
  };
  return { ok: true, normalized };
}

export interface InlineMcpNormalizeOk {
  readonly ok: true;
  readonly servers: readonly NormalizedMcpServer[];
}

export interface InlineMcpNormalizeError {
  readonly ok: false;
  readonly errors: readonly PluginError[];
}

export type InlineMcpNormalizeResult =
  | InlineMcpNormalizeOk
  | InlineMcpNormalizeError;

/**
 * Normalize an inline MCP server map (Claude manifest alternative B:
 * `mcp: { ... }` inside the manifest itself, no sibling .mcp.json file).
 *
 * Mirrors the per-server validation that `readPluginMcpServers` performs
 * for the file form. Returns errors collected per server.
 */
export function normalizeInlineMcpMap(
  map: Record<string, PluginMcpServerDeclaration>,
  pluginRoot: string
): InlineMcpNormalizeResult {
  const out: NormalizedMcpServer[] = [];
  const errors: PluginError[] = [];
  for (const [key, decl] of Object.entries(map)) {
    const norm = normalizeMcpDeclaration(key, decl, pluginRoot, "(inline mcp)");
    if (norm.ok) {
      out.push(norm.normalized);
    } else {
      errors.push(norm.error);
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, servers: out };
}
