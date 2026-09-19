import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AiChatHistoryDrawer from "@/views/components/aiChatV2/AiChatHistoryDrawer.vue";
import { browseHistory, readHistory, searchHistory } from "@/views/api/aiChatV2";
import type { HistoryExcerpt } from "@/entityTypes/aiChatArchiveTypes";

/**
 * Component test for the history browser drawer (technical-design §13.1).
 *
 * The drawer is local browsing only — search/read happen over IPC to the
 * retrieval service, no AI calls. It has two independent modes:
 * - Browse: paginated chronological read, auto-loaded on open. Viewing never
 *   mutates model context.
 * - Search: literal query with continuation cursors + error-code banners.
 *
 * `browseHistory` / `searchHistory` / `readHistory` are mocked so the tests
 * drive pagination, expansion, navigation, and selection deterministically.
 * Vuetify components are stubbed; the child `AiChatHistoryMessage` is real so
 * select/expand/navigate emits propagate to the drawer.
 *
 * NOTE: This file MUST be run with the dedicated workspace config
 * `test/vitest/main/components/vitest.config.mjs` (which sets
 * `environment: 'happy-dom'`).
 */

vi.mock("@/views/api/aiChatV2", () => ({
  browseHistory: vi.fn(),
  readHistory: vi.fn(),
  searchHistory: vi.fn(),
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      aiChatHistory: {
        drawer_title: "Conversation History",
        close: "Close history",
        tab_browse: "Browse",
        tab_search: "Search",
        search_button: "Search",
        search_placeholder: "Search archived history…",
        search_query_too_long: "Query too long",
        no_match: "No matching messages found.",
        partial_scan: "Partial results — scan incomplete.",
        index_incomplete: "Indexing in progress; results may be incomplete.",
        read_more: "Load more",
        go_to_message: "Go to message",
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
        VTabs: { template: '<div class="v-tabs"><slot /></div>' },
        VTab: {
          props: ["value"],
          emits: ["click"],
          template:
            '<button class="v-tab" @click="$emit(\'click\')"><slot /></button>',
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
  vi.mocked(browseHistory).mockReset();
  vi.mocked(searchHistory).mockReset();
  vi.mocked(readHistory).mockReset();
  vi.mocked(browseHistory).mockResolvedValue({
    records: [],
    nextCursor: null,
    truncated: false,
    sourceRevision: 1,
  });
});

function mountSearchDrawer() {
  // The search UI renders only on the search tab; Vuetify tab switching is
  // stubbed, so mount directly on the search tab via the initialTab prop.
  return mountDrawer({ initialTab: "search" });
}

describe("AiChatHistoryDrawer", () => {
  it("renders browse and search tabs with an accessible close button", async () => {
    const w = mountDrawer();
    await flushPromises();
    expect(w.find('[data-testid="ai-history-tab-browse"]').exists()).toBe(true);
    expect(w.find('[data-testid="ai-history-tab-search"]').exists()).toBe(true);
  });

  it("loads browse history when the drawer opens (modelValue false → true)", async () => {
    vi.mocked(browseHistory).mockResolvedValue({
      records: [makeExcerpt({ sourceId: "open-1", text: "opened list" })],
      nextCursor: null,
      truncated: false,
      sourceRevision: 1,
    });
    // Mounted closed: mounting alone must not fetch (the mount-time fetch
    // only runs when already open at mount).
    const w = mountDrawer({ modelValue: false });
    await flushPromises();
    expect(browseHistory).not.toHaveBeenCalled();
    // Opening the drawer on the same conversation and tab fetches.
    await w.setProps({ modelValue: true });
    await flushPromises();
    expect(browseHistory).toHaveBeenCalledWith("conv-1", undefined);
    expect(w.text()).toContain("opened list");
  });

  it("auto-loads paginated browse history on open (viewing is model-independent)", async () => {
    vi.mocked(browseHistory).mockResolvedValue({
      records: [makeExcerpt({ sourceId: "b1", text: "browsed one" })],
      nextCursor: "browse-cursor",
      truncated: false,
      sourceRevision: 1,
    });
    const w = mountDrawer();
    await flushPromises();
    expect(browseHistory).toHaveBeenCalledWith("conv-1", undefined);
    expect(w.text()).toContain("browsed one");
    expect(w.find('[data-testid="ai-history-load-more"]').exists()).toBe(true);
  });

  it("renders the empty browse state when the archive has no pages", async () => {
    const w = mountDrawer();
    await flushPromises();
    expect(w.text()).toContain(
      "No archived history yet for this conversation."
    );
  });

  it("loads more browse pages via cursor without touching search", async () => {
    vi.mocked(browseHistory)
      .mockResolvedValueOnce({
        records: [makeExcerpt({ sourceId: "b1", text: "browse one" })],
        nextCursor: "c1",
        truncated: false,
        sourceRevision: 1,
      })
      .mockResolvedValueOnce({
        records: [makeExcerpt({ sourceId: "b2", text: "browse two" })],
        nextCursor: null,
        truncated: false,
        sourceRevision: 1,
      });
    const w = mountDrawer();
    await flushPromises();
    await w.find('[data-testid="ai-history-load-more"]').trigger("click");
    await flushPromises();
    expect(browseHistory).toHaveBeenNthCalledWith(2, "conv-1", "c1");
    expect(searchHistory).not.toHaveBeenCalled();
    expect(w.text()).toContain("browse two");
  });

  it("searches and renders matching excerpts on the search tab", async () => {
    vi.mocked(searchHistory).mockResolvedValue({
      records: [makeExcerpt({ sourceId: "a", text: "first hit" })],
      nextCursor: null,
      scanComplete: true,
      indexComplete: true,
    });
    const w = mountSearchDrawer();
    await flushPromises();
    const input = w.find(".v-text-field");
    await input.setValue("first");
    await w.find('[data-testid="ai-history-search-button"]').trigger("click");
    await flushPromises();
    expect(searchHistory).toHaveBeenCalledTimes(1);
    expect(searchHistory).toHaveBeenCalledWith("conv-1", "first", undefined);
    expect(w.text()).toContain("first hit");
  });

  it("does not search when the query is empty", async () => {
    const w = mountSearchDrawer();
    await flushPromises();
    await w.find('[data-testid="ai-history-search-button"]').trigger("click");
    await flushPromises();
    expect(searchHistory).not.toHaveBeenCalled();
  });

  it("loads more search results via the cursor on the Load more button", async () => {
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
    const w = mountSearchDrawer();
    await flushPromises();
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
    const w = mountSearchDrawer();
    await flushPromises();
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
    const w = mountSearchDrawer();
    await flushPromises();
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
    const w = mountSearchDrawer();
    await flushPromises();
    const input = w.find(".v-text-field");
    await input.setValue("idx");
    await w.find('[data-testid="ai-history-search-button"]').trigger("click");
    await flushPromises();
    expect(w.text()).toContain("Indexing in progress");
  });

  it("shows a load error when searchHistory rejects", async () => {
    vi.mocked(searchHistory).mockRejectedValue(new Error("boom"));
    const w = mountSearchDrawer();
    await flushPromises();
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
    const w = mountSearchDrawer();
    await flushPromises();
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
    const w = mountSearchDrawer();
    await flushPromises();
    const input = w.find(".v-text-field");
    await input.setValue("approx");
    await w.find('[data-testid="ai-history-search-button"]').trigger("click");
    await flushPromises();
    expect(w.find('[data-testid="ai-history-select-passage"]').exists()).toBe(
      false
    );
  });

  it("expands a truncated passage in place via a bounded read", async () => {
    const excerpt = makeExcerpt({
      sourceId: "trunc-1",
      text: "prefix…",
      hasMore: true,
    });
    vi.mocked(browseHistory).mockResolvedValue({
      records: [excerpt],
      nextCursor: null,
      truncated: false,
      sourceRevision: 1,
    });
    vi.mocked(readHistory).mockResolvedValue({
      records: [makeExcerpt({ sourceId: "trunc-1", text: "full passage" })],
      nextCursor: null,
      truncated: false,
      sourceRevision: 1,
      storedContentIncomplete: false,
    });
    const w = mountDrawer();
    await flushPromises();
    expect(w.find('[data-testid="ai-history-read-more"]').exists()).toBe(true);
    await w.find('[data-testid="ai-history-read-more"]').trigger("click");
    await flushPromises();
    expect(readHistory).toHaveBeenCalledWith("conv-1", {
      source_id: "trunc-1",
    });
    expect(w.text()).toContain("full passage");
  });

  it("emits navigate when Go to message is clicked (viewing stays selection-free)", async () => {
    const excerpt = makeExcerpt({
      sourceId: "nav-1",
      text: "navigable",
      hasMore: true,
    });
    vi.mocked(browseHistory).mockResolvedValue({
      records: [excerpt],
      nextCursor: null,
      truncated: false,
      sourceRevision: 1,
    });
    const w = mountDrawer();
    await flushPromises();
    await w.find('[data-testid="ai-history-go-to-message"]').trigger("click");
    expect(w.emitted("navigate")).toBeTruthy();
    expect(w.emitted("navigate")![0][0]).toMatchObject({
      sourceId: "nav-1",
    });
    expect(w.emitted("select")).toBeFalsy();
  });

  it("emits update:modelValue(false) when the close button is clicked", async () => {
    const w = mountDrawer();
    await flushPromises();
    await w.find('[data-testid="ai-history-close"]').trigger("click");
    expect(w.emitted("update:modelValue")).toBeTruthy();
    expect(w.emitted("update:modelValue")![0]).toEqual([false]);
  });

  it("labels the close button accessibly", async () => {
    const w = mountDrawer();
    await flushPromises();
    const closeBtn = w.find('[data-testid="ai-history-close"]');
    expect(closeBtn.attributes("aria-label")).toBe("Close history");
  });
});
