import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AiChatSelectedContext from "@/views/components/aiChatV2/AiChatSelectedContext.vue";

/**
 * Mirrors the component's exported SelectedContextItem interface. Defined
 * locally because the *.vue shim only declares a default export, so plain
 * tsc cannot resolve named type exports from .vue files (only vue-tsc can).
 */
interface SelectedContextItem {
  sourceId: string;
  preview: string;
  estimatedTokens: number;
  refreshed?: boolean;
  rejected?: boolean;
}

/**
 * Component test for the selected-context panel (technical-design §13.3).
 *
 * Renders the user's drafted history selections above the composer. Draft
 * refs are per-conversation; the backend re-resolves them on submit (no
 * renderer text is trusted as the original quote). Rejected selections
 * (SOURCE_UNAVAILABLE) are flagged with the error color and refreshed ones
 * with the warning color so the user can act before sending.
 *
 * The panel is hidden (v-if) when the selections list is empty. Vuetify
 * components are stubbed; the chip stub honours `closable`/`color` via
 * forwarded attributes so the remove/clear emits can be driven.
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
        selected_context: "Selected context",
        estimated_cost: "Estimated cost: {tokens} tokens",
        clear_selections: "Clear selections",
      },
    },
  },
});

const VChip = {
  props: ["color", "closable"],
  emits: ["click:close"],
  template:
    '<span class="v-chip" :data-color="color ?? \'default\'" @click="$emit(\'click:close\')"><slot /></span>',
};
const VBtn = {
  emits: ["click"],
  template:
    '<button class="v-btn" data-testid="ai-selected-context-clear" @click="$emit(\'click\')"><slot /></button>',
};

function mountPanel(selections: SelectedContextItem[]) {
  return mount(AiChatSelectedContext, {
    props: { selections },
    global: {
      plugins: [i18n],
      stubs: {
        VSheet: { template: '<div class="v-sheet"><slot /></div>' },
        VChip,
        VBtn,
        VIcon: { template: "<i />" },
        VSpacer: { template: "<span />" },
      },
    },
  });
}

function makeItem(
  overrides: Partial<SelectedContextItem> = {}
): SelectedContextItem {
  return {
    sourceId: overrides.sourceId ?? "src-1",
    preview: overrides.preview ?? "some preview text",
    estimatedTokens: overrides.estimatedTokens ?? 10,
    refreshed: overrides.refreshed,
    rejected: overrides.rejected,
  };
}

describe("AiChatSelectedContext", () => {
  it("is hidden when there are no selections", () => {
    const w = mountPanel([]);
    expect(w.find('[data-testid="ai-selected-context"]').exists()).toBe(false);
  });

  it("renders each selection preview and the summed token estimate", () => {
    const w = mountPanel([
      makeItem({
        sourceId: "a",
        preview: "first passage",
        estimatedTokens: 12,
      }),
      makeItem({
        sourceId: "b",
        preview: "second passage",
        estimatedTokens: 8,
      }),
    ]);
    const panel = w.find('[data-testid="ai-selected-context"]');
    expect(panel.exists()).toBe(true);
    expect(panel.text()).toContain("first passage");
    expect(panel.text()).toContain("second passage");
    expect(panel.text()).toContain("20");
  });

  it("flags rejected selections with the error color", () => {
    const w = mountPanel([
      makeItem({ sourceId: "bad", preview: "gone", rejected: true }),
    ]);
    const chip = w.find(".v-chip");
    expect(chip.exists()).toBe(true);
    expect(chip.attributes("data-color")).toBe("error");
  });

  it("flags refreshed selections with the warning color", () => {
    const w = mountPanel([
      makeItem({ sourceId: "moved", preview: "refreshed", refreshed: true }),
    ]);
    const chip = w.find(".v-chip");
    expect(chip.attributes("data-color")).toBe("warning");
  });

  it("uses the default color for healthy selections", () => {
    const w = mountPanel([makeItem({ sourceId: "ok", preview: "fine" })]);
    const chip = w.find(".v-chip");
    expect(chip.attributes("data-color")).toBe("default");
  });

  it("emits remove(sourceId) when a chip close is clicked", async () => {
    const w = mountPanel([
      makeItem({ sourceId: "rm-1", preview: "to remove" }),
      makeItem({ sourceId: "rm-2", preview: "to keep" }),
    ]);
    const chips = w.findAll(".v-chip");
    await chips[0].trigger("click");
    expect(w.emitted("remove")).toBeTruthy();
    expect(w.emitted("remove")![0]).toEqual(["rm-1"]);
  });

  it("emits clear when the clear button is clicked", async () => {
    const w = mountPanel([makeItem({ sourceId: "c-1", preview: "x" })]);
    await w.find('[data-testid="ai-selected-context-clear"]').trigger("click");
    expect(w.emitted("clear")).toBeTruthy();
    expect(w.emitted("clear")!.length).toBe(1);
  });
});
