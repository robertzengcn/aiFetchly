import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BrowserAccountPickerCard from "@/views/components/aiChatV2/BrowserAccountPickerCard.vue";
import BrowserSiteConfirmCard from "@/views/components/aiChatV2/BrowserSiteConfirmCard.vue";
import BrowserTaskBatchCard from "@/views/components/aiChatV2/BrowserTaskBatchCard.vue";

/**
 * T26: account picker, site-confirmation, and batch/control cards
 * (A-FR-03, S-FR-04, C-FR-04).
 */

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      browserSignIn: {
        pickAccount: "Choose an account",
        pickAccountHint: "Several saved accounts match {domain}.",
        useAnother: "Use another account",
      },
      browserSite: {
        confirmTitle: "Confirm additional login domains",
        confirmHint: "The sign-in for {domain} visited additional domains.",
        warning: "Only visited domains appear here.",
        apply: "Confirm selected domains",
      },
      browserTasks: {
        batchTitle: "Parallel browser tasks",
        returnResultsNow: "Return results now",
        taskRunning: "Running",
        taskWaitingForYou: "Waiting for you",
        taskPaused: "Paused by you",
        taskCompleted: "Completed",
        taskFailed: "Failed",
        taskCancelled: "Stopped",
        pause: "Pause",
        resume: "Resume",
        stop: "Stop",
      },
      common: { cancel: "Cancel" },
    },
  },
});

function mountCard(
  component: unknown,
  props: Record<string, unknown>
): ReturnType<typeof mount> {
  return mount(component as never, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    props: props as any,
    global: {
      plugins: [i18n],
      stubs: {
        VCard: { template: "<div><slot /></div>" },
        VCardTitle: { template: "<div><slot /></div>" },
        VCardText: { template: "<div><slot /></div>" },
        VCardActions: { template: "<div><slot /></div>" },
        VList: { template: "<div><slot /></div>" },
        VListItem: {
          template: "<div @click=\"$emit('click')\"><slot name=\"prepend\" /><slot /><slot name=\"append\" /></div>",
          props: ["clickable"],
        },
        VListItemTitle: { template: "<div><slot /></div>" },
        VListItemSubtitle: { template: "<div><slot /></div>" },
        VChip: { template: "<span><slot /></span>" },
        VCheckboxBtn: true,
        VBtn: {
          template: "<button :data-testid=\"$attrs['data-testid']\" @click=\"$emit('click')\"><slot /></button>",
        },
        VSpacer: true,
      },
    },
  });
}

describe("BrowserAccountPickerCard (A-FR-03)", () => {
  it("lists matching accounts and emits the selected id", async () => {
    const wrapper = mountCard(BrowserAccountPickerCard, {
      siteDomain: "example.test",
      accounts: [
        { id: 7, user: "a@example.test", name: "Account A" },
        { id: 9, user: "b@example.test", name: "Account B" },
      ],
    });
    expect(wrapper.text()).toContain("Account A");
    expect(wrapper.text()).toContain("b@example.test");
    await wrapper.find('[data-testid="account-option-9"]').trigger("click");
    expect(wrapper.emitted("selected")?.[0]).toEqual([9]);
  });

  it("emits 'other' for use-another-account", async () => {
    const wrapper = mountCard(BrowserAccountPickerCard, {
      siteDomain: "example.test",
      accounts: [{ id: 7, user: "a@example.test", name: "A" }],
    });
    await wrapper.find('[data-testid="account-other"]').trigger("click");
    expect(wrapper.emitted("other")).toBeTruthy();
  });
});

describe("BrowserSiteConfirmCard (S-FR-04)", () => {
  it("applies only the confirmed domains", async () => {
    const wrapper = mountCard(BrowserSiteConfirmCard, {
      siteId: 42,
      registrableDomain: "example.test",
      proposedDomains: ["auth.partner.test", "cdn.partner.test"],
    });
    await wrapper.find('[data-testid="site-confirm-apply"]').trigger("click");
    const applied = wrapper.emitted("applied");
    expect(applied?.[0]).toEqual([
      { siteId: 42, domains: ["auth.partner.test", "cdn.partner.test"] },
    ]);
  });

  it("cancel emits cancelled without applying", async () => {
    const wrapper = mountCard(BrowserSiteConfirmCard, {
      siteId: 42,
      registrableDomain: "example.test",
      proposedDomains: ["auth.partner.test"],
    });
    await wrapper.find('[data-testid="site-confirm-cancel"]').trigger("click");
    expect(wrapper.emitted("cancelled")).toBeTruthy();
    expect(wrapper.emitted("applied")).toBeFalsy();
  });
});

describe("BrowserTaskBatchCard (C-FR-04)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mountBatch() {
    return mountCard(BrowserTaskBatchCard, {
      batchId: "batch_1",
      tasks: [
        { taskId: "batch_1:0", label: "Search suppliers", state: "running", sessionId: "mb_a" },
        { taskId: "batch_1:1", label: "Extract prices", state: "paused", sessionId: "mb_b" },
      ],
    });
  }

  it("renders one row per task with a state chip", () => {
    const wrapper = mountBatch();
    expect(wrapper.text()).toContain("Search suppliers");
    expect(wrapper.text()).toContain("Paused by you");
  });

  it("return-results-now emits with the batch id", async () => {
    const wrapper = mountBatch();
    await wrapper.find('[data-testid="batch-return-now"]').trigger("click");
    expect(wrapper.emitted("returnNow")?.[0]).toEqual(["batch_1"]);
  });

  it("pause/resume/stop carry task and session ids", async () => {
    const wrapper = mountBatch();
    await wrapper.find('[data-testid="task-pause-batch_1:0"]').trigger("click");
    expect(wrapper.emitted("pause")?.[0]).toEqual([
      { taskId: "batch_1:0", sessionId: "mb_a" },
    ]);
    await wrapper.find('[data-testid="task-stop-batch_1:1"]').trigger("click");
    expect(wrapper.emitted("stop")?.[0]).toEqual([
      { taskId: "batch_1:1", sessionId: "mb_b" },
    ]);
  });
});
