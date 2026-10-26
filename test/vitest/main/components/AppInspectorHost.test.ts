import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AppInspectorHost from "@/views/components/appShell/AppInspectorHost.vue";
import { useAppInspectorStore } from "@/views/store/appInspector";

/**
 * Inspector-host topology (2026-10-26 docked-column design §constraint):
 * the host renders the active inspector INLINE as a shell flex child — the
 * previous `<Teleport to="body">` put the panel outside the layout row, so
 * the docked wide-mode presentation had to float over content.
 */

// The rollout adapters fetch flags on mount; resolve the default-on flags
// deterministically so the assembled inspector mounts clean.
vi.mock("@/views/api/aiChatWorkspace", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/views/api/aiChatWorkspace")
    >();
  return {
    ...actual,
    fetchWorkspaceRolloutFlags: vi.fn(async () => ({
      status: true,
      data: {
        enabled: true,
        explicit: true,
        adapters: {
          sharedOrchestration: true,
          specializedResults: true,
          voiceMemory: true,
        },
      },
    })),
  };
});

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      workspaceChat: {
        inspector: {
          region: "Inspector",
          close: "Close inspector",
          artifacts: "Artifacts",
          activity: "Activity",
          context: "Context",
          resize: "Resize inspector",
          artifactsDisabled: "Artifact results are unavailable.",
        },
      },
    },
  },
});

beforeEach(() => {
  setActivePinia(createPinia());
});

function mountHost() {
  return mount(AppInspectorHost, { global: { plugins: [i18n] } });
}

describe("AppInspectorHost — inline topology (no body teleport)", () => {
  it("renders the active chat inspector INSIDE the host, not in document.body", async () => {
    const store = useAppInspectorStore();
    const wrapper = mountHost();
    store.open({
      kind: "chat",
      ownerRoute: "/aiworkspace",
      conversationId: "conv-1",
      tab: "activity",
    });
    await flushPromises();

    const panel = wrapper.find('[data-testid="workspace-inspector"]');
    expect(panel.exists()).toBe(true);
    // The host is a shell flex child; a body-teleported panel would still
    // mount but outside the layout row.
    expect(
      document.querySelector("body > [data-testid='workspace-inspector']")
    ).toBeNull();

    // Closing empties the host again.
    store.close();
    await flushPromises();
    expect(
      wrapper.find('[data-testid="workspace-inspector"]').exists()
    ).toBe(false);
  });
});
