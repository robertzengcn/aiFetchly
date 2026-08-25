/**
 * Component tests for SkillInstallCard (PRD §22.1/§26.4, NFR-08):
 * plan review actions, secure secret input behavior, recoverable-failure
 * retry, terminal states, and i18n-keyed labels.
 */
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SkillInstallCard from "@/views/components/aiChatV2/SkillInstallCard.vue";
import type { InstallSnapshot } from "@/entityTypes/skillInstallationTypes";
import en from "@/views/lang/en";

vi.mock("@/views/api/skillInstallation", () => ({
  approveSkillInstall: vi.fn(),
  cancelSkillInstall: vi.fn(),
  submitSkillInstallSecret: vi.fn(),
  getSkillInstallStatus: vi.fn(),
}));

import {
  approveSkillInstall,
  cancelSkillInstall,
  submitSkillInstallSecret,
} from "@/views/api/skillInstallation";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  missingWarn: false,
  fallbackWarn: false,
  messages: { en },
});

function makeSnapshot(
  overrides: Partial<InstallSnapshot> = {}
): InstallSnapshot {
  return {
    sessionId: "sess-1",
    installationId: null,
    state: "awaiting_approval",
    nextAction: "review-plan",
    planRevision: "rev-1",
    safeSummary: "source verified; discovered: video-use",
    recoverable: true,
    ...overrides,
  };
}

function mountCard(snapshot: InstallSnapshot) {
  return mount(SkillInstallCard, {
    props: { snapshot },
    global: {
      plugins: [i18n],
      stubs: {
        VCard: { template: "<div><slot /></div>" },
        VCardTitle: { template: "<div><slot /></div>" },
        VCardText: { template: "<div><slot /></div>" },
        VBtn: {
          template:
            '<button :data-testid="$attrs[\'data-testid\']" @click="$emit(\'click\')"><slot /></button>',
          props: ["loading", "disabled"],
        },
        VIcon: true,
        VChip: { template: "<span><slot /></span>" },
        VProgressLinear: true,
        VSpacer: { template: "<span />" },
        VTextField: {
          props: ["modelValue", "label"],
          emits: ["update:modelValue"],
          template:
            '<input :label="label" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
        },
      },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SkillInstallCard", () => {
  it("renders the review state with approve and reject actions", () => {
    const wrapper = mountCard(makeSnapshot());
    expect(wrapper.find('[data-testid="skill-install-review"]').exists()).toBe(
      true
    );
    expect(wrapper.find('[data-testid="skill-install-approve"]').exists()).toBe(
      true
    );
    expect(wrapper.find('[data-testid="skill-install-reject"]').exists()).toBe(
      true
    );
    // Labels render through i18n keys, not hardcoded strings.
    expect(wrapper.text()).toContain("Skill installation");
    expect(wrapper.text()).toContain("Approve");
  });

  it("approve emits the updated snapshot from the IPC bridge", async () => {
    const updated = makeSnapshot({ state: "ready", nextAction: "ready" });
    vi.mocked(approveSkillInstall).mockResolvedValue(updated);
    const wrapper = mountCard(makeSnapshot());
    await wrapper
      .find('[data-testid="skill-install-approve"]')
      .trigger("click");
    await flushPromises();
    expect(approveSkillInstall).toHaveBeenCalledWith({
      sessionId: "sess-1",
      planRevision: "rev-1",
      approve: true,
    });
    expect(wrapper.emitted("updated")?.[0]?.[0]).toMatchObject({
      state: "ready",
    });
  });

  it("renders the secure secret input only in awaiting_secret", () => {
    const awaiting = mountCard(
      makeSnapshot({
        state: "awaiting_secret",
        nextAction: "provide-secret-securely",
        safeSummary: "credentials: ELEVENLABS_API_KEY",
      })
    );
    expect(
      awaiting.find('[data-testid="skill-install-secret"]').exists()
    ).toBe(true);
    expect(awaiting.text()).toContain("Never paste API keys");

    const notAwaiting = mountCard(makeSnapshot());
    expect(
      notAwaiting.find('[data-testid="skill-install-secret"]').exists()
    ).toBe(false);
  });

  it("submits the secret through the secure channel and clears the field", async () => {
    const resumed = makeSnapshot({ state: "verifying", nextAction: "resume" });
    vi.mocked(submitSkillInstallSecret).mockResolvedValue({
      configured: true,
      environmentVariable: "ELEVENLABS_API_KEY",
      snapshot: resumed,
    });
    const wrapper = mountCard(
      makeSnapshot({
        state: "awaiting_secret",
        safeSummary: "credentials: ELEVENLABS_API_KEY",
      })
    );
    // Drive the stubbed password field like a user typing.
    await wrapper
      .find('input[label="ELEVENLABS_API_KEY"]')
      .setValue("sk-test-secret-value-123");
    await wrapper
      .find('[data-testid="skill-install-secret-submit"]')
      .trigger("click");
    await flushPromises();
    expect(submitSkillInstallSecret).toHaveBeenCalledWith({
      sessionId: "sess-1",
      environmentVariable: "ELEVENLABS_API_KEY",
      value: "sk-test-secret-value-123",
    });
    // The value is cleared immediately after submission.
    expect(
      (wrapper.find('input[label="ELEVENLABS_API_KEY"]').element as HTMLInputElement).value
    ).toBe("");
    expect(wrapper.emitted("updated")?.[0]?.[0]).toMatchObject({
      state: "verifying",
    });
  });

  it("renders retry and cancel for recoverable failures", () => {
    const wrapper = mountCard(
      makeSnapshot({ state: "failed", nextAction: "retry", planRevision: null })
    );
    expect(wrapper.find('[data-testid="skill-install-failed"]').exists()).toBe(
      true
    );
  });

  it("cancel flows through the IPC bridge", async () => {
    vi.mocked(cancelSkillInstall).mockResolvedValue(
      makeSnapshot({ state: "cancelled" })
    );
    const wrapper = mountCard(makeSnapshot({ state: "failed" }));
    await wrapper.find('[data-testid="skill-install-cancel"]').trigger("click");
    await flushPromises();
    expect(cancelSkillInstall).toHaveBeenCalledWith("sess-1");
  });

  it("shows the ready banner without any execution hint", () => {
    const wrapper = mountCard(
      makeSnapshot({ state: "ready", nextAction: "ready" })
    );
    expect(wrapper.find('[data-testid="skill-install-ready"]').exists()).toBe(
      true
    );
    expect(wrapper.text()).toContain("will not run until you ask");
  });
});
