import { windowInvoke } from "@/views/utils/apirequest";
import {
  AI_PROVIDER_SETTINGS_GET,
  AI_PROVIDER_SETTINGS_SAVE,
  AI_PROVIDER_MODELS_REFRESH,
  AI_PROVIDER_CONNECTION_TEST,
  AI_PROVIDER_API_KEY_CLEAR,
} from "@/config/channellist";
import type {
  AIProviderSettingsView,
  RefreshLocalAIModelsRequest,
  RefreshLocalAIModelsResponse,
  SaveAIProviderSettingsRequest,
  TestLocalAIProviderRequest,
  LocalAIProviderTestResult,
} from "@/entityTypes/aiProviderTypes";

/**
 * Renderer API for the Local AI Provider feature.
 *
 * All calls go through the main process via `windowInvoke`; the renderer never
 * calls a provider URL directly and never receives the plaintext API key (only
 * `apiKeyConfigured: boolean` on the settings view).
 */

/** Load the redacted provider settings view (mode + redacted local config). */
export async function getAIProviderSettings(): Promise<AIProviderSettingsView> {
  return (await windowInvoke(AI_PROVIDER_SETTINGS_GET)) as AIProviderSettingsView;
}

/** Save provider mode and (when local) the provider config + key. */
export async function saveAIProviderSettings(
  request: SaveAIProviderSettingsRequest
): Promise<AIProviderSettingsView> {
  return (await windowInvoke(
    AI_PROVIDER_SETTINGS_SAVE,
    request as unknown as object
  )) as AIProviderSettingsView;
}

/**
 * Refresh models from a (possibly unsaved) provider so the user can test a URL
 * before saving. Returns a synthetic single-model list with a warning when
 * the provider's /models endpoint is unavailable.
 */
export async function refreshLocalAIModels(
  request: RefreshLocalAIModelsRequest
): Promise<RefreshLocalAIModelsResponse> {
  return (await windowInvoke(
    AI_PROVIDER_MODELS_REFRESH,
    request as unknown as object
  )) as RefreshLocalAIModelsResponse;
}

/** Run a connection test and capability probe against a provider. */
export async function testLocalAIProvider(
  request: TestLocalAIProviderRequest
): Promise<LocalAIProviderTestResult> {
  return (await windowInvoke(
    AI_PROVIDER_CONNECTION_TEST,
    request as unknown as object
  )) as LocalAIProviderTestResult;
}

/** Delete the stored provider API key. Returns the redacted settings view. */
export async function clearLocalAIProviderApiKey(): Promise<AIProviderSettingsView> {
  return (await windowInvoke(AI_PROVIDER_API_KEY_CLEAR)) as AIProviderSettingsView;
}
