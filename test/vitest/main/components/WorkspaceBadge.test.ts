import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import WorkspaceBadge from "@/views/components/aiChatV2/WorkspaceBadge.vue";
import type { WorkspaceSummary } from "@/entityTypes/workspaceTypes";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      workspace: {
        badgeLabel: "Workspace",
        notSet: "No workspace set",
      },
    },
  },
});

function mountBadge(workspace: WorkspaceSummary | null) {
  return mount(WorkspaceBadge, {
    props: { workspace },
    global: {
      plugins: [i18n],
      stubs: {
        VIcon: true,
      },
    },
  });
}

describe("WorkspaceBadge", () => {
  it("requests workspace setup when the unset badge is clicked", async () => {
    const wrapper = mountBadge(null);

    await wrapper.find(".workspace-badge--unset").trigger("click");

    expect(wrapper.emitted("request-set-workspace")).toHaveLength(1);
  });
});
