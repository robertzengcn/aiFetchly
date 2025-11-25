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
                createdAt: "DESC"
            }
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
            where: { enabled: true }
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
    async updateMCPTool(id: number, mcpTool: Partial<MCPToolEntity>): Promise<void> {
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
}

