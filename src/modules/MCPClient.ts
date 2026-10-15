import { spawn, ChildProcess } from "child_process";
import { log } from "@/modules/Logger";
import { MCP_CONNECT_TIMEOUT_MS } from "@/config/mcpConfig";
import {
  SupervisedStdioTransport,
  type SupervisedStdioTransportOptions,
} from "@/modules/mcp/SupervisedStdioTransport";
import { buildSanitizedChildEnv } from "@/modules/mcp/mcpSpawnPolicy";
import {
  getPluginMcpRuntimeResolver,
  type ResolvedPluginLaunch,
} from "@/service/PluginMcpRuntimeResolver";
import { Client as McpSdkClient } from "@modelcontextprotocol/sdk/client/index.js";
import type { WebSocket as WSWebSocket } from "ws";

// WebSocket import - use dynamic import for optional dependency
let WebSocket: typeof import("ws") | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  WebSocket = require("ws");
} catch {
  // WebSocket not available, will throw error when trying to use it
}

export interface MCPClientConfig {
  host?: string;
  port?: number;
  transport: "stdio" | "sse" | "websocket";
  authType?: "none" | "api_key" | "bearer_token" | "custom";
  authConfig?: Record<string, unknown>;
  timeout?: number;
  /** Explicit stdio command (e.g. "npx"). Takes precedence over host-splitting. */
  command?: string;
  /** Args for the stdio command. */
  args?: string[];
  /** Env vars for the spawned stdio process. */
  env?: Record<string, string>;
  /** Working directory for the spawned process (plugin-owned servers). */
  cwd?: string;
  /** Owned-process family id for supervised stdio spawns. */
  ownerId?: string;
  /**
   * Host-managed plugin runtime (plugin PRD §19.5). When present, the client
   * resolves the trusted launch through PluginMcpRuntimeResolver instead of
   * spawning a plugin-declared OS command: process.execPath in Node mode with
   * the validated entry file and a written host-context file. Mutually
   * exclusive with command/host in practice; command stays ignored.
   */
  hostRuntime?: {
    readonly pluginName: string;
    readonly entry: string;
    readonly pluginVersion?: string;
    /**
     * Execute-mode host context (deadline, browser, output directory). When
     * absent the launch is discovery mode — no browser, no output allocation
     * (design §6.2).
     */
    readonly context?: {
      readonly mode: "execute";
      readonly executionId: string;
      readonly outputDirectory?: string;
      readonly browser?: {
        readonly executablePath: string;
        readonly version: string;
      };
      readonly deadlineEpochMs?: number;
    };
  };
}

export interface MCPToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/** Normalized content block of a tool result (design §4.1: complete blocks). */
export type MCPContentBlock =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "image";
      readonly mimeType: string;
      /** Base64 payload; must be routed to the supervisor, never persisted. */
      readonly data: string;
    }
  | {
      readonly type: "audio";
      readonly mimeType: string;
      readonly data: string;
    }
  | {
      readonly type: "resource";
      readonly resource: {
        readonly uri: string;
        readonly text?: string;
        readonly blob?: string;
        readonly mimeType?: string;
      };
    }
  | {
      /** Preserved for completeness (audit A19): MCP resource_link blocks. */
      readonly type: "resource_link";
      readonly uri: string;
      readonly name?: string;
      readonly description?: string;
      readonly mimeType?: string;
    };

/** Structured tool-call result preserving every content block plus isError. */
export interface MCPToolCallContent {
  readonly content: readonly MCPContentBlock[];
  readonly structuredContent?: Record<string, unknown>;
  readonly isError: boolean;
}

/**
 * MCP Client for communicating with MCP servers.
 *
 * The stdio path is rebuilt on the official `@modelcontextprotocol/sdk`
 * `Client` with a host-owned `SupervisedStdioTransport` (PRD D-19): full
 * initialize/version negotiation, `notifications/initialized`, server→client
 * notifications/progress/cancellation, complete content blocks, graceful
 * close, and process-tree termination. The legacy WebSocket path is kept for
 * existing generic servers; SSE remains unsupported.
 */
