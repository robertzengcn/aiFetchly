import type {
  AIProviderValidationResult,
  LocalAIProviderConfigInput,
  LocalAIProviderPreset,
} from "@/entityTypes/aiProviderTypes";
import { getPresetDefinition, isValidPreset } from "./AIProviderPresets";

/**
 * Normalize a user-entered provider base URL into a canonical form ending
 * with `/v1` and no trailing slash.
 *
 * Rules:
 *   1. Trim whitespace.
 *   2. Require `http:` or `https:` protocol.
 *   3. Strip trailing slashes from the path.
 *   4. Append `/v1` when the path does not already end with `/v1`.
 *   5. Drop any query string / hash.
 *
 * @throws Error when the URL is not parseable or uses an unsupported protocol.
 */
export function normalizeOpenAIBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error("Provider URL must not be empty.");
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(
      `Provider URL is not valid: "${trimmed}". Use a full http or https URL.`
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Provider URL must use http or https.");
  }
  // Strip trailing slashes from the pathname. Note: the URL spec reverts an
  // empty pathname back to "/", so a root path ("/" or "") reads as "/" here.
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  if (parsed.pathname === "/" || parsed.pathname === "") {
    parsed.pathname = "/v1";
  } else if (!parsed.pathname.endsWith("/v1")) {
    parsed.pathname = `${parsed.pathname}/v1`;
  }
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

/** Hostnames that are considered "local" and safe to use over plain HTTP. */
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

/** Returns true when `hostname` refers to the local machine. */
export function isLocalHostname(hostname: string): boolean {
  return LOCAL_HOSTNAMES.has(hostname.toLowerCase());
}

/** Returns true when the (already normalized) URL is plain HTTP to a non-local host. */
export function isInsecurePublicHttpUrl(normalizedUrl: string): boolean {
  try {
    const parsed = new URL(normalizedUrl);
    return parsed.protocol === "http:" && !isLocalHostname(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Validate a local provider config input.
 *
 * Returns `{ valid, normalized, errors, warnings }`. The `normalized` value
 * has a cleaned baseUrl and trimmed name/model so callers can persist it
 * directly. Validation never throws — IPC handlers surface `errors` instead.
 *
 * `existingApiKeyConfigured` lets the validator know whether a key is already
 * stored, so an OpenAI preset save that omits the key (e.g. keeping the
 * existing one) is not flagged as missing.
 */
export function validateLocalProviderConfig(
  input: Partial<LocalAIProviderConfigInput> | null | undefined,
  existingApiKeyConfigured = false
): AIProviderValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!input) {
    return { valid: false, errors: ["Provider config is required."], warnings };
  }

  const presetRaw = typeof input.preset === "string" ? input.preset : "";
  let preset: LocalAIProviderPreset | undefined;
  if (!presetRaw) {
    errors.push("Provider preset is required.");
  } else if (!isValidPreset(presetRaw)) {
    errors.push(`Unknown provider preset: "${presetRaw}".`);
  } else {
    preset = presetRaw;
  }

  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length === 0) {
    errors.push("Provider name must not be empty.");
  }

  const defaultModel =
    typeof input.defaultModel === "string" ? input.defaultModel.trim() : "";
  if (defaultModel.length === 0) {
    errors.push("Default model must not be empty.");
  }

  const baseUrlRaw = typeof input.baseUrl === "string" ? input.baseUrl : "";
  let normalizedBaseUrl = "";
  if (baseUrlRaw.trim().length === 0) {
    errors.push("Base URL must not be empty.");
  } else {
    try {
      normalizedBaseUrl = normalizeOpenAIBaseUrl(baseUrlRaw);
      if (isInsecurePublicHttpUrl(normalizedBaseUrl)) {
        warnings.push(
          "Base URL uses HTTP without TLS to a non-local host. API keys sent over this connection may be intercepted."
        );
      }
    } catch (err) {
      errors.push(
        err instanceof Error ? err.message : "Base URL is not valid."
      );
    }
  }

  // API-key recommendations (warnings only — never block save).
  const apiKeyProvided =
    typeof input.apiKey === "string" && input.apiKey.trim().length > 0;
  const willHaveApiKey =
    apiKeyProvided && !input.clearApiKey
      ? true
      : input.clearApiKey
      ? false
      : existingApiKeyConfigured;
  if (preset && !willHaveApiKey) {
    try {
      const def = getPresetDefinition(preset);
      if (def.apiKeyRecommended) {
        warnings.push(
          `${def.displayName} usually requires an API key. Chat may fail without one.`
        );
      } else if (preset === "custom") {
        warnings.push(
          "Some custom providers require an API key. Leave empty only if your provider does not need one."
        );
      }
    } catch {
      // preset already reported above
    }
  }

  // Context size sanity (warning only).
  if (
    input.contextSize !== undefined &&
    input.contextSize !== null &&
    (typeof input.contextSize !== "number" || input.contextSize <= 0)
  ) {
    warnings.push("Context size should be a positive number; ignoring it.");
  }

  if (errors.length > 0 || !preset) {
    return { valid: false, errors, warnings };
  }

  const normalized: LocalAIProviderConfigInput = {
    preset,
    name,
    baseUrl: normalizedBaseUrl,
    defaultModel,
    ...(typeof input.apiKey === "string" ? { apiKey: input.apiKey } : {}),
    ...(input.clearApiKey ? { clearApiKey: true } : {}),
    ...(typeof input.contextSize === "number" && input.contextSize > 0
      ? { contextSize: input.contextSize }
      : {}),
  };

  return { valid: true, normalized, errors, warnings };
}
