import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P04/Q-01: the ONE-TIME opt-in prompt is genuinely one-time — a confirm
 * submits the WHOLE reviewed cohort (unselected accounts are stored opted
 * OUT, never re-asked), a Decline submits every pending id, a failed
 * submit keeps the prompt OPEN with a retriable error (no silent partial
 * apply + close), and a large cohort fits the IPC bound.
 */

const apiMocks = vi.hoisted(() => ({
  getAiOptInPendingAccounts: vi.fn(
    async (): Promise<
      ReadonlyArray<{ id: number; user: string; name: string | null }>
    > => []
  ),
  submitAiOptInDecisions: vi.fn(
    async (
      _decisions?: ReadonlyArray<{ id: number; enabled: boolean }>
    ): Promise<{ ok: boolean; failedIds?: number[] }> => ({ ok: true })
  ),
}));
vi.mock("@/views/api/socialaccount", () => apiMocks);

import AiOptInPromptDialog from "@/views/pages/socialaccount/AiOptInPromptDialog.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      socialaccount: {
        ai_optin_prompt_title: "AI use for saved accounts",
        ai_optin_prompt_body: "Choose.",
        ai_optin_decline: "Keep all off",
        ai_optin_confirm: "Opt in selected",
        ai_optin_submit_failed:
          "Some accounts could not be saved. Retry — the prompt stays open until every choice is stored.",
      },
    },
  },
});

function makeCohort(count: number): Array<{
  id: number;
  user: string;
  name: string | null;
}> {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    user: `user${i + 1}`,
    name: null,
  }));
}

function mountDialog() {
  return mount(AiOptInPromptDialog, {
    global: {
      plugins: [i18n],
      stubs: {
        // Vuetify is not installed in the component suite; the checkbox
        // stub emulates Vuetify's ARRAY model semantics (toggle by value).
        "v-dialog": { template: "<div data-stub='dialog'><slot /></div>", props: ["modelValue"] },
        "v-card": { template: "<div><slot /></div>" },
        "v-card-title": { template: "<div><slot /></div>" },
        "v-card-text": { template: "<div><slot /></div>" },
        "v-card-actions": { template: "<div><slot /></div>" },
        "v-spacer": { template: "<span />" },
        "v-btn": {
          // emits declared: the parent's @click binds to the CUSTOM event
          // only — without this the native click fallthrough fired the
          // handler twice.
          emits: ["click"],
          template: "<button @click=\"$emit('click', $event)\"><slot /></button>",
        },
        "v-alert": { template: "<div data-stub='alert'><slot /></div>", props: ["type"] },
        "v-checkbox": {
          props: ["modelValue", "value"],
          emits: ["update:model-value"],
          template:
            "<input type='checkbox' :checked=\"Array.isArray(modelValue) ? modelValue.includes(value) : modelValue\" @change=\"$emit('update:model-value', Array.isArray(modelValue) ? (modelValue.includes(value) ? modelValue.filter(v => v !== value) : [...modelValue, value]) : $event.target.checked)\" />",
        },
      },
    },
  });
}

