import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WorkspaceMemoryPanel from "@/views/components/aiChatV2/WorkspaceMemoryPanel.vue";
import type { WorkspaceSummary } from "@/entityTypes/workspaceTypes";
import { workspaceMemoryApi } from "@/views/api/aiWorkspaceMemory";
import { portableWorkspaceMemoryApi } from "@/views/api/portableWorkspaceMemory";

vi.mock("@/views/api/aiWorkspaceMemory", () => ({
  workspaceMemoryApi: {
    list: vi.fn(),
    autoDreamStatus: vi.fn(),
    runAutoDream: vi.fn(),
  },
}));

vi.mock("@/views/api/portableWorkspaceMemory", () => ({
  portableWorkspaceMemoryApi: {
    status: vi.fn(),
    list: vi.fn(),
    enablePreview: vi.fn(),
    enable: vi.fn(),
    rescan: vi.fn(),
    onChanged: vi.fn(() => () => undefined),
  },
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  missingWarn: false,
  fallbackWarn: false,
  messages: { en: {} },
});

function mountPanel(props: {
  conversationId?: string;
  workspace?: Partial<WorkspaceSummary> | null;
}) {
  const workspace: WorkspaceSummary | null =
    props.workspace === undefined
      ? ({ approvalState: "approved" } as unknown as WorkspaceSummary)
      : (props.workspace as WorkspaceSummary | null);
  return mount(WorkspaceMemoryPanel, {
    props: {
      conversationId: props.conversationId ?? "conv-1",
      workspace,
    },
    global: {
      plugins: [i18n],
      stubs: {
        VCard: { template: "<div><slot /></div>" },
        VBtn: { template: "<button><slot /></button>" },
        VIcon: true,
        VSpacer: true,
        VChip: { template: "<span><slot /></span>" },
        VTextField: true,
        VSwitch: true,
        VList: { template: "<div><slot /></div>" },
        VListItem: { template: "<div><slot /></div>" },
        VDialog: { template: "<div><slot /></div>" },
        VSnackbar: true,
        WorkspaceMemoryStatusBadge: true,
        WorkspaceMemoryEditorDialog: true,
        PortableMemoryEnableDialog: true,
        PortableMemoryConflictDialog: true,
        RouterLink: true,
      },
    },
  });
}

function statusData(overrides: Record<string, unknown> = {}) {
  return {
    enabled: false,
    defaultStorageMode: "private-only",
    importPolicy: "review-new",
    syncState: "idle",
    privateCount: 3,
    portableCount: 0,
    rejectedCount: 0,
    conflictCount: 0,
    pendingReviewCount: 0,
    gitTrackingState: "untracked",
    ...overrides,
  };
}

describe("WorkspaceMemoryPanel — portable memory banner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(workspaceMemoryApi.list).mockResolvedValue({
      status: true,
      msg: "",
      data: [],
    } as never);
    vi.mocked(workspaceMemoryApi.autoDreamStatus).mockResolvedValue({
      status: true,
      msg: "",
      data: undefined,
    } as never);
    vi.mocked(portableWorkspaceMemoryApi.status).mockResolvedValue({
      status: true,
      msg: "",
      data: statusData(),
    } as never);
  });

  it("shows the enable action when portable memory is disabled", async () => {
    const wrapper = mountPanel({});
    await flushPromises();
    const text = wrapper.text();
    expect(text).toContain("Enable portable memory");
    expect(text).toContain("stored privately");
    expect(
      wrapper.findComponent({ name: "PortableMemoryEnableDialog" }).exists()
    ).toBe(true);
  });

  it("shows counts, git state, and rescan when enabled", async () => {
    vi.mocked(portableWorkspaceMemoryApi.status).mockResolvedValue({
      status: true,
      msg: "",
      data: statusData({
        enabled: true,
        portableCount: 2,
        privateCount: 5,
        gitTrackingState: "tracked",
      }),
    } as never);
    const wrapper = mountPanel({});
    await flushPromises();
    const text = wrapper.text();
    expect(text).toContain("Portable memory");
    expect(text).toContain("2 / 7");
    expect(text).toContain("tracked");
    expect(text).toContain("Rescan");
    expect(text).not.toContain("Enable portable memory");
  });

  it("surfaces pending-review, rejected, and conflict counts as chips", async () => {
    vi.mocked(portableWorkspaceMemoryApi.status).mockResolvedValue({
      status: true,
      msg: "",
      data: statusData({
        enabled: true,
        portableCount: 4,
        pendingReviewCount: 2,
        rejectedCount: 1,
        conflictCount: 1,
      }),
    } as never);
    const wrapper = mountPanel({});
    await flushPromises();
    const text = wrapper.text();
    expect(text).toContain("Pending review: 2");
    expect(text).toContain("Rejected: 1");
    expect(text).toContain("Conflicted: 1");
  });

  it("hides the banner entirely without an approved workspace", async () => {
    const wrapper = mountPanel({ workspace: { approvalState: "pending" } });
    await flushPromises();
    // The portable banner section (wm-portable) is only rendered inside the
    // v-else (approved-workspace) template; the empty-workspace state shows
    // the no-workspace message instead. The diagnostics/conflict dialogs are
    // always mounted (open=false) so they don't count as banner visibility.
    expect(wrapper.text()).not.toContain("Enable portable memory");
    expect(wrapper.find(".wm-portable").exists()).toBe(false);
  });

  it("requests a rescan through the portable API", async () => {
    vi.mocked(portableWorkspaceMemoryApi.status).mockResolvedValue({
      status: true,
      msg: "",
      data: statusData({ enabled: true, portableCount: 1 }),
    } as never);
    vi.mocked(portableWorkspaceMemoryApi.rescan).mockResolvedValue({
      status: true,
      msg: "",
      data: null,
    } as never);
    const wrapper = mountPanel({});
    await flushPromises();
    const rescanBtn = wrapper
      .findAll("button")
      .find((b) => b.text() === "Rescan");
    expect(rescanBtn).toBeDefined();
    await rescanBtn?.trigger("click");
    expect(portableWorkspaceMemoryApi.rescan).toHaveBeenCalledWith("conv-1");
  });

  it("shows a Resolve button and opens the conflict dialog when conflicts exist", async () => {
    vi.mocked(portableWorkspaceMemoryApi.status).mockResolvedValue({
      status: true,
      msg: "",
      data: statusData({
        enabled: true,
        portableCount: 2,
        conflictCount: 1,
      }),
    } as never);
    const wrapper = mountPanel({});
    await flushPromises();
    const resolveBtn = wrapper
      .findAll("button")
      .find((b) => b.text() === "Resolve");
    expect(resolveBtn).toBeDefined();
    await resolveBtn?.trigger("click");
    expect(
      wrapper.findComponent({ name: "PortableMemoryConflictDialog" }).exists()
    ).toBe(true);
  });

  it("renders per-memory storage + sync badges when portable is enabled (FR-061)", async () => {
    vi.mocked(portableWorkspaceMemoryApi.status).mockResolvedValue({
      status: true,
      msg: "",
      data: statusData({ enabled: true, portableCount: 1 }),
    } as never);
    vi.mocked(workspaceMemoryApi.list).mockResolvedValue({
      status: true,
      msg: "",
      data: [
        {
          id: 1,
          memoryId: "wmem-x",
          workspaceKey: "ws_a",
          workspaceRoot: "/r",
          type: "decision",
          title: "Badge me",
          content: "c",
          status: "active",
          confidence: 90,
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:00.000Z",
        },
      ],
    } as never);
    vi.mocked(portableWorkspaceMemoryApi.list).mockResolvedValue({
      status: true,
      msg: "",
      data: [
        {
          memoryId: "wmem-x",
          type: "decision",
          title: "Badge me",
          content: "c",
          status: "active",
          confidence: 90,
          updatedAt: "2026-08-01T00:00:00.000Z",
          storageMode: "portable-team",
          syncState: "synced",
          visibility: "team",
        },
      ],
    } as never);
    const wrapper = mountPanel({});
    await flushPromises();
    await flushPromises();
    const text = wrapper.text();
    // Storage badge (team) + sync badge (synced) appear per row.
    expect(text).toContain("Team");
    expect(text).toContain("Synced");
  });

  it("subscribes to sync summaries and refreshes debounced", async () => {
    vi.useFakeTimers();
    let sink: ((s: unknown) => void) | null = null;
    vi.mocked(portableWorkspaceMemoryApi.onChanged).mockImplementation(((
      cb: (s: unknown) => void
    ) => {
      sink = cb;
      return () => undefined;
    }) as unknown as typeof portableWorkspaceMemoryApi.onChanged);
    const wrapper = mountPanel({});
    await flushPromises();
    expect(sink).toBeTypeOf("function");
    (sink as unknown as (s: unknown) => void)({ scopeId: "s", imported: 1 });
    // Not refreshed synchronously — debounce window.
    expect(vi.mocked(portableWorkspaceMemoryApi.status)).toHaveBeenCalledTimes(
      1
    );
    vi.advanceTimersByTime(300);
    await flushPromises();
    expect(
      vi.mocked(portableWorkspaceMemoryApi.status).mock.calls.length
    ).toBeGreaterThan(1);
    vi.useRealTimers();
    void wrapper;
  });

  it("Run Auto Summary sends the open conversationId with force: true", async () => {
    vi.mocked(workspaceMemoryApi.runAutoDream).mockResolvedValue({
      status: true,
      msg: "",
      data: [
        {
          id: 1,
          runId: "wrun-1",
          status: "completed",
          startedAt: "2026-08-26T00:00:00.000Z",
          chatConversationsReviewed: 1,
          agentTasksReviewed: 0,
          memoriesCreated: 1,
          memoriesUpdated: 0,
          memoriesArchived: 0,
          createdAt: "2026-08-26T00:00:00.000Z",
          updatedAt: "2026-08-26T00:00:00.000Z",
        },
      ],
    } as never);
    const wrapper = mountPanel({ conversationId: "conv-focus" });
    await flushPromises();
    const runBtn = wrapper
      .findAll("button")
      .find((b) => /runAutoSummary|AUTO SUMMARY/i.test(b.text()));
    expect(runBtn).toBeDefined();
    await runBtn?.trigger("click");
    await flushPromises();
    expect(workspaceMemoryApi.runAutoDream).toHaveBeenCalledWith({
      conversationId: "conv-focus",
      force: true,
    });
  });
});
