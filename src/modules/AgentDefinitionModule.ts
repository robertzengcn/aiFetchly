// src/modules/AgentDefinitionModule.ts
import { BaseModule } from "@/modules/baseModule";
import { AgentDefinitionModel } from "@/model/AgentDefinition.model";
import { AgentDefinitionRegistry } from "@/service/AgentDefinitionRegistry";
import type { AgentDefinitionView } from "@/entityTypes/agentTypes";

export class AgentDefinitionModule extends BaseModule {
  private readonly model: AgentDefinitionModel;

  constructor() {
    super();
    this.model = new AgentDefinitionModel(this.dbpath);
  }

  async ensureBuiltIns(): Promise<void> {
    await this.ensureConnection();
    for (const view of AgentDefinitionRegistry.listBuiltIns()) {
      await this.model.upsert(view);
    }
  }

  async listActive(): Promise<AgentDefinitionView[]> {
    await this.ensureConnection();
    return this.model.listActive();
  }

  async getActiveById(agentId: string): Promise<AgentDefinitionView | null> {
    await this.ensureConnection();
    return this.model.getActiveById(agentId);
  }
}