describe("AiOptInPromptDialog one-time semantics (P04/Q-01)", () => {
  beforeEach(() => {
    apiMocks.getAiOptInPendingAccounts.mockClear();
    apiMocks.submitAiOptInDecisions.mockClear();
    apiMocks.getAiOptInPendingAccounts.mockResolvedValue([]);
    apiMocks.submitAiOptInDecisions.mockResolvedValue({ ok: true });
  });

  it("a confirm submits the WHOLE reviewed cohort (unselected stored opted-out)", async () => {
    apiMocks.getAiOptInPendingAccounts.mockResolvedValue(makeCohort(3));
    const wrapper = mountDialog();
    await flushPromises();
    // The dialog opened with the three pending accounts.
    expect(
      wrapper.find("[data-testid='ai-optin-prompt-dialog']").exists()
    ).toBe(true);
    // The user opts in ONLY account 2 and confirms.
    // The checkbox stub's root IS the input (data-testid falls through).
    await wrapper.find("[data-testid='ai-optin-account-2']").setValue(true);
    await wrapper.find("[data-testid='ai-optin-confirm']").trigger("click");
    await flushPromises();
    expect(apiMocks.submitAiOptInDecisions).toHaveBeenCalledTimes(1);
    const decisions = apiMocks.submitAiOptInDecisions.mock.calls[0]?.[0];
    expect(decisions).toEqual([
      { id: 1, enabled: false },
      { id: 2, enabled: true },
      { id: 3, enabled: false },
    ]);
  });

  it("a Decline submits EVERY pending id as opted-out", async () => {
    apiMocks.getAiOptInPendingAccounts.mockResolvedValue(makeCohort(3));
    const wrapper = mountDialog();
    await flushPromises();
    await wrapper.find("[data-testid='ai-optin-decline']").trigger("click");
    await flushPromises();
    const decisions = apiMocks.submitAiOptInDecisions.mock.calls[0]?.[0];
    expect(decisions).toEqual([
      { id: 1, enabled: false },
      { id: 2, enabled: false },
      { id: 3, enabled: false },
    ]);
  });

  it("a large cohort (300 accounts) submits in one call without tripping the bound", async () => {
    apiMocks.getAiOptInPendingAccounts.mockResolvedValue(makeCohort(300));
    const wrapper = mountDialog();
    await flushPromises();
    await wrapper.find("[data-testid='ai-optin-decline']").trigger("click");
    await flushPromises();
    const decisions = apiMocks.submitAiOptInDecisions.mock.calls[0]?.[0] as Array<{
      id: number;
      enabled: boolean;
    }>;
    expect(decisions).toHaveLength(300);
  });

  it("a FAILED submit keeps the prompt open with a retriable error", async () => {
    apiMocks.getAiOptInPendingAccounts.mockResolvedValue(makeCohort(2));
    apiMocks.submitAiOptInDecisions.mockResolvedValue({
      ok: false,
      failedIds: [1, 2],
    });
    const wrapper = mountDialog();
    await flushPromises();
    await wrapper.find("[data-testid='ai-optin-decline']").trigger("click");
    await flushPromises();
    // The dialog STAYS open with the error — no silent close.
    expect(
      wrapper.find("[data-testid='ai-optin-submit-error']").exists()
    ).toBe(true);
    expect(apiMocks.submitAiOptInDecisions).toHaveBeenCalledTimes(1);
    expect(
      wrapper.find("[data-testid='ai-optin-submit-error']").exists()
    ).toBe(true);
    // The pending set narrowed to the FAILED ids for the retry.
    const retry = await wrapper
      .find("[data-testid='ai-optin-decline']")
      .trigger("click");
    void retry;
    await flushPromises();
    const secondCall = apiMocks.submitAiOptInDecisions.mock.calls[1]?.[0];
    expect(secondCall).toEqual([
      { id: 1, enabled: false },
      { id: 2, enabled: false },
    ]);
  });

  it("a thrown submit keeps the prompt open and a retry succeeds", async () => {
    apiMocks.getAiOptInPendingAccounts.mockResolvedValue(makeCohort(1));
    apiMocks.submitAiOptInDecisions.mockRejectedValueOnce(
      new Error("ipc down")
    );
    const wrapper = mountDialog();
    await flushPromises();
    await wrapper.find("[data-testid='ai-optin-decline']").trigger("click");
    await flushPromises();
    expect(
      wrapper.find("[data-testid='ai-optin-submit-error']").exists()
    ).toBe(true);
    apiMocks.submitAiOptInDecisions.mockResolvedValue({ ok: true });
    await wrapper.find("[data-testid='ai-optin-decline']").trigger("click");
    await flushPromises();
    // The retry succeeded — the error cleared and the prompt dismissed
    // (visible=false unmounts nothing in the stub, but the error is gone
    // and no further submissions happen).
    expect(
      wrapper.find("[data-testid='ai-optin-submit-error']").exists()
    ).toBe(false);
    expect(apiMocks.submitAiOptInDecisions).toHaveBeenCalledTimes(2);
  });
});
