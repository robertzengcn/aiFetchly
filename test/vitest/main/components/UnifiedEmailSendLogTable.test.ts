import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { createRouter, createMemoryHistory } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import UnifiedEmailSendLogTable from "@/views/pages/emailSendTaskLog/widgets/UnifiedEmailSendLogTable.vue";
import type { UnifiedSendLogEntry } from "@/entityTypes/buckemailType";

// Mock the unified send-log API so no IPC is invoked.
const apiMocks = vi.hoisted(() => ({
  getUnifiedEmailSendLog: vi.fn(),
}));

vi.mock("@/views/api/buckemail", () => ({
  getUnifiedEmailSendLog: (...args: unknown[]) =>
    apiMocks.getUnifiedEmailSendLog(...args),
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    en: {
      emailtasksendlog: {
        id: "id",
        status: "status",
        receiver: "receiver",
        title: "title",
        content: "content",
        record_time: "record time",
        source: "source",
        source_legacy: "Legacy",
        source_authorized: "Authorized",
        actions: "actions",
      },
    },
  },
});

// The table navigates to the detail route on row-action click, so it needs a
// real router. Routes are minimal — only the name the table pushes to.
function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/",
        name: "home",
        component: { template: "<div />" },
      },
      {
        path: "/sendlog",
        name: "UNIFIED_EMAIL_SEND_LOG",
        component: { template: "<div />" },
      },
      {
        path: "/sendlog/detail/:source/:id",
        name: "UNIFIED_EMAIL_SEND_LOG_DETAIL",
        component: { template: "<div />" },
      },
    ],
  });
}

const stubs = {
  VTextField: { template: "<input />" },
  VDataTableServer: {
    name: "VDataTableServer",
    props: [
      "items",
      "itemsLength",
      "loading",
      "headers",
      "itemsPerPage",
      "search",
      "itemValue",
      "modelValue",
    ],
    emits: ["update:options", "update:modelValue"],
    template: `<div data-testid="v-data-table-server">
      <slot
        v-for="(item, i) in items"
        :key="i"
        name="item.actions"
        :item="item"
      />
    </div>`,
  },
  VChip: {
    props: ["size", "color", "variant"],
    template: '<span class="v-chip"><slot /></span>',
  },
  VIcon: {
    props: ["size", "color"],
    emits: ["click"],
    template:
      '<i data-testid="row-action-icon" @click="$emit(\'click\')"><slot /></i>',
  },
};

const SAMPLE_ROWS: UnifiedSendLogEntry[] = [
  {
    id: 1,
    source: "legacy",
    status: "Success",
    receiver: "alice@example.com",
    title: "Welcome Alice",
    record_time: "2026-09-01T00:00:00.000Z",
    taskId: 1001,
  },
  {
    id: 2,
    source: "authorized",
    status: "Failure",
    receiver: "bob@example.com",
    title: "Authorized Send",
    record_time: "2026-09-02T00:00:00.000Z",
    batchId: 5,
    draftId: 7,
  },
];

function mountTable() {
  const router = createTestRouter();
  return {
    router,
    wrapper: mount(UnifiedEmailSendLogTable, {
      global: { plugins: [i18n, router], stubs },
    }),
  };
}

describe("UnifiedEmailSendLogTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getUnifiedEmailSendLog.mockResolvedValue({
      data: SAMPLE_ROWS,
      total: 2,
    });
  });

  it("renders the data table", () => {
    const { wrapper } = mountTable();
    expect(wrapper.find('[data-testid="v-data-table-server"]').exists()).toBe(
      true
    );
  });

  it("fetches the unified send log on mount (no task-id route param)", async () => {
    const { wrapper } = mountTable();
    // Trigger the initial server-side fetch the way v-data-table-server does.
    wrapper
      .findComponent({ name: "VDataTableServer" })
      .vm.$emit("update:options", { page: 1, itemsPerPage: 10, sortBy: [] });
    await vi.waitFor(() => {
      expect(apiMocks.getUnifiedEmailSendLog).toHaveBeenCalledTimes(1);
    });
    // The call must NOT include a TaskId — this view spans all tasks.
    const callArg = apiMocks.getUnifiedEmailSendLog.mock.calls[0][0] as {
      TaskId?: number;
    };
    expect(callArg.TaskId).toBeUndefined();
  });

  it("passes the fetched rows to the table", async () => {
    const { wrapper } = mountTable();
    wrapper
      .findComponent({ name: "VDataTableServer" })
      .vm.$emit("update:options", { page: 1, itemsPerPage: 10, sortBy: [] });
    await vi.waitFor(() => {
      expect(apiMocks.getUnifiedEmailSendLog).toHaveBeenCalledTimes(1);
    });
    await vi.dynamicImportSettled();
    const table = wrapper.findComponent({ name: "VDataTableServer" });
    // v-data-table-server stub exposes items as a prop.
    const itemsProp = table.props("items") as UnifiedSendLogEntry[];
    expect(itemsProp).toHaveLength(2);
    expect(itemsProp.map((r) => r.source).sort()).toEqual(
      ["authorized", "legacy"].sort()
    );
  });

  it("passes the correct total count", async () => {
    const { wrapper } = mountTable();
    wrapper
      .findComponent({ name: "VDataTableServer" })
      .vm.$emit("update:options", { page: 1, itemsPerPage: 10, sortBy: [] });
    await vi.waitFor(() => {
      expect(apiMocks.getUnifiedEmailSendLog).toHaveBeenCalledTimes(1);
    });
    await vi.dynamicImportSettled();
    const table = wrapper.findComponent({ name: "VDataTableServer" });
    expect(table.props("itemsLength")).toBe(2);
  });

  it("includes the source column header", () => {
    const { wrapper } = mountTable();
    const table = wrapper.findComponent({ name: "VDataTableServer" });
    const headers = table.props("headers") as Array<{ key: string }>;
    expect(headers.some((h) => h.key === "source")).toBe(true);
  });

  it("includes the actions column header", () => {
    const { wrapper } = mountTable();
    const table = wrapper.findComponent({ name: "VDataTableServer" });
    const headers = table.props("headers") as Array<{ key: string }>;
    expect(headers.some((h) => h.key === "actions")).toBe(true);
  });

  it("navigates to the detail route with (source, id) params on row action", async () => {
    const { wrapper, router } = mountTable();
    wrapper
      .findComponent({ name: "VDataTableServer" })
      .vm.$emit("update:options", { page: 1, itemsPerPage: 10, sortBy: [] });
    await vi.waitFor(() => {
      expect(apiMocks.getUnifiedEmailSendLog).toHaveBeenCalledTimes(1);
    });
    await vi.dynamicImportSettled();

    // The stubbed table renders one actions slot per row; click the first
    // (legacy row, id 1).
    const icon = wrapper.find('[data-testid="row-action-icon"]');
    expect(icon.exists()).toBe(true);
    await icon.trigger("click");

    // router.push is async — wait for navigation to complete.
    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe(
        "UNIFIED_EMAIL_SEND_LOG_DETAIL"
      );
    });
    expect(router.currentRoute.value.params.source).toBe("legacy");
    expect(router.currentRoute.value.params.id).toBe("1");
  });

  it("navigates with the authorized source for an authorized row", async () => {
    const { wrapper, router } = mountTable();
    wrapper
      .findComponent({ name: "VDataTableServer" })
      .vm.$emit("update:options", { page: 1, itemsPerPage: 10, sortBy: [] });
    await vi.waitFor(() => {
      expect(apiMocks.getUnifiedEmailSendLog).toHaveBeenCalledTimes(1);
    });
    await vi.dynamicImportSettled();

    // The second rendered actions slot belongs to the authorized row (id 2).
    const icons = wrapper.findAll('[data-testid="row-action-icon"]');
    expect(icons).toHaveLength(2);
    await icons[1].trigger("click");

    // router.push is async — wait for navigation to complete.
    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe(
        "UNIFIED_EMAIL_SEND_LOG_DETAIL"
      );
    });
    expect(router.currentRoute.value.params.source).toBe("authorized");
    expect(router.currentRoute.value.params.id).toBe("2");
  });
});
