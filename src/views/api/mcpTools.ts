import { windowInvoke } from '@/views/utils/apirequest';
import {
    MCP_TOOL_LIST,
    MCP_TOOL_ADD,
    MCP_TOOL_UPDATE,
    MCP_TOOL_DELETE,
    MCP_TOOL_DISCOVER,
    MCP_TOOL_TOGGLE_SERVER,
    MCP_TOOL_TOGGLE_TOOL,
    MCP_TOOL_TEST_CONNECTION
} from '@/config/channellist';
import type { Iresponse } from '@/views/api/types';

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

export interface MCPServer {
    id: number;
    serverName: string;
    host: string;
    port?: number;
    transport: string;
    enabled: boolean;
    authType: string;
    timeout: number;
    tools?: string[];
    toolConfig?: Record<string, { enabled?: boolean; customConfig?: Record<string, unknown> }>;
    metadata?: Record<string, unknown>;
}

export interface MCPToolInfo {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
}

/**
 * Get all MCP tools
 */
export async function getMCPTools(): Promise<MCPServer[] | null> {
    return await windowInvoke(MCP_TOOL_LIST);
}

/**
 * Add new MCP server
 */
export async function addMCPServer(config: MCPServerConfig): Promise<number | null> {
    return await windowInvoke(MCP_TOOL_ADD, config);
}

/**
 * Update MCP server
 */
export async function updateMCPServer(id: number, config: Partial<MCPServerConfig>): Promise<void> {
    return await windowInvoke(MCP_TOOL_UPDATE, { id, config });
}

/**
 * Delete MCP server
 */
export async function deleteMCPServer(id: number): Promise<void> {
    return await windowInvoke(MCP_TOOL_DELETE, { id });
}

/**
 * Discover tools from server
 */
export async function discoverMCPTools(serverId: number): Promise<MCPToolInfo[] | null> {
    return await windowInvoke(MCP_TOOL_DISCOVER, { serverId });
}

/**
 * Toggle server enabled/disabled
 */
export async function toggleServerEnabled(id: number, enabled: boolean): Promise<void> {
    return await windowInvoke(MCP_TOOL_TOGGLE_SERVER, { id, enabled });
}

/**
 * Toggle tool enabled/disabled
 */
export async function toggleToolEnabled(serverId: number, toolName: string, enabled: boolean): Promise<void> {
    return await windowInvoke(MCP_TOOL_TOGGLE_TOOL, { serverId, toolName, enabled });
}

/**
 * Test connection to MCP server
 */
export async function testMCPConnection(serverId: number): Promise<boolean | null> {
    return await windowInvoke(MCP_TOOL_TEST_CONNECTION, { serverId });
}

