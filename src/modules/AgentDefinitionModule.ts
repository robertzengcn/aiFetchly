// src/modules/AgentDefinitionModule.ts
import { BaseModule } from "@/modules/baseModule";
import { AgentDefinitionModel } from "@/model/AgentDefinition.model";
import { InstalledPluginModel } from "@/model/InstalledPlugin.model";
import { AgentDefinitionRegistry } from "@/service/AgentDefinitionRegistry";
import { getAIFetchlyConfigManager } from "@/service/aifetchlyConfig/AIFetchlyConfigManager";
import { sanitizeAgentSegment } from "@/service/pluginCompat/ClaudeAgentFormatAdapter";
import type {
  AgentDefinitionView,
  CreateManualAgentDefinitionInput,
  ParsedPluginAgentDefinition,
  UpdateManualAgentDefinitionInput,
} from "@/entityTypes/agentTypes";

export class AgentDefinitionModule extends BaseModule {
  private readonly model: AgentDefinitionModel;
  private readonly pluginModel: InstalledPluginModel;

  constructor() {
    super();
    this.model = new AgentDefinitionModel(this.dbpath);
    this.pluginModel = new InstalledPluginModel(this.dbpath);
  }

  async ensureBuiltIns(): Promise<void> {
    await this.ensureConnection();
    for (const view of AgentDefinitionRegistry.listBuiltIns()) {
      await this.model.upsert(view);
    }
  }

  /**
   * Runtime active catalog: active + healthy agents whose owning plugin (if
   * any) is enabled. Built-in and manual agents need only be active+healthy.
   * (Decision D3 — plugin enablement composed in the Module, not via SQL join.)
   */
  async listActive(): Promise<AgentDefinitionView[]> {
    return this.listActiveForRuntime();
  }

  async listActiveForRuntime(): Promise<AgentDefinitionView[]> {
    await this.ensureConnection();
    const enabled = await this.enabledPluginNames();
    const all = this.mergeWithRuntimeDefinitions(await this.model.listAll());
    return all.filter((a) => this.isRuntimeEligible(a, enabled));
  }

  async getActiveById(agentId: string): Promise<AgentDefinitionView | null> {
    await this.ensureConnection();
    const persisted = await this.model.getById(agentId);
    const runtime = this.getRuntimeDefinition(agentId);
    const a = persisted ?? runtime;
    if (!a) return null;
    const enabled = await this.enabledPluginNames();
    return this.isRuntimeEligible(a, enabled) ? a : null;
  }

  private async enabledPluginNames(): Promise<Set<string>> {
    const enabled = await this.pluginModel.findEnabled();
    return new Set(enabled.map((p) => p.name));
  }

  private isRuntimeEligible(
    a: AgentDefinitionView,
    enabled: Set<string>
  ): boolean {
    if (a.status !== "active") return false;
    if (a.health !== "healthy") return false;
    if (a.source === "plugin") {
      return !!a.pluginName && enabled.has(a.pluginName);
    }
    return true;
  }

  // -- Management (non-runtime) -------------------------------------------

  async listAllForManagement(): Promise<AgentDefinitionView[]> {
    await this.ensureConnection();
    return this.mergeWithRuntimeDefinitions(await this.model.listAll());
  }

  async getForManagement(agentId: string): Promise<AgentDefinitionView | null> {
    await this.ensureConnection();
    return (
      (await this.model.getById(agentId)) ?? this.getRuntimeDefinition(agentId)
    );
  }

