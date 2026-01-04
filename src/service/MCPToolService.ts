import { MCPToolEntity } from "@/entity/MCPTool.entity";
import { MCPToolModule } from "@/modules/MCPToolModule";
import { MCPClient } from "@/modules/MCPClient";
import type { ToolFunction } from "@/api/aiChatApi";

export interface MCPServerConfig {
    serverName: string;
    host: string;
    port?: number;
    transport: "stdio" | "sse" | "websocket";
    enabled?: boolean;
    authType?: "none" | "api_key" | "bearer_token" | "custom";
    authConfig?: Record<string, unknown>;
    timeout?: number;
    metadata?: Record<string, unknown>;
}

export interface MCPToolInfo {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
    enabled?: boolean;
    customConfig?: Record<string, unknown>;
}

export interface MCPToolWithServer {
    serverId: number;
    serverName: string;
    toolName: string;
    toolInfo: MCPToolInfo;
}

/**
 * Service for managing MCP tools and servers
 */
export class MCPToolService {
    private mcpToolModule: MCPToolModule;

    constructor() {
        this.mcpToolModule = new MCPToolModule();
    }

    /**
     * Get all MCP servers with their tools
     */
    async getAllMCPTools(): Promise<MCPToolEntity[]> {
        return await this.mcpToolModule.getAllMCPTools();
    }

    /**
     * Get only enabled servers and their enabled tools
     */
    async getEnabledMCPTools(): Promise<MCPToolWithServer[]> {
        const enabledServers = await this.mcpToolModule.getEnabledMCPTools();

        const enabledTools: MCPToolWithServer[] = [];

        for (const server of enabledServers) {
            if (!server.tools) continue;

            try {
                const toolNames: string[] = JSON.parse(server.tools);
                const toolConfig: Record<string, { enabled?: boolean; customConfig?: Record<string, unknown> }> = server.toolConfig
                    ? JSON.parse(server.toolConfig)
                    : {};

                // Parse tool schemas from metadata
                let toolSchemas: Record<string, { description?: string; inputSchema?: Record<string, unknown> }> = {};
                if (server.metadata) {
                    try {
                        const metadata = JSON.parse(server.metadata);
                        toolSchemas = (metadata.toolSchemas as Record<string, { description?: string; inputSchema?: Record<string, unknown> }>) || {};
                    } catch (error) {
                        console.error(`Failed to parse metadata for server ${server.id}:`, error);
                    }
                }

                for (const toolName of toolNames) {
                    const config = toolConfig[toolName] || {};
                    // Tool is enabled by default if not explicitly disabled
                    if (config.enabled !== false) {
                        const schema = toolSchemas[toolName] || {};
                        enabledTools.push({
                            serverId: server.id,
                            serverName: server.serverName,
                            toolName,
                            toolInfo: {
                                name: toolName,
                                description: schema.description,
                                inputSchema: schema.inputSchema,
                                enabled: true,
                                customConfig: config.customConfig
                            }
                        });
                    }
                }
            } catch (error) {
                console.error(`Failed to parse tools for server ${server.id}:`, error);
            }
        }

        return enabledTools;
    }

    /**
     * Convert enabled MCP tools to ToolFunction format for AI
     * Tool schemas are loaded from metadata stored during tool discovery
     */
    async getEnabledMCPToolsAsFunctions(): Promise<ToolFunction[]> {
        const enabledTools = await this.getEnabledMCPTools();
        const toolFunctions: ToolFunction[] = [];

        for (const tool of enabledTools) {
            toolFunctions.push({
                type: "function",
                name: `mcp_${tool.serverId}_${tool.toolName}`,
                description: tool.toolInfo.description || `MCP tool ${tool.toolName} from ${tool.serverName}`,
                parameters: tool.toolInfo.inputSchema || {
                    type: "object",
                    properties: {},
                    required: []
                }
            });
        }

        return toolFunctions;
    }

    /**
     * Add new MCP server configuration
     */
    async addMCPServer(config: MCPServerConfig): Promise<number> {
        const entity = new MCPToolEntity();
        entity.serverName = config.serverName;
        entity.host = config.host;
        entity.port = config.port;
        entity.transport = config.transport;
        entity.enabled = config.enabled ?? true;
        entity.authType = config.authType || "none";
        entity.authConfig = config.authConfig ? JSON.stringify(config.authConfig) : undefined;
        entity.timeout = config.timeout || 30000;
        entity.metadata = config.metadata ? JSON.stringify(config.metadata) : undefined;

        return await this.mcpToolModule.saveMCPTool(entity);
    }

    /**
     * Update existing MCP server configuration
     */
    async updateMCPServer(id: number, config: Partial<MCPServerConfig>): Promise<void> {
        const updateData: Partial<MCPToolEntity> = {};

        if (config.serverName !== undefined) updateData.serverName = config.serverName;
        if (config.host !== undefined) updateData.host = config.host;
        if (config.port !== undefined) updateData.port = config.port;
        if (config.transport !== undefined) updateData.transport = config.transport;
        if (config.enabled !== undefined) updateData.enabled = config.enabled;
        if (config.authType !== undefined) updateData.authType = config.authType;
        if (config.authConfig !== undefined) {
            updateData.authConfig = config.authConfig ? JSON.stringify(config.authConfig) : undefined;
        }
        if (config.timeout !== undefined) updateData.timeout = config.timeout;
        if (config.metadata !== undefined) {
            updateData.metadata = config.metadata ? JSON.stringify(config.metadata) : undefined;
        }

        await this.mcpToolModule.updateMCPTool(id, updateData);
    }

