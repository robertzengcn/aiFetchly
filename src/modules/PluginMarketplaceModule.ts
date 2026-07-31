import { BaseModule } from "@/modules/baseModule";
import { PluginMarketplaceModel } from "@/model/PluginMarketplace.model";
import { PluginMarketplaceEntity } from "@/entity/PluginMarketplace.entity";
import type { PluginMarketplaceError } from "@/entityTypes/pluginMarketplaceTypes";

/**
 * Business logic for plugin marketplaces. DB-facing only: no fetching,
 * no manifest parsing beyond this table's own columns.
 * Source of truth: PRD §9.3, tech design §10.2.
 */
export class PluginMarketplaceModule extends BaseModule {
  private marketplaceModel: PluginMarketplaceModel;

  constructor() {
    super();
    this.marketplaceModel = new PluginMarketplaceModel(this.dbpath);
  }

  async listMarketplaces(): Promise<PluginMarketplaceEntity[]> {
    return this.marketplaceModel.findAll();
  }

  async listEnabledMarketplaces(): Promise<PluginMarketplaceEntity[]> {
    return this.marketplaceModel.findEnabled();
  }

  async getMarketplaceByName(
    name: string
  ): Promise<PluginMarketplaceEntity | null> {
    return this.marketplaceModel.findByName(name);
  }

  async createMarketplace(
    input: Partial<PluginMarketplaceEntity>
  ): Promise<number> {
    return this.marketplaceModel.create({
      name: input.name,
      displayName: input.displayName,
      ownerName: input.ownerName ?? "unknown",
      ownerEmail: input.ownerEmail,
      ownerUrl: input.ownerUrl,
      description: input.description,
      version: input.version,
      sourceKind: input.sourceKind ?? "url",
      sourceUri: input.sourceUri ?? "",
      sourceRef: input.sourceRef,
      installPath: input.installPath,
      manifestJson: input.manifestJson ?? "{}",
      pluginCount: input.pluginCount ?? 0,
      enabled: input.enabled ?? 1,
      autoUpdate: input.autoUpdate ?? 0,
      health: input.health ?? "healthy",
      lastErrorJson: input.lastErrorJson ?? "[]",
      lastFetchedAt: input.lastFetchedAt,
      sourceMetaJson: input.sourceMetaJson ?? "{}",
    });
  }

  async updateMarketplaceState(
    input: Partial<PluginMarketplaceEntity> & { name: string }
  ): Promise<boolean> {
    const patch: Partial<PluginMarketplaceEntity> = {};
    for (const key of [
      "displayName", "ownerName", "ownerEmail", "ownerUrl", "description",
      "version", "sourceKind", "sourceUri", "sourceRef", "installPath",
      "manifestJson", "pluginCount", "enabled", "autoUpdate", "health",
      "lastErrorJson", "lastFetchedAt", "sourceMetaJson",
    ] as const) {
      if (input[key] !== undefined) {
        // immutable-friendly shallow copy into patch
        (patch as Record<string, unknown>)[key] = input[key];
      }
    }
    return this.marketplaceModel.updateByName(input.name, patch);
  }

  async toggleMarketplace(name: string, enabled: boolean): Promise<boolean> {
    const ok = await this.marketplaceModel.toggle(name, enabled);
    if (ok) {
      await this.marketplaceModel.updateByName(name, {
        health: enabled ? "healthy" : "disabled",
      });
    }
    return ok;
  }

  async setMarketplaceErrors(
    name: string,
    errors: readonly PluginMarketplaceError[]
  ): Promise<boolean> {
    return this.marketplaceModel.updateByName(name, {
      lastErrorJson: JSON.stringify(errors),
      health: errors.length === 0 ? "healthy" : "invalid",
    });
  }

  async removeMarketplace(name: string): Promise<boolean> {
    return this.marketplaceModel.remove(name);
  }
}
