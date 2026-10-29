import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent } from "vue";
import ManagedBrowserHandoffDialog from "@/views/components/aiChatV2/ManagedBrowserHandoffDialog.vue";
import type { SafeManagedBrowserStatus } from "@/entityTypes/managedBrowserTypes";

/**
 * ManagedBrowserHandoffDialog (design §13.2, FR-P0-013): reason copy,
 * countdown to the handoff deadline, and the receipt actions.
 */

function status(
  overrides: Partial<SafeManagedBrowserStatus> = {}
): SafeManagedBrowserStatus {
  return {
    sessionId: "mb_test000000001",
    accountId: 101,
    platformId: 2,
    accountLabel: "My Channel",
    platformLabel: "YouTube",
    state: "handoff",
    currentOrigin: null,
    pageTitle: null,
    pageRevision: 1,
    authenticated: false,
    handoffReason: "login_required",
    handoffExpiresAtEpochMs: Date.now() + 5 * 60_000,
    proxyActive: false,
    lastErrorCode: null,
    ...overrides,
  };
}

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      managedBrowser: {
        unknown_account: "Unknown account",
        handoff: {
          title: "Browser handoff",
          account_line: "You now control the browser window for:",
          time_remaining: "Time remaining for this login window:",
          saved_login_hint: "Log in in the opened browser window.",
          verify_login: "I've finished logging in",
          extend: "Extend time (10 min)",
          cancel_task: "Cancel task",
          reasons: {
            login_required: "The site requires a login to continue.",
            user_requested: "You asked to take over this step.",
          },
        },
      },
    },
  },
});

// Vuetify stubs: v-dialog renders its slot when modelValue is true.
const VDialog = defineComponent({
  props: { modelValue: { type: Boolean, default: false } },
  emits: ["update:modelValue"],
  template: `<div v-if="modelValue"><slot /></div>`,
});
const VCard = { template: "<div><slot /></div>" };
const VCardTitle = { template: "<div><slot /></div>" };
const VCardText = { template: "<div><slot /></div>" };
const VCardActions = { template: "<div><slot /></div>" };
const VBtn = defineComponent({
  props: { disabled: { type: Boolean, default: false } },
  emits: ["click"],
  setup(_, { emit }) {
    const onClick = (): void => emit("click");
    return { onClick };
  },
  template: `<button :disabled="disabled" @click="onClick"><slot /></button>`,
});
const VIcon = { template: "<i><slot /></i>" };
const VSpacer = { template: "<span />" };

function mountDialog(props: { status: SafeManagedBrowserStatus | null }) {
  return mount(ManagedBrowserHandoffDialog, {
    props: { modelValue: true, ...props },
    global: {
      plugins: [i18n],
      stubs: {
        "v-dialog": VDialog,
        "v-card": VCard,
        "v-card-title": VCardTitle,
        "v-card-text": VCardText,
        "v-card-actions": VCardActions,
        "v-btn": VBtn,
        "v-icon": VIcon,
        "v-spacer": VSpacer,
      },
    },
  });
}

describe("ManagedBrowserHandoffDialog", () => {
  it("renders the account, the localized reason, and a countdown", () => {
    const wrapper = mountDialog({ status: status() });
    expect(wrapper.find("[data-testid='mb-handoff-dialog']").exists()).toBe(
      true
    );
    expect(wrapper.text()).toContain("My Channel");
    expect(wrapper.text()).toContain(
      "The site requires a login to continue."
    );
    const countdown = wrapper.find("[data-testid='mb-handoff-countdown']");
    expect(countdown.exists()).toBe(true);
    // 5 minutes out => between 4:xx and 5:00 inclusive.
    expect(countdown.find("strong").text()).toMatch(/^[45]:\d{2}$/);
  });

  it("hides the countdown line when no deadline is known", () => {
    const wrapper = mountDialog({
      status: status({ handoffExpiresAtEpochMs: null }),
    });
    expect(
      wrapper.find("[data-testid='mb-handoff-countdown']").exists()
    ).toBe(false);
  });

  it("emits verify / extend / cancel from the receipt actions", async () => {
    const wrapper = mountDialog({ status: status() });
    await wrapper.find("[data-testid='mb-handoff-verify']").trigger("click");
    await wrapper.find("[data-testid='mb-handoff-extend']").trigger("click");
    await wrapper.find("[data-testid='mb-handoff-cancel']").trigger("click");
    expect(wrapper.emitted("verify")).toHaveLength(1);
    expect(wrapper.emitted("extend")).toHaveLength(1);
    expect(wrapper.emitted("cancel")).toHaveLength(1);
  });

  it("falls back to the unknown-account label without a status", () => {
    const wrapper = mountDialog({ status: null });
    expect(wrapper.text()).toContain("Unknown account");
  });
});
