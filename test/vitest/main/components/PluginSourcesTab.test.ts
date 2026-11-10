import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import PluginSourcesTab from "@/views/components/plugins/PluginSourcesTab.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      plugins: {
        sources: { browse: "Browse sources", manage: "Manage sources" },
      },
    },
  },
});

const { discoverReload, marketChanged } = vi.hoisted(() => ({
  discoverReload: vi.fn(),
  marketChanged: vi.fn(),
}));

/** Stub the two heavy children; capture reload + changed wiring. */
const PluginDiscoverTabStub = {
  name: "PluginDiscoverTab",
  setup() {
    return { reload: discoverReload };
  },
  template: "<div data-testid='stub-discover'>discover</div>",
};

const PluginMarketplacesTabStub = {
  name: "PluginMarketplacesTab",
  emits: ["changed"],
  setup(_props: unknown, { emit }: { emit: (e: string) => void }) {
    function triggerChanged(): void {
      emit("changed");
    }
    return { triggerChanged, marketChanged };
  },
  template:
    "<div data-testid='stub-marketplaces'><button data-testid='stub-marketplaces-trigger' @click='triggerChanged'>x</button></div>",
};

function mountSources() {
  return mount(PluginSourcesTab, {
    global: {
      plugins: [i18n],
      stubs: {
        PluginDiscoverTab: PluginDiscoverTabStub,
        PluginMarketplacesTab: PluginMarketplacesTabStub,
      },
    },
  });
}

describe("PluginSourcesTab", () => {
  beforeEach(() => {
    discoverReload.mockReset();
    marketChanged.mockReset();
    discoverReload.mockResolvedValue(undefined);
  });

  it("renders both secondary tabs", () => {
    const w = mountSources();
    expect(w.text()).toContain("Browse sources");
    expect(w.text()).toContain("Manage sources");
  });

  it("exposes reloadBrowse() which calls the discover tab's reload", async () => {
    const w = mountSources();
    await flushPromises();
    await (w.vm as unknown as { reloadBrowse: () => Promise<void> }).reloadBrowse();
    expect(discoverReload).toHaveBeenCalledTimes(1);
  });

  it("reloads the discover browse view when a marketplace source changes", async () => {
    const w = mountSources();
    await flushPromises();
    discoverReload.mockClear();

    await w.find('[data-testid="stub-marketplaces-trigger"]').trigger("click");
    await flushPromises();

    expect(discoverReload).toHaveBeenCalledTimes(1);
  });
});
