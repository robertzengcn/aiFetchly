import { BrowserWindow, dialog } from "electron";
import { log } from "@/modules/Logger";
import { MCPToolService, MCPServerConfig } from "@/service/MCPToolService";
import { isAppTrustedOrigin } from "@/service/OriginTrust";
import { registerValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
import {
  mcpToolListInputSchema,
  mcpToolAddInputSchema,
  mcpToolUpdateInputSchema,
  mcpToolByIdInputSchema,
  mcpToolDiscoverInputSchema,
  mcpToolToggleServerInputSchema,
  mcpToolToggleToolInputSchema,
  mcpToolTrustInputSchema,
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
  MCP_TOOL_TRUST,
} from "@/config/channellist";

/**
 * MCP Tool IPC handlers — all 8 migrated to registerValidatedHandler.
 *
 * Envelope: handlers return data only; wrapper wraps in {status, msg, data}.
 * LIST returns formatted server array (with parsed JSON fields) as data.
 */
export function registerMCPToolIpcHandlers(): void {
  log.info("MCP Tool IPC handlers registered");

  registerValidatedHandler(MCP_TOOL_LIST, mcpToolListInputSchema, async () => {
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
  });

  registerValidatedHandler(
    MCP_TOOL_ADD,
    mcpToolAddInputSchema,
    async (input) => {
      const service = new MCPToolService();
      return service.addMCPServer(input as unknown as MCPServerConfig);
    }
  );

  registerValidatedHandler(
    MCP_TOOL_UPDATE,
    mcpToolUpdateInputSchema,
    async (input) => {
      const service = new MCPToolService();
      await service.updateMCPServer(
        input.id,
        input.config as Partial<MCPServerConfig>
      );
      return null;
    }
  );

  registerValidatedHandler(
    MCP_TOOL_DELETE,
    mcpToolByIdInputSchema,
    async (input) => {
      const service = new MCPToolService();
      await service.deleteMCPServer(input.id);
      return null;
    }
  );

  registerValidatedHandler(
    MCP_TOOL_DISCOVER,
    mcpToolDiscoverInputSchema,
    async (input) => {
      const service = new MCPToolService();
      return service.discoverTools(input.serverId);
    }
  );

  registerValidatedHandler(
    MCP_TOOL_TOGGLE_SERVER,
    mcpToolToggleServerInputSchema,
    async (input) => {
      const service = new MCPToolService();
      await service.toggleServerEnabled(input.id, input.enabled);
      return { action: input.enabled ? "enabled" : "disabled" };
    }
  );

  registerValidatedHandler(
    MCP_TOOL_TOGGLE_TOOL,
    mcpToolToggleToolInputSchema,
    async (input) => {
      const service = new MCPToolService();
      await service.toggleToolEnabled(
        input.serverId,
        input.toolName,
        input.enabled
      );
      return { action: input.enabled ? "enabled" : "disabled" };
    }
  );

  registerValidatedHandler(
    MCP_TOOL_TEST_CONNECTION,
    mcpToolDiscoverInputSchema, // same shape: { serverId }
    async (input) => {
      const service = new MCPToolService();
      return service.testConnection(input.serverId);
    }
  );

  // F1 fix — explicit trust grant for MCP stdio servers. Without this, the
  // service-layer assertStdioTrusted gate refuses to spawn any stdio child.
  //
  // F1 follow-up — treat trust like a shell-tool approval, not a normal
  // settings update. Granting trust authorizes the server to spawn a local
  // child process, so it requires BOTH:
  //   1. a trusted app sender frame (rejects compromised/external frames that
  //      would otherwise self-grant trust then spawn), AND
  //   2. an explicit native confirmation dialog bound to this server id+name,
  //      so the approval is the result of a real user gesture.
  // Revocation is always safe and needs no confirmation.
  registerValidatedHandler(
    MCP_TOOL_TRUST,
    mcpToolTrustInputSchema,
    async (input, event) => {
      const senderUrl = event?.senderFrame?.url;
      if (!isAppTrustedOrigin(senderUrl)) {
        throw new Error(
          "MCP trust request from an untrusted origin was denied."
        );
      }

      const service = new MCPToolService();

      if (!input.trusted) {
        service.setTrust(input.serverId, false);
        return { trusted: false };
      }

      const serverName = await service.getServerName(input.serverId);
      const parent = BrowserWindow.fromWebContents(event?.sender);
      const choice = await dialog.showMessageBox(parent, {
        type: "warning",
        title: "Trust MCP stdio server?",
        message: "Allow this MCP stdio server to run a local process?",
        detail:
          `Server: ${serverName ?? `#${input.serverId}`}\n\n` +
          "Only approve servers you trust — a stdio MCP server can execute " +
          "arbitrary local commands on your machine.",
        buttons: ["Cancel", "Trust"],
        defaultId: 0,
        cancelId: 0,
      });

      if (choice.response !== 1) {
        return { trusted: false };
      }
      service.setTrust(input.serverId, true);
      return { trusted: true };
    }
  );
}
