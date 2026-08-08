"use strict";
import { RagConfigApi } from "@/api/ragConfigApi";
import type {
  AvailableModelsResponse,
  ModelInfo,
} from "@/api/ragConfigApi";
import { getLocalEmbeddingModels } from "@/service/embedding/LocalEmbeddingModels";
import { isLocalXenovaModel } from "@/service/embedding/EmbeddingModelId";
import { SystemSettingModule } from "@/modules/SystemSettingModule";

/**
 * Source of the persisted default embedding model. Abstracted so the catalog
 * can be unit-tested without touching SQLite.
 */
export interface DefaultModelProvider {
  getDefaultEmbeddingModel(): Promise<{
    modelName: string;
    dimension: number;
  } | null>;
}

export interface EmbeddingModelCatalogOptions {
  /** Whether the catalog may contact the remote AI server. */
  includeRemote?: boolean;
}

/**
 * Merges remote embedding models (from the AI server) with built-in local
 * embedding models into a single model list used by the UI and IPC validation.
 *
 * Responsibilities:
 *  - normalize remote entries (fill provider/displayName/is_free/available)
 *  - always include local models, even when the remote list API fails
 *  - resolve the effective default model (persisted setting > remote default
 *    > first local model > first available)
 *
 * Local model IDs are namespaced with `local-xenova:` so they cannot collide
 * with remote IDs.
 */
export class EmbeddingModelCatalogService {
  private ragConfigApi: RagConfigApi;
  private defaultProvider: DefaultModelProvider;

  constructor(
    ragConfigApi: RagConfigApi = new RagConfigApi(),
    defaultProvider: DefaultModelProvider = new SystemSettingModule()
  ) {
    this.ragConfigApi = ragConfigApi;
    this.defaultProvider = defaultProvider;
  }

  /**
   * Return the merged model list. Never throws when the remote API fails —
   * returns a local-only catalog instead so the UI can always offer the free
   * local model.
   */
  async listModels(
    options: EmbeddingModelCatalogOptions = {}
  ): Promise<AvailableModelsResponse> {
    let remoteModels: Record<string, ModelInfo> = {};
    let remoteDefault: string | undefined;
    let configuredCount = 0;

    if (options.includeRemote !== false) {
      try {
        const response = await this.ragConfigApi.getAvailableEmbeddingModels();
        if (response.status && response.data) {
          remoteModels = this.normalizeRemoteModels(response.data.models);
          remoteDefault = response.data.default_model;
          configuredCount =
            response.data.configured_models ?? Object.keys(remoteModels).length;
        }
      } catch (error) {
        console.warn(
          "[EmbeddingModelCatalog] Remote model list unavailable; returning local-only catalog:",
          error instanceof Error ? error.message : error
        );
      }
    }

    const merged: Record<string, ModelInfo> = { ...remoteModels };

    // Local IDs are namespaced; add them without overwriting remote entries.
    for (const localModel of getLocalEmbeddingModels()) {
      if (!merged[localModel.name]) {
        merged[localModel.name] = localModel;
      }
    }

    const defaultModel = await this.resolveDefaultModel(merged, remoteDefault);
    const defaultDimensions =
      defaultModel && merged[defaultModel]
        ? merged[defaultModel].dimensions
        : undefined;

    return {
      models: merged,
      default_model: defaultModel,
      default_dimensions: defaultDimensions,
      total_models: Object.keys(merged).length,
      configured_models: configuredCount,
    };
  }

  /**
   * Look up a single model by stable ID. Local models resolve without any
   * remote call; remote models consult the merged list.
   */
  async getModel(modelId: string): Promise<ModelInfo | null> {
    if (typeof modelId !== "string" || modelId.length === 0) {
      return null;
    }
    if (isLocalXenovaModel(modelId)) {
      return (
        getLocalEmbeddingModels().find((model) => model.name === modelId) ?? null
      );
    }
    try {
      const list = await this.listModels();
      return list.models[modelId] ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Resolve the effective default model + dimensions from the merged list.
   */
  async getDefaultModel(): Promise<{
    modelName: string;
    dimension: number;
  } | null> {
    const list = await this.listModels();
    const defaultName = list.default_model;
    if (!defaultName || !list.models[defaultName]) {
      return null;
    }
    return {
      modelName: defaultName,
      dimension: list.models[defaultName].dimensions,
    };
  }

  /** True when the model ID routes to the local Xenova provider. */
  isLocalModel(modelId: string): boolean {
    return isLocalXenovaModel(modelId);
  }

  private normalizeRemoteModels(
    models: Record<string, ModelInfo> | undefined
  ): Record<string, ModelInfo> {
    const result: Record<string, ModelInfo> = {};
    if (!models || typeof models !== "object") {
      return result;
    }
    for (const [key, model] of Object.entries(models)) {
      if (!model || typeof model.name !== "string") {
        continue;
      }
      result[key] = {
        name: model.name,
        description: model.description ?? "",
        dimensions: model.dimensions,
        displayName: model.displayName ?? model.name,
        provider: model.provider ?? "remote-api",
        is_free: model.is_free === true,
        available: model.available !== false,
        underlyingModel: model.underlyingModel,
      };
    }
    return result;
  }

  private async resolveDefaultModel(
    models: Record<string, ModelInfo>,
    remoteDefault: string | undefined
  ): Promise<string> {
    // 1. Persisted user setting wins if it is present in the merged list.
    try {
      const persisted = await this.defaultProvider.getDefaultEmbeddingModel();
      if (persisted && models[persisted.modelName]) {
        return persisted.modelName;
      }
    } catch (error) {
      console.warn(
        "[EmbeddingModelCatalog] Failed to read persisted default embedding model:",
        error instanceof Error ? error.message : error
      );
    }

    // 2. Server-reported default, if present.
    if (remoteDefault && models[remoteDefault]) {
      return remoteDefault;
    }

    // 3. Fall back to the first local model (guarantees a usable default).
    const firstLocal = getLocalEmbeddingModels()[0];
    if (firstLocal && models[firstLocal.name]) {
      return firstLocal.name;
    }

    // 4. Otherwise the first available model, or empty string.
    const firstKey = Object.keys(models)[0];
    return firstKey ?? "";
  }
}
