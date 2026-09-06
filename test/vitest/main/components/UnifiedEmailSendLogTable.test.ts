import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
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
      },
    },
  },
});

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
    template: '<div data-testid="v-data-table-server" />',
  },
  VChip: {
    props: ["size", "color", "variant"],
    template: '<span class="v-chip"><slot /></span>',
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
  return mount(UnifiedEmailSendLogTable, {
    global: { plugins: [i18n], stubs },
  });
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
    const wrapper = mountTable();
    expect(wrapper.find('[data-testid="v-data-table-server"]').exists()).toBe(
      true
    );
  });

  it("fetches the unified send log on mount (no task-id route param)", async () => {
    const wrapper = mountTable();
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
    const wrapper = mountTable();
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
    const wrapper = mountTable();
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
    const wrapper = mountTable();
    const table = wrapper.findComponent({ name: "VDataTableServer" });
    const headers = table.props("headers") as Array<{ key: string }>;
    expect(headers.some((h) => h.key === "source")).toBe(true);
  });
});
