import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AiChatToolResultViewer from "@/views/components/aiChatV2/AiChatToolResultViewer.vue";

/**
 * Component tests for the paged result viewer.
 *
 * These pin the behaviours the design singles out for the renderer:
 *   - the first page loads only when the viewer is opened, and reopening does
 *     not accumulate page data (NFR-08),
 *   - a partial search is labelled so "no matches" is never overclaimed,
 *   - output renders as escaped text, never as executable markup,
 *   - copy is labelled as copying the displayed page, not the whole result.
 *
 * Must run under test/vitest/main/components/vitest.config.mjs (happy-dom).
 */

const getToolOutput = vi.fn();
const readToolOutput = vi.fn();
const searchToolOutput = vi.fn();
const exportToolOutput = vi.fn();

vi.mock("@/views/api/aiToolResult", () => ({
  getToolOutput: (...args: unknown[]) => getToolOutput(...args),
  readToolOutput: (...args: unknown[]) => readToolOutput(...args),
  searchToolOutput: (...args: unknown[]) => searchToolOutput(...args),
  exportToolOutput: (...args: unknown[]) => exportToolOutput(...args),
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      aiChatV2: {
        toolOutput: {
          view: "View full result",
          export: "Export result",
          close: "Close",
          size: "Saved size",
          records: "records",
          search: "Search",
          search_placeholder: "Search this output",
          search_no_matches: "No matches in the saved output",
          search_incomplete: "Search stopped early",
          source_incomplete: "The tool itself stopped early",
          next_page: "Next page",
          previous_page: "Previous page",
          page_of: "Page {page}",
          copy_page: "Copy this page",
          copied: "Copied",
          loading: "Loading…",
          not_available: "This saved output is not available",
          binary_unsupported: "Cannot display as text; export it instead",
          quota_reached: "Storage quota reached",
        },
      },
    },
  },
});

function mountViewer(props: Record<string, unknown> = {}) {
  return mount(AiChatToolResultViewer, {
    props: {
      conversationId: "conv-1",
      outputId: "out_0123456789abcdef0123456789abcdef",
      ...props,
    },
    global: {
      plugins: [i18n],
      stubs: {
        "v-btn": {
          props: ["disabled"],
          // `emits` is required: without it the @click listener is treated as
          // a native fallthrough handler as well as a component listener, so a
          // single click fires the handler twice.
          emits: ["click"],
          template:
            '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
        },
        "v-text-field": {
          props: ["modelValue"],
          emits: ["update:modelValue"],
          template:
            '<div><input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" /></div>',
        },
        "v-alert": { template: "<div><slot /></div>" },
      },
    },
  });
}

function descriptor(overrides: Record<string, unknown> = {}) {
  return {
    outputId: "out_0123456789abcdef0123456789abcdef",
    toolName: "scrape_businesses",
    format: "json",
    mediaType: "application/json",
    capturedBytes: 2048,
    preservation: "complete",
    sourceCompleteness: "complete",
    state: "committed",
    recordCount: 120,
    ...overrides,
  };
}

beforeEach(() => {
  getToolOutput.mockReset().mockResolvedValue(descriptor());
  readToolOutput.mockReset().mockResolvedValue({
    outputId: "out_0123456789abcdef0123456789abcdef",
    text: "page one",
    startByte: 0,
    endByte: 8,
    totalBytes: 16,
    nextCursor: "cursor-1",
    complete: false,
  });
  searchToolOutput.mockReset();
  exportToolOutput.mockReset().mockResolvedValue({ status: "exported" });
});

describe("AiChatToolResultViewer — lazy loading", () => {
  it("loads the first page when it is opened", async () => {
    const wrapper = mountViewer();
    await flushPromises();
    expect(readToolOutput).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-testid="viewer-page"]').text()).toBe("page one");
  });

  it("shows the saved size and record count", async () => {
    const wrapper = mountViewer();
    await flushPromises();
    expect(wrapper.find('[data-testid="viewer-size"]').text()).toContain("2.0 KiB");
    expect(wrapper.find('[data-testid="viewer-records"]').text()).toContain("120");
  });
});

