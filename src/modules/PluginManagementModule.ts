import { BaseModule } from "@/modules/baseModule";
import { InstalledPluginModel } from "@/model/InstalledPlugin.model";
import { InstalledSkillModel } from "@/model/InstalledSkill.model";
import { MCPToolModel } from "@/model/MCPTool.model";
import { InstalledPluginEntity } from "@/entity/InstalledPlugin.entity";
import type {
  CreateInstalledPluginInput,
  UpdatePluginStateInput,
  PluginUninstallResult,
  PluginError,
  PluginComponentState,
} from "@/entityTypes/pluginTypes";

/**
 * Business logic for installed plugins.
 * Source of truth: Design §6.2.
 *
 * Rules:
 *  - May call InstalledPluginModel, InstalledSkillModel, MCPToolModel.
 *  - Does NOT parse zip files.
 *  - Does NOT execute plugin code.
 */
export class PluginManagementModule extends BaseModule {
  private pluginModel: InstalledPluginModel;
  private skillModel: InstalledSkillModel;
  private mcpModel: MCPToolModel;

  constructor() {
    super();
    this.pluginModel = new InstalledPluginModel(this.dbpath);
    this.skillModel = new InstalledSkillModel(this.dbpath);
    this.mcpModel = new MCPToolModel(this.dbpath);
  }

  async listInstalledPlugins(): Promise<InstalledPluginEntity[]> {
    return this.pluginModel.findAll();
  }

  async listEnabledPlugins(): Promise<InstalledPluginEntity[]> {
    return this.pluginModel.findEnabled();
  }

  async getPluginByName(
    name: string
  ): Promise<InstalledPluginEntity | null> {
    return this.pluginModel.findByName(name);
  }

  async createPlugin(input: CreateInstalledPluginInput): Promise<number> {
    return this.pluginModel.create({
      name: input.name,
      displayName: input.displayName,
      version: input.version,
      source: input.source,
      description: input.description,
      author: input.author,
      installPath: input.installPath,
      manifestJson: input.manifestJson,
      permissionsJson: input.permissionsJson ?? "[]",
      componentStateJson: input.componentStateJson ?? "{}",
      enabled: input.enabled ?? 1,
      health: input.health ?? "healthy",
    });
  }

  async updatePluginState(input: UpdatePluginStateInput): Promise<boolean> {
    if (!input.name) {
      return false;
    }
    const patch: Partial<InstalledPluginEntity> = {};
    if (input.displayName !== undefined) patch.displayName = input.displayName;
    if (input.version !== undefined) patch.version = input.version;
    if (input.description !== undefined) patch.description = input.description;
    if (input.manifestJson !== undefined) patch.manifestJson = input.manifestJson;
    if (input.permissionsJson !== undefined)
      patch.permissionsJson = input.permissionsJson;
    if (input.componentStateJson !== undefined)
      patch.componentStateJson = input.componentStateJson;
    if (input.health !== undefined) patch.health = input.health;
    if (input.lastLoadErrorsJson !== undefined)
      patch.lastLoadErrorsJson = input.lastLoadErrorsJson;
    return this.pluginModel.updateByName(input.name, patch);
  }

  async togglePlugin(name: string, enabled: boolean): Promise<boolean> {
    return this.pluginModel.toggle(name, enabled);
  }

  async setLoadErrors(
    name: string,
    errors: readonly PluginError[]
  ): Promise<boolean> {
    return this.pluginModel.updateByName(name, {
      lastLoadErrorsJson: JSON.stringify(errors),
      health: errors.length === 0 ? "healthy" : "partial_load",
    });
  }

  async updateComponentState(
    name: string,
    state: PluginComponentState
  ): Promise<boolean> {
    return this.pluginModel.updateByName(name, {
      componentStateJson: JSON.stringify(state),
    });
  }

  /**
   * Remove a plugin row, its owned skill rows, and its owned MCP rows.
   * Filesystem cleanup of installPath is the caller's responsibility
   * (PluginImportService rollback / IPC uninstall flow).
   *
   * Returns the names of removed owned components so callers can also
   * unregister them from runtime registries.
   */
  async uninstallPlugin(name: string): Promise<PluginUninstallResult> {
    const existing = await this.pluginModel.findByName(name);
    if (!existing) {
      return {
        removedPlugin: false,
        removedSkillNames: [],
        removedMcpServerNames: [],
        errors: [],
      };
    }

    const errors: PluginError[] = [];

    const ownedSkills = await this.skillModel.findByPluginName(name);
    const removedSkillNames = ownedSkills.map((s) => s.name);
    try {
      await this.skillModel.deleteByPluginName(name);
    } catch (e: unknown) {
      errors.push({
        code: "uninstall-failed",
        componentType: "skill",
        pluginName: name,
        message: e instanceof Error ? e.message : String(e),
        recoverable: false,
      });
    }

    const ownedMcp = await this.mcpModel.findByPluginName(name);
    const removedMcpServerNames = ownedMcp.map((m) => m.serverName);
    try {
      await this.mcpModel.deleteByPluginName(name);
    } catch (e: unknown) {
      errors.push({
        code: "uninstall-failed",
        componentType: "mcpServer",
        pluginName: name,
        message: e instanceof Error ? e.message : String(e),
        recoverable: false,
      });
    }

    let removedPlugin = false;
    try {
      removedPlugin = await this.pluginModel.remove(name);
    } catch (e: unknown) {
      errors.push({
        code: "uninstall-failed",
        componentType: "plugin",
        pluginName: name,
        message: e instanceof Error ? e.message : String(e),
        recoverable: false,
      });
    }

    return {
      removedPlugin,
      removedSkillNames,
      removedMcpServerNames,
      errors,
    };
  }
}
