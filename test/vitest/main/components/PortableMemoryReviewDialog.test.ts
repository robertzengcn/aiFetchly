import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PortableMemoryReviewDialog from "@/views/components/aiChatV2/PortableMemoryReviewDialog.vue";
import { portableWorkspaceMemoryApi } from "@/views/api/portableWorkspaceMemory";

vi.mock("@/views/api/portableWorkspaceMemory", () => ({
  portableWorkspaceMemoryApi: {
    listPendingReview: vi.fn(),
    approveReview: vi.fn(),
    rejectReview: vi.fn(),
    approveDeletion: vi.fn(),
    rejectDeletion: vi.fn(),
    onChanged: vi.fn(() => () => undefined),
  },
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  missingWarn: false,
  fallbackWarn: false,
  messages: { en: { portableMemory: {} } },
});

function mountDialog(props: { open?: boolean; conversationId?: string }) {
  return mount(PortableMemoryReviewDialog, {
    props: {
      open: props.open ?? true,
      conversationId: props.conversationId ?? "conv-1",
    },
    global: {
      plugins: [i18n],
      stubs: {
        VDialog: { template: "<div><slot /></div>" },
        VCard: { template: "<div><slot /></div>" },
        VCardTitle: { template: "<div><slot /></div>" },
        VCardText: { template: "<div><slot /></div>" },
        VCardActions: { template: "<div><slot /></div>" },
        VBtn: { template: "<button><slot /></button>" },
        VSpacer: true,
      },
    },
  });
}

const newEntry = {
  memoryId: "wmem-018f2f70-7d3d-7cc0-a07f-1d36e59c2ef1",
  relativePath: ".aifetchly/memory/wmem-018f2f70-7d3d-7cc0-a07f-1d36e59c2ef1.md",
  syncState: "pending-review",
  message: "new external record",
  title: undefined,
  preview: "# External\n\nbody",
  parseable: true,
};

const delEntry = {
  memoryId: "wmem-018f2f94-83c7-7a2e-9fc1-849880ba10c0",
  relativePath: ".aifetchly/memory/wmem-018f2f94-83c7-7a2e-9fc1-849880ba10c0.md",
  syncState: "missing",
  message: "file absent; awaiting deletion review",
  preview: undefined,
  parseable: false,
};

describe("PortableMemoryReviewDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(portableWorkspaceMemoryApi.listPendingReview).mockResolvedValue({
      status: true,
      msg: "",
      data: { newRecords: [newEntry], edits: [], deletions: [delEntry] },
    } as never);
    vi.mocked(portableWorkspaceMemoryApi.approveReview).mockResolvedValue({
      status: true,
      msg: "",
      data: null,
    } as never);
    vi.mocked(portableWorkspaceMemoryApi.approveDeletion).mockResolvedValue({
      status: true,
      msg: "",
      data: null,
    } as never);
  });

  it("loads and groups pending records by kind", async () => {
    const wrapper = mountDialog({});
    await flushPromises();
    const text = wrapper.text();
    expect(text).toContain("New records");
    expect(text).toContain("Deleted files");
    expect(text).toContain(newEntry.relativePath);
    expect(text).toContain(delEntry.relativePath);
  });

  it("shows an empty state when there are no pending changes", async () => {
    vi.mocked(portableWorkspaceMemoryApi.listPendingReview).mockResolvedValue({
      status: true,
      msg: "",
      data: { newRecords: [], edits: [], deletions: [] },
    } as never);
    const wrapper = mountDialog({});
    await flushPromises();
    expect(wrapper.text()).toContain("No pending changes.");
  });

  it("approves a new record through the API", async () => {
    const wrapper = mountDialog({});
    await flushPromises();
    const vm = wrapper.vm as unknown as {
      onApprove: (e: typeof newEntry) => Promise<void>;
    };
    await vm.onApprove(newEntry);
    await flushPromises();
    expect(portableWorkspaceMemoryApi.approveReview).toHaveBeenCalledWith({
      conversationId: "conv-1",
      memoryId: newEntry.memoryId,
    });
    expect(wrapper.emitted("resolved")).toHaveLength(1);
  });

  it("approves a deletion through the API", async () => {
    const wrapper = mountDialog({});
    await flushPromises();
    const vm = wrapper.vm as unknown as {
      onApproveDeletion: (e: typeof delEntry) => Promise<void>;
    };
    await vm.onApproveDeletion(delEntry);
    await flushPromises();
    expect(portableWorkspaceMemoryApi.approveDeletion).toHaveBeenCalledWith({
      conversationId: "conv-1",
      memoryId: delEntry.memoryId,
    });
  });
});
