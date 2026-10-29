import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { MCPToolEntity } from "@/entity/MCPTool.entity";

export class MCPToolModel extends BaseDb {
  private repository: Repository<MCPToolEntity>;

  constructor(filepath: string) {
    super(filepath);
    this.repository = this.sqliteDb.connection.getRepository(MCPToolEntity);
  }

  /**
   * Get all MCP servers with their tools
   */
  async getAllMCPTools(): Promise<MCPToolEntity[]> {
    return await this.repository.find({
      order: {
        createdAt: "DESC",
      },
    });
  }

  /**
   * Get MCP server by ID
   */
  async getMCPToolById(id: number): Promise<MCPToolEntity | null> {
    return await this.repository.findOne({ where: { id } });
  }

  /**
   * Get enabled MCP servers
   */
  async getEnabledMCPTools(): Promise<MCPToolEntity[]> {
    return await this.repository.find({
      where: { enabled: true },
    });
  }

  /**
   * Save MCP server configuration
   */
  async saveMCPTool(mcpTool: MCPToolEntity): Promise<number> {
    const saved = await this.repository.save(mcpTool);
    return saved.id;
  }

  /**
   * Update MCP server configuration
   */
  async updateMCPTool(
    id: number,
    mcpTool: Partial<MCPToolEntity>
  ): Promise<void> {
    const existing = await this.repository.findOne({ where: { id } });
    if (!existing) {
      throw new Error(`MCP server with id ${id} not found`);
    }
    Object.assign(existing, mcpTool);
    await this.repository.save(existing);
  }

  /**
   * Delete MCP server
   */
  async deleteMCPTool(id: number): Promise<number> {
    const result = await this.repository.delete(id);
    if (result.affected === 0) {
      throw new Error(`MCP server with id ${id} not found`);
    }
    return result.affected || 0;
  }

  /**
   * Toggle server enabled status
   */
  async toggleServerEnabled(id: number, enabled: boolean): Promise<void> {
    const server = await this.repository.findOne({ where: { id } });
    if (!server) {
      throw new Error(`MCP server with id ${id} not found`);
    }
    server.enabled = enabled;
    await this.repository.save(server);
  }

  /**
   * Find all MCP servers owned by a given plugin. (Design §5.3)
   */
  async findByPluginName(pluginName: string): Promise<MCPToolEntity[]> {
    return await this.repository.find({ where: { pluginName } });
  }

  /**
   * Find a plugin's OWN-disabled MCP server rows (B11/HOST-15): rows the
   * import flow disabled because the declared browser dependency was
   * unresolved (`hostDisabledReason: "browser-missing"` marker in the
   * host-owned metadata). Explicit user disables have no marker and are
   * never returned — the repair flow must not silently resurrect them.
   */
  async findBrowserDisabledByPluginName(
    pluginName: string
  ): Promise<MCPToolEntity[]> {
    const rows = await this.repository.find({
      where: { pluginName, enabled: false },
    });
    return rows.filter((row) => {
      try {
        const metadata = row.metadata
          ? (JSON.parse(row.metadata) as Record<string, unknown>)
          : null;
        return metadata?.["hostDisabledReason"] === "browser-missing";
      } catch {
        return false;
      }
    });
  }

  /**
   * Re-enable an OWN-disabled server row and remove the hostDisabledReason
   * marker (B11 repair). Returns the updated row count.
   */
  async clearBrowserDisabledMarker(id: number): Promise<boolean> {
    const row = await this.repository.findOne({ where: { id } });
    if (!row) return false;
    try {
      const metadata = row.metadata
        ? (JSON.parse(row.metadata) as Record<string, unknown>)
        : {};
      delete metadata["hostDisabledReason"];
      row.metadata = JSON.stringify(metadata);
    } catch {
      row.metadata = "{}";
    }
    row.enabled = true;
    await this.repository.save(row);
    return true;
  }

  /**
   * Delete all MCP servers owned by a given plugin. Used during plugin uninstall.
   * Returns the count of deleted rows.
   */
  async deleteByPluginName(pluginName: string): Promise<number> {
    const result = await this.repository.delete({ pluginName });
    return result.affected ?? 0;
  }

  /**
   * Enable or disable every MCP server owned by a plugin in one update.
   * Used by the activation gate (HOST-04) so a plugin whose manifest failed
   * policy / host-requirement registration has no discoverable servers.
   * Returns the number of rows updated.
   */
  async setEnabledByPluginName(
    pluginName: string,
    enabled: boolean
  ): Promise<number> {
    const result = await this.repository.update({ pluginName }, { enabled });
    return result.affected ?? 0;
  }
}