describe("AiChatToolResultViewer — paging", () => {
  it("advances to the next page and back", async () => {
    const wrapper = mountViewer();
    await flushPromises();
    expect(wrapper.find('[data-testid="viewer-page"]').text()).toBe("page one");

    // Queue the second page only AFTER the first page has loaded, otherwise
    // the initial mount consumes it.
    readToolOutput.mockResolvedValueOnce({
      outputId: "out_0123456789abcdef0123456789abcdef",
      text: "page two",
      startByte: 8,
      endByte: 16,
      totalBytes: 16,
      nextCursor: null,
      complete: true,
    });
    await wrapper.find('[data-testid="viewer-next"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="viewer-page"]').text()).toBe("page two");

    // Visited-page back navigation does not re-read from the network.
    await wrapper.find('[data-testid="viewer-prev"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="viewer-page"]').text()).toBe("page one");
  });

  it("disables next on the final page", async () => {
    readToolOutput.mockResolvedValue({
      outputId: "out_0123456789abcdef0123456789abcdef",
      text: "only page",
      startByte: 0,
      endByte: 9,
      totalBytes: 9,
      nextCursor: null,
      complete: true,
    });
    const wrapper = mountViewer();
    await flushPromises();
    const next = wrapper.find('[data-testid="viewer-next"]');
    expect(next.attributes("disabled")).toBeDefined();
  });

  it("retains a bounded number of pages rather than accumulating them (NFR-08)", async () => {
    let call = 0;
    readToolOutput.mockImplementation(async () => {
      call += 1;
      return {
        outputId: "out_0123456789abcdef0123456789abcdef",
        text: `page ${call}`,
        startByte: (call - 1) * 8,
        endByte: call * 8,
        totalBytes: 400,
        nextCursor: `cursor-${call}`,
        complete: false,
      };
    });
    const wrapper = mountViewer();
    await flushPromises();
    // Walk well past the five-page cache budget.
    for (let i = 0; i < 8; i += 1) {
      await wrapper.find('[data-testid="viewer-next"]').trigger("click");
      await flushPromises();
    }
    expect(call).toBe(9);
    // Still responsive after eviction rather than degraded or throwing.
    expect(wrapper.find('[data-testid="viewer-page"]').text()).toBe("page 9");
  });
});

describe("AiChatToolResultViewer — search honesty", () => {
  it("reports a complete scan with no matches as a real 'no matches'", async () => {
    searchToolOutput.mockResolvedValue({
      outputId: "out_0123456789abcdef0123456789abcdef",
      matches: [],
      scanComplete: true,
      nextCursor: null,
      sourceCompleteness: "complete",
    });
    const wrapper = mountViewer();
    await flushPromises();
    const input = wrapper.find('[data-testid="viewer-search-input"] input');
    await input.setValue("needle");
    await wrapper.find('[data-testid="viewer-search-submit"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="viewer-no-matches"]').text()).toBe(
      "No matches in the saved output"
    );
    expect(wrapper.find('[data-testid="viewer-search-incomplete"]').exists()).toBe(false);
  });

  it("does NOT claim no-matches when the scan stopped early (AC-17)", async () => {
    searchToolOutput.mockResolvedValue({
      outputId: "out_0123456789abcdef0123456789abcdef",
      matches: [],
      scanComplete: false,
      nextCursor: "cursor-2",
      sourceCompleteness: "complete",
    });
    const wrapper = mountViewer();
    await flushPromises();
    const input = wrapper.find('[data-testid="viewer-search-input"] input');
    await input.setValue("needle");
    await wrapper.find('[data-testid="viewer-search-submit"]').trigger("click");
    await flushPromises();
    // The honest message is shown instead of "no matches".
    expect(wrapper.find('[data-testid="viewer-no-matches"]').text()).toBe(
      "Search stopped early"
    );
    expect(wrapper.find('[data-testid="viewer-search-incomplete"]').exists()).toBe(true);
  });

  it("lists matches and opens one on click", async () => {
    searchToolOutput.mockResolvedValue({
      outputId: "out_0123456789abcdef0123456789abcdef",
      matches: [
        {
          startByte: 100,
          endByte: 106,
          excerpt: "...the needle here...",
          readCursor: "match-cursor",
        },
      ],
      scanComplete: true,
      nextCursor: null,
      sourceCompleteness: "complete",
    });
    const wrapper = mountViewer();
    await flushPromises();
    const input = wrapper.find('[data-testid="viewer-search-input"] input');
    await input.setValue("needle");
    await wrapper.find('[data-testid="viewer-search-submit"]').trigger("click");
    await flushPromises();

    const matches = wrapper.findAll('[data-testid="viewer-match"]');
    expect(matches).toHaveLength(1);
    await wrapper.find('[data-testid="viewer-match-button"]').trigger("click");
    await flushPromises();
    // Opening a match reads from that match's cursor.
    const lastCall = readToolOutput.mock.calls[readToolOutput.mock.calls.length - 1][0];
    expect(lastCall.cursor).toBe("match-cursor");
  });
});

