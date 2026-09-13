import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AiChatHistoryDrawer from "@/views/components/aiChatV2/AiChatHistoryDrawer.vue";
import { searchHistory } from "@/views/api/aiChatV2";
import type { HistoryExcerpt } from "@/entityTypes/aiChatArchiveTypes";

/**
 * Component test for the history browser drawer (technical-design §13.1).
 *
 * The drawer is local browsing only — search/read happen over IPC to the
 * retrieval service, no AI calls. It supports paginated continuation via a
 * cursor and surfaces the recoverable-history error codes (partial-scan,
 * no-match, scope-invalid) so the user understands incomplete results.
 *
 * `searchHistory` is mocked so the tests drive the drawer's pagination,
 * error-code banner, and selection-emission paths deterministically without
 * a real archive behind the IPC boundary. Vuetify components are stubbed;
 * the child `AiChatHistoryMessage` is real so the "Select passage" emit
 * propagates to the drawer's `select` emit.
 *
 * NOTE: This file MUST be run with the dedicated workspace config
 * `test/vitest/main/components/vitest.config.mjs` (which sets
 * `environment: 'happy-dom'`).
 */

vi.mock("@/views/api/aiChatV2", () => ({
  searchHistory: vi.fn(),
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      aiChatHistory: {
        drawer_title: "Conversation History",
        search_placeholder: "Search archived history…",
        search_query_too_long: "Query too long",
        no_match: "No matching messages found.",
        partial_scan: "Partial results — scan incomplete.",
        index_incomplete: "Indexing in progress; results may be incomplete.",
        read_more: "Load more",
        select_passage: "Select passage",
        selected_context: "Selected context",
        estimated_cost: "Estimated cost: {tokens} tokens",
        clear_selections: "Clear selections",
        source_changed: "Source changed",
        source_unavailable: "Source unavailable",
        scope_invalid: "Invalid scope. Retry.",
        load_error: "Failed to load history. {message}",
        empty: "No archived history yet for this conversation.",
      },
    },
  },
});

function makeExcerpt(overrides: Partial<HistoryExcerpt> = {}): HistoryExcerpt {
  return {
    sourceId: overrides.sourceId ?? "src-1",
    messageId: overrides.messageId ?? "msg-1",
    role: overrides.role ?? "user",
    timestamp: overrides.timestamp ?? "2026-09-13T10:00:00Z",
    text: overrides.text ?? "Hello world",
    exact: overrides.exact ?? true,
    redacted: overrides.redacted ?? false,
    hasMore: overrides.hasMore ?? false,
  };
}

function mountDrawer(props: Record<string, unknown> = {}) {
  return mount(AiChatHistoryDrawer, {
    props: {
      modelValue: true,
      conversationId: "conv-1",
      ...props,
    },
    global: {
      plugins: [i18n],
      stubs: {
        VNavigationDrawer: {
          template:
            '<div class="v-navigation-drawer" data-testid="ai-history-drawer"><slot /></div>',
        },
        // Must honour v-model: emit update:modelValue on input so the
        // component's `query` ref is populated; otherwise the search button
        // stays disabled and runSearch early-returns on an empty query.
        VTextField: {
          props: ["modelValue"],
          emits: ["update:modelValue"],
          template:
            '<input class="v-text-field" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
        },
        // VBtn must declare the "click" emit: without it, the parent's
        // @click listener falls through onto the native <button> AND is
        // invoked again by $emit('click') — every click would fire the
        // handler twice. Declaring it keeps exactly one dispatch per click.
        VBtn: {
          props: { disabled: { type: Boolean, default: false } },
          emits: ["click"],
          template:
            '<button class="v-btn" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
        },
        VIcon: { template: "<i />" },
        VList: { template: '<div class="v-list"><slot /></div>' },
        VListItem: { template: '<div class="v-list-item"><slot /></div>' },
        VDivider: { template: "<hr />" },
        VSpacer: { template: "<span />" },
      },
    },
  });
}

beforeEach(() => {
  vi.mocked(searchHistory).mockReset();
});

