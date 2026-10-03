/**
 * Virtual small/cheap-model alias understood by the hosted aiFetchly AI
 * server. Mirrors the backend `_SMALL_MODEL_ALIASES` set in
 * `aifetchserver/api/openai_compatible.py`.
 *
 * Sending `model: "small"` (case-insensitive) to the hosted
 * `/api/ai/v1/chat/completions` endpoint routes the request to the best
 * active, configured chat row flagged `is_small_model` in the server's
 * environment. When no small row is flagged the server answers
 * HTTP 404 with the stable machine-readable code `small_model_unavailable`.
 *
 * Third-party OpenAI-compatible providers (Ollama, LM Studio, …) do NOT
 * understand this alias: the local client maps it to the configured
 * default model instead (see `OpenAICompatibleProviderClient`).
 */
export const SMALL_MODEL_ALIAS = "small";

/** Hosted-server virtual aliases that resolve to the cheap-model row. */
const SMALL_MODEL_ALIASES: ReadonlySet<string> = new Set(["haiku", "small"]);

/**
 * True when `model` is a hosted-server virtual small-model alias
 * (case-insensitive, surrounding whitespace ignored).
 */
export function isSmallModelAlias(model: unknown): boolean {
  return (
    typeof model === "string" &&
    SMALL_MODEL_ALIASES.has(model.trim().toLowerCase())
  );
}
