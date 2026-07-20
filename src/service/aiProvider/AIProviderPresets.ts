import type { LocalAIProviderPreset } from "@/entityTypes/aiProviderTypes";

/** Definition of a built-in provider preset. Preset ids must remain stable. */
export interface AIProviderPresetDefinition {
  readonly preset: LocalAIProviderPreset;
  readonly displayName: string;
  readonly defaultName: string;
  readonly defaultBaseUrl: string;
  /** Whether an API key is generally required for this provider. */
  readonly apiKeyRecommended: boolean;
}

/**
 * Built-in OpenAI-compatible provider presets. The UI may localize
 * `displayName` separately; the `preset` id is the canonical identifier.
 */
export const AI_PROVIDER_PRESETS: readonly AIProviderPresetDefinition[] = [
  {
    preset: "ollama",
    displayName: "Ollama",
    defaultName: "Ollama",
    defaultBaseUrl: "http://localhost:11434/v1",
    apiKeyRecommended: false,
  },
  {
    preset: "lm_studio",
    displayName: "LM Studio",
    defaultName: "LM Studio",
    defaultBaseUrl: "http://localhost:1234/v1",
    apiKeyRecommended: false,
  },
  {
    preset: "openai",
    displayName: "OpenAI",
    defaultName: "OpenAI",
    defaultBaseUrl: "https://api.openai.com/v1",
    apiKeyRecommended: true,
  },
  {
    preset: "openrouter",
    displayName: "OpenRouter",
    defaultName: "OpenRouter",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    apiKeyRecommended: true,
  },
  {
    preset: "vllm",
    displayName: "vLLM",
    defaultName: "vLLM",
    defaultBaseUrl: "http://localhost:8000/v1",
    apiKeyRecommended: false,
  },
  {
    preset: "localai",
    displayName: "LocalAI",
    defaultName: "LocalAI",
    defaultBaseUrl: "http://localhost:8080/v1",
    apiKeyRecommended: false,
  },
  {
    preset: "custom",
    displayName: "Custom",
    defaultName: "Custom Provider",
    defaultBaseUrl: "",
    apiKeyRecommended: false,
  },
];

const PRESET_BY_ID: ReadonlyMap<LocalAIProviderPreset, AIProviderPresetDefinition> =
  new Map(AI_PROVIDER_PRESETS.map((p) => [p.preset, p]));

/** All valid preset ids (used for validation). */
export const VALID_PRESET_IDS: readonly LocalAIProviderPreset[] =
  AI_PROVIDER_PRESETS.map((p) => p.preset);

/** Returns true when `preset` is a known preset id. */
export function isValidPreset(preset: string): preset is LocalAIProviderPreset {
  return PRESET_BY_ID.has(preset as LocalAIProviderPreset);
}

/** Look up a preset definition by id; throws for unknown ids. */
export function getPresetDefinition(
  preset: LocalAIProviderPreset
): AIProviderPresetDefinition {
  const def = PRESET_BY_ID.get(preset);
  if (!def) {
    throw new Error(`Unknown AI provider preset: ${preset}`);
  }
  return def;
}
