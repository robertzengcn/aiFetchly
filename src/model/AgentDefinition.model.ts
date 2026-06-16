// src/model/AgentDefinition.model.ts
import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { AgentDefinitionEntity } from "@/entity/AgentDefinition.entity";
import type { AgentDefinitionView } from "@/entityTypes/agentTypes";

function toView(e: AgentDefinitionEntity): AgentDefinitionView {
  return {
    id: e.agentId,
    name: e.name,
    description: e.description,
    version: e.version,
    systemPrompt: e.systemPrompt,
    allowedTools: e.allowedTools,
    defaultModel: e.defaultModel ?? undefined,
    mode: e.mode as AgentDefinitionView["mode"],
    maxToolCalls: e.maxToolCalls,
    maxRuntimeMs: e.maxRuntimeMs,
    maxContinueCalls: e.maxContinueCalls,
    outputSchema: e.outputSchema,
    status: e.status as AgentDefinitionView["status"],
  };
}

export class AgentDefinitionModel extends BaseDb {
  public repository: Repository<AgentDefinitionEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    this.repository =
      this.sqliteDb.connection.getRepository(AgentDefinitionEntity);
  }

  async upsert(view: AgentDefinitionView): Promise<void> {
    const existing = await this.repository.findOne({
      where: { agentId: view.id },
    });
    const merged: Partial<AgentDefinitionEntity> = {
      agentId: view.id,
      name: view.name,
      description: view.description,
      version: view.version,
      systemPrompt: view.systemPrompt,
      allowedTools: view.allowedTools,
      defaultModel: view.defaultModel ?? null,
      mode: view.mode,
      maxToolCalls: view.maxToolCalls,
      maxRuntimeMs: view.maxRuntimeMs,
      maxContinueCalls: view.maxContinueCalls,
      outputSchema: view.outputSchema,
      status: view.status,
    };
    if (existing) {
      await this.repository.save({ ...existing, ...merged });
    } else {
      await this.repository.save(merged as AgentDefinitionEntity);
    }
  }

  async getActiveById(agentId: string): Promise<AgentDefinitionView | null> {
    const e = await this.repository.findOne({
      where: { agentId, status: "active" },
    });
    return e ? toView(e) : null;
  }

  async getById(agentId: string): Promise<AgentDefinitionView | null> {
    const e = await this.repository.findOne({ where: { agentId } });
    return e ? toView(e) : null;
  }

  async listActive(): Promise<AgentDefinitionView[]> {
    const rows = await this.repository.find({ where: { status: "active" } });
    return rows.map(toView);
  }
}