    /**
     * Delete MCP server
     */
    async deleteMCPServer(id: number): Promise<void> {
        await this.mcpToolModule.deleteMCPTool(id);
    }

    /**
     * Connect to MCP server and discover available tools
     */
    async discoverTools(serverId: number): Promise<MCPToolInfo[]> {
        const server = await this.mcpToolModule.getMCPToolById(serverId);

        if (!server) {
            throw new Error(`MCP server with id ${serverId} not found`);
        }

        const client = new MCPClient({
            host: server.host,
            port: server.port,
            transport: server.transport,
            authType: server.authType,
            authConfig: server.authConfig ? JSON.parse(server.authConfig) : undefined,
            timeout: server.timeout
        });

        try {
            await client.connect();
            const tools = await client.listTools();
            await client.disconnect();

            // Update server with discovered tools
            const toolNames = tools.map(t => t.name);
            server.tools = JSON.stringify(toolNames);

            // Store tool schemas in metadata for later use
            let metadata: Record<string, unknown> = {};
            if (server.metadata) {
                try {
                    metadata = JSON.parse(server.metadata);
                } catch (e) {
                    console.warn("Failed to parse existing metadata, initializing new");
                }
            }

            // Store tool schemas: toolName -> { description, inputSchema }
            const toolSchemas: Record<string, { description?: string; inputSchema?: Record<string, unknown> }> = {};
            for (const tool of tools) {
                toolSchemas[tool.name] = {
                    description: tool.description,
                    inputSchema: tool.inputSchema
                };
            }
            metadata.toolSchemas = toolSchemas;
            server.metadata = JSON.stringify(metadata);

            // Initialize tool config if not exists
            let toolConfig: Record<string, { enabled?: boolean; customConfig?: Record<string, unknown> }> = {};
            if (server.toolConfig) {
                try {
                    toolConfig = JSON.parse(server.toolConfig);
                } catch (e) {
                    console.warn("Failed to parse existing toolConfig, initializing new");
                }
            }

            // Add new tools with default enabled state
            for (const tool of tools) {
                if (!toolConfig[tool.name]) {
                    toolConfig[tool.name] = { enabled: true };
                }
            }

            server.toolConfig = JSON.stringify(toolConfig);
            await this.mcpToolModule.updateMCPTool(serverId, {
                tools: server.tools,
                metadata: server.metadata,
                toolConfig: server.toolConfig
            });

            return tools;
        } catch (error) {
            await client.disconnect().catch(() => {});
            throw error;
        }
    }

    /**
     * Enable/disable entire server
     */
    async toggleServerEnabled(id: number, enabled: boolean): Promise<void> {
        await this.mcpToolModule.toggleServerEnabled(id, enabled);
    }

    /**
     * Enable/disable specific tool
     */
    async toggleToolEnabled(serverId: number, toolName: string, enabled: boolean): Promise<void> {
        const server = await this.mcpToolModule.getMCPToolById(serverId);

        if (!server) {
            throw new Error(`MCP server with id ${serverId} not found`);
        }

        let toolConfig: Record<string, { enabled?: boolean; customConfig?: Record<string, unknown> }> = {};
        if (server.toolConfig) {
            try {
                toolConfig = JSON.parse(server.toolConfig);
            } catch (e) {
                console.warn("Failed to parse toolConfig");
            }
        }

        if (!toolConfig[toolName]) {
            toolConfig[toolName] = {};
        }
        toolConfig[toolName].enabled = enabled;

        await this.mcpToolModule.updateMCPTool(serverId, {
            toolConfig: JSON.stringify(toolConfig)
        });
    }

    /**
     * Execute a tool call on MCP server
     */
    async executeMCPTool(serverId: number, toolName: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
        const server = await this.mcpToolModule.getMCPToolById(serverId);

        if (!server) {
            throw new Error(`MCP server with id ${serverId} not found`);
        }

        if (!server.enabled) {
            throw new Error(`MCP server ${server.serverName} is disabled`);
        }

        // Check if tool is enabled
        if (server.toolConfig) {
            try {
                const toolConfig: Record<string, { enabled?: boolean }> = JSON.parse(server.toolConfig);
                if (toolConfig[toolName]?.enabled === false) {
                    throw new Error(`Tool ${toolName} is disabled`);
                }
            } catch (e) {
                console.warn("Failed to parse toolConfig for tool check");
            }
        }

        const client = new MCPClient({
            host: server.host,
            port: server.port,
            transport: server.transport,
            authType: server.authType,
            authConfig: server.authConfig ? JSON.parse(server.authConfig) : undefined,
            timeout: server.timeout
        });

        try {
            await client.connect();
            const result = await client.callTool(toolName, params);
            await client.disconnect();
            return result;
        } catch (error) {
            await client.disconnect().catch(() => {});
            throw error;
        }
    }

    /**
     * Test connectivity to MCP server
     */
    async testConnection(serverId: number): Promise<boolean> {
        const server = await this.mcpToolModule.getMCPToolById(serverId);

        if (!server) {
            throw new Error(`MCP server with id ${serverId} not found`);
        }

        const client = new MCPClient({
            host: server.host,
            port: server.port,
            transport: server.transport,
            authType: server.authType,
            authConfig: server.authConfig ? JSON.parse(server.authConfig) : undefined,
            timeout: server.timeout
        });

        try {
            await client.connect();
            await client.disconnect();
            return true;
        } catch (error) {
            await client.disconnect().catch(() => {});
            return false;
        }
    }
}

