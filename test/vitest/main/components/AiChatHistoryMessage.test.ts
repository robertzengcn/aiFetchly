import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AiChatHistoryMessage from "@/views/components/aiChatV2/AiChatHistoryMessage.vue";
import type { HistoryExcerpt } from "@/entityTypes/aiChatArchiveTypes";

/**
 * Component test for a single archived history excerpt
 * (technical-design §13.1, AC-17/AC-24).
 *
 * The excerpt carries trusted text + offsets from the backend; selection
 * emits only the opaque `sourceId` (never renderer-quoted text). Expansion
 * and navigation emit for the parent drawer to fulfill via bounded reads —
 * viewing never mutates model context. All controls carry accessible names
 * and are keyboard-operable.
 *
 * NOTE: This file MUST be run with the dedicated workspace config
 * `test/vitest/main/components/vitest.config.mjs` (which sets
 * `environment: 'happy-dom'`).
 */

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      aiChatHistory: {
        select_passage: "Select passage",
        read_more: "Read more",
        go_to_message: "Go to message",
      },
    },
  },
});

function makeExcerpt(overrides: Partial<HistoryExcerpt> = {}): HistoryExcerpt {
  return {
    sourceId: overrides.sourceId ?? "src-1",
    messageId: overrides.messageId ?? "msg-1",
    role: overrides.role ?? "assistant",
    timestamp: overrides.timestamp ?? "2026-09-13T10:00:00Z",
    text: overrides.text ?? "Archived passage text",
    exact: overrides.exact ?? true,
    redacted: overrides.redacted ?? false,
    hasMore: overrides.hasMore ?? false,
  };
}

function mountMessage(excerpt: HistoryExcerpt) {
  return mount(AiChatHistoryMessage, {
    props: { excerpt },
    global: {
      plugins: [i18n],
      stubs: {
        VIcon: { template: "<i />" },
        VSpacer: { template: "<span />" },
        VBtn: {
          props: { disabled: { type: Boolean, default: false } },
          emits: ["click"],
          template:
            '<button class="v-btn" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
        },
      },
    },
  });
}

describe("AiChatHistoryMessage", () => {
  it("renders role, timestamp, and exact passage text", () => {
    const w = mountMessage(makeExcerpt({ text: "exact wording here" }));
    expect(w.text()).toContain("assistant");
    expect(w.text()).toContain("exact wording here");
  });

  it("emits select with the opaque excerpt (sourceId, not quoted text)", async () => {
    const excerpt = makeExcerpt({ sourceId: "opaque-9", exact: true });
    const w = mountMessage(excerpt);
    await w.find('[data-testid="ai-history-select-passage"]').trigger("click");
    expect(w.emitted("select")).toBeTruthy();
    expect(w.emitted("select")![0][0]).toMatchObject({
      sourceId: "opaque-9",
    });
  });

  it("hides the Select button when the excerpt is not exact", () => {
    const w = mountMessage(makeExcerpt({ exact: false }));
    expect(w.find('[data-testid="ai-history-select-passage"]').exists()).toBe(
      false
    );
  });

  it("emits expand for truncated passages (read more)", async () => {
    const excerpt = makeExcerpt({ sourceId: "trunc-2", hasMore: true });
    const w = mountMessage(excerpt);
    await w.find('[data-testid="ai-history-read-more"]').trigger("click");
    expect(w.emitted("expand")).toBeTruthy();
    expect(w.emitted("expand")![0][0]).toMatchObject({
      sourceId: "trunc-2",
    });
    expect(w.emitted("select")).toBeFalsy();
  });

  it("emits navigate without selecting (viewing stays selection-free)", async () => {
    const excerpt = makeExcerpt({ sourceId: "nav-3", hasMore: true });
    const w = mountMessage(excerpt);
    await w.find('[data-testid="ai-history-go-to-message"]').trigger("click");
    expect(w.emitted("navigate")).toBeTruthy();
    expect(w.emitted("navigate")![0][0]).toMatchObject({
      sourceId: "nav-3",
    });
    expect(w.emitted("select")).toBeFalsy();
  });

  it("hides expansion controls when the passage is complete", () => {
    const w = mountMessage(makeExcerpt({ hasMore: false }));
    expect(w.find('[data-testid="ai-history-read-more"]').exists()).toBe(false);
    expect(w.find('[data-testid="ai-history-go-to-message"]').exists()).toBe(
      false
    );
  });

  it("labels every control accessibly for keyboard-only use (AC-24)", () => {
    const w = mountMessage(makeExcerpt({ hasMore: true }));
    expect(
      w.find('[data-testid="ai-history-select-passage"]').attributes(
        "aria-label"
      )
    ).toBe("Select passage");
    expect(
      w.find('[data-testid="ai-history-read-more"]').attributes("aria-label")
    ).toBe("Read more");
    expect(
      w.find('[data-testid="ai-history-go-to-message"]').attributes(
        "aria-label"
      )
    ).toBe("Go to message");
  });
});
