// src/modules/AgentDefinitionModule.ts
import { BaseModule } from "@/modules/baseModule";
import { AgentDefinitionModel } from "@/model/AgentDefinition.model";
import { AgentDefinitionRegistry } from "@/service/AgentDefinitionRegistry";
import type {
  AgentDefinitionView,
  ParsedPluginAgentDefinition,
} from "@/entityTypes/agentTypes";

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

  /**
   * Persist plugin-owned agents. `preservedDisabledIds` carries agent IDs the
   * user previously disabled so overwrite/reinstall honors their toggle
   * (design §3.4, Decision D5). Must not run in a worker process.
   */
  async upsertPluginAgents(
    pluginName: string,
    agents: readonly ParsedPluginAgentDefinition[],
    preservedDisabledIds: ReadonlySet<string> = new Set()
  ): Promise<void> {
    await this.ensureConnection();
    for (const a of agents) {
      const initiallyEnabled = !preservedDisabledIds.has(a.definition.id);
      await this.model.upsertPluginAgent(a.definition, initiallyEnabled);
    }
    void pluginName;
  }

  async findAgentsByPluginName(
    pluginName: string
  ): Promise<AgentDefinitionView[]> {
    await this.ensureConnection();
    return this.model.findByPluginName(pluginName);
  }

  async deleteAgentsByPluginName(pluginName: string): Promise<string[]> {
    await this.ensureConnection();
    return this.model.deleteByPluginName(pluginName);
  }

  async toggleAgent(agentId: string, enabled: boolean): Promise<boolean> {
    await this.ensureConnection();
    return this.model.toggle(agentId, enabled);
  }
}
