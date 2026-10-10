import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import WorkspaceBadge from "@/views/components/aiChatV2/WorkspaceBadge.vue";
import type { WorkspaceSummary } from "@/entityTypes/workspaceTypes";

/**
 * FR-WS-002/003/007: the workspace chooser badge must render the complete
 * state model — loading, none selected (explicit Choose action + context),
 * pending approval, approved (name + icon/text status + shortened path),
 * revoked, and must block Choose/Change with a visible localized reason while
 * a run is active. Status is never conveyed by color alone: every state
 * asserts its text.
 */

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      workspace: {
        badgeLabel: "Workspace",
        notSet: "No workspace set",
        changeFolder: "Change folder",
        chooseAction: "Choose workspace",
        chooseHint: "Pick a folder so AI file tools can read and write files.",
        loading: "Loading workspace…",
        statusApproved: "Approved",
        statusPending: "Pending approval",
        statusRevoked: "Access revoked",
        busyReason: "Available after current run",
      },
      workspaceMemory: { memoryAction: "Memory" },
    },
  },
});

function workspace(
  overrides: Partial<WorkspaceSummary> = {}
): WorkspaceSummary {
  return {
    id: 7,
    conversationId: "conv-1",
    rootPath: "/home/user/projects/very/deeply/nested/checkout-directory",
    label: null,
    approvalState: "approved",
    ...overrides,
  };
}

function mountBadge(props: {
  workspace: WorkspaceSummary | null;
  memoryCount?: number;
  loading?: boolean;
  busy?: boolean;
}) {
  return mount(WorkspaceBadge, {
    props,
    global: {
      plugins: [i18n],
      stubs: { VIcon: true },
    },
  });
}

describe("WorkspaceBadge (FR-WS-002/003/007 state model)", () => {
  it("renders the loading state without chooser actions", () => {
    const wrapper = mountBadge({ workspace: null, loading: true });
    expect(
      wrapper.find('[data-testid="workspace-badge-loading"]').exists()
    ).toBe(true);
    expect(wrapper.text()).toContain("Loading workspace…");
    expect(
      wrapper.find('[data-testid="workspace-badge-choose"]').exists()
    ).toBe(false);
    expect(
      wrapper.find('[data-testid="workspace-badge-change"]').exists()
    ).toBe(false);
  });

  it("renders an explicit Choose action with explanatory context when no workspace is set", async () => {
    const wrapper = mountBadge({ workspace: null });
    expect(
      wrapper.find('[data-testid="workspace-badge-unset"]').exists()
    ).toBe(true);
    expect(wrapper.text()).toContain("No workspace set");
    expect(wrapper.text()).toContain(
      "Pick a folder so AI file tools can read and write files."
    );
    const choose = wrapper.get('[data-testid="workspace-badge-choose"]');
    expect(choose.text()).toContain("Choose workspace");

    await choose.trigger("click");
    expect(wrapper.emitted("request-set-workspace")).toHaveLength(1);
  });

  it("renders name, icon-plus-text Approved status, and a shortened path", () => {
    const wrapper = mountBadge({
      workspace: workspace({ label: "project" }),
    });
    expect(wrapper.find('[data-testid="workspace-badge"]').exists()).toBe(true);
    expect(wrapper.get(".workspace-badge__name").text()).toBe("project");
    // Status is text + icon, never color alone (FR-QUAL-004).
    const status = wrapper.get(".workspace-badge__status");
    expect(status.attributes("data-approval-state")).toBe("approved");
    expect(status.text()).toContain("Approved");
    // Path is shortened but keeps head and tail segments.
    const path = wrapper.get(".workspace-badge__path").text();
    expect(path).toContain("...");
    expect(path).not.toBe(workspace().rootPath);
  });

  it("falls back to the path's final segment when the workspace has no label", () => {
    const wrapper = mountBadge({ workspace: workspace() });
    expect(wrapper.get(".workspace-badge__name").text()).toBe(
      "checkout-directory"
    );
  });

  it("renders the pending-approval state as text, not color alone", () => {
    const wrapper = mountBadge({
      workspace: workspace({ approvalState: "pending", label: "awaiting" }),
    });
    const status = wrapper.get(".workspace-badge__status");
    expect(status.attributes("data-approval-state")).toBe("pending");
    expect(status.text()).toContain("Pending approval");
    expect(wrapper.get(".workspace-badge__name").text()).toBe("awaiting");
  });

  it("renders the revoked state as text", () => {
    const wrapper = mountBadge({
      workspace: workspace({ approvalState: "revoked" }),
    });
    const status = wrapper.get(".workspace-badge__status");
    expect(status.attributes("data-approval-state")).toBe("revoked");
    expect(status.text()).toContain("Access revoked");
  });

  it("forwards the Change action and Memory action for an approved workspace", async () => {
    const wrapper = mountBadge({
      workspace: workspace(),
      memoryCount: 3,
    });
    const change = wrapper.get('[data-testid="workspace-badge-change"]');
    expect(change.text()).toContain("Change folder");
    await change.trigger("click");
    expect(wrapper.emitted("request-set-workspace")).toHaveLength(1);

    expect(wrapper.get(".workspace-badge__memory-count").text()).toBe("3");
    await wrapper.get(".workspace-badge__memory").trigger("click");
    expect(wrapper.emitted("request-open-memory")).toHaveLength(1);
  });

  it("blocks Choose/Change while a run is active with a visible reason (FR-WS-007)", async () => {
    const noWorkspace = mountBadge({ workspace: null, busy: true });
    const choose = noWorkspace.get('[data-testid="workspace-badge-choose"]');
    expect(choose.attributes("disabled")).toBeDefined();
    expect(
      noWorkspace.find('[data-testid="workspace-badge-busy-reason"]').exists()
    ).toBe(true);
    expect(noWorkspace.text()).toContain("Available after current run");
    await choose.trigger("click");
    expect(noWorkspace.emitted("request-set-workspace")).toBeUndefined();

    const approved = mountBadge({ workspace: workspace(), busy: true });
    const change = approved.get('[data-testid="workspace-badge-change"]');
    expect(change.attributes("disabled")).toBeDefined();
    expect(approved.text()).toContain("Available after current run");
    await change.trigger("click");
    expect(approved.emitted("request-set-workspace")).toBeUndefined();
  });

  it("allows the safe transition again once no run is active", async () => {
    const wrapper = mountBadge({ workspace: workspace(), busy: false });
    await wrapper.get('[data-testid="workspace-badge-change"]').trigger("click");
    expect(wrapper.emitted("request-set-workspace")).toHaveLength(1);
    expect(
      wrapper.find('[data-testid="workspace-badge-busy-reason"]').exists()
    ).toBe(false);
  });
});
