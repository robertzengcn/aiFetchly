import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ScheduleListPage from "@/views/pages/schedule/list.vue";
import { TaskType } from "@/entity/ScheduleTask.entity";
import type { ScheduleListResponse } from "@/entityTypes/schedule-type";

// Mock the schedule API so no IPC is invoked.
const apiMocks = vi.hoisted(() => ({
  getScheduleList: vi.fn(),
  getSchedulerStatus: vi.fn(),
  startScheduler: vi.fn(),
  stopScheduler: vi.fn(),
  exportSchedules: vi.fn(),
}));

vi.mock("@/views/api/schedule", () => ({
  getScheduleList: (...args: unknown[]) => apiMocks.getScheduleList(...args),
  deleteSchedule: vi.fn(),
  enableSchedule: vi.fn(),
  disableSchedule: vi.fn(),
  pauseSchedule: vi.fn(),
  resumeSchedule: vi.fn(),
  runScheduleNow: vi.fn(),
  getSchedulerStatus: () => apiMocks.getSchedulerStatus(),
  startScheduler: () => apiMocks.startScheduler(),
  stopScheduler: () => apiMocks.stopScheduler(),
  exportSchedules: (...args: unknown[]) => apiMocks.exportSchedules(...args),
  importSchedules: vi.fn(),
}));

// ScheduleTable renders child Vuetify components; stub it to keep the test
// focused on the list page's own filter behavior.
const stubs = {
  ScheduleTable: {
    name: "ScheduleTable",
    props: ["schedules", "loading"],
    template: '<div data-testid="schedule-table">{{ schedules.length }}</div>',
  },
  VContainer: { template: "<div><slot /></div>" },
  VRow: { template: '<div class="v-row"><slot /></div>' },
  VCol: { template: '<div class="v-col"><slot /></div>' },
  VCard: { template: "<div><slot /></div>" },
  VCardTitle: { template: "<div><slot /></div>" },
  VCardText: { template: "<div><slot /></div>" },
  VCardActions: { template: "<div><slot /></div>" },
  VBtn: { template: "<button><slot /></button>" },
  VChip: { template: '<span class="v-chip"><slot /></span>' },
  VTextField: { template: "<input />" },
  VSelect: {
    props: ["items", "modelValue", "label"],
    template:
      '<select data-testid="v-select" :data-label="label"><option v-for="i in items" :key="i.value" :value="i.value">{{ i.title }}</option></select>',
  },
  VPagination: { template: '<div class="v-pagination" />' },
  VDialog: { template: "<div><slot /></div>" },
  VIcon: true,
  VSpacer: true,
};

const i18n = createI18n({
  legacy: false,
  locale: "en",
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    en: {
      schedule: {
        schedule_management: "Schedule Management",
        manage_automated_scheduling: "Manage Automated Scheduling",
        new_schedule: "New Schedule",
        scheduler_status: "Scheduler Status",
        running: "Running",
        stopped: "Stopped",
        active_schedules: "Active Schedules",
        total_schedules: "Total Schedules",
        scheduler: "Scheduler",
        start: "Start",
        stop: "Stop",
        schedules: "Schedules",
        search_schedules: "Search Schedules",
        task_type: "Task Type",
        trigger_type: "Trigger Type",
        ai_message: "AI Message Task",
      },
      common: {
        status: "Status",
        page: "Page",
        of: "of",
        import: "Import",
        export: "Export",
        clear_filters: "Clear Filters",
        cancel: "Cancel",
        confirm: "Confirm",
        ok: "OK",
      },
    },
  },
});

function makeResponse(count: number): ScheduleListResponse {
  const items = Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `AI message ${i + 1}`,
    description: "",
    task_type: TaskType.AI_MESSAGE,
    task_id: i + 1,
    cron_expression: "0 * * * *",
    is_active: true,
    status: "active",
    trigger_type: "cron",
    parent_schedule_id: null,
    dependency_condition: null,
    delay_minutes: 0,
    execution_count: 0,
    failure_count: 0,
    last_error_message: null,
    next_run_time: null,
    last_run_time: null,
    last_modified: null,
  })) as unknown as ScheduleListResponse["schedules"];
  return {
    schedules: items,
    total: count,
    page: 0,
    size: 10,
  } as ScheduleListResponse;
}

function mountPage() {
  return mount(ScheduleListPage, {
    global: { plugins: [i18n], stubs },
  });
}

describe("ScheduleListPage task-type filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getScheduleList.mockResolvedValue(makeResponse(2));
    apiMocks.getSchedulerStatus.mockResolvedValue({
      isRunning: false,
      activeSchedules: 0,
      totalSchedules: 0,
    });
  });

  it("only offers the AI Message Task option in the task-type filter", async () => {
    const wrapper = mountPage();
    await flushPromises();

    // The task-type filter is the v-select labeled "Task Type".
    const taskTypeSelect = wrapper.find('[data-label="Task Type"]');
    expect(taskTypeSelect.exists()).toBe(true);

    const options = taskTypeSelect.findAll("option");
    expect(options).toHaveLength(1);
    expect(options[0].text()).toBe("AI Message Task");
    expect(options[0].attributes("value")).toBe(TaskType.AI_MESSAGE);
  });

  it("still requests and renders AI message schedules", async () => {
    const wrapper = mountPage();
    await flushPromises();

    expect(apiMocks.getScheduleList).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-testid="schedule-table"]').text()).toContain(
      "2"
    );
  });
});
