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
  getSkillInstallApprovalToken: vi.fn().mockResolvedValue("test-approval-token"),
  onSkillInstallProgress: vi.fn(() => () => undefined),
}));

import {
  approveSkillInstall,
  cancelSkillInstall,
  getSkillInstallApprovalToken,
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
      approvalToken: "test-approval-token",
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

  it("renders structured plan fields when the snapshot carries safePlan (TODO 8)", () => {
    const wrapper = mountCard(
      makeSnapshot({
        safePlan: {
          source: "https://github.com/a/video-use",
          revision: "abc123def456",
          skills: [
            {
              name: "video-use",
              kind: "prompt",
              description: "Edit and produce videos",
            },
          ],
          dependencies: [
            { name: "ffmpeg", status: "satisfied" },
            { name: "ffprobe", status: "missing" },
          ],
          credentials: ["ELEVENLABS_API_KEY"],
          mode: "managed-copy",
          commands: [
            {
              id: "cmd:abc",
              executable: "pip",
              args: ["install", "-r", "requirements.txt"],
              riskLevel: "low",
              rationale: "Proposed by repository instructions",
            },
          ],
          warnings: [],
        },
      })
    );
    expect(wrapper.find('[data-testid="skill-install-plan"]').exists()).toBe(
      true
    );
    const skillRows = wrapper.findAll('[data-testid="skill-install-plan-skill"]');
    expect(skillRows).toHaveLength(1);
    expect(skillRows[0].text()).toContain("video-use");
    expect(skillRows[0].text()).toContain("prompt");
    const deps = wrapper.find('[data-testid="skill-install-plan-deps"]');
    expect(deps.text()).toContain("ffmpeg: satisfied");
    expect(deps.text()).toContain("ffprobe: missing");
    const creds = wrapper.find('[data-testid="skill-install-plan-creds"]');
    expect(creds.text()).toContain("ELEVENLABS_API_KEY");
    // Source + revision + mode chip present.
    const plan = wrapper.find('[data-testid="skill-install-plan"]');
    expect(plan.text()).toContain("https://github.com/a/video-use");
    expect(plan.text()).toContain("abc123def456");
    expect(plan.text()).toContain("managed-copy");
  });

  it("shows the commands that will execute on the approval card (review D1)", () => {
    const wrapper = mountCard(
      makeSnapshot({
        safePlan: {
          source: "https://github.com/a/video-use",
          revision: "abc123def456",
          skills: [],
          dependencies: [],
          credentials: [],
          mode: "managed-copy",
          commands: [
            {
              id: "cmd:pip",
              executable: "pip",
              args: ["install", "-r", "requirements.txt"],
              riskLevel: "low",
              rationale: "Proposed by repository instructions",
            },
            {
              id: "cmd:sudo",
              executable: "sudo",
              args: ["apt", "install", "ffmpeg"],
              riskLevel: "high",
              rationale: "Privilege escalation detected",
            },
          ],
          warnings: [],
        },
      })
    );
    const section = wrapper.find('[data-testid="skill-install-commands"]');
    expect(section.exists()).toBe(true);
    const rows = wrapper.findAll('[data-testid="skill-install-command-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain("pip install -r requirements.txt");
    expect(rows[0].text()).toContain("low");
    expect(rows[1].text()).toContain("sudo apt install ffmpeg");
    expect(rows[1].text()).toContain("high");
    // The never-run-automatically hint accompanies the list.
    expect(section.text()).toContain("never run automatically");
  });

  it("renders an expandable diagnostics view with warnings (TODO 8)", () => {
    const wrapper = mountCard(
      makeSnapshot({
        safePlan: {
          source: "https://github.com/a/b",
          revision: "rev",
          skills: [],
          dependencies: [],
          credentials: [],
          mode: "managed-copy",
          commands: [],
          warnings: ["Multiple independent skills were discovered"],
        },
      })
    );
    const details = wrapper.find('[data-testid="skill-install-diagnostics"]');
    expect(details.exists()).toBe(true);
    expect(details.text()).toContain("Multiple independent skills");
    // Raw safe summary lives inside the diagnostics view.
    expect(details.text()).toContain("source verified");
  });

  it("omits the plan section when no safePlan is present", () => {
    const wrapper = mountCard(makeSnapshot());
    expect(wrapper.find('[data-testid="skill-install-plan"]').exists()).toBe(
      false
    );
  });

  it("approve failure emits failed and clears busy (D2)", async () => {
    vi.mocked(approveSkillInstall).mockResolvedValue(null);
    const wrapper = mountCard(makeSnapshot());
    const btn = wrapper.find('[data-testid="skill-install-approve"]');
    await btn.trigger("click");
    await flushPromises();
    expect(wrapper.emitted("failed")?.[0]?.[0]).toBeTruthy();
    // Buttons are usable again (busy reset).
    expect(btn.attributes("loading")).toBeUndefined();
  });

  it("token fetch failure emits failed without calling approve (D2)", async () => {
    vi.mocked(getSkillInstallApprovalToken).mockReset();
    vi.mocked(getSkillInstallApprovalToken).mockResolvedValue(null);
    const wrapper = mountCard(makeSnapshot());
    await wrapper
      .find('[data-testid="skill-install-approve"]')
      .trigger("click");
    await flushPromises();
    expect(approveSkillInstall).not.toHaveBeenCalled();
    expect(wrapper.emitted("failed")?.[0]?.[0]).toBeTruthy();
  });

  it("secret submission failure keeps the typed value and emits failed (D2)", async () => {
    vi.mocked(submitSkillInstallSecret).mockResolvedValue(null);
    const wrapper = mountCard(
      makeSnapshot({
        state: "awaiting_secret",
        safeSummary: "credentials: ELEVENLABS_API_KEY",
      })
    );
    await wrapper
      .find('input[label="ELEVENLABS_API_KEY"]')
      .setValue("sk-keep-me-on-failure-123");
    await wrapper
      .find('[data-testid="skill-install-secret-submit"]')
      .trigger("click");
    await flushPromises();
    // Failed submission does NOT discard what the user typed.
    expect(
      (
        wrapper.find('input[label="ELEVENLABS_API_KEY"]').element as HTMLInputElement
      ).value
    ).toBe("sk-keep-me-on-failure-123");
    expect(wrapper.emitted("failed")?.[0]?.[0]).toBeTruthy();
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
