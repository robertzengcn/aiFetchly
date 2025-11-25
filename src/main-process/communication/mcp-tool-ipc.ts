import { ipcMain } from 'electron';
import { MCPToolService, MCPServerConfig } from '@/service/MCPToolService';
import { CommonMessage } from '@/entityTypes/commonType';
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

/**
 * Register MCP Tool IPC handlers
 */
export function registerMCPToolIpcHandlers(): void {
    console.log("MCP Tool IPC handlers registered");

    // Get all MCP tools
    ipcMain.handle(MCP_TOOL_LIST, async (): Promise<CommonMessage<Array<{
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
    }> | null>> => {
        try {
            const service = new MCPToolService();
            const servers = await service.getAllMCPTools();

            const formattedServers = servers.map(server => ({
                id: server.id,
                serverName: server.serverName,
                host: server.host,
                port: server.port,
                transport: server.transport,
                enabled: server.enabled,
                authType: server.authType,
                timeout: server.timeout,
                tools: server.tools ? JSON.parse(server.tools) : undefined,
                toolConfig: server.toolConfig ? JSON.parse(server.toolConfig) : undefined,
                metadata: server.metadata ? JSON.parse(server.metadata) : undefined
            }));

            return {
                status: true,
                msg: "MCP tools retrieved successfully",
                data: formattedServers
            };
        } catch (error) {
            console.error('MCP Tool list error:', error);
            return {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
        }
    });

    // Add new MCP server
    ipcMain.handle(MCP_TOOL_ADD, async (event, data): Promise<CommonMessage<number | null>> => {
        try {
            const requestData = JSON.parse(data) as MCPServerConfig;
            const service = new MCPToolService();
            const id = await service.addMCPServer(requestData);

            return {
                status: true,
                msg: "MCP server added successfully",
                data: id
            };
        } catch (error) {
            console.error('MCP Tool add error:', error);
            return {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
        }
    });

    // Update MCP server
    ipcMain.handle(MCP_TOOL_UPDATE, async (event, data): Promise<CommonMessage<void>> => {
        try {
            const requestData = JSON.parse(data) as { id: number; config: Partial<MCPServerConfig> };
            const service = new MCPToolService();
            await service.updateMCPServer(requestData.id, requestData.config);

            return {
                status: true,
                msg: "MCP server updated successfully"
            };
        } catch (error) {
            console.error('MCP Tool update error:', error);
            return {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred"
            };
        }
    });

    // Delete MCP server
    ipcMain.handle(MCP_TOOL_DELETE, async (event, data): Promise<CommonMessage<void>> => {
        try {
            const requestData = JSON.parse(data) as { id: number };
            const service = new MCPToolService();
            await service.deleteMCPServer(requestData.id);

            return {
                status: true,
                msg: "MCP server deleted successfully"
            };
        } catch (error) {
            console.error('MCP Tool delete error:', error);
            return {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred"
            };
        }
    });

    // Discover tools from server
    ipcMain.handle(MCP_TOOL_DISCOVER, async (event, data): Promise<CommonMessage<Array<{
        name: string;
        description?: string;
        inputSchema?: Record<string, unknown>;
    }> | null>> => {
        try {
            const requestData = JSON.parse(data) as { serverId: number };
            const service = new MCPToolService();
            const tools = await service.discoverTools(requestData.serverId);

            return {
                status: true,
                msg: "Tools discovered successfully",
                data: tools
            };
        } catch (error) {
            console.error('MCP Tool discover error:', error);
            return {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
        }
    });

    // Toggle server enabled/disabled
    ipcMain.handle(MCP_TOOL_TOGGLE_SERVER, async (event, data): Promise<CommonMessage<void>> => {
        try {
            const requestData = JSON.parse(data) as { id: number; enabled: boolean };
            const service = new MCPToolService();
            await service.toggleServerEnabled(requestData.id, requestData.enabled);

            return {
                status: true,
                msg: `MCP server ${requestData.enabled ? 'enabled' : 'disabled'} successfully`
            };
        } catch (error) {
            console.error('MCP Tool toggle server error:', error);
            return {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred"
            };
        }
    });

    // Toggle tool enabled/disabled
    ipcMain.handle(MCP_TOOL_TOGGLE_TOOL, async (event, data): Promise<CommonMessage<void>> => {
        try {
            const requestData = JSON.parse(data) as { serverId: number; toolName: string; enabled: boolean };
            const service = new MCPToolService();
            await service.toggleToolEnabled(requestData.serverId, requestData.toolName, requestData.enabled);

            return {
                status: true,
                msg: `Tool ${requestData.enabled ? 'enabled' : 'disabled'} successfully`
            };
        } catch (error) {
            console.error('MCP Tool toggle tool error:', error);
            return {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred"
            };
        }
    });

    // Test connection
    ipcMain.handle(MCP_TOOL_TEST_CONNECTION, async (event, data): Promise<CommonMessage<boolean | null>> => {
        try {
            const requestData = JSON.parse(data) as { serverId: number };
            const service = new MCPToolService();
            const connected = await service.testConnection(requestData.serverId);

            return {
                status: true,
                msg: connected ? "Connection successful" : "Connection failed",
                data: connected
            };
        } catch (error) {
            console.error('MCP Tool test connection error:', error);
            return {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: null
            };
        }
    });
}


