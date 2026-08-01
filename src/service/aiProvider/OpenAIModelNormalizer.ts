import type {
  OpenAIModel,
  OpenAIModelsResponse,
} from "@/api/aiChatApi";

/** Options that shape normalization of a local provider model list. */
export interface NormalizeModelsOptions {
  /** Configured default model; inserted at the top when absent from the list. */
  readonly defaultModel?: string;
  /** Provider display name, used as `owned_by` fallback. */
  readonly providerName?: string;
  /** Optional configured context-size override applied to the default model. */
  readonly contextSize?: number;
}

/** Options for synthesizing a single-model list when /models is unavailable. */
export interface SyntheticModelListOptions {
  readonly model: string;
  readonly providerName?: string;
  readonly contextSize?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function toModel(entry: unknown, providerName: string): OpenAIModel | null {
  if (!isRecord(entry)) {
    return null;
  }
  const id =
    typeof entry.id === "string"
      ? entry.id
      : typeof entry.name === "string"
        ? entry.name
        : "";
  if (id.length === 0) {
    return null;
  }
  const model: OpenAIModel = {
    id,
    object: "model",
    created: typeof entry.created === "number" ? entry.created : 0,
    owned_by:
      typeof entry.owned_by === "string" && entry.owned_by.length > 0
        ? entry.owned_by
        : providerName,
  };
  const contextSize =
    typeof entry.context_size === "number"
      ? entry.context_size
      : typeof entry.context_window === "number"
        ? entry.context_window
        : typeof entry.context_length === "number"
          ? entry.context_length
          : undefined;
  if (typeof contextSize === "number" && contextSize > 0) {
    model.context_size = contextSize;
  }
  if (typeof entry.max_tokens === "number" && entry.max_tokens > 0) {
    model.max_tokens = entry.max_tokens;
  }
  return model;
}

/**
 * Normalize an OpenAI-compatible `/models` response into the canonical
 * `OpenAIModelsResponse`. Tolerates a few field-name variants (id vs name,
 * context_size/context_window/context_length). When `defaultModel` is set but
 * absent from the returned list, it is inserted at the top so the model
 * selector always offers the configured model.
 */
export function normalizeOpenAIModelsResponse(
  raw: unknown,
  options: NormalizeModelsOptions = {}
): OpenAIModelsResponse {
  const providerName = options.providerName ?? "local";
  const data: OpenAIModel[] = [];

  if (isRecord(raw) && Array.isArray(raw.data)) {
    for (const entry of raw.data) {
      const model = toModel(entry, providerName);
      if (model) {
        data.push(model);
      }
    }
  } else if (isRecord(raw) && Array.isArray(raw.models)) {
    // Some providers reuse the hosted-style { models: [...] } envelope.
    for (const entry of raw.models) {
      const model = toModel(entry, providerName);
      if (model) {
        data.push(model);
      }
    }
  }

  // Ensure the configured default model is present.
  if (options.defaultModel && options.defaultModel.length > 0) {
    const exists = data.some(
      (m) => m.id === options.defaultModel
    );
    if (!exists) {
      const fallback: OpenAIModel = {
        id: options.defaultModel,
        object: "model",
        created: 0,
        owned_by: providerName,
      };
      if (typeof options.contextSize === "number" && options.contextSize > 0) {
        fallback.context_size = options.contextSize;
      }
      data.unshift(fallback);
    }
  }

  const result: OpenAIModelsResponse = {
    object: "list",
    data,
  };
  const defaultModel =
    options.defaultModel ??
    (isRecord(raw) && typeof raw.default_model === "string"
      ? raw.default_model
      : data[0]?.id);
  if (defaultModel) {
    result.default_model = defaultModel;
  }
  return result;
}

/**
 * Build a synthetic single-model list. Used as a graceful fallback when a local
 * provider's `/models` endpoint is unavailable, so chat can still proceed with
 * the manually configured model (the UI surfaces a warning).
 */
export function buildSyntheticModelList(
  options: SyntheticModelListOptions
): OpenAIModelsResponse {
  const providerName = options.providerName ?? "local";
  const model: OpenAIModel = {
    id: options.model,
    object: "model",
    created: 0,
    owned_by: providerName,
  };
  if (typeof options.contextSize === "number" && options.contextSize > 0) {
    model.context_size = options.contextSize;
  }
  return {
    object: "list",
    data: [model],
    default_model: options.model,
  };
}