describe("AiChatHistoryDrawer", () => {
  it("renders the drawer landmark and empty state before any search", () => {
    const w = mountDrawer();
    expect(w.find('[data-testid="ai-history-drawer"]').exists()).toBe(true);
    expect(w.text()).toContain(
      "No archived history yet for this conversation."
    );
  });

  it("searches and renders matching excerpts", async () => {
    vi.mocked(searchHistory).mockResolvedValue({
      records: [makeExcerpt({ sourceId: "a", text: "first hit" })],
      nextCursor: null,
      scanComplete: true,
      indexComplete: true,
    });
    const w = mountDrawer();
    const input = w.find(".v-text-field");
    await input.setValue("first");
    await w.find('[data-testid="ai-history-search-button"]').trigger("click");
    await flushPromises();
    expect(searchHistory).toHaveBeenCalledTimes(1);
    expect(searchHistory).toHaveBeenCalledWith("conv-1", "first", undefined);
    expect(w.text()).toContain("first hit");
  });

  it("does not search when the query is empty", async () => {
    const w = mountDrawer();
    await w.find('[data-testid="ai-history-search-button"]').trigger("click");
    await flushPromises();
    expect(searchHistory).not.toHaveBeenCalled();
  });

  it("loads more results via the cursor on the Load more button", async () => {
    vi.mocked(searchHistory)
      .mockResolvedValueOnce({
        records: [makeExcerpt({ sourceId: "a", text: "page one" })],
        nextCursor: "cursor-1",
        scanComplete: true,
        indexComplete: true,
      })
      .mockResolvedValueOnce({
        records: [makeExcerpt({ sourceId: "b", text: "page two" })],
        nextCursor: null,
        scanComplete: true,
        indexComplete: true,
      });
    const w = mountDrawer();
    const input = w.find(".v-text-field");
    await input.setValue("term");
    await w.find('[data-testid="ai-history-search-button"]').trigger("click");
    await flushPromises();
    expect(w.text()).toContain("page one");
    expect(w.find('[data-testid="ai-history-load-more"]').exists()).toBe(true);
    await w.find('[data-testid="ai-history-load-more"]').trigger("click");
    await flushPromises();
    expect(searchHistory).toHaveBeenNthCalledWith(
      2,
      "conv-1",
      "term",
      "cursor-1"
    );
    expect(w.text()).toContain("page one");
    expect(w.text()).toContain("page two");
  });

  it("surfaces the no-match error code as a status banner", async () => {
    vi.mocked(searchHistory).mockResolvedValue({
      records: [],
      nextCursor: null,
      scanComplete: true,
      indexComplete: true,
      errorCode: "HISTORY_NO_MATCH",
    });
    const w = mountDrawer();
    const input = w.find(".v-text-field");
    await input.setValue("nothing");
    await w.find('[data-testid="ai-history-search-button"]').trigger("click");
    await flushPromises();
    expect(w.text()).toContain("No matching messages found.");
  });

  it("surfaces the partial-scan banner when scanComplete is false", async () => {
    vi.mocked(searchHistory).mockResolvedValue({
      records: [makeExcerpt({ text: "partial" })],
      nextCursor: null,
      scanComplete: false,
      indexComplete: true,
    });
    const w = mountDrawer();
    const input = w.find(".v-text-field");
    await input.setValue("partial");
    await w.find('[data-testid="ai-history-search-button"]').trigger("click");
    await flushPromises();
    expect(w.text()).toContain("Partial results");
  });

  it("surfaces the index-incomplete banner when indexComplete is false", async () => {
    vi.mocked(searchHistory).mockResolvedValue({
      records: [makeExcerpt({ text: "idx" })],
      nextCursor: null,
      scanComplete: true,
      indexComplete: false,
    });
    const w = mountDrawer();
    const input = w.find(".v-text-field");
    await input.setValue("idx");
    await w.find('[data-testid="ai-history-search-button"]').trigger("click");
    await flushPromises();
    expect(w.text()).toContain("Indexing in progress");
  });

  it("shows a load error when searchHistory rejects", async () => {
    vi.mocked(searchHistory).mockRejectedValue(new Error("boom"));
    const w = mountDrawer();
    const input = w.find(".v-text-field");
    await input.setValue("err");
    await w.find('[data-testid="ai-history-search-button"]').trigger("click");
    await flushPromises();
    expect(w.find('[data-testid="ai-history-error"]').exists()).toBe(true);
    expect(w.text()).toContain("boom");
  });

  it("emits select when a passage Select button is clicked", async () => {
    const excerpt = makeExcerpt({
      sourceId: "sel-1",
      exact: true,
      text: "select me",
    });
    vi.mocked(searchHistory).mockResolvedValue({
      records: [excerpt],
      nextCursor: null,
      scanComplete: true,
      indexComplete: true,
    });
    const w = mountDrawer();
    const input = w.find(".v-text-field");
    await input.setValue("sel");
    await w.find('[data-testid="ai-history-search-button"]').trigger("click");
    await flushPromises();
    const selectBtn = w.find('[data-testid="ai-history-select-passage"]');
    expect(selectBtn.exists()).toBe(true);
    await selectBtn.trigger("click");
    expect(w.emitted("select")).toBeTruthy();
    expect(w.emitted("select")![0][0]).toMatchObject({
      sourceId: "sel-1",
    });
  });

  it("does not render the Select button when the excerpt is not exact", async () => {
    vi.mocked(searchHistory).mockResolvedValue({
      records: [makeExcerpt({ exact: false, text: "approx" })],
      nextCursor: null,
      scanComplete: true,
      indexComplete: true,
    });
    const w = mountDrawer();
    const input = w.find(".v-text-field");
    await input.setValue("approx");
    await w.find('[data-testid="ai-history-search-button"]').trigger("click");
    await flushPromises();
    expect(w.find('[data-testid="ai-history-select-passage"]').exists()).toBe(
      false
    );
  });

  it("emits update:modelValue(false) when the close button is clicked", async () => {
    const w = mountDrawer();
    // The close button is the first v-btn (icon mdi-close). Trigger it.
    const closeBtn = w.findAll(".v-btn")[0];
    await closeBtn.trigger("click");
    expect(w.emitted("update:modelValue")).toBeTruthy();
    expect(w.emitted("update:modelValue")![0]).toEqual([false]);
  });
});