export class MCPClient {
  private config: MCPClientConfig;
  private connection: ChildProcess | WSWebSocket | null = null;
  private connected = false;
  private requestId = 0;
  /** SDK client for the stdio path; owns the transport lifecycle. */
  private sdk: McpSdkClient | null = null;
  /** Trusted host-runtime launch adopted by connectStdioHostRuntime. */
  private hostLaunch: ResolvedPluginLaunch | null = null;
  private pendingRequests: Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  > = new Map();

  constructor(config: MCPClientConfig) {
    this.config = {
      timeout: 30000,
      ...config,
    };
  }

  /**
   * Establish connection based on transport type.
   *
   * Race-protects the underlying `doConnect()` with `MCP_CONNECT_TIMEOUT_MS`
   * so a dead MCP server fails fast instead of eating the entire call budget.
   * On timeout we force-disconnect to clean up any spawned process and avoid
   * leaving `this.connected = true` on an abandoned client.
   */
  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("MCP connection timeout")),
        MCP_CONNECT_TIMEOUT_MS
      );
    });

    // Keep a handle on the raced-away connect attempt: when the timeout wins,
    // its eventual rejection must not surface as an unhandled rejection.
    const connectPromise = this.doConnect();
    connectPromise.catch(() => undefined);
    try {
      await Promise.race([connectPromise, timeoutPromise]);
    } catch (err) {
      if (err instanceof Error && err.message === "MCP connection timeout") {
        // Force cleanup — disconnect() would no-op because this.connected is
        // still false (doConnect hasn't completed). We must bypass the guard.
        try {
          if (this.sdk) {
            await this.sdk.close().catch(() => {
              /* best-effort */
            });
            this.sdk = null;
          }
          if (
            this.config.transport === "stdio" &&
            this.connection &&
            "kill" in this.connection
          ) {
            (this.connection as ChildProcess).kill("SIGKILL");
          } else if (
            (this.config.transport === "websocket" ||
              this.config.transport === "sse") &&
            this.connection
          ) {
            const conn = this.connection as { close?: () => void };
            if (typeof conn.close === "function") conn.close();
          }
        } catch {
          /* best-effort cleanup */
        }
        this.connection = null;
      }
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Actual connection logic — dispatched by connect() which wraps it in a
   * race timeout. Sets `this.connected = true` on success.
   */
  private async doConnect(): Promise<void> {
    switch (this.config.transport) {
      case "stdio":
        await this.connectStdio();
        break;
      case "sse":
        await this.connectSSE();
        break;
      case "websocket":
        await this.connectWebSocket();
        break;
      default:
        throw new Error(`Unsupported transport type: ${this.config.transport}`);
    }

    this.connected = true;
  }

  /**
   * Connect via stdio on the official SDK: spawn through the supervised
   * transport, run the full initialize/version-negotiation handshake, and
   * fail closed when the server negotiates an unsupported protocol version.
   */
  private async connectStdio(): Promise<void> {
    // Host-managed plugin runtime: resolve the trusted launch (validated
    // entry, process.execPath, host-context file) and spawn through the
    // transport's trustedNodeLaunch branch. Falls through to the normal
    // command path for every other server.
    if (this.config.hostRuntime) {
      return this.connectStdioHostRuntime();
    }

    // Prefer explicit command/args (plugin-owned stdio servers). Fall back to
    // the legacy "host is a space-separated command" convention for manually
    // added stdio servers.
    let command: string;
    let args: string[];
    if (this.config.command) {
      command = this.config.command;
      args = this.config.args ?? [];
    } else {
      const parts = (this.config.host ?? "").split(" ");
      command = parts[0] ?? "";
      args = parts.slice(1);
    }
    if (!command) {
      throw new Error(
        "stdio transport requires a command (or a host string to split)"
      );
    }

    const transportOptions: SupervisedStdioTransportOptions = {
      command,
      args,
      env: this.config.env,
      cwd: this.config.cwd,
      ownerId: this.config.ownerId ?? "mcp-server",
    };

    const transport = new SupervisedStdioTransport(transportOptions);
    await this.adoptSdkTransport(transport);
  }

  /**
   * Host-managed runtime branch (plugin PRD §19.7): resolve the launch via
   * PluginMcpRuntimeResolver (entry confinement, atomic host-context file),
   * spawn process.execPath in Node mode through the supervised transport, and
   * release the context file on disconnect.
   */
  private async connectStdioHostRuntime(): Promise<void> {
    const { pluginName, entry, pluginVersion, context } =
      this.config.hostRuntime!;

    const resolver = getPluginMcpRuntimeResolver();
    const resolved = context
      ? resolver.resolveForExecute(pluginName, entry, {
          mode: "execute",
          executionId: context.executionId,
          pluginVersion: pluginVersion ?? "unknown",
          outputDirectory: context.outputDirectory,
          browser: context.browser,
          deadlineEpochMs: context.deadlineEpochMs,
        })
      : resolver.resolveForDiscovery(
          pluginName,
          entry,
          pluginVersion ?? "unknown"
        );
    if (!resolved.ok) {
      throw new Error(
        `Plugin MCP runtime for "${pluginName}" rejected: ${resolved.error.message}`
      );
    }
    this.hostLaunch = resolved.launch;

    const transport = new SupervisedStdioTransport({
      command: resolved.launch.executable,
      args: resolved.launch.extraArgs,
      env: this.config.env,
      cwd: resolved.launch.cwd,
      ownerId: resolved.launch.ownerId,
      trustedNodeLaunch: {
        executable: resolved.launch.executable,
        entryFile: resolved.launch.entryFile,
      },
    });
    try {
      await this.adoptSdkTransport(transport);
    } catch (error) {
      // Failed handshake — release the transient context file immediately.
      resolver.release(resolved.launch);
      this.hostLaunch = null;
      throw error;
    }
  }

  /** Shared SDK handshake/adoption used by both stdio branches. */
  private async adoptSdkTransport(
    transport: SupervisedStdioTransport
  ): Promise<void> {
    const client = new McpSdkClient(
      { name: "aiFetchly", version: "1.0.0" },
      { capabilities: {} }
    );
    // Assign BEFORE the handshake: a connect() timeout must be able to close
    // this client (and through it the transport, which owns and kills the
    // spawned server child). Leaving it null here leaks the child process.
    this.sdk = client;

    try {
      await client.connect(transport);
    } catch (error) {
      this.sdk = null;
      await client.close().catch(() => {
        /* best-effort */
      });
      throw error;
    }

    // Protocol-version pinning (design §4.1) is enforced inside the SDK
    // Client: connect() rejects a server whose negotiated protocolVersion is
    // outside SUPPORTED_PROTOCOL_VERSIONS.

    this.sdk = client;
    this.connection = null; // the SDK owns the child via the transport
  }

  /**
   * Connect via SSE (SSE remains out of scope; Computer Use uses stdio).
   */
  private async connectSSE(): Promise<void> {
    throw new Error("SSE transport not yet implemented");
  }

  /**
   * Connect via WebSocket (legacy path for existing generic servers).
   */
  private async connectWebSocket(): Promise<void> {
    if (!WebSocket) {
      throw new Error(
        "WebSocket support requires 'ws' package. Install it with: yarn add ws"
      );
    }

    const url = `ws://${this.config.host}:${this.config.port || 8080}`;

    return new Promise((resolve, reject) => {
      const ws = new WebSocket.WebSocket(url);

      ws.on("open", () => {
        this.connection = ws;
        // Send initialize request
        this.sendRequest("initialize", {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: {
            name: "aiFetchly",
            version: "1.0.0",
          },
        })
          .then(() => {
            resolve();
          })
          .catch(reject);
      });

      ws.on("message", (data: unknown) => {
        try {
          const dataStr =
            typeof data === "string"
              ? data
              : Buffer.isBuffer(data)
              ? data.toString()
              : String(data);
          const message = JSON.parse(dataStr);
          this.handleMessage(message);
        } catch (e) {
          log.warn("Failed to parse WebSocket message:", e);
        }
      });

      ws.on("error", (error: Error) => {
        reject(error);
      });

      ws.on("close", () => {
        this.connected = false;
      });
    });
  }

  /**
   * Handle incoming messages (legacy WebSocket path only).
   */
  private handleMessage(message: Record<string, unknown>): void {
    if (message.id !== undefined && typeof message.id === "number") {
      const request = this.pendingRequests.get(message.id);
      if (request) {
        this.pendingRequests.delete(message.id);
        if (message.error) {
          request.reject(new Error(JSON.stringify(message.error)));
        } else {
          request.resolve(message.result);
        }
      }
    }
  }

  /**
   * Send a request to the MCP server (legacy WebSocket path only).
   */
  private async sendRequest(
    method: string,
    params?: Record<string, unknown>
  ): Promise<unknown> {
    const id = ++this.requestId;
    const request = {
      jsonrpc: "2.0",
      id,
      method,
      params: params || {},
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout for method ${method}`));
      }, this.config.timeout);

      const originalResolve = this.pendingRequests.get(id)?.resolve;
      const originalReject = this.pendingRequests.get(id)?.reject;

      if (originalResolve && originalReject) {
        this.pendingRequests.set(id, {
          resolve: (value) => {
            clearTimeout(timeout);
            originalResolve(value);
          },
          reject: (error) => {
            clearTimeout(timeout);
            originalReject(error);
          },
        });
      }

      const message = JSON.stringify(request) + "\n";

      if (
        this.config.transport === "websocket" &&
        this.connection &&
        WebSocket &&
        this.connection instanceof WebSocket.WebSocket
      ) {
        this.connection.send(message);
      } else {
        reject(new Error("Connection not available"));
      }
    });
  }

  /**
   * Request list of available tools from server.
   */
  async listTools(): Promise<MCPToolInfo[]> {
    if (this.sdk) {
      const result = await this.sdk.listTools();
      return result.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as Record<string, unknown>,
      }));
    }

    const result = (await this.sendRequest("tools/list")) as {
      tools?: Array<{
        name: string;
        description?: string;
        inputSchema?: Record<string, unknown>;
      }>;
    };

    if (!result || !result.tools) {
      return [];
    }

    return result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  /**
   * Execute tool call and get the complete, normalized content union
   * (design §4.1: preserve all content blocks, structured content, and
   * isError semantics). Image data must be routed to the supervisor and is
   * never persisted into tool JSON by generic callers.
   *
   * Managed-async callers (plugin PRD §21.5) pass `maxTotalTimeoutMs` and
   * `resetTimeoutOnProgress: false` so progress notifications never extend
   * the authoritative job deadline, plus `onprogress` to receive correlated
   * SDK progress notifications.
   */
  async callToolContent(
    toolName: string,
    params: Record<string, unknown>,
    options?: {
      timeoutMs?: number;
      signal?: AbortSignal;
      /** Hard total ceiling independent of progress activity (HOST-07). */
      maxTotalTimeoutMs?: number;
      /** Default true (legacy behavior); async callers pass false. */
      resetTimeoutOnProgress?: boolean;
      /** SDK progress-notification sink (progress/total/message). */
      onprogress?: (progress: {
        readonly progress: number;
        readonly total?: number;
        readonly message?: string;
      }) => void;
    }
  ): Promise<MCPToolCallContent> {
    if (!this.sdk) {
      throw new Error("callToolContent requires an SDK stdio connection");
    }
    const result = await this.sdk.callTool(
      { name: toolName, arguments: params },
      undefined,
      {
        timeout: options?.timeoutMs ?? this.config.timeout,
        signal: options?.signal,
        resetTimeoutOnProgress: options?.resetTimeoutOnProgress ?? true,
        maxTotalTimeout: options?.maxTotalTimeoutMs,
        onprogress: options?.onprogress,
      }
    );

    const rawContent = Array.isArray(result.content) ? result.content : [];
    const content: MCPContentBlock[] = [];
    for (const block of rawContent) {
      const typed = block as Record<string, unknown>;
      if (typed.type === "text" && typeof typed.text === "string") {
        content.push({ type: "text", text: typed.text });
      } else if (
        typed.type === "image" &&
        typeof typed.data === "string" &&
        typeof typed.mimeType === "string"
      ) {
        content.push({
          type: "image",
          mimeType: typed.mimeType,
          data: typed.data,
        });
      } else if (
        typed.type === "audio" &&
        typeof typed.data === "string" &&
        typeof typed.mimeType === "string"
      ) {
        content.push({
          type: "audio",
          mimeType: typed.mimeType,
          data: typed.data,
        });
      } else if (typed.type === "resource_link" && typeof typed.uri === "string") {
        content.push({
          type: "resource_link",
          uri: typed.uri,
          name: typeof typed.name === "string" ? typed.name : undefined,
          description:
            typeof typed.description === "string" ? typed.description : undefined,
          mimeType:
            typeof typed.mimeType === "string" ? typed.mimeType : undefined,
        });
      } else if (typed.type === "resource" && typed.resource) {
        const resource = typed.resource as Record<string, unknown>;
        content.push({
          type: "resource",
          resource: {
            uri: String(resource.uri ?? ""),
            text: typeof resource.text === "string" ? resource.text : undefined,
            blob: typeof resource.blob === "string" ? resource.blob : undefined,
            mimeType:
              typeof resource.mimeType === "string"
                ? resource.mimeType
                : undefined,
          },
        });
      }
    }

    return {
      content,
      structuredContent:
        result.structuredContent &&
        typeof result.structuredContent === "object"
          ? (result.structuredContent as Record<string, unknown>)
          : undefined,
      isError: result.isError === true,
    };
  }

  /**
   * Execute tool call (compatibility shape preserved for MCPToolService).
   */
  async callTool(
    toolName: string,
    params: Record<string, unknown>,
    options?: { timeoutMs?: number; signal?: AbortSignal }
  ): Promise<Record<string, unknown>> {
    if (this.sdk) {
      const result = await this.callToolContent(toolName, params, options);

      if (result.isError) {
        throw new Error(`Tool execution failed: ${JSON.stringify(result)}`);
      }

      // Prefer structured content when the server provides it.
      if (result.structuredContent) {
        return result.structuredContent;
      }

      const textContent = result.content.find(
        (block): block is Extract<MCPContentBlock, { type: "text" }> =>
          block.type === "text"
      );
      if (textContent?.text) {
        try {
          return JSON.parse(textContent.text) as Record<string, unknown>;
        } catch {
          return { result: textContent.text };
        }
      }
      const dataContent = result.content.find(
        (block) => block.type === "image" || block.type === "audio"
      );
      if (dataContent) {
        return { data: dataContent.data, mimeType: dataContent.mimeType };
      }

      return { content: result.content };
    }

    const result = (await this.sendRequest("tools/call", {
      name: toolName,
      arguments: params,
    })) as {
      content?: Array<{ type: string; text?: string; data?: unknown }>;
      isError?: boolean;
    };

    if (result.isError) {
      throw new Error(`Tool execution failed: ${JSON.stringify(result)}`);
    }

    // Extract content from result
    if (result.content && Array.isArray(result.content)) {
      const textContent = result.content.find((c) => c.type === "text");
      if (textContent?.text) {
        try {
          return JSON.parse(textContent.text);
        } catch {
          return { result: textContent.text };
        }
      }
      const dataContent = result.content.find((c) => c.data);
      if (dataContent?.data) {
        return dataContent.data as Record<string, unknown>;
      }
    }

    return result as Record<string, unknown>;
  }

  /**
   * Close connection: SDK graceful close (drain stdin, then escalate to
   * SIGTERM/SIGKILL) for stdio; direct close for the legacy WebSocket path.
   */
  async disconnect(): Promise<void> {
    if (!this.connected && !this.sdk) {
      return;
    }

    // Host-runtime launches own a transient host-context file; release it on
    // every disconnect path (design §6.2: delete after process exit).
    if (this.hostLaunch) {
      getPluginMcpRuntimeResolver().release(this.hostLaunch);
      this.hostLaunch = null;
    }

    if (this.sdk) {
      const sdk = this.sdk;
      this.sdk = null;
      this.connected = false;
      await sdk.close().catch(() => {
        /* best-effort: transport close escalates to SIGKILL */
      });
      return;
    }

    if (
      this.config.transport === "stdio" &&
      this.connection &&
      "kill" in this.connection
    ) {
      (this.connection as ChildProcess).kill();
    } else if (
      this.config.transport === "websocket" &&
      this.connection &&
      WebSocket &&
      this.connection instanceof WebSocket.WebSocket
    ) {
      this.connection.close();
    }

    this.connection = null;
    this.connected = false;
    for (const pending of this.pendingRequests.values()) {
      pending.reject(new Error("MCP client disconnected"));
    }
    this.pendingRequests.clear();
  }
}

/**
 * Exposed for the session pool and tests: build the sanitized child env from
 * the shared spawn policy. Re-exported so callers do not reach into private
 * MCPClient internals.
 */
export { buildSanitizedChildEnv };
