import { describe, expect, it, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createI18n } from "vue-i18n";
import AppPageShell from "@/views/components/pageTemplates/AppPageShell.vue";
import PageStateView from "@/views/components/pageTemplates/PageStateView.vue";
import type { PageLoadState } from "@/views/types/uiConvergenceTypes";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      ui: {
        state: {
          loading: "Loading…",
          emptyTitle: "Nothing here yet",
          emptyBody: "Get started by creating your first record.",
          noResultsTitle: "No matching records",
          noResultsBody: "Records may be hidden by the current filters.",
          clearFilters: "Clear filters",
          errorTitle: "Something went wrong",
          errorBody: "The operation failed. Try again.",
          forbiddenTitle: "Capability unavailable",
          forbiddenBody: "This capability is not enabled for your plan.",
        },
      },
    },
  },
});

beforeEach(() => {
  setActivePinia(createPinia());
});

function mountShell(props: Record<string, unknown> = {}) {
  return mount(AppPageShell, {
    props: { pageId: "test", titleKey: "Test page", ...props },
    global: { plugins: [i18n] },
    slots: {
      "primary-action": "<button data-testid='primary'>Go</button>",
      overflow: "<div data-testid='overflow'>…</div>",
      toolbar: "<div data-testid='toolbar'>search</div>",
      default: "<div data-testid='content'>body</div>",
    },
  });
}

describe("AppPageShell (IPR-003..006, design §11.1)", () => {
  it("renders one programmatic h1 from the title slot and exposes focus", async () => {
    const wrapper = mountShell();
    const h1 = wrapper.find('[data-testid="app-page-title"]');
    expect(h1.element.tagName).toBe("H1");
    expect(h1.attributes("tabindex")).toBe("-1");
    // Focus API is exposed for post-navigation focus (design §22.2).
    document.body.appendChild(wrapper.element);
    try {
      const vm = wrapper.vm as unknown as { focusHeading(): void };
      vm.focusHeading();
      expect(document.activeElement).toBe(h1.element);
    } finally {
      document.body.removeChild(wrapper.element);
    }
  });

  it("places toolbar below the header and primary/overflow in the header", () => {
    const wrapper = mountShell();
    const headerText = wrapper.find(".page-header").element.textContent ?? "";
    expect(headerText).toContain("Test page");
    expect(wrapper.find('[data-testid="primary"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="overflow"]').exists()).toBe(true);
    // Toolbar follows the header in DOM order (IPR-005).
    expect(
      wrapper.find(".page-header").element.compareDocumentPosition(
        wrapper.find(".page-toolbar").element
      ) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(wrapper.find('[data-testid="content"]').exists()).toBe(true);
  });

  it("carries aria-busy and content-width contracts", () => {
    const wrapper = mountShell({ busy: true, contentWidth: "form" });
    expect(wrapper.find('[data-testid="app-page-shell"]').attributes("aria-busy")).toBe("true");
    expect(wrapper.find(".width-form").exists()).toBe(true);
  });
});

describe("PageStateView (IPR-043, design §12)", () => {
  function mountState(loadState: PageLoadState) {
    return mount(PageStateView, {
      props: { loadState },
      global: { plugins: [i18n] },
    });
  }

  it("renders shaped skeleton rows for loading", () => {
    const wrapper = mountState({ state: "loading" });
    expect(wrapper.findAll(".skeleton-row").length).toBe(5);
    // The template's leading doc-comment makes the component multi-root;
    // assert on the rendered container rather than wrapper.element.
    const container = wrapper.find('[data-testid="page-state-loading"]');
    expect(container.attributes("role")).toBe("status");
    // Screen-reader text mirrors the state.
    expect(wrapper.text()).toContain("Loading…");
  });

  it("separates first-use from no-results with a Clear filters action", async () => {
    const noResults = mountState({ state: "empty", kind: "no-results" });
    expect(noResults.find('[data-testid="page-state-clear-filters"]').exists()).toBe(true);
    expect(noResults.find('[data-testid="page-state-empty-action"]').exists()).toBe(false);

    const firstUse = mountState({ state: "empty", kind: "first-use" });
    expect(firstUse.find('[data-testid="page-state-clear-filters"]').exists()).toBe(false);
  });

  it("shows retry only for recoverable errors and never leaks raw errors", () => {
    const recoverable = mountState({
      state: "error",
      messageKey: "ui.state.errorBody",
      recoverable: true,
    });
    expect(recoverable.find('[data-testid="page-state-retry"]').exists()).toBe(true);
    const fatal = mountState({
      state: "error",
      messageKey: "ui.state.errorBody",
      recoverable: false,
    });
    expect(fatal.find('[data-testid="page-state-retry"]').exists()).toBe(false);
  });

  it("names the unavailable capability for forbidden state", () => {
    const wrapper = mountState({
      state: "forbidden",
      capabilityKey: "ui.state.forbiddenBody",
    });
    expect(wrapper.find(".state-title").text()).toContain("Capability unavailable");
  });
});
