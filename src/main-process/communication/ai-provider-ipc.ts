import { ipcMain } from "electron";
import type { CommonMessage } from "@/entityTypes/commonType";
import type {
  AIProviderMode,
  AIProviderSettingsView,
  LocalAIProviderConfig,
  LocalAIProviderConfigInput,
  RefreshLocalAIModelsRequest,
  RefreshLocalAIModelsResponse,
  SaveAIProviderSettingsRequest,
  TestLocalAIProviderRequest,
  LocalAIProviderTestResult,
} from "@/entityTypes/aiProviderTypes";
import {
  AI_PROVIDER_SETTINGS_GET,
  AI_PROVIDER_SETTINGS_SAVE,
  AI_PROVIDER_MODELS_REFRESH,
  AI_PROVIDER_CONNECTION_TEST,
  AI_PROVIDER_API_KEY_CLEAR,
} from "@/config/channellist";
import { AIProviderSettingsService } from "@/service/aiProvider/AIProviderSettingsService";
import { AIProviderConnectionTester } from "@/service/aiProvider/AIProviderConnectionTester";
import { OpenAICompatibleProviderClient } from "@/service/aiProvider/OpenAICompatibleProviderClient";
import { validateLocalProviderConfig } from "@/service/aiProvider/AIProviderConfigValidator";

function ok<T>(data: T): CommonMessage<T> {
  return { status: true, msg: "", data };
}
function denied<T>(msg: string): CommonMessage<T> {
  return { status: false, msg, data: undefined };
}

/** Build the service instance per handler (settings can change at runtime). */
function service(): AIProviderSettingsService {
  return new AIProviderSettingsService();
}

/** Parse an IPC argument that may arrive as a JSON string or an object. */
function parseArg<T>(data: unknown): T | null {
  if (data == null) return null;
  if (typeof data === "string") {
    try {
      return JSON.parse(data) as T;
    } catch {
      return null;
    }
  }
  return data as T;
}

/**
 * Register AI Provider settings IPC handlers.
 *
 * Security: handlers never return the plaintext API key. Save/test/refresh
 * accept a transient key from the form, but every response surfaces only the
 * redacted `AIProviderSettingsView` (or a model/test result without secrets).
 */
export function registerAIProviderIpcHandlers(): void {
  ipcMain.handle(AI_PROVIDER_SETTINGS_GET, async () => {
    try {
      return ok(service().getSettingsView());
    } catch (err) {
      return denied(err instanceof Error ? err.message : String(err));
    }
  });

  ipcMain.handle(
    AI_PROVIDER_SETTINGS_SAVE,
    async (_e, data: unknown): Promise<CommonMessage<AIProviderSettingsView>> => {
      try {
        const req = parseArg<SaveAIProviderSettingsRequest>(data);
        if (!req || (req.mode !== "hosted" && req.mode !== "local")) {
          return denied("mode must be 'hosted' or 'local'");
        }
        const svc = service();
        const mode: AIProviderMode = req.mode;

        if (mode === "local") {
          if (!req.localProvider) {
            return denied("localProvider is required when mode is 'local'");
          }
          svc.saveLocalProvider(req.localProvider);
        } else {
          // Switching to hosted: leave any saved local config intact but clear
          // local availability so the resolver does not treat local as usable.
          // (Provider config is retained for when the user switches back.)
        }
        svc.setMode(mode);
        return ok(svc.getSettingsView());
      } catch (err) {
        return denied(err instanceof Error ? err.message : String(err));
      }
    }
  );

  ipcMain.handle(
    AI_PROVIDER_API_KEY_CLEAR,
    async (): Promise<CommonMessage<AIProviderSettingsView>> => {
      try {
        const svc = service();
        svc.clearApiKey();
        return ok(svc.getSettingsView());
      } catch (err) {
        return denied(err instanceof Error ? err.message : String(err));
      }
    }
  );

  ipcMain.handle(
    AI_PROVIDER_MODELS_REFRESH,
    async (_e, data: unknown): Promise<CommonMessage<RefreshLocalAIModelsResponse>> => {
      try {
        const req = parseArg<RefreshLocalAIModelsRequest>(data);
        if (!req?.provider) {
          return denied("provider is required");
        }
        const validation = validateLocalProviderConfig(
          req.provider,
          typeof req.provider.apiKey === "string" &&
            req.provider.apiKey.trim().length > 0
        );
        if (!validation.valid || !validation.normalized) {
          return denied(`Invalid provider configuration: ${validation.errors.join("; ")}`);
        }
        const cfg = validation.normalized;
        const config: LocalAIProviderConfig = {
          preset: cfg.preset,
          name: cfg.name,
          baseUrl: cfg.baseUrl,
          defaultModel: cfg.defaultModel,
          apiKeyConfigured: !!cfg.apiKey && !cfg.clearApiKey,
          ...(typeof cfg.contextSize === "number" ? { contextSize: cfg.contextSize } : {}),
        };
        const apiKey = cfg.clearApiKey ? "" : cfg.apiKey ?? "";
        // Use a one-off client; listModels falls back to a synthetic list on
        // failure and we surface that as a warning rather than an error.
        const client = new OpenAICompatibleProviderClient(config, apiKey);
        const models = await client.listModels();
        const isSynthetic =
          models.data.length === 1 && models.data[0].id === cfg.defaultModel;
        const response: RefreshLocalAIModelsResponse = {
          models: models.data.map((m) => ({
            id: m.id,
            object: m.object,
            created: m.created,
            owned_by: m.owned_by,
            ...(typeof m.context_size === "number" ? { context_size: m.context_size } : {}),
          })),
          ...(models.default_model ? { default_model: models.default_model } : {}),
          ...(isSynthetic
            ? {
                warning:
                  "Model list could not be loaded. You can still use the manually entered model if your provider supports it.",
              }
            : {}),
        };
        return ok(response);
      } catch (err) {
        return denied(err instanceof Error ? err.message : String(err));
      }
    }
  );

  ipcMain.handle(
    AI_PROVIDER_CONNECTION_TEST,
    async (_e, data: unknown): Promise<CommonMessage<LocalAIProviderTestResult>> => {
      try {
        const req = parseArg<TestLocalAIProviderRequest>(data);
        if (!req?.provider) {
          return denied("provider is required");
        }
        const tester = new AIProviderConnectionTester();
        const result = await tester.test(req.provider, { probeTools: false });
        return ok(result);
      } catch (err) {
        return denied(err instanceof Error ? err.message : String(err));
      }
    }
  );
}