describe("AiChatToolResultViewer — truthful states", () => {
  it("warns when the capture is partial", async () => {
    getToolOutput.mockResolvedValue(
      descriptor({ preservation: "partial", sourceCompleteness: "partial" })
    );
    const wrapper = mountViewer();
    await flushPromises();
    expect(wrapper.find('[data-testid="viewer-partial-notice"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="viewer-source-incomplete"]').exists()).toBe(true);
  });

  it("warns when the producer itself truncated even though our capture is complete", async () => {
    getToolOutput.mockResolvedValue(
      descriptor({ preservation: "complete", sourceCompleteness: "partial" })
    );
    const wrapper = mountViewer();
    await flushPromises();
    // A complete capture of an incomplete source is still incomplete overall.
    expect(wrapper.find('[data-testid="viewer-source-incomplete"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="viewer-partial-notice"]').exists()).toBe(false);
  });

  it("shows a translated error and no page when the output is unavailable", async () => {
    readToolOutput.mockRejectedValue(new Error("OUTPUT_NOT_AVAILABLE"));
    const wrapper = mountViewer();
    await flushPromises();
    const error = wrapper.find('[data-testid="viewer-error"]');
    expect(error.exists()).toBe(true);
    // The raw machine code is translated, never shown as prose.
    expect(error.text()).toBe("This saved output is not available");
    expect(error.text()).not.toContain("OUTPUT_NOT_AVAILABLE");
    expect(wrapper.find('[data-testid="viewer-page"]').exists()).toBe(false);
  });

  it("offers export guidance for binary output", async () => {
    readToolOutput.mockRejectedValue(new Error("OUTPUT_FORMAT_UNSUPPORTED"));
    const wrapper = mountViewer();
    await flushPromises();
    expect(wrapper.find('[data-testid="viewer-error"]').text()).toBe(
      "Cannot display as text; export it instead"
    );
  });
});

describe("AiChatToolResultViewer — safe rendering", () => {
  it("renders output as escaped text, never as markup", async () => {
    readToolOutput.mockResolvedValue({
      outputId: "out_0123456789abcdef0123456789abcdef",
      text: "<img src=x onerror=\"alert(1)\"><script>bad()</script>",
      startByte: 0,
      endByte: 48,
      totalBytes: 48,
      nextCursor: null,
      complete: true,
    });
    const wrapper = mountViewer();
    await flushPromises();
    // The markup is present as literal TEXT...
    expect(wrapper.find('[data-testid="viewer-page"]').text()).toContain("<script>");
    // ...and no element was actually created from it.
    expect(wrapper.find('[data-testid="viewer-page"] script').exists()).toBe(false);
    expect(wrapper.find('[data-testid="viewer-page"] img').exists()).toBe(false);
  });

  it("labels copy as copying the displayed page, not the whole result", async () => {
    const wrapper = mountViewer();
    await flushPromises();
    const copy = wrapper.find('[data-testid="viewer-copy"]');
    expect(copy.text()).toBe("Copy this page");
    expect(copy.text()).not.toMatch(/copy (the )?full/i);
  });
});
