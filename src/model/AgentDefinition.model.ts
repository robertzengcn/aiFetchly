// src/model/AgentDefinition.model.ts
import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { AgentDefinitionEntity } from "@/entity/AgentDefinition.entity";
import type { AgentDefinitionView } from "@/entityTypes/agentTypes";

function toView(e: AgentDefinitionEntity): AgentDefinitionView {
  let manifest: Record<string, unknown> = {};
  if (e.manifestJson) {
    try {
      manifest = JSON.parse(e.manifestJson) as Record<string, unknown>;
    } catch {
      manifest = {};
    }
  }
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
    source: (e.source ?? "built-in") as AgentDefinitionView["source"],
    pluginName: e.pluginName ?? undefined,
    pluginComponentPath: e.pluginComponentPath ?? undefined,
    manifest,
    health: (e.health ?? "healthy") as AgentDefinitionView["health"],
    lastError: e.lastError ?? undefined,
    createdAt: e.createdAt ? new Date(e.createdAt).toISOString() : undefined,
    updatedAt: e.updatedAt ? new Date(e.updatedAt).toISOString() : undefined,
  };
}

export class AgentDefinitionModel extends BaseDb {
  public repository: Repository<AgentDefinitionEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    this.repository = this.sqliteDb.connection.getRepository(
      AgentDefinitionEntity
    );
  }

  /** All persisted columns except `status` (callers decide status policy). */
  private toPartial(view: AgentDefinitionView): Partial<AgentDefinitionEntity> {
    return {
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
      source: view.source,
      pluginName: view.pluginName ?? null,
      pluginComponentPath: view.pluginComponentPath ?? null,
      manifestJson: view.manifest ? JSON.stringify(view.manifest) : null,
      health: view.health,
      lastError: view.lastError ?? null,
    };
  }

  async upsert(view: AgentDefinitionView): Promise<void> {
    const existing = await this.repository.findOne({
      where: { agentId: view.id },
    });
    const merged: Partial<AgentDefinitionEntity> = {
      ...this.toPartial(view),
      status: view.status,
    };
    if (existing) {
      await this.repository.save({ ...existing, ...merged });
    } else {
      await this.repository.save(merged as AgentDefinitionEntity);
    }
  }

  /**
   * Upsert one plugin-owned agent. On update, refresh content + health but
   * PRESERVE the user's toggled status. On insert, `initiallyEnabled`
   * (derived from prior component state) decides the status; when omitted,
   * the view's status is used.
   */
  async upsertPluginAgent(
    view: AgentDefinitionView,
    initiallyEnabled?: boolean
  ): Promise<void> {
    const existing = await this.repository.findOne({
      where: { agentId: view.id },
    });
    if (existing) {
      await this.repository.save({
        ...existing,
        ...this.toPartial(view),
        status: existing.status,
      });
      return;
    }
    await this.repository.save({
      ...this.toPartial(view),
      status:
        initiallyEnabled === undefined
          ? view.status
          : initiallyEnabled
            ? "active"
            : "disabled",
    } as AgentDefinitionEntity);
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

  async listAll(): Promise<AgentDefinitionView[]> {
    const rows = await this.repository.find({ order: { agentId: "ASC" } });
    return rows.map(toView);
  }

  async findByPluginName(pluginName: string): Promise<AgentDefinitionView[]> {
    const rows = await this.repository.find({
      where: { pluginName },
      order: { agentId: "ASC" },
    });
    return rows.map(toView);
  }

  async deleteByPluginName(pluginName: string): Promise<string[]> {
    const rows = await this.repository.find({ where: { pluginName } });
    const ids = rows.map((r) => r.agentId);
    if (rows.length > 0) {
      await this.repository.delete({ pluginName });
    }
    return ids;
  }

  async toggle(agentId: string, enabled: boolean): Promise<boolean> {
    const existing = await this.repository.findOne({ where: { agentId } });
    if (!existing) return false;
    await this.repository.save({
      ...existing,
      status: enabled ? "active" : "disabled",
    });
    return true;
  }

  async deleteUserAgent(agentId: string): Promise<boolean> {
    const existing = await this.repository.findOne({ where: { agentId } });
    if (!existing) return false;
    await this.repository.delete({ agentId });
    return true;
  }
}
