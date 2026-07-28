import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WebsiteImportDialog from "@/views/pages/knowledge/WebsiteImportDialog.vue";

// Mock the renderer API so no IPC is invoked.
const ragApiMocks = vi.hoisted(() => ({
  importWebsiteMock: vi.fn(),
  onWebsiteImportProgressMock: vi.fn(),
}));
vi.mock("@/views/api/rag", () => ({
  importWebsite: (...args: unknown[]) => ragApiMocks.importWebsiteMock(...args),
  onWebsiteImportProgress: (handler: unknown) =>
    ragApiMocks.onWebsiteImportProgressMock(handler),
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    en: {
      knowledge: {
        website_import_url_required: "URL is required",
        website_import_urls_required: "At least one URL is required",
        website_import_too_many_urls: "Too many URLs (max {max})",
      },
    },
  },
});

// Stub every Vuetify component the template renders.
const stubs = {
  VDialog: { template: "<div><slot /></div>" },
  VCard: { template: "<div><slot /></div>" },
  VCardTitle: { template: "<div><slot /></div>" },
  VCardText: { template: "<div><slot /></div>" },
  VCardActions: { template: "<div><slot /></div>" },
  VBtnToggle: { template: "<div><slot /></div>" },
  VBtn: { template: "<button><slot /></button>" },
  VTextField: true,
  VTextarea: true,
  VSlider: true,
  VProgressLinear: true,
  VSelect: true,
  VRow: { template: "<div><slot /></div>" },
  VCol: { template: "<div><slot /></div>" },
  VIcon: true,
  VChip: true,
  VAlert: { template: "<div><slot /></div>" },
  VSpacer: true,
  VDivider: true,
  VList: { template: "<div><slot /></div>" },
  VListItem: { template: "<div><slot /></div>" },
  VListItemTitle: true,
  VListItemSubtitle: true,
};

function mountDialog() {
  return mount(WebsiteImportDialog, {
    props: { modelValue: true },
    global: { plugins: [i18n], stubs },
  });
}

const successOutcome = (mode: string, requestedCount: number) => ({
  success: true,
  mode,
  imported: [],
  skipped: [],
  importedCount: 0,
  skippedCount: 0,
  requestedCount,
  summary: "",
  discoveredCount: mode === "site_crawl" ? 0 : undefined,
});

describe("WebsiteImportDialog", () => {
  beforeEach(() => {
    ragApiMocks.importWebsiteMock.mockReset();
    ragApiMocks.onWebsiteImportProgressMock.mockReset();
    ragApiMocks.onWebsiteImportProgressMock.mockReturnValue(vi.fn());
  });

  it("blocks submit and sets formError when url is empty (single_page default)", async () => {
    const w = mountDialog();
    const vm = w.vm as unknown as {
      submit: () => Promise<void>;
      formError: string;
    };
    await vm.submit();
    expect(ragApiMocks.importWebsiteMock).not.toHaveBeenCalled();
    expect(vm.formError.length).toBeGreaterThan(0);
  });

  it("parses url_list (trims + drops blanks), forwards payload + duplicatePolicy, emits completed", async () => {
    ragApiMocks.importWebsiteMock.mockResolvedValue(
      successOutcome("url_list", 2)
    );
    const w = mountDialog();
    const vm = w.vm as unknown as {
      mode: string;
      urlsText: string;
      duplicatePolicy: string;
      submit: () => Promise<void>;
    };
    vm.mode = "url_list";
    vm.urlsText = "  https://a.example\n\n   \nhttps://b.example  \n";
    vm.duplicatePolicy = "allow";
    await vm.submit();
    await flushPromises();
    expect(ragApiMocks.importWebsiteMock).toHaveBeenCalledTimes(1);
    const opts = ragApiMocks.importWebsiteMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(opts.mode).toBe("url_list");
    expect(opts.urls).toEqual(["https://a.example", "https://b.example"]);
    expect(opts.duplicatePolicy).toBe("allow");
    expect(w.emitted("completed")).toBeTruthy();
  });

  it("rejects more than the max-URL cap client-side without calling the API", async () => {
    const w = mountDialog();
    const vm = w.vm as unknown as {
      mode: string;
      urlsText: string;
      submit: () => Promise<void>;
      formError: string;
    };
    vm.mode = "url_list";
    vm.urlsText = Array.from(
      { length: 51 },
      (_, i) => `https://x${i}.example`
    ).join("\n");
    await vm.submit();
    expect(ragApiMocks.importWebsiteMock).not.toHaveBeenCalled();
    expect(vm.formError.length).toBeGreaterThan(0);
  });

  it("subscribes to website import progress and exposes the current page", async () => {
    let resolveImport: (
      value: ReturnType<typeof successOutcome>
    ) => void = () => undefined;
    ragApiMocks.importWebsiteMock.mockReturnValue(
      new Promise((resolve) => {
        resolveImport = resolve;
      })
    );
    const cleanup = vi.fn();
    ragApiMocks.onWebsiteImportProgressMock.mockReturnValue(cleanup);

    const w = mountDialog();
    const vm = w.vm as unknown as {
      url: string;
      submit: () => Promise<void>;
      importing: boolean;
      currentProgress: { url?: string; phase: string } | null;
      progressEvents: unknown[];
    };
    vm.url = "https://example.com/docs";
    const submitPromise = vm.submit();
    await flushPromises();

    const handler = ragApiMocks.onWebsiteImportProgressMock.mock
      .calls[0][0] as (event: {
      phase: string;
      mode: string;
      url: string;
      importedCount: number;
      skippedCount: number;
    }) => void;
    handler({
      phase: "scraping",
      mode: "single_page",
      url: "https://example.com/docs",
      importedCount: 0,
      skippedCount: 0,
    });
    await flushPromises();

    expect(vm.currentProgress?.url).toBe("https://example.com/docs");
    expect(vm.progressEvents).toHaveLength(1);

    resolveImport(successOutcome("single_page", 1));
    await submitPromise;
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(vm.importing).toBe(false);
  });
});
