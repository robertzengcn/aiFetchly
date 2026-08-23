import { describe, it, expect, beforeEach, vi } from "vitest";
import { createLightweightCompletionService } from "@/service/AIChatLightweightCompletionFactory";
import type { AIChatLightweightCompletionDeps } from "@/service/AIChatLightweightCompletionService";
import { HttpResponseError } from "@/modules/lib/httpResponseError";
import { AIChatLightweightFailure } from "@/service/AIChatLightweightTypes";
import type {
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
} from "@/api/aiChatApi";

// Kill switch default is OFF. For small-route tests we flip the env before
// constructing the service.
process.env.AIFETCHLY_SMALL_MODEL_ROUTING_ENABLED = "true";

function okResponse(
  model = "resolved-small-model"
): OpenAIChatCompletionResponse {
  return {
    id: "resp-1",
    object: "chat.completion",
    created: 1,
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "summary" },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

interface DepOverrides {
  providerKind?: "hosted" | "local";
  providerKindEnum?:
    | "hosted"
    | "ollama"
    | "lm_studio"
    | "openai"
    | "openrouter"
    | "vllm"
    | "localai"
    | "custom";
  hostedAIEnabled?: boolean;
}

function buildDeps(
  overrides: DepOverrides = {}
): AIChatLightweightCompletionDeps & {
  completeHosted: ReturnType<typeof vi.fn>;
  completeLocal: ReturnType<typeof vi.fn>;
} {
  const completeHosted = vi.fn();
  const completeLocal = vi.fn();
  const kind = overrides.providerKind ?? "hosted";
  return {
    completeHosted,
    completeLocal,
    resolveProvider: async () => ({
      kind,
      providerKind: overrides.providerKindEnum ?? "hosted",
    }),
    isHostedAIEnabled: () => overrides.hostedAIEnabled ?? true,
  } as AIChatLightweightCompletionDeps & {
    completeHosted: ReturnType<typeof vi.fn>;
    completeLocal: ReturnType<typeof vi.fn>;
  };
}

describe("AIChatLightweightCompletionService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("routing", () => {
    it("hosted + enabled sends model='small' on the first attempt", async () => {
      const deps = buildDeps();
      deps.completeHosted.mockResolvedValueOnce(okResponse("haiku-resolved"));
      const svc = createLightweightCompletionService(deps);

      const result = await svc.complete({
        workload: "user_auto_dream",
        messages: [{ role: "user", content: "summarize" }],
        manual: false,
      });

      expect(result.route).toBe("hosted_small");
      expect(result.resolvedModel).toBe("haiku-resolved");
      expect(result.attemptCount).toBe(1);
      expect(deps.completeHosted).toHaveBeenCalledTimes(1);
      expect(deps.completeHosted).toHaveBeenCalledWith(
        expect.objectContaining({ model: "small", stream: false }),
        undefined
      );
    });

    it("local provider never receives the small alias; route is provider_normal", async () => {
      const deps = buildDeps({
        providerKind: "local",
        providerKindEnum: "ollama",
      });
      deps.completeLocal.mockResolvedValueOnce(okResponse("llama3"));
      const svc = createLightweightCompletionService(deps);

      const result = await svc.complete({
        workload: "user_auto_dream",
        messages: [{ role: "user", content: "x" }],
        manual: false,
      });

      expect(result.route).toBe("provider_normal");
      expect(result.resolvedModel).toBe("llama3");
      expect(deps.completeLocal).toHaveBeenCalledTimes(1);
      const req = deps.completeLocal.mock
        .calls[0]![0] as OpenAIChatCompletionRequest;
      expect(req.model).toBeUndefined(); // no alias sent
    });

    it("local provider preserves a requested real model", async () => {
      const deps = buildDeps({
        providerKind: "local",
        providerKindEnum: "openai",
      });
      deps.completeLocal.mockResolvedValueOnce(okResponse("gpt-4o-mini"));
      const svc = createLightweightCompletionService(deps);

      await svc.complete({
        workload: "session_memory_summary",
        messages: [{ role: "user", content: "x" }],
        normalModel: "gpt-4o-mini",
        manual: false,
      });

      const req = deps.completeLocal.mock
        .calls[0]![0] as OpenAIChatCompletionRequest;
      expect(req.model).toBe("gpt-4o-mini");
    });

    it("kill switch off routes to provider_normal without calling hosted small", async () => {
      const previous = process.env.AIFETCHLY_SMALL_MODEL_ROUTING_ENABLED;
      process.env.AIFETCHLY_SMALL_MODEL_ROUTING_ENABLED = "false";
      // Re-import the config module to reset its cache.
      const { resetSmallModelRoutingCache } = await import(
        "@/config/aiLightweightRouting"
      );
      resetSmallModelRoutingCache();
      const { createLightweightCompletionService: createFresh } = await import(
        "@/service/AIChatLightweightCompletionFactory"
      );
      const deps = buildDeps();
      deps.completeHosted.mockResolvedValueOnce(okResponse("normal-model"));
      const svc = createFresh(deps);

      const result = await svc.complete({
        workload: "user_auto_dream",
        messages: [{ role: "user", content: "x" }],
        normalModel: "normal-model",
        manual: false,
      });

      expect(result.route).toBe("provider_normal");
      const req = deps.completeHosted.mock
        .calls[0]![0] as OpenAIChatCompletionRequest;
      expect(req.model).toBe("normal-model");
      process.env.AIFETCHLY_SMALL_MODEL_ROUTING_ENABLED = previous;
      resetSmallModelRoutingCache();
    });
  });

  describe("failure classification & retry", () => {
    it("missing small-model (404) opens cooldown with no fallback for optional work", async () => {
      const deps = buildDeps();
      deps.completeHosted.mockRejectedValueOnce(
        new HttpResponseError("Not Found", 404, "{}")
      );
      const svc = createLightweightCompletionService(deps);

      await expect(
        svc.complete({
          workload: "user_auto_dream",
          messages: [{ role: "user", content: "x" }],
          manual: false,
        })
      ).rejects.toMatchObject({ reason: "small_model_unavailable" });

      // Exactly one request — no retry, no fallback.
      expect(deps.completeHosted).toHaveBeenCalledTimes(1);
      expect(deps.completeLocal).not.toHaveBeenCalled();
      // Cooldown opened.
      const cd = svc.getCooldownState("user_auto_dream");
      expect(cd?.reason).toBe("small_model_unavailable");
      expect(cd?.cooldownUntil).toBeGreaterThan(Date.now());
    });

    it("cooldown suppresses a subsequent background call (cooldown_skip)", async () => {
      const deps = buildDeps();
      deps.completeHosted.mockRejectedValueOnce(
        new HttpResponseError("Not Found", 404, "{}")
      );
      const svc = createLightweightCompletionService(deps);

      // First call fails and opens cooldown.
      await expect(
        svc.complete({
          workload: "user_auto_dream",
          messages: [{ role: "user", content: "x" }],
          manual: false,
        })
      ).rejects.toBeInstanceOf(AIChatLightweightFailure);

      // Second background call is skipped before any server call.
      await expect(
        svc.complete({
          workload: "user_auto_dream",
          messages: [{ role: "user", content: "y" }],
          manual: false,
        })
      ).rejects.toMatchObject({ reason: "small_model_unavailable" });
      expect(deps.completeHosted).toHaveBeenCalledTimes(1); // unchanged
    });

    it("manual execution bypasses scheduling cooldown without enabling fallback", async () => {
      const deps = buildDeps();
      deps.completeHosted.mockRejectedValueOnce(
        new HttpResponseError("Not Found", 404, "{}")
      );
      const svc = createLightweightCompletionService(deps);

      // Open cooldown via a background failure.
      await expect(
        svc.complete({
          workload: "user_auto_dream",
          messages: [{ role: "user", content: "x" }],
          manual: false,
        })
      ).rejects.toBeInstanceOf(AIChatLightweightFailure);

      // Manual call bypasses cooldown — still hits the server, still no fallback.
      deps.completeHosted.mockRejectedValueOnce(
        new HttpResponseError("Not Found", 404, "{}")
      );
      await expect(
        svc.complete({
          workload: "user_auto_dream",
          messages: [{ role: "user", content: "y" }],
          manual: true,
        })
      ).rejects.toMatchObject({ reason: "small_model_unavailable" });
      expect(deps.completeHosted).toHaveBeenCalledTimes(2);
      expect(deps.completeLocal).not.toHaveBeenCalled();
    });

    it("429 performs one same-route retry then succeeds", async () => {
      const deps = buildDeps();
      deps.completeHosted
        .mockRejectedValueOnce(new HttpResponseError("rl", 429, "", 1))
        .mockResolvedValueOnce(okResponse());
      const svc = createLightweightCompletionService(deps);

      const result = await svc.complete({
        workload: "session_memory_summary",
        messages: [{ role: "user", content: "x" }],
        manual: false,
      });

      expect(result.route).toBe("hosted_small");
      expect(result.attemptCount).toBe(2);
      expect(result.retryReason).toBe("rate_limit");
      expect(deps.completeHosted).toHaveBeenCalledTimes(2);
    });

    it("generic 5xx retries once without broad fallback (optional workload)", async () => {
      const deps = buildDeps();
      deps.completeHosted.mockRejectedValue(
        new HttpResponseError("boom", 500, "")
      );
      const svc = createLightweightCompletionService(deps);

      await expect(
        svc.complete({
          workload: "user_auto_dream",
          messages: [{ role: "user", content: "x" }],
          manual: false,
        })
      ).rejects.toMatchObject({ reason: "server_error" });
      // Initial + one retry = 2, no fallback to local.
      expect(deps.completeHosted).toHaveBeenCalledTimes(2);
      expect(deps.completeLocal).not.toHaveBeenCalled();
    });

    it("ambiguous timeout produces exactly one total request (no retry, no fallback)", async () => {
      const deps = buildDeps();
      deps.completeHosted.mockRejectedValueOnce(
        new DOMException("aborted", "AbortError")
      );
      const svc = createLightweightCompletionService(deps);

      await expect(
        svc.complete({
          workload: "user_auto_dream",
          messages: [{ role: "user", content: "x" }],
          manual: false,
        })
      ).rejects.toMatchObject({ reason: "timeout_ambiguous" });
      expect(deps.completeHosted).toHaveBeenCalledTimes(1);
      expect(deps.completeLocal).not.toHaveBeenCalled();
    });

    it("authentication failure does not retry or fall back", async () => {
      const deps = buildDeps();
      deps.completeHosted.mockRejectedValue(
        new HttpResponseError("unauth", 401, "")
      );
      const svc = createLightweightCompletionService(deps);

      await expect(
        svc.complete({
          workload: "user_auto_dream",
          messages: [{ role: "user", content: "x" }],
          manual: false,
        })
      ).rejects.toMatchObject({ reason: "authentication" });
      expect(deps.completeHosted).toHaveBeenCalledTimes(1);
      expect(deps.completeLocal).not.toHaveBeenCalled();
    });
  });

  describe("compact controlled fallback", () => {
    it("conversation_compact falls back exactly once on small_model_unavailable", async () => {
      const deps = buildDeps();
      deps.completeHosted
        .mockRejectedValueOnce(new HttpResponseError("nf", 404, "{}"))
        .mockResolvedValueOnce(okResponse("normal-compact-model"));
      const svc = createLightweightCompletionService(deps);

      const result = await svc.complete({
        workload: "conversation_compact",
        messages: [{ role: "user", content: "x" }],
        normalModel: "normal-compact-model",
        manual: false,
      });

      expect(result.route).toBe("normal_fallback");
      expect(result.fallbackAttempted).toBe(true);
      expect(result.fallbackReason).toBe("small_model_unavailable");
      expect(result.resolvedModel).toBe("normal-compact-model");
      // One small attempt + one normal fallback = 2 total.
      expect(deps.completeHosted).toHaveBeenCalledTimes(2);
    });

    it("conversation_compact does NOT fall back on ambiguous timeout", async () => {
      const deps = buildDeps();
      deps.completeHosted.mockRejectedValueOnce(
        new DOMException("aborted", "AbortError")
      );
      const svc = createLightweightCompletionService(deps);

      await expect(
        svc.complete({
          workload: "conversation_compact",
          messages: [{ role: "user", content: "x" }],
          normalModel: "normal",
          manual: false,
        })
      ).rejects.toMatchObject({ reason: "timeout_ambiguous" });
      expect(deps.completeHosted).toHaveBeenCalledTimes(1);
      expect(deps.completeLocal).not.toHaveBeenCalled();
    });

    it("conversation_compact does NOT fall back on authentication failure", async () => {
      const deps = buildDeps();
      deps.completeHosted.mockRejectedValue(
        new HttpResponseError("u", 401, "")
      );
      const svc = createLightweightCompletionService(deps);

      await expect(
        svc.complete({
          workload: "conversation_compact",
          messages: [{ role: "user", content: "x" }],
          normalModel: "normal",
          manual: false,
        })
      ).rejects.toMatchObject({ reason: "authentication" });
      expect(deps.completeLocal).not.toHaveBeenCalled();
    });

    it("optional workloads never fall back to the normal model", async () => {
      const deps = buildDeps();
      deps.completeHosted.mockRejectedValue(
        new HttpResponseError("nf", 404, "{}")
      );
      const svc = createLightweightCompletionService(deps);

      await expect(
        svc.complete({
          workload: "session_memory_summary",
          messages: [{ role: "user", content: "x" }],
          normalModel: "normal",
          manual: false,
        })
      ).rejects.toMatchObject({ reason: "small_model_unavailable" });
      expect(deps.completeLocal).not.toHaveBeenCalled();
    });
  });

  describe("cancellation", () => {
    it("cancellation before retry prevents the second request", async () => {
      const deps = buildDeps();
      // 429 with a 100ms retry delay so the caller abort lands deterministically
      // during the retry sleep (before the second completion call).
      deps.completeHosted.mockRejectedValueOnce(
        new HttpResponseError("rl", 429, "", 100)
      );
      const svc = createLightweightCompletionService(deps);

      const controller = new AbortController();
      setTimeout(() => controller.abort(), 10);

      await expect(
        svc.complete({
          workload: "session_memory_summary",
          messages: [{ role: "user", content: "x" }],
          manual: false,
          signal: controller.signal,
        })
      ).rejects.toMatchObject({ reason: "cancelled" });
      expect(deps.completeHosted).toHaveBeenCalledTimes(1);
    });
  });

  describe("cooldown reset", () => {
    it("resetCooldowns clears a config cooldown so a background call can probe again", async () => {
      const deps = buildDeps();
      deps.completeHosted.mockRejectedValueOnce(
        new HttpResponseError("nf", 404, "{}")
      );
      const svc = createLightweightCompletionService(deps);

      await expect(
        svc.complete({
          workload: "user_auto_dream",
          messages: [{ role: "user", content: "x" }],
          manual: false,
        })
      ).rejects.toBeInstanceOf(AIChatLightweightFailure);
      expect(svc.getCooldownState("user_auto_dream")).not.toBeNull();

      svc.resetCooldowns();
      expect(svc.getCooldownState("user_auto_dream")).toBeNull();
    });
  });
});
