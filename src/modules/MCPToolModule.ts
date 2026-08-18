import { MCPToolModel } from "@/model/MCPTool.model";
import { MCPToolEntity } from "@/entity/MCPTool.entity";
import { BaseModule } from "@/modules/baseModule";

export class MCPToolModule extends BaseModule {
  private mcpToolModel: MCPToolModel;

  constructor() {
    super();
    this.mcpToolModel = new MCPToolModel(this.dbpath);
  }

  private async withConnection<T>(fn: () => Promise<T>): Promise<T> {
    await this.ensureConnection();
    return fn();
  }

  public async getAllMCPTools(): Promise<MCPToolEntity[]> {
    return this.withConnection(() => this.mcpToolModel.getAllMCPTools());
  }

  public async getMCPToolById(id: number): Promise<MCPToolEntity | null> {
    return this.withConnection(() => this.mcpToolModel.getMCPToolById(id));
  }

  public async getEnabledMCPTools(): Promise<MCPToolEntity[]> {
    return this.withConnection(() => this.mcpToolModel.getEnabledMCPTools());
  }

  public async saveMCPTool(mcpTool: MCPToolEntity): Promise<number> {
    return this.withConnection(() => this.mcpToolModel.saveMCPTool(mcpTool));
  }

  public async updateMCPTool(
    id: number,
    mcpTool: Partial<MCPToolEntity>
  ): Promise<void> {
    return this.withConnection(() =>
      this.mcpToolModel.updateMCPTool(id, mcpTool)
    );
  }

  public async deleteMCPTool(id: number): Promise<number> {
    return this.withConnection(() => this.mcpToolModel.deleteMCPTool(id));
  }

  public async toggleServerEnabled(
    id: number,
    enabled: boolean
  ): Promise<void> {
    return this.withConnection(() =>
      this.mcpToolModel.toggleServerEnabled(id, enabled)
    );
  }

  /** Find all MCP servers owned by a plugin. (Design §5.3) */
  public async findMcpByPluginName(
    pluginName: string
  ): Promise<MCPToolEntity[]> {
    return this.withConnection(() =>
      this.mcpToolModel.findByPluginName(pluginName)
    );
  }

  /**
   * Find a plugin-owned MCP server by plugin name and scoped server name.
   * Used by the dual-format MCP tool name parser to resolve
   * `mcp__<plugin>__<server>__<tool>` calls. Returns null when no row
   * matches.
   */
  public async findPluginMcpByScopedName(
    pluginName: string,
    scopedServerName: string
  ): Promise<MCPToolEntity | null> {
    const all = await this.withConnection(() =>
      this.mcpToolModel.findByPluginName(pluginName)
    );
    return all.find((m) => m.serverName === scopedServerName) ?? null;
  }
}
