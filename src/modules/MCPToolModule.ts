import { MCPToolModel } from "@/model/MCPTool.model";
import { MCPToolEntity } from "@/entity/MCPTool.entity";
import { BaseModule } from "@/modules/baseModule";

export class MCPToolModule extends BaseModule {
    private mcpToolModel: MCPToolModel;

    constructor() {
        super();
        this.mcpToolModel = new MCPToolModel(this.dbpath);
    }

    public async getAllMCPTools(): Promise<MCPToolEntity[]> {
        return this.mcpToolModel.getAllMCPTools();
    }

    public async getMCPToolById(id: number): Promise<MCPToolEntity | null> {
        return this.mcpToolModel.getMCPToolById(id);
    }

    public async getEnabledMCPTools(): Promise<MCPToolEntity[]> {
        return this.mcpToolModel.getEnabledMCPTools();
    }

    public async saveMCPTool(mcpTool: MCPToolEntity): Promise<number> {
        return await this.mcpToolModel.saveMCPTool(mcpTool);
    }

    public async updateMCPTool(id: number, mcpTool: Partial<MCPToolEntity>): Promise<void> {
        return await this.mcpToolModel.updateMCPTool(id, mcpTool);
    }

    public async deleteMCPTool(id: number): Promise<number> {
        return await this.mcpToolModel.deleteMCPTool(id);
    }

    public async toggleServerEnabled(id: number, enabled: boolean): Promise<void> {
        return await this.mcpToolModel.toggleServerEnabled(id, enabled);
    }
}

