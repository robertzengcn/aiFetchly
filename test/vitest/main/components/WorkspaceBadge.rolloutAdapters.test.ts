import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import type { WorkspaceSummary } from "@/entityTypes/workspaceTypes";

const rolloutFlagsMock = vi.fn();

vi.mock("@/views/api/aiChatWorkspace", () => ({
  fetchWorkspaceRolloutFlags: (...args: unknown[]) =>
    rolloutFlagsMock(...args),
}));

import WorkspaceBadge from "@/views/components/aiChatV2/WorkspaceBadge.vue";
import {
  useWorkspaceRolloutAdapters,
  resetWorkspaceRolloutAdaptersForTest,
} from "@/views/composables/aiChatWorkspace/useWorkspaceRolloutAdapters";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      workspace: {
        memory: "Memory",
      },
    },
  },
});

/** Approved workspace fixture so the badge's mapped section renders. */
const workspaceFixture: WorkspaceSummary = {
  id: 1,
  conversationId: "conv-1",
  rootPath: "/tmp/workspace-root",
  label: "Workspace root",
  approvalState: "approved",
};

function mountBadge(props: Record<string, unknown> = {}) {
  const emittedOpenMemory: string[] = [];
  const host = defineComponent({
    setup() {
      return () =>
        h(WorkspaceBadge, {
          workspace: workspaceFixture,
          memoryCount: 0,
          showMemory: props.showMemory !== false,
          onRequestSetWorkspace: () => undefined,
          onRequestOpenMemory: () => {
            emittedOpenMemory.push("open");
          },
        });
    },
  });
  const wrapper = mount(host, {
    global: {
      plugins: [i18n],
      stubs: { "v-icon": { template: "<i />" } },
    },
  });
  return { wrapper, emittedOpenMemory };
}

beforeEach(() => {
  rolloutFlagsMock.mockReset();
  rolloutFlagsMock.mockResolvedValue(null);
  resetWorkspaceRolloutAdaptersForTest();
});

describe("WorkspaceBadge voice/memory adapter (A02 §23.1)", () => {
  it("renders the memory surface entry while the adapter flag is on", () => {
    const { wrapper } = mountBadge();
    expect(
      wrapper.find('[data-testid="workspace-badge-memory"]').exists()
    ).toBe(true);
  });

  it("hides the memory surface entry when the adapter flag is rolled off", () => {
    const { wrapper } = mountBadge({ showMemory: false });
    expect(
      wrapper.find('[data-testid="workspace-badge-memory"]').exists()
    ).toBe(false);
  });

  it("emits request-open-memory when the entry is clicked", async () => {
    const { wrapper, emittedOpenMemory } = mountBadge();
    await wrapper
      .find('[data-testid="workspace-badge-memory"]')
      .trigger("click");
    expect(emittedOpenMemory).toEqual(["open"]);
  });
});

describe("useWorkspaceRolloutAdapters (A02 §23.1)", () => {
  it("keeps adapters on when the flag channel is unavailable", async () => {
    rolloutFlagsMock.mockResolvedValue(null);
    void useWorkspaceRolloutAdapters();
    await flushPromises();
    const adapters = useWorkspaceRolloutAdapters();
    expect(adapters.sharedOrchestration.value).toBe(true);
    expect(adapters.specializedResults.value).toBe(true);
    expect(adapters.voiceMemory.value).toBe(true);
  });

  it("reflects an explicit rollback per adapter without cross-contamination", async () => {
    rolloutFlagsMock.mockResolvedValue({
      enabled: true,
      explicit: true,
      adapters: {
        sharedOrchestration: false,
        specializedResults: true,
        voiceMemory: false,
      },
    });
    void useWorkspaceRolloutAdapters();
    await flushPromises();
    const adapters = useWorkspaceRolloutAdapters();
    expect(adapters.sharedOrchestration.value).toBe(false);
    expect(adapters.specializedResults.value).toBe(true);
    expect(adapters.voiceMemory.value).toBe(false);
  });
});
