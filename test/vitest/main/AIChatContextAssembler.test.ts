import { describe, it, expect, vi, beforeEach } from "vitest";
import { AIChatContextAssembler } from "@/service/AIChatContextAssembler";
import { AIChatSessionMemoryModule } from "@/modules/AIChatSessionMemoryModule";
import { AIChatCompactModule } from "@/modules/AIChatCompactModule";
import { AIChatV2Module } from "@/modules/AIChatV2Module";
import { SystemSettingModule } from "@/modules/SystemSettingModule";
import { AIUserMemoryRetrievalService } from "@/service/AIUserMemoryRetrievalService";
import { ai_custom_context_directive } from "@/config/settinggroupInit";

// Disable all external dependencies the constructor news up.
// We only care about the messages array the assembler builds.
function silenceDeps() {
  vi.spyOn(AIChatSessionMemoryModule.prototype, "getByConversation").mockResolvedValue(null);
  vi.spyOn(AIChatCompactModule.prototype, "getActiveSummary").mockResolvedValue(null);
  vi.spyOn(AIChatV2Module.prototype, "getConversationMessages").mockResolvedValue([]);
  vi.spyOn(AIUserMemoryRetrievalService.prototype, "retrieve").mockResolvedValue({
    contextBlock: "",
    memories: [],
  });
}

function baseInput() {
  return {
    conversationId: "conv-test",
    currentUserMessage: "hello",
    baseSystemPrompt: "you are helpful",
    mode: "chat" as const,
  };
}

describe("AIChatContextAssembler — custom context directive", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    silenceDeps();
  });

  it("injects directive as a system message right after the base system prompt", async () => {
    vi.spyOn(SystemSettingModule.prototype, "getSettingValue").mockResolvedValue(
      "Always answer concisely."
    );

    const assembler = new AIChatContextAssembler();
    const result = await assembler.assemble(baseInput());

    expect(result.messages[0]).toEqual({ role: "system", content: "you are helpful" });
    expect(result.messages[1]).toEqual({
      role: "system",
      content: "Always answer concisely.",
    });
    // And the getSettingValue call targeted the new key
    expect(SystemSettingModule.prototype.getSettingValue).toHaveBeenCalledWith(
      ai_custom_context_directive
    );
  });

  it("skips injection when the setting value is null or empty", async () => {
    vi.spyOn(SystemSettingModule.prototype, "getSettingValue").mockResolvedValue("");

    const assembler = new AIChatContextAssembler();
    const result = await assembler.assemble(baseInput());

    expect(result.messages).toHaveLength(2); // base prompt + user message
    expect(result.messages[0]).toEqual({ role: "system", content: "you are helpful" });
    expect(result.messages[1]).toEqual({ role: "user", content: "hello" });
  });

  it("skips injection when the setting value is whitespace-only", async () => {
    vi.spyOn(SystemSettingModule.prototype, "getSettingValue").mockResolvedValue("   \n  ");

    const assembler = new AIChatContextAssembler();
    const result = await assembler.assemble(baseInput());

    expect(result.messages).toHaveLength(2);
    expect(result.messages[1]).toEqual({ role: "user", content: "hello" });
  });
});
