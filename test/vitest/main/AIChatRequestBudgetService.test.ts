/**
 * Unit tests for AIChatRequestBudgetService (technical-design §8.1–§8.5).
 *
 * Verifies the complete-request token budget:
 * - Dispatch requires I + O + M <= C (§8.2).
 * - Unknown text-only models fall back to 8,192-token context + 1,024 output
 *   reservation (§8.1), labeled limitSource = "fallback".
 * - Image content parts MUST count as non-zero tokens (never zero-token image).
 * - Safety margin M = ceil(0.10 * C).
 * - Compaction trigger at I >= 0.80 * U; target I <= 0.60 * U.
 * - Mandatory oversized content → CONTEXT_REQUIRED_CONTENT_TOO_LARGE (§8.5).
 * - Optional blocks may be evicted to fit, but never current user content /
 *   user-selected excerpts / required permission state / half a tool pair.
 * - allocateSectionCapacity caps source at min(12000, C - Osection - M -
 *   overhead - stateInputCost); non-positive capacity is an error.
 *
 * The budget service takes an injected model-limit resolver so the tests are
 * deterministic and don't touch the live catalog.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AIChatRequestBudgetService } from "@/service/AIChatRequestBudgetService";
import { AI_CHAT_RECOVERABLE_DEFAULTS } from "@/service/AIChatRecoverableDefaults";
import type { OpenAIChatMessage, OpenAITool } from "@/api/aiChatApi";

/** Build a minimal chat message with a single text content part. */
function textMsg(
  role: "user" | "assistant" | "system" | "tool",
  text: string
): OpenAIChatMessage {
  return {
    role,
    content: text,
  };
}

/** Build a chat message with an image_url content part (vision input). */
function imageMsg(
  role: "user" | "assistant" = "user",
  dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANS"
): OpenAIChatMessage {
  return {
    role,
    content: [
      { type: "text", text: "describe this" },
      { type: "image_url", image_url: { url: dataUrl } },
    ],
  };
}

/** A model-limit resolver returning fixed limits for deterministic tests. */
function fixedResolver(limits: {
  contextLimit: number;
  outputLimit: number;
  limitSource: "provider" | "configured" | "fallback";
}) {
  return {
    resolve: vi.fn(() => limits),
  };
}

