import { describe, expect, it, vi, beforeEach } from "vitest";
import { defineComponent } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

/**
 * B10/P-FR-07: the renderer proxy list NEVER receives the stored
 * password — only `hasPassword`. The table binds its "Pass Saved" column
 * to that flag; the secret stays in main-process storage.
 */

const getProxyListMock = vi.fn();

vi.mock("@/views/api/proxy", () => ({
  getProxyList: (...args: unknown[]) => getProxyListMock(...args),
}));

import ProxySelectedTable from "@/views/pages/proxy/widgets/ProxySelectedTable.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: { proxy: { pass: "Pass" } } },
});

// Capture the props the table receives (headers/items). Real Vuetify
// emits update:options on mount, which drives the loader.
const DataTableStub = defineComponent({
  name: "VDataTableServer",
  props: {
    headers: { type: Array as () => Array<Record<string, unknown>>, default: () => [] },
    items: { type: Array as () => Array<Record<string, unknown>>, default: () => [] },
  },
  emits: ["update:options"],
  mounted() {
    this.$emit("update:options", { page: 1, itemsPerPage: 10, sortBy: [] });
  },
  template: `<div class="dt-stub" data-testid="dt-headers" :data-keys="headers.map(h => h.key).join(',')" />`,
});

const rows = [
  {
    id: 1,
    host: "proxy-one.test",
    port: "8080",
    username: "alice",
    // NO password field — the API no longer returns it (B10).
    hasPassword: true,
    protocol: "http",
    country_code: "DE",
    addtime: "2026-11-14",
    status: 1,
    statusName: "Active",
    browser_usable: true,
  },
  {
    id: 2,
    host: "proxy-two.test",
    port: "3128",
    username: "",
    hasPassword: false,
    protocol: "https",
    country_code: "US",
    addtime: "2026-11-14",
    status: 1,
    statusName: "Active",
    browser_usable: true,
  },
];

beforeEach(() => {
  getProxyListMock.mockReset();
  // SearchProxyResp shape: { data: rows, total }.
  getProxyListMock.mockResolvedValue({
    total: rows.length,
    data: rows,
  });
});

describe("ProxySelectedTable (B10 password redaction)", () => {
  it("exposes a hasPassword column and never a password column", async () => {
    const wrapper = mount(ProxySelectedTable, {
      global: {
        plugins: [i18n],
        stubs: { "v-data-table-server": DataTableStub },
      },
    });
    // The stub emits update:options on mount, driving the real loader.
    await flushPromises();
    const stub = wrapper.findComponent(DataTableStub);
    const keys = String(stub.attributes("data-keys")).split(",");
    expect(keys).toContain("hasPassword");
    expect(keys).not.toContain("password");
    expect(keys).not.toContain("pass");
  });

  it("renders rows that carry no password value", async () => {
    const wrapper = mount(ProxySelectedTable, {
      global: {
        plugins: [i18n],
        stubs: { "v-data-table-server": DataTableStub },
      },
    });
    await flushPromises();
    const stub = wrapper.findComponent(DataTableStub);
    const items = stub.props("items") as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item.password).toBeUndefined();
      expect(item.pass).toBeUndefined();
      expect(typeof item.hasPassword).toBe("boolean");
    }
  });
});
