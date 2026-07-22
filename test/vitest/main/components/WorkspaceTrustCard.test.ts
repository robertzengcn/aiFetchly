// test/vitest/main/components/WorkspaceTrustCard.test.ts
// Phase 14 (Plan 14-04) — component tests for WorkspaceTrustCard.vue.
//
// Covers the TRS-03 trust-prompt surface that happy-dom CAN validate:
//   - 4 buttons render with English fallback text (workspaceTrust i18n keys
//     are added in Plan 14-05; the || fallbacks make the card render
//     correctly even before translations land).
//   - Preview fetches AGENTS.md content ONCE via previewWorkspaceAgents and
//     caches; subsequent toggles just show/hide (no re-fetch).
//   - Trust buttons call setWorkspaceTrust (the IPC that approves the
//     workspace on the main side) then emit 'trusted' with the scope.
//   - Keep disabled emits 'dismissed' WITHOUT calling any IPC mock.
//   - Loading state shows on the button during the IPC call.
//
// Live-app UX (real Electron IPC, real dismissal persistence across
// remounts, real chokidar file events) is covered by the plan's Task 3
// human-verify checkpoint — those behaviors cannot be exercised by
// happy-dom component tests alone.
//
// TRS-07 (boundary): previewWorkspaceAgents is the SOLE route to AGENTS.md
// content in the renderer. The test verifies the renderer never imports
// fs/path (the boundary grep test in rendererNoFsAccessToAifetchly.test.ts
// covers the static side).

import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import WorkspaceTrustCard from "@/views/components/aiChatV2/WorkspaceTrustCard.vue";

// Mock the renderer API — every IPC wrapper is replaced so the test never
// touches window.api. previewWorkspaceAgents + setWorkspaceTrust spies drive
// the assertions; acquire/release are not used by the card itself.
const previewWorkspaceAgentsMock = vi.fn();
const setWorkspaceTrustMock = vi.fn();
const acquireWorkspaceWatchMock = vi.fn();
const releaseWorkspaceWatchMock = vi.fn();

vi.mock("@/views/api/workspaceWatch", () => ({
  acquireWorkspaceWatch: (...args: unknown[]) =>
    acquireWorkspaceWatchMock(...args),
  releaseWorkspaceWatch: (...args: unknown[]) =>
    releaseWorkspaceWatchMock(...args),
  previewWorkspaceAgents: (...args: unknown[]) =>
    previewWorkspaceAgentsMock(...args),
  setWorkspaceTrust: (...args: unknown[]) => setWorkspaceTrustMock(...args),
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: {} },
});

function mountCard(
  props?: Partial<{ workspaceId: string; conversationId: string }>
) {
  return mount(WorkspaceTrustCard, {
    props: {
      workspaceId: props?.workspaceId ?? "42",
      conversationId: props?.conversationId ?? "v2-conv-1",
    },
    global: {
      plugins: [i18n],
      stubs: {
        VIcon: true,
        // Pass-through stub so the v-if on the inner <pre> controls DOM
        // presence directly. Without this, the unresolved transition
        // wrapper may not render its slot content in happy-dom.
        VExpandTransition: {
          template: "<slot />",
        },
      },
    },
  });
}