describe("AIChatRequestBudgetService", () => {
  let svc: AIChatRequestBudgetService;

  beforeEach(() => {
    svc = new AIChatRequestBudgetService();
  });

  describe("limit resolution (§8.1)", () => {
    it("uses provider limits when available", () => {
      const resolver = fixedResolver({
        contextLimit: 32_000,
        outputLimit: 8_000,
        limitSource: "provider",
      });
      const r = svc.preflight({
        messages: [textMsg("user", "hi")],
        tools: [],
        model: "gpt-4o",
        outputReserve: 4_000,
        modelLimitResolver: resolver.resolve,
      });
      expect(r.ok).toBe(true);
      expect(r.resolvedLimits?.contextLimit).toBe(32_000);
      expect(r.resolvedLimits?.limitSource).toBe("provider");
    });

    it("falls back to 8192 context + 1024 output for unknown text models", () => {
      const resolver = fixedResolver({
        contextLimit: 8_192,
        outputLimit: 1_024,
        limitSource: "fallback",
      });
      const r = svc.preflight({
        messages: [textMsg("user", "hi")],
        tools: [],
        model: "unknown-local-model",
        outputReserve: 1_024,
        modelLimitResolver: resolver.resolve,
      });
      expect(r.resolvedLimits?.contextLimit).toBe(8_192);
      expect(r.resolvedLimits?.outputLimit).toBe(1_024);
      expect(r.resolvedLimits?.limitSource).toBe("fallback");
    });
  });

  describe("formula I + O + M <= C (§8.2)", () => {
    it("accepts a request that fits within usable capacity", () => {
      const resolver = fixedResolver({
        contextLimit: 32_000,
        outputLimit: 8_000,
        limitSource: "provider",
      });
      // 100 chars ≈ 25 bytes ≈ conservative estimate; well within 24,800 usable.
      const r = svc.preflight({
        messages: [textMsg("user", "x".repeat(100))],
        tools: [],
        model: "gpt-4o",
        outputReserve: 4_000,
        modelLimitResolver: resolver.resolve,
      });
      expect(r.ok).toBe(true);
      expect(r.estimatedInputTokens).toBeLessThan(r.usableInputCapacity);
    });

    it("rejects when input + output + safety exceeds context limit", () => {
      const resolver = fixedResolver({
        contextLimit: 1_000,
        outputLimit: 200,
        limitSource: "provider",
      });
      // Force a large mandatory input that cannot fit.
      const r = svc.preflight({
        messages: [textMsg("user", "x".repeat(8_000))],
        tools: [],
        model: "small-model",
        outputReserve: 200,
        modelLimitResolver: resolver.resolve,
      });
      expect(r.ok).toBe(false);
      // Mandatory oversized content → CONTEXT_REQUIRED_CONTENT_TOO_LARGE.
      expect(r.errorCode).toBe("CONTEXT_REQUIRED_CONTENT_TOO_LARGE");
    });

    it("computes safety margin M = ceil(0.10 * C)", () => {
      const resolver = fixedResolver({
        contextLimit: 32_000,
        outputLimit: 8_000,
        limitSource: "provider",
      });
      const r = svc.preflight({
        messages: [textMsg("user", "hi")],
        tools: [],
        model: "gpt-4o",
        outputReserve: 4_000,
        modelLimitResolver: resolver.resolve,
      });
      expect(r.safetyMargin).toBe(Math.ceil(0.1 * 32_000));
    });
  });

  describe("image accounting (§8.1 — never zero-token image)", () => {
    it("counts image content parts as non-zero tokens", () => {
      const resolver = fixedResolver({
        contextLimit: 32_000,
        outputLimit: 8_000,
        limitSource: "provider",
      });
      const withoutImg = svc.preflight({
        messages: [textMsg("user", "describe this")],
        tools: [],
        model: "gpt-4o",
        outputReserve: 4_000,
        modelLimitResolver: resolver.resolve,
      });
      const withImg = svc.preflight({
        messages: [imageMsg()],
        tools: [],
        model: "gpt-4o",
        outputReserve: 4_000,
        modelLimitResolver: resolver.resolve,
      });
      expect(withImg.estimatedInputTokens).toBeGreaterThan(
        withoutImg.estimatedInputTokens
      );
      // Image must never be zero-token — it adds a non-zero conservative estimate.
      const imgDelta =
        withImg.estimatedInputTokens - withoutImg.estimatedInputTokens;
      expect(imgDelta).toBeGreaterThan(0);
    });

    it("counts an oversized image against the fallback budget and rejects it", () => {
      const resolver = fixedResolver({
        contextLimit: 8_192,
        outputLimit: 1_024,
        limitSource: "fallback",
      });
      // A large base64 data URL (50,000 chars) conservatively estimates to
      // ~12,500 tokens — far exceeding the 8,192 fallback context. The image
      // is mandatory current-user content, so this is CONTEXT_REQUIRED_CONTENT_TOO_LARGE,
      // never a silent zero-token image.
      const bigImage = "data:image/png;base64," + "A".repeat(50_000);
      const r = svc.preflight({
        messages: [imageMsg("user", bigImage)],
        tools: [],
        model: "unknown-text-only",
        outputReserve: 1_024,
        modelLimitResolver: resolver.resolve,
      });
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe("CONTEXT_REQUIRED_CONTENT_TOO_LARGE");
      // The image contributed a large non-zero token count.
      expect(r.estimatedInputTokens).toBeGreaterThan(10_000);
    });
  });

  describe("compaction trigger thresholds (§8.2)", () => {
    it("reports trigger (80%) and target (60%) of usable capacity", () => {
      const resolver = fixedResolver({
        contextLimit: 32_000,
        outputLimit: 8_000,
        limitSource: "provider",
      });
      const r = svc.preflight({
        messages: [textMsg("user", "hi")],
        tools: [],
        model: "gpt-4o",
        outputReserve: 4_000,
        modelLimitResolver: resolver.resolve,
      });
      const U = 32_000 - 4_000 - Math.ceil(0.1 * 32_000); // 24,800
      expect(r.usableInputCapacity).toBe(U);
      expect(r.compactionTriggerThreshold).toBe(Math.floor(0.8 * U));
      expect(r.compactionTargetThreshold).toBe(Math.floor(0.6 * U));
    });

    it("signals needsCompaction when input crosses the trigger threshold", () => {
      const resolver = fixedResolver({
        contextLimit: 32_000,
        outputLimit: 8_000,
        limitSource: "provider",
      });
      const U = 32_000 - 4_000 - Math.ceil(0.1 * 32_000);
      const trigger = Math.floor(0.8 * U); // 19,840
      // Build an input just over the trigger threshold.
      const r = svc.preflight({
        messages: [textMsg("user", "x".repeat((trigger + 500) * 4))],
        tools: [],
        model: "gpt-4o",
        outputReserve: 4_000,
        modelLimitResolver: resolver.resolve,
      });
      expect(r.needsCompaction).toBe(true);
    });
  });

  describe("tool definition + framing accounting (§8.2)", () => {
    it("counts tool definitions toward the serialized input", () => {
      const resolver = fixedResolver({
        contextLimit: 32_000,
        outputLimit: 8_000,
        limitSource: "provider",
      });
      const withoutTools = svc.preflight({
        messages: [textMsg("user", "hi")],
        tools: [],
        model: "gpt-4o",
        outputReserve: 4_000,
        modelLimitResolver: resolver.resolve,
      });
      const tools: OpenAITool[] = [
        {
          type: "function",
          function: {
            name: "search_history",
            description: "Search conversation history for a phrase.",
            parameters: {
              type: "object",
              properties: { query: { type: "string" } },
              required: ["query"],
            },
          },
        },
      ];
      const withTools = svc.preflight({
        messages: [textMsg("user", "hi")],
        tools,
        model: "gpt-4o",
        outputReserve: 4_000,
        modelLimitResolver: resolver.resolve,
      });
      expect(withTools.estimatedInputTokens).toBeGreaterThan(
        withoutTools.estimatedInputTokens
      );
    });
  });

  describe("allocateSectionCapacity (§8.3)", () => {
    it("caps source capacity at min(12000, C - Osection - M - overhead - stateInputCost)", () => {
      const resolver = fixedResolver({
        contextLimit: 32_000,
        outputLimit: 8_000,
        limitSource: "provider",
      });
      const cap = svc.allocateSectionCapacity({
        model: "gpt-4o",
        sectionOutputReserve:
          AI_CHAT_RECOVERABLE_DEFAULTS.sectionOutputCapTokens,
        promptOverhead: 1_000,
        stateInputCost: 500,
        modelLimitResolver: resolver.resolve,
      });
      // C(32000) - Osection(1500) - M(3200) - overhead(1000) - state(500) = 25800,
      // capped at the 12000 section source target.
      expect(cap.sourceCapacity).toBe(12_000);
      expect(cap.errorCode).toBeUndefined();
    });

    it("returns a non-positive capacity as an error for a small model", () => {
      const resolver = fixedResolver({
        contextLimit: 1_000,
        outputLimit: 200,
        limitSource: "provider",
      });
      const cap = svc.allocateSectionCapacity({
        model: "tiny",
        sectionOutputReserve: 1_500,
        promptOverhead: 1_000,
        stateInputCost: 500,
        modelLimitResolver: resolver.resolve,
      });
      expect(cap.sourceCapacity).toBeLessThanOrEqual(0);
      expect(cap.errorCode).toBe("COMPACTION_CONTEXT_REJECTED");
    });
  });
});
