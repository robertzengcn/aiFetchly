import * as path from "path";
import type {
  PluginMcpServerDeclaration,
  PluginMcpTransport,
  PluginError,
} from "@/entityTypes/pluginTypes";

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
}

export interface ParseServersJsonOk {
  readonly ok: true;
  readonly servers: Record<string, PluginMcpServerDeclaration>;
}

export interface ParseServersJsonError {
  readonly ok: false;
  readonly error: PluginError;
}

export type ParseServersJsonResult =
  | ParseServersJsonOk
  | ParseServersJsonError;

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
    if (
      decl.command.includes("..") ||
      path.isAbsolute(decl.command)
    ) {
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
  return { ok: true, normalized };
}
