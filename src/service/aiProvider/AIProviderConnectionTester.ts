import type {
  LocalAIProviderCapabilities,
  LocalAIProviderConfigInput,
  LocalAIProviderTestResult,
  ProviderCapabilityStatus,
} from "@/entityTypes/aiProviderTypes";
import { validateLocalProviderConfig } from "./AIProviderConfigValidator";

const MODELS_TIMEOUT_MS = 10_000;
const CHAT_TIMEOUT_MS = 20_000;
const STREAM_TIMEOUT_MS = 20_000;

const TEST_CHAT_MESSAGES = [
  { role: "user", content: "Reply with exactly: pong" },
];

/**
 * Mutable working copy of capabilities used during probing. A mutable object is
 * assignable to the readonly `LocalAIProviderCapabilities` on return, so we can
 * mutate fields as each probe completes without rebuilding the object.
 */
type MutableCapabilities = {
  modelsEndpoint: ProviderCapabilityStatus;
  chat: ProviderCapabilityStatus;
  streaming: ProviderCapabilityStatus;
  tools: ProviderCapabilityStatus;
  vision: "supported" | "unsupported" | "unknown";
  contextSize?: number;
};

/** Default (unknown) capabilities before probing. */
function unknownCapabilities(): MutableCapabilities {
  return {
    modelsEndpoint: "unknown",
    chat: "unknown",
    streaming: "unknown",
    tools: "unknown",
    vision: "unknown",
  };
}

/**
 * Probes a (possibly unsaved) local provider to discover its capabilities.
 *
 * Steps: validate config -> GET /models -> non-stream chat -> stream chat ->
 * optional tool probe. Each step is bounded by an AbortController timeout so a
 * hung provider cannot block the UI. Never throws — failures degrade the
 * corresponding capability and the overall status.
 *
 * Runs in the main process only. `fetchImpl` is injectable for unit tests.
 */
