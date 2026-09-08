import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { createRouter, createMemoryHistory } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EmailSendTaskLogTable from "@/views/pages/emailSendTaskLog/widgets/EmailSendTaskLogTable.vue";
import type { EmailMarketingSendLogListDisplay } from "@/entityTypes/buckemailType";

// Mock the per-task send-log API so no IPC is invoked.
const apiMocks = vi.hoisted(() => ({
  getBuckEmailSendLog: vi.fn(),
}));

vi.mock("@/views/api/buckemail", () => ({
  getBuckEmailSendLog: (...args: unknown[]) =>
    apiMocks.getBuckEmailSendLog(...args),
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
        record_time: "record time",
      },
    },
  },
});

// The table reads $route.params.id for the task filter; mount on a route
// without params (the standalone list-page usage).
function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/",
        name: "home",
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
      "showSelect",
    ],
    emits: ["update:options", "update:modelValue"],
    template: `<div data-testid="v-data-table-server">
      <slot
        v-for="(item, i) in items"
        :key="i"
        name="item.record_time"
        :item="item"
      />
    </div>`,
  },
};

// Legacy rows carry local-naive "YYYY-MM-DD HH:mm:ss" record_time strings
// (emailmarketing_send_log via getRecorddatetime()).
const SAMPLE_ROWS: EmailMarketingSendLogListDisplay[] = [
  {
    id: 1,
    status: "Success",
    receiver: "alice@example.com",
    title: "Welcome Alice",
    record_time: "2026-09-01 08:30:00",
  },
  {
    id: 2,
    status: "Failure",
    receiver: "bob@example.com",
    title: "Follow-up Bob",
    record_time: "2026-09-02 15:10:00",
  },
];

function mountTable() {
  const router = createTestRouter();
  return {
    router,
    wrapper: mount(EmailSendTaskLogTable, {
      global: { plugins: [i18n, router], stubs },
    }),
  };
}

describe("EmailSendTaskLogTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getBuckEmailSendLog.mockResolvedValue({
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

  it("renders record_time in the user's local timezone", async () => {
    const { wrapper } = mountTable();
    wrapper
      .findComponent({ name: "VDataTableServer" })
      .vm.$emit("update:options", { page: 1, itemsPerPage: 10, sortBy: [] });
    await vi.waitFor(() => {
      expect(apiMocks.getBuckEmailSendLog).toHaveBeenCalledTimes(1);
    });
    await vi.dynamicImportSettled();

    const cells = wrapper.findAll('[data-testid="record-time-cell"]');
    expect(cells).toHaveLength(2);
    expect(cells[0].text()).toBe(
      new Date("2026-09-01 08:30:00").toLocaleString()
    );
    expect(cells[1].text()).toBe(
      new Date("2026-09-02 15:10:00").toLocaleString()
    );
  });

  it("shows a placeholder for a row without record_time", async () => {
    apiMocks.getBuckEmailSendLog.mockResolvedValue({
      data: [{ ...SAMPLE_ROWS[0], record_time: undefined }],
      total: 1,
    });
    const { wrapper } = mountTable();
    wrapper
      .findComponent({ name: "VDataTableServer" })
      .vm.$emit("update:options", { page: 1, itemsPerPage: 10, sortBy: [] });
    await vi.waitFor(() => {
      expect(apiMocks.getBuckEmailSendLog).toHaveBeenCalledTimes(1);
    });
    await vi.dynamicImportSettled();

    const cells = wrapper.findAll('[data-testid="record-time-cell"]');
    expect(cells).toHaveLength(1);
    expect(cells[0].text()).toBe("—");
  });
});
