import { MCPToolService, MCPServerConfig } from "@/service/MCPToolService";
import { registerValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
import {
  mcpToolListInputSchema,
  mcpToolAddInputSchema,
  mcpToolUpdateInputSchema,
  mcpToolByIdInputSchema,
  mcpToolDiscoverInputSchema,
  mcpToolToggleServerInputSchema,
  mcpToolToggleToolInputSchema,
} from "@/schemas/ipc/mcpTool";
import {
  MCP_TOOL_LIST,
  MCP_TOOL_ADD,
  MCP_TOOL_UPDATE,
  MCP_TOOL_DELETE,
  MCP_TOOL_DISCOVER,
  MCP_TOOL_TOGGLE_SERVER,
  MCP_TOOL_TOGGLE_TOOL,
  MCP_TOOL_TEST_CONNECTION,
} from "@/config/channellist";

/**
 * MCP Tool IPC handlers — all 8 migrated to registerValidatedHandler.
 *
 * Envelope: handlers return data only; wrapper wraps in {status, msg, data}.
 * LIST returns formatted server array (with parsed JSON fields) as data.
 */
export function registerMCPToolIpcHandlers(): void {
  console.log("MCP Tool IPC handlers registered");

  registerValidatedHandler(
    MCP_TOOL_LIST,
    mcpToolListInputSchema,
    async () => {
      const service = new MCPToolService();
      const servers = await service.getAllMCPTools();
      return servers.map((server) => ({
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
        metadata: server.metadata ? JSON.parse(server.metadata) : undefined,
        pluginName: server.pluginName ?? undefined,
        origin: server.origin,
      }));
    },
  );

  registerValidatedHandler(
    MCP_TOOL_ADD,
    mcpToolAddInputSchema,
    async (input) => {
      const service = new MCPToolService();
      return service.addMCPServer(input as unknown as MCPServerConfig);
    },
  );

  registerValidatedHandler(
    MCP_TOOL_UPDATE,
    mcpToolUpdateInputSchema,
    async (input) => {
      const service = new MCPToolService();
      await service.updateMCPServer(
        input.id,
        input.config as Partial<MCPServerConfig>,
      );
      return null;
    },
  );

  registerValidatedHandler(
    MCP_TOOL_DELETE,
    mcpToolByIdInputSchema,
    async (input) => {
      const service = new MCPToolService();
      await service.deleteMCPServer(input.id);
      return null;
    },
  );

  registerValidatedHandler(
    MCP_TOOL_DISCOVER,
    mcpToolDiscoverInputSchema,
    async (input) => {
      const service = new MCPToolService();
      return service.discoverTools(input.serverId);
    },
  );

  registerValidatedHandler(
    MCP_TOOL_TOGGLE_SERVER,
    mcpToolToggleServerInputSchema,
    async (input) => {
      const service = new MCPToolService();
      await service.toggleServerEnabled(input.id, input.enabled);
      return { action: input.enabled ? "enabled" : "disabled" };
    },
  );

  registerValidatedHandler(
    MCP_TOOL_TOGGLE_TOOL,
    mcpToolToggleToolInputSchema,
    async (input) => {
      const service = new MCPToolService();
      await service.toggleToolEnabled(
        input.serverId,
        input.toolName,
        input.enabled,
      );
      return { action: input.enabled ? "enabled" : "disabled" };
    },
  );

  registerValidatedHandler(
    MCP_TOOL_TEST_CONNECTION,
    mcpToolDiscoverInputSchema, // same shape: { serverId }
    async (input) => {
      const service = new MCPToolService();
      return service.testConnection(input.serverId);
    },
  );
}