describe("WorkspaceTrustCard", () => {
  beforeEach(() => {
    previewWorkspaceAgentsMock.mockReset();
    setWorkspaceTrustMock.mockReset();
    acquireWorkspaceWatchMock.mockReset();
    releaseWorkspaceWatchMock.mockReset();
  });

  it("renders all 4 TRS-03 buttons with the English fallback text", () => {
    const wrapper = mountCard();

    // The 4 buttons in the order specified by the plan:
    const preview = wrapper.find('[data-testid="trust-card-preview-btn"]');
    const keepDisabled = wrapper.find(
      '[data-testid="trust-card-keep-disabled-btn"]'
    );
    const trustInstructions = wrapper.find(
      '[data-testid="trust-card-trust-instructions-btn"]'
    );
    const trustAll = wrapper.find('[data-testid="trust-card-trust-all-btn"]');

    expect(preview.exists()).toBe(true);
    expect(keepDisabled.exists()).toBe(true);
    expect(trustInstructions.exists()).toBe(true);
    expect(trustAll.exists()).toBe(true);

    // Fallback text shows when the workspaceTrust i18n keys are absent
    // (Plan 14-05 adds them).
    expect(preview.text()).toContain("Preview");
    expect(keepDisabled.text()).toContain("Keep disabled");
    expect(trustInstructions.text()).toContain("Trust instructions only");
    expect(trustAll.text()).toContain("Trust all workspace AI config");
  });

  it("clicking Preview fetches AGENTS.md content and expands to show it", async () => {
    const body = "# Project agent guide\n\nAlways reply concisely.";
    previewWorkspaceAgentsMock.mockResolvedValue(body);

    const wrapper = mountCard();

    expect(
      wrapper.find('[data-testid="trust-card-preview-content"]').exists()
    ).toBe(false);

    await wrapper
      .find('[data-testid="trust-card-preview-btn"]')
      .trigger("click");
    await flushPromises();

    expect(previewWorkspaceAgentsMock).toHaveBeenCalledTimes(1);
    expect(previewWorkspaceAgentsMock).toHaveBeenCalledWith("42");

    const content = wrapper.find('[data-testid="trust-card-preview-content"]');
    expect(content.exists()).toBe(true);
    expect(content.text()).toContain("# Project agent guide");
    expect(content.text()).toContain("Always reply concisely.");
  });

  it("second Preview click collapses without re-fetching (fetch ONCE, cache)", async () => {
    previewWorkspaceAgentsMock.mockResolvedValue("cached body");

    const wrapper = mountCard();

    const btn = wrapper.find('[data-testid="trust-card-preview-btn"]');
    await btn.trigger("click");
    await flushPromises();
    expect(previewWorkspaceAgentsMock).toHaveBeenCalledTimes(1);

    // Collapse.
    await btn.trigger("click");
    await flushPromises();
    expect(
      wrapper.find('[data-testid="trust-card-preview-content"]').exists()
    ).toBe(false);

    // Expand again — must NOT re-fetch (cache).
    await btn.trigger("click");
    await flushPromises();
    expect(previewWorkspaceAgentsMock).toHaveBeenCalledTimes(1);
    expect(
      wrapper.find('[data-testid="trust-card-preview-content"]').exists()
    ).toBe(true);
  });

  it("clicking Trust all calls setWorkspaceTrust and emits 'trusted' with scope 'all'", async () => {
    setWorkspaceTrustMock.mockResolvedValue({ ok: true });

    const wrapper = mountCard();

    await wrapper
      .find('[data-testid="trust-card-trust-all-btn"]')
      .trigger("click");
    await flushPromises();

    expect(setWorkspaceTrustMock).toHaveBeenCalledTimes(1);
    expect(setWorkspaceTrustMock).toHaveBeenCalledWith({
      workspaceId: "42",
      scope: "all",
    });

    const trustedEvents = wrapper.emitted("trusted");
    expect(trustedEvents).toBeDefined();
    expect(trustedEvents?.[0]).toEqual(["all"]);
  });

  it("clicking Trust instructions only calls setWorkspaceTrust with scope 'instructions'", async () => {
    setWorkspaceTrustMock.mockResolvedValue({ ok: true });

    const wrapper = mountCard();

    await wrapper
      .find('[data-testid="trust-card-trust-instructions-btn"]')
      .trigger("click");
    await flushPromises();

    expect(setWorkspaceTrustMock).toHaveBeenCalledWith({
      workspaceId: "42",
      scope: "instructions",
    });
    expect(wrapper.emitted("trusted")?.[0]).toEqual(["instructions"]);
  });

  it("clicking Keep disabled emits 'dismissed' WITHOUT calling any IPC", async () => {
    const wrapper = mountCard();

    await wrapper
      .find('[data-testid="trust-card-keep-disabled-btn"]')
      .trigger("click");
    await flushPromises();

    expect(setWorkspaceTrustMock).not.toHaveBeenCalled();
    expect(previewWorkspaceAgentsMock).not.toHaveBeenCalled();
    expect(wrapper.emitted("dismissed")).toHaveLength(1);
  });

  it("shows loading state on Preview button during the fetch", async () => {
    // Hold the promise so we can observe the loading flag mid-flight.
    let resolve!: (v: string) => void;
    previewWorkspaceAgentsMock.mockReturnValue(
      new Promise<string>((r) => {
        resolve = r;
      })
    );

    const wrapper = mountCard();
    const btn = wrapper.find('[data-testid="trust-card-preview-btn"]');
    // The component always binds data-loading as 'true' | 'false'. Before
    // any click the flag must read 'false'.
    expect(btn.attributes("data-loading")).toBe("false");

    const clickPromise = btn.trigger("click");
    await flushPromises();
    // While unresolved, the loading flag must be true.
    expect(btn.attributes("data-loading")).toBe("true");

    resolve("body");
    await clickPromise;
    await flushPromises();
    expect(btn.attributes("data-loading")).toBe("false");
  });

  it("shows loading state on Trust button during the IPC call", async () => {
    let resolve!: (v: { ok: boolean }) => void;
    setWorkspaceTrustMock.mockReturnValue(
      new Promise<{ ok: boolean }>((r) => {
        resolve = r;
      })
    );

    const wrapper = mountCard();
    const btn = wrapper.find('[data-testid="trust-card-trust-all-btn"]');

    const clickPromise = btn.trigger("click");
    await flushPromises();
    expect(btn.attributes("data-loading")).toBe("true");

    resolve({ ok: true });
    await clickPromise;
    await flushPromises();
    expect(btn.attributes("data-loading")).toBe("false");
  });
});