export class AIProviderConnectionTester {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async test(
    input: LocalAIProviderConfigInput,
    options: { probeTools?: boolean } = {}
  ): Promise<LocalAIProviderTestResult> {
    const capabilities = unknownCapabilities();

    const validation = validateLocalProviderConfig(
      input,
      typeof input.apiKey === "string" && input.apiKey.trim().length > 0
    );
    if (!validation.valid || !validation.normalized) {
      return {
        status: "failed",
        message: `Invalid provider configuration: ${validation.errors.join(
          "; "
        )}`,
        capabilities,
      };
    }
    const cfg = validation.normalized;
    const apiKey = cfg.clearApiKey ? "" : cfg.apiKey ?? "";
    const headers = this.jsonHeaders(apiKey);
    const base = cfg.baseUrl;
    const model = cfg.defaultModel;

    const messages: string[] = [];
    let chatOk = false;
    let modelsList: string[] | undefined;

    // 1) Models endpoint.
    try {
      const res = await this.fetchWithTimeout(
        `${base}/models`,
        { method: "GET", headers },
        MODELS_TIMEOUT_MS
      );
      if (res.ok) {
        capabilities.modelsEndpoint = "supported";
        const raw = (await res.json().catch(() => null)) as unknown;
        modelsList = this.extractModelIds(raw, model);
      } else {
        capabilities.modelsEndpoint =
          res.status === 404 ? "unsupported" : "failed";
      }
    } catch {
      capabilities.modelsEndpoint = "failed";
    }

    // 2) Non-streaming chat.
    try {
      const res = await this.fetchWithTimeout(
        `${base}/chat/completions`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            model,
            messages: TEST_CHAT_MESSAGES,
            temperature: 0,
            max_tokens: 8,
            stream: false,
          }),
        },
        CHAT_TIMEOUT_MS
      );
      if (res.ok) {
        capabilities.chat = "supported";
        chatOk = true;
      } else if (res.status === 401 || res.status === 403) {
        capabilities.chat = "unsupported";
        messages.push("AI provider authentication failed. Check your API key.");
      } else if (
        this.isModelMissing(res.status, await res.text().catch(() => ""))
      ) {
        capabilities.chat = "unsupported";
        messages.push(
          "The selected model is not available from this provider."
        );
      } else {
        capabilities.chat = "failed";
        messages.push(`Chat endpoint returned HTTP ${res.status}.`);
      }
    } catch {
      capabilities.chat = "failed";
      messages.push(
        "Could not connect to the provider. Check that it is running and the base URL is correct."
      );
    }

    // 3) Streaming chat (only meaningful if chat works).
    if (chatOk) {
      try {
        const res = await this.fetchWithTimeout(
          `${base}/chat/completions`,
          {
            method: "POST",
            headers: { ...headers, Accept: "text/event-stream" },
            body: JSON.stringify({
              model,
              messages: TEST_CHAT_MESSAGES,
              temperature: 0,
              max_tokens: 8,
              stream: true,
            }),
          },
          STREAM_TIMEOUT_MS
        );
        capabilities.streaming = res.ok ? "supported" : "failed";
        // Drain a little of the body so the connection closes cleanly.
        await res.body
          ?.getReader()
          .read()
          .catch(() => undefined);
      } catch {
        capabilities.streaming = "failed";
      }
    }

    // 4) Optional tool probe.
    if (options.probeTools && chatOk) {
      capabilities.tools = await this.probeTools(base, headers, model);
    }

    const status: LocalAIProviderTestResult["status"] = chatOk
      ? capabilities.streaming === "supported" &&
        capabilities.modelsEndpoint === "supported"
        ? "passed"
        : "partial"
      : "failed";

    return {
      status,
      message: this.summarize(status, messages, capabilities),
      capabilities,
      models: modelsList,
      defaultModel: model,
    };
  }

  private jsonHeaders(apiKey: string): Record<string, string> {
    const h: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    if (apiKey.trim().length > 0) {
      h.Authorization = `Bearer ${apiKey}`;
    }
    return h;
  }

  /** fetch with a hard timeout via AbortController. */
  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private isModelMissing(status: number, body: string): boolean {
    if (status !== 404 && status !== 400) return false;
    return /model.*(not found|not available|does not exist)/i.test(body);
  }

  private extractModelIds(raw: unknown, fallback: string): string[] {
    let arr: unknown[] | undefined;
    if (raw && typeof raw === "object") {
      const r = raw as { data?: unknown; models?: unknown };
      if (Array.isArray(r.data)) arr = r.data;
      else if (Array.isArray(r.models)) arr = r.models;
    }
    const ids = (arr ?? [])
      .map((entry) => {
        if (entry && typeof entry === "object") {
          const e = entry as { id?: unknown; name?: unknown };
          if (typeof e.id === "string") return e.id;
          if (typeof e.name === "string") return e.name;
        }
        return undefined;
      })
      .filter((x): x is string => typeof x === "string" && x.length > 0);
    if (!ids.includes(fallback) && fallback.length > 0) {
      ids.unshift(fallback);
    }
    return ids;
  }

  private async probeTools(
    base: string,
    headers: Record<string, string>,
    model: string
  ): Promise<ProviderCapabilityStatus> {
    try {
      const res = await this.fetchWithTimeout(
        `${base}/chat/completions`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: "Call the provided tool." }],
            tools: [
              {
                type: "function",
                function: {
                  name: "ping_tool",
                  description: "Return pong.",
                  parameters: {
                    type: "object",
                    properties: {},
                    additionalProperties: false,
                  },
                },
              },
            ],
            tool_choice: { type: "function", function: { name: "ping_tool" } },
            max_tokens: 16,
            stream: false,
          }),
        },
        CHAT_TIMEOUT_MS
      );
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return /\b(tools?|functions?)\b/i.test(body)
          ? "unsupported"
          : "unknown";
      }
      const raw = (await res.json().catch(() => null)) as unknown;
      if (raw && typeof raw === "object") {
        const choices = (raw as { choices?: unknown[] }).choices;
        if (Array.isArray(choices) && choices.length > 0) {
          const msg = (choices[0] as { message?: { tool_calls?: unknown[] } })
            .message;
          if (
            msg &&
            Array.isArray(msg.tool_calls) &&
            msg.tool_calls.length > 0
          ) {
            return "supported";
          }
        }
      }
      return "unknown";
    } catch {
      return "unknown";
    }
  }

  private summarize(
    status: LocalAIProviderTestResult["status"],
    extra: string[],
    caps: LocalAIProviderCapabilities
  ): string {
    if (status === "passed") {
      return "Connection test passed.";
    }
    if (status === "partial") {
      const parts: string[] = [
        "Chat test passed, but some capabilities could not be verified.",
      ];
      if (caps.streaming !== "supported") {
        parts.push("Streaming could not be verified and may not work.");
      }
      if (caps.modelsEndpoint !== "supported") {
        parts.push(
          "The model list could not be loaded; the manually entered model will be used."
        );
      }
      return parts.join(" ");
    }
    return extra.length > 0 ? extra.join(" ") : "Connection test failed.";
  }
}
