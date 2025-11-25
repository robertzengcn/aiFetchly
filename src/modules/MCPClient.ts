import { spawn, ChildProcess } from "child_process";
import type { EventEmitter } from "events";

// WebSocket import - use dynamic import for optional dependency
let WebSocket: typeof import("ws") | null = null;
try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    WebSocket = require("ws");
} catch {
    // WebSocket not available, will throw error when trying to use it
}

export interface MCPClientConfig {
    host: string;
    port?: number;
    transport: "stdio" | "sse" | "websocket";
    authType?: "none" | "api_key" | "bearer_token" | "custom";
    authConfig?: Record<string, unknown>;
    timeout?: number;
}

export interface MCPToolInfo {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
}

/**
 * MCP Client for communicating with MCP servers
 * Supports stdio, SSE, and WebSocket transports
 */
export class MCPClient {
    private config: MCPClientConfig;
    private connection: ChildProcess | InstanceType<typeof WebSocket.WebSocket> | EventSource | null = null;
    private connected: boolean = false;
    private requestId: number = 0;
    private pendingRequests: Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }> = new Map();

    constructor(config: MCPClientConfig) {
        this.config = {
            timeout: 30000,
            ...config
        };
    }

    /**
     * Establish connection based on transport type
     */
    async connect(): Promise<void> {
        if (this.connected) {
            return;
        }

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
     * Connect via stdio (process-based)
     */
    private async connectStdio(): Promise<void> {
        // For stdio, host is the command to execute
        const [command, ...args] = this.config.host.split(" ");
        
        return new Promise((resolve, reject) => {
            const process = spawn(command, args, {
                stdio: ["pipe", "pipe", "pipe"]
            });

            this.connection = process;

            let buffer = "";

            process.stdout?.on("data", (data: Buffer) => {
                buffer += data.toString();
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                    if (line.trim()) {
                        try {
                            const message = JSON.parse(line);
                            this.handleMessage(message);
                        } catch (e) {
                            console.warn("Failed to parse MCP message:", e);
                        }
                    }
                }
            });

            process.stderr?.on("data", (data: Buffer) => {
                console.error("MCP stderr:", data.toString());
            });

            process.on("error", (error) => {
                reject(error);
            });

            process.on("exit", (code) => {
                this.connected = false;
                if (code !== 0 && code !== null) {
                    console.error(`MCP process exited with code ${code}`);
                }
            });

            // Send initialize request
            this.sendRequest("initialize", {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: {
                    name: "aiFetchly",
                    version: "1.0.0"
                }
            }).then(() => {
                resolve();
            }).catch(reject);
        });
    }

    /**
     * Connect via SSE (Server-Sent Events)
     */
    private async connectSSE(): Promise<void> {
        // Note: Node.js doesn't have native EventSource, would need polyfill or library
        // For now, throw error indicating SSE needs implementation
        throw new Error("SSE transport not yet implemented");
    }

    /**
     * Connect via WebSocket
     */
    private async connectWebSocket(): Promise<void> {
        if (!WebSocket) {
            throw new Error("WebSocket support requires 'ws' package. Install it with: yarn add ws");
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
                        version: "1.0.0"
                    }
                }).then(() => {
                    resolve();
                }).catch(reject);
            });

            ws.on("message", (data: unknown) => {
                try {
                    const dataStr = typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString() : String(data);
                    const message = JSON.parse(dataStr);
                    this.handleMessage(message);
                } catch (e) {
                    console.warn("Failed to parse WebSocket message:", e);
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
     * Handle incoming messages
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
     * Send a request to the MCP server
     */
    private async sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
        const id = ++this.requestId;
        const request = {
            jsonrpc: "2.0",
            id,
            method,
            params: params || {}
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
                    }
                });
            }

            const message = JSON.stringify(request) + "\n";

            if (this.config.transport === "stdio" && this.connection && "stdin" in this.connection) {
                this.connection.stdin?.write(message);
            } else if (this.config.transport === "websocket" && this.connection && WebSocket && this.connection instanceof WebSocket.WebSocket) {
                this.connection.send(message);
            } else {
                reject(new Error("Connection not available"));
            }
        });
    }

    /**
     * Request list of available tools from server
     */
    async listTools(): Promise<MCPToolInfo[]> {
        const result = await this.sendRequest("tools/list") as { tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> };
        
        if (!result || !result.tools) {
            return [];
        }

        return result.tools.map(tool => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema
        }));
    }

    /**
     * Execute tool call
     */
    async callTool(toolName: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
        const result = await this.sendRequest("tools/call", {
            name: toolName,
            arguments: params
        }) as { content?: Array<{ type: string; text?: string; data?: unknown }>; isError?: boolean };

        if (result.isError) {
            throw new Error(`Tool execution failed: ${JSON.stringify(result)}`);
        }

        // Extract content from result
        if (result.content && Array.isArray(result.content)) {
            const textContent = result.content.find(c => c.type === "text");
            if (textContent?.text) {
                try {
                    return JSON.parse(textContent.text);
                } catch {
                    return { result: textContent.text };
                }
            }
            const dataContent = result.content.find(c => c.data);
            if (dataContent?.data) {
                return dataContent.data as Record<string, unknown>;
            }
        }

        return result as Record<string, unknown>;
    }

    /**
     * Close connection
     */
    async disconnect(): Promise<void> {
        if (!this.connected) {
            return;
        }

        if (this.config.transport === "stdio" && this.connection && "kill" in this.connection) {
            (this.connection as ChildProcess).kill();
        } else if (this.config.transport === "websocket" && this.connection && WebSocket && this.connection instanceof WebSocket.WebSocket) {
            this.connection.close();
        }

        this.connection = null;
        this.connected = false;
        this.pendingRequests.clear();
    }
}