  private mergeWithRuntimeDefinitions(
    persisted: readonly AgentDefinitionView[]
  ): AgentDefinitionView[] {
    const merged = new Map<string, AgentDefinitionView>();
    for (const agent of this.listRuntimeDefinitions()) {
      merged.set(agent.id, agent);
    }
    for (const agent of persisted) {
      merged.set(agent.id, agent);
    }
    return [...merged.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  private listRuntimeDefinitions(): AgentDefinitionView[] {
    return getAIFetchlyConfigManager().getAgentRegistry().list();
  }

  private getRuntimeDefinition(agentId: string): AgentDefinitionView | null {
    return getAIFetchlyConfigManager().getAgentRegistry().getById(agentId);
  }

  /**
   * Create a user-owned (manual) agent. ID becomes `user:<slug>`; rejects
   * collisions with any existing source (design §3.2, §11.2).
   */
  async createManualAgent(
    input: CreateManualAgentDefinitionInput
  ): Promise<AgentDefinitionView> {
    await this.ensureConnection();
    const slug = sanitizeAgentSegment(input.idSlug);
    if (!slug) {
      throw new Error("Agent id slug is empty after sanitization.");
    }
    const id = `user:${slug}`;
    const existing = await this.model.getById(id);
    if (existing) {
      throw new Error(`Agent id "${id}" already exists.`);
    }
    const view: AgentDefinitionView = {
      id,
      name: input.name,
      description: input.description,
      version: 1,
      systemPrompt: input.systemPrompt,
      allowedTools: input.allowedTools,
      ...(input.defaultModel ? { defaultModel: input.defaultModel } : {}),
      mode: input.mode,
      maxToolCalls: input.maxToolCalls,
      maxRuntimeMs: input.maxRuntimeMs,
      maxContinueCalls: input.maxContinueCalls,
      outputSchema: input.outputSchema ?? {},
      status: input.enabled === false ? "disabled" : "active",
      source: "user",
      manifest: {},
      health: "healthy",
    };
    await this.model.upsert(view);
    return view;
  }

  /**
   * Update a user-owned agent. Plugin-owned and built-in agents cannot be
   * edited directly (design §6.4, §11.2). Bumps version on save.
   */
  async updateManualAgent(
    agentId: string,
    patch: UpdateManualAgentDefinitionInput
  ): Promise<AgentDefinitionView> {
    await this.ensureConnection();
    const existing = await this.model.getById(agentId);
    if (!existing) throw new Error(`Agent "${agentId}" not found.`);
    if (existing.source !== "user") {
      throw new Error(
        `Agent "${agentId}" is not user-owned and cannot be edited.`
      );
    }

    // defaultModel: null means "clear" — drop the optional field entirely.
    const defaultModelCleared =
      patch.defaultModel !== undefined && patch.defaultModel === null;

    const updated: AgentDefinitionView = {
      ...existing,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined
        ? { description: patch.description }
        : {}),
      ...(patch.systemPrompt !== undefined
        ? { systemPrompt: patch.systemPrompt }
        : {}),
      ...(patch.allowedTools !== undefined
        ? { allowedTools: patch.allowedTools }
        : {}),
      ...(patch.defaultModel !== undefined && !defaultModelCleared
        ? { defaultModel: patch.defaultModel as string }
        : {}),
      ...(defaultModelCleared ? {} : {}),
      ...(patch.mode !== undefined ? { mode: patch.mode } : {}),
      ...(patch.maxToolCalls !== undefined
        ? { maxToolCalls: patch.maxToolCalls }
        : {}),
      ...(patch.maxRuntimeMs !== undefined
        ? { maxRuntimeMs: patch.maxRuntimeMs }
        : {}),
      ...(patch.maxContinueCalls !== undefined
        ? { maxContinueCalls: patch.maxContinueCalls }
        : {}),
      ...(patch.outputSchema !== undefined
        ? { outputSchema: patch.outputSchema }
        : {}),
      ...(patch.enabled !== undefined
        ? { status: patch.enabled ? "active" : "disabled" }
        : {}),
      version: existing.version + 1,
    };
    if (defaultModelCleared) {
      delete (updated as { defaultModel?: string }).defaultModel;
    }
    await this.model.upsert(updated);
    return updated;
  }

  async toggleAgent(agentId: string, enabled: boolean): Promise<boolean> {
    await this.ensureConnection();
    const existing = await this.model.getById(agentId);
    const runtime = existing ?? this.getRuntimeDefinition(agentId);
    if (!runtime) return false;
    if (runtime.source === "built-in") {
      throw new Error(`Built-in agent "${agentId}" cannot be toggled.`);
    }
    if (existing) {
      return this.model.toggle(agentId, enabled);
    }
    await this.model.upsert({
      ...runtime,
      status: enabled ? "active" : "disabled",
    });
    return true;
  }

  /**
   * Delete a user-owned agent. Built-ins cannot be deleted; plugin-owned
   * agents must be removed via plugin uninstall (design §11.2).
   */
  async deleteManualAgent(agentId: string): Promise<boolean> {
    await this.ensureConnection();
    const existing = await this.model.getById(agentId);
    if (!existing) return false;
    if (existing.source === "built-in") {
      throw new Error(`Built-in agent "${agentId}" cannot be deleted.`);
    }
    if (existing.source === "plugin") {
      throw new Error(
        `Plugin-owned agent "${agentId}" cannot be deleted directly; uninstall the plugin.`
      );
    }
    return this.model.deleteUserAgent(agentId);
  }

  // -- Plugin-owned -------------------------------------------------------

  /**
   * Persist plugin-owned agents. `preservedDisabledIds` carries agent IDs the
   * user previously disabled so overwrite/reinstall honors their toggle
   * (design §3.4, Decision D5).
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
}
