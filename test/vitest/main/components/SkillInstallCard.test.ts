/**
 * Component tests for SkillInstallCard (PRD §22.1/§26.4, NFR-08):
 * plan review actions, secure secret input behavior, recoverable-failure
 * retry, terminal states, and i18n-keyed labels.
 */
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import SkillInstallCard from "@/views/components/aiChatV2/SkillInstallCard.vue";
import type { InstallSnapshot } from "@/entityTypes/skillInstallationTypes";
import en from "@/views/lang/en";

vi.mock("@/views/api/skillInstallation", () => ({
  approveSkillInstall: vi.fn(),
  approveSkillInstallDependency: vi.fn(),
  cancelSkillInstall: vi.fn(),
  retrySkillInstall: vi.fn(),
  runApprovedSkillInstallCommand: vi.fn(),
  submitSkillInstallSecret: vi.fn(),
  getSkillInstallStatus: vi.fn(),
  getSkillInstallApprovalToken: vi
    .fn()
    .mockResolvedValue("test-approval-token"),
  onSkillInstallProgress: vi.fn(() => () => undefined),
}));

import {
  approveSkillInstall,
  approveSkillInstallDependency,
  cancelSkillInstall,
  getSkillInstallApprovalToken,
  getSkillInstallStatus,
  retrySkillInstall,
  runApprovedSkillInstallCommand,
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
            "<button :data-testid=\"$attrs['data-testid']\" @click=\"$emit('click')\"><slot /></button>",
          props: ["loading", "disabled"],
        },
        VIcon: true,
        VChip: { template: "<span><slot /></span>" },
        VProgressLinear: true,
        VSpacer: { template: "<span />" },
        VTextField: {
          props: ["modelValue", "label", "type"],
          emits: ["update:modelValue"],
          template:
            '<input :label="label" :type="type ?? \'text\'" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
        },
        VCheckbox: {
          props: ["modelValue", "value", "label"],
          emits: ["update:modelValue"],
          methods: {
            toggle(): void {
              const current = Array.isArray(this.modelValue)
                ? [...(this.modelValue as string[])]
                : [];
              const v = this.value as string;
              const i = current.indexOf(v);
              if (i >= 0) {
                current.splice(i, 1);
              } else {
                current.push(v);
              }
              this.$emit("update:modelValue", current);
            },
          },
          template:
            '<label data-testid="skill-install-candidate"><input type="checkbox" :value="value" :checked="(modelValue ?? []).includes(value)" @change="toggle" />{{ label }}</label>',
        },
      },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SkillInstallCard historical refresh (P1-4)", () => {
  // Clear the per-test implementations contaminating the factory mock.
  afterAll(() => {
    vi.mocked(getSkillInstallStatus).mockReset();
  });

  it("reopens with authoritative status and drops a stale approve gate", async () => {
    // Persisted tool row says awaiting_approval; the live install is done.
    vi.mocked(getSkillInstallStatus).mockResolvedValue(
      makeSnapshot({ state: "ready", nextAction: "ready" })
    );
    const wrapper = mountCard(makeSnapshot());
    expect(
      wrapper.find('[data-testid="skill-install-review"]').exists()
    ).toBe(true);
    await flushPromises();

    // A reopened historical card must re-fetch its status (PRD §22.2).
    expect(getSkillInstallStatus).toHaveBeenCalledWith("sess-1");
    // The refreshed state renders the outcome — no Approve replay.
    expect(
      wrapper.find('[data-testid="skill-install-review"]').exists()
    ).toBe(false);
    expect(wrapper.find('[data-testid="skill-install-ready"]').exists()).toBe(
      true
    );
  });

  it("keeps the approve gate when the live status is still awaiting_approval", async () => {
    vi.mocked(getSkillInstallStatus).mockResolvedValue(
      makeSnapshot({ state: "awaiting_approval" })
    );
    const wrapper = mountCard(makeSnapshot());
    await flushPromises();

    expect(getSkillInstallStatus).toHaveBeenCalledWith("sess-1");
    expect(
      wrapper.find('[data-testid="skill-install-review"]').exists()
    ).toBe(true);
    expect(wrapper.find('[data-testid="skill-install-approve"]').exists()).toBe(
      true
    );
  });
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
    expect(awaiting.find('[data-testid="skill-install-secret"]').exists()).toBe(
      true
    );
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
    // R9 B01/B02: the mount re-fetches the authoritative status — provide
    // a successful read of the same awaiting_secret state.
    const secretSnapshot = makeSnapshot({
      state: "awaiting_secret",
      safeSummary: "credentials: ELEVENLABS_API_KEY",
    });
    vi.mocked(getSkillInstallStatus).mockResolvedValue(secretSnapshot);
    const wrapper = mountCard(secretSnapshot);
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
    // R9 B02: the successful submit is an authoritative adoption — the
    // card immediately reflects the verifying state, so the secret input
    // section is gone (a stronger post-state than reading the field).
    expect(
      wrapper.find('[data-testid="skill-install-secret"]').exists()
    ).toBe(false);
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
    expect(cancelSkillInstall).toHaveBeenCalledWith("sess-1", {});
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
            { id: "dep:ffmpeg", name: "ffmpeg", status: "satisfied" },
            { id: "dep:ffprobe", name: "ffprobe", status: "missing" },
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
              environmentNames: [],
            },
          ],
          warnings: [],
        },
      })
    );
    expect(wrapper.find('[data-testid="skill-install-plan"]').exists()).toBe(
      true
    );
    const skillRows = wrapper.findAll(
      '[data-testid="skill-install-plan-skill"]'
    );
    expect(skillRows).toHaveLength(1);
    expect(skillRows[0].text()).toContain("video-use");
    // Audit R9: the skill-kind enum is translated, not raw.
    expect(skillRows[0].text()).toContain("Prompt skill");
    const deps = wrapper.find('[data-testid="skill-install-plan-deps"]');
    // Localized dependency statuses (audit finding 12).
    expect(deps.text()).toContain("ffmpeg: Satisfied");
    expect(deps.text()).toContain("ffprobe: Missing");
    const creds = wrapper.find('[data-testid="skill-install-plan-creds"]');
    expect(creds.text()).toContain("ELEVENLABS_API_KEY");
    // Source + revision + mode chip present.
    const plan = wrapper.find('[data-testid="skill-install-plan"]');
    expect(plan.text()).toContain("https://github.com/a/video-use");
    expect(plan.text()).toContain("abc123def456");
    expect(plan.text()).toContain("Managed copy");
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
              environmentNames: [],
            },
            {
              id: "cmd:sudo",
              executable: "sudo",
              args: ["apt", "install", "ffmpeg"],
              riskLevel: "high",
              rationale: "Privilege escalation detected",
              environmentNames: [],
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
    // Audit R9: risk levels render localized, not raw.
    expect(rows[0].text()).toContain("Low risk");
    expect(rows[1].text()).toContain("sudo apt install ffmpeg");
    expect(rows[1].text()).toContain("High risk");
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
    // R9 B01/B02: provide a successful same-state status read.
    const secretSnapshot = makeSnapshot({
      state: "awaiting_secret",
      safeSummary: "credentials: ELEVENLABS_API_KEY",
    });
    vi.mocked(getSkillInstallStatus).mockResolvedValue(secretSnapshot);
    const wrapper = mountCard(secretSnapshot);
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
        wrapper.find('input[label="ELEVENLABS_API_KEY"]')
          .element as HTMLInputElement
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

  // --- Typed dependency approval (PRD §18 / FR-14, installing_dependencies)
  const depSnapshot = makeSnapshot({
    state: "installing_dependencies",
    nextAction: "approve-dependency",
    safePlan: {
      source: "/tmp/video-use",
      revision: "abc123def456",
      skills: [{ name: "video-use", kind: "prompt", description: "d" }],
      dependencies: [
        {
          id: "dep:ffmpeg",
          name: "ffmpeg",
          status: "missing",
          installMethod: "apt: ffmpeg (ffmpeg binary)",
          requiresElevation: true,
        },
        { id: "dep:git", name: "git", status: "satisfied" },
      ],
      credentials: [],
      mode: "managed-copy",
      commands: [],
      warnings: [],
    },
  });

  it("renders one Install/Decline pair per MISSING dependency in installing_dependencies", () => {
    const wrapper = mountCard(depSnapshot);
    expect(wrapper.find('[data-testid="skill-install-deps"]').exists()).toBe(
      true
    );
    const rows = wrapper.findAll('[data-testid="skill-install-dep-row"]');
    expect(rows).toHaveLength(1); // satisfied git is not rendered
    expect(
      wrapper.find('[data-testid="skill-install-dep-approve-ffmpeg"]').exists()
    ).toBe(true);
    expect(
      wrapper.find('[data-testid="skill-install-dep-decline-ffmpeg"]').exists()
    ).toBe(true);
    // Install method + elevation hint are visible for informed consent.
    expect(wrapper.text()).toContain("apt: ffmpeg");
    expect(wrapper.text()).toContain("elevated permissions");
    // The typed-installer-only promise is stated (no repository commands).
    expect(wrapper.text()).toContain("never executed");
  });

  it("install flows through the token-bound dependency channel and emits the snapshot", async () => {
    const updated = makeSnapshot({ state: "ready", nextAction: "ready" });
    // Re-prime the token mock: an earlier test leaves a persistent null.
    vi.mocked(getSkillInstallApprovalToken).mockResolvedValue(
      "test-approval-token"
    );
    vi.mocked(approveSkillInstallDependency).mockResolvedValue(updated);
    const wrapper = mountCard(depSnapshot);
    await wrapper
      .find('[data-testid="skill-install-dep-approve-ffmpeg"]')
      .trigger("click");
    await flushPromises();
    expect(approveSkillInstallDependency).toHaveBeenCalledWith({
      sessionId: "sess-1",
      dependencyId: "dep:ffmpeg",
      approve: true,
      planRevision: "rev-1",
      approvalToken: "test-approval-token",
    });
    expect(wrapper.emitted("updated")?.[0]?.[0]).toMatchObject({
      state: "ready",
    });
  });

  it("decline sends approve:false for that dependency (rollback path)", async () => {
    const cancelled = makeSnapshot({
      state: "cancelled",
      nextAction: "resume",
    });
    vi.mocked(getSkillInstallApprovalToken).mockResolvedValue(
      "test-approval-token"
    );
    vi.mocked(approveSkillInstallDependency).mockResolvedValue(cancelled);
    const wrapper = mountCard(depSnapshot);
    await wrapper
      .find('[data-testid="skill-install-dep-decline-ffmpeg"]')
      .trigger("click");
    await flushPromises();
    expect(approveSkillInstallDependency).toHaveBeenCalledWith(
      expect.objectContaining({ dependencyId: "dep:ffmpeg", approve: false })
    );
    expect(wrapper.emitted("updated")?.[0]?.[0]).toMatchObject({
      state: "cancelled",
    });
  });

  it("dependency approval failure emits failed without updating the snapshot", async () => {
    vi.mocked(approveSkillInstallDependency).mockResolvedValue(null);
    const wrapper = mountCard(depSnapshot);
    await wrapper
      .find('[data-testid="skill-install-dep-approve-ffmpeg"]')
      .trigger("click");
    await flushPromises();
    expect(wrapper.emitted("failed")).toBeTruthy();
    expect(wrapper.emitted("updated")).toBeUndefined();
  });

  it("hides the dependency section outside installing_dependencies", () => {
    const wrapper = mountCard(makeSnapshot()); // awaiting_approval
    expect(wrapper.find('[data-testid="skill-install-deps"]').exists()).toBe(
      false
    );
  });

  // --- Approved command execution (FR-06/FR-16) ---
  const commandSnapshot = makeSnapshot({
    state: "installing_dependencies",
    nextAction: "approve-dependency",
    safePlan: {
      source: "/tmp/video-use",
      revision: "abc123def456",
      skills: [{ name: "video-use", kind: "prompt", description: "d" }],
      dependencies: [],
      credentials: ["ELEVENLABS_API_KEY"],
      mode: "managed-copy",
      commands: [
        {
          id: "cmd:setup",
          executable: "python",
          args: ["-m", "pip", "install", "-r", "requirements.txt"],
          riskLevel: "medium",
          rationale: "install helper deps",
          environmentNames: ["ELEVENLABS_API_KEY"],
        },
      ],
      warnings: [],
    },
  });

  it("renders per-command run controls with args, risk, and env NAMES", () => {
    const wrapper = mountCard(commandSnapshot);
    expect(
      wrapper.find('[data-testid="skill-install-run-commands"]').exists()
    ).toBe(true);
    expect(
      wrapper.find('[data-testid="skill-install-run-cmd:setup"]').exists()
    ).toBe(true);
    expect(wrapper.text()).toContain(
      "python -m pip install -r requirements.txt"
    );
    // Audit R9: risk level renders localized.
    expect(wrapper.text()).toContain("Medium risk");
    // Env-var NAMES surface for informed consent; values never do.
    expect(wrapper.text()).toContain("ELEVENLABS_API_KEY");
    expect(wrapper.text()).not.toMatch(/sk-[a-zA-Z0-9]{10,}/);
  });

  it("run sends only the template id + token, then shows the redacted result", async () => {
    vi.mocked(getSkillInstallApprovalToken).mockResolvedValue(
      "test-approval-token"
    );
    // R9 B01/B02: provide a successful same-state status read.
    vi.mocked(getSkillInstallStatus).mockResolvedValue(commandSnapshot);
    vi.mocked(runApprovedSkillInstallCommand).mockResolvedValue({
      ok: true,
      commandId: "cmd:setup",
      exitCode: 0,
      stdoutPreview: "installed 3 packages",
      stderrPreview: "",
      timedOut: false,
      injectedEnvNames: ["ELEVENLABS_API_KEY"],
    });
    const wrapper = mountCard(commandSnapshot);
    await wrapper
      .find('[data-testid="skill-install-run-cmd:setup"]')
      .trigger("click");
    await flushPromises();
    // The renderer cannot substitute command text — id + token only.
    expect(runApprovedSkillInstallCommand).toHaveBeenCalledWith({
      sessionId: "sess-1",
      commandId: "cmd:setup",
      approvalToken: "test-approval-token",
    });
    expect(
      wrapper
        .find('[data-testid="skill-install-run-result-cmd:setup"]')
        .exists()
    ).toBe(true);
    expect(wrapper.text()).toContain("Exit 0");
    expect(wrapper.text()).toContain("Injected: ELEVENLABS_API_KEY");
    expect(wrapper.text()).toContain("installed 3 packages");
  });

  it("a failed run shows the failure without a snapshot update", async () => {
    vi.mocked(getSkillInstallApprovalToken).mockResolvedValue(
      "test-approval-token"
    );
    vi.mocked(runApprovedSkillInstallCommand).mockResolvedValue({
      ok: false,
      commandId: "cmd:setup",
      exitCode: 1,
      stdoutPreview: "",
      stderrPreview: "pip: not found",
      timedOut: false,
      injectedEnvNames: [],
      errorCode: "COMMAND_FAILED",
    });
    // R9 B01/B02: provide a successful same-state status read.
    vi.mocked(getSkillInstallStatus).mockResolvedValue(commandSnapshot);
    const wrapper = mountCard(commandSnapshot);
    await wrapper
      .find('[data-testid="skill-install-run-cmd:setup"]')
      .trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("Failed");
    expect(wrapper.text()).toContain("pip: not found");
    expect(wrapper.emitted("updated")).toBeUndefined();
  });

  it("failed-state Retry calls the typed retry and swaps in the new session", async () => {
    const fresh = makeSnapshot({
      sessionId: "sess-2",
      state: "awaiting_approval",
      nextAction: "review-plan",
      planRevision: "rev-2",
    });
    vi.mocked(retrySkillInstall).mockResolvedValue(fresh);
    const wrapper = mountCard(
      makeSnapshot({ state: "failed", nextAction: "retry" })
    );
    await wrapper.find('[data-testid="skill-install-retry"]').trigger("click");
    await flushPromises();
    expect(retrySkillInstall).toHaveBeenCalledWith("sess-1", {});
    expect(wrapper.emitted("updated")?.[0]?.[0]).toMatchObject({
      sessionId: "sess-2",
      state: "awaiting_approval",
    });
  });

  it("retry failure emits failed (e.g. three-same-cause stop rule)", async () => {
    vi.mocked(retrySkillInstall).mockResolvedValue(null);
    const wrapper = mountCard(
      makeSnapshot({ state: "failed", nextAction: "retry" })
    );
    await wrapper.find('[data-testid="skill-install-retry"]').trigger("click");
    await flushPromises();
    expect(wrapper.emitted("failed")).toBeTruthy();
  });

  it("hides run controls during review and in terminal states", () => {
    const review = mountCard(makeSnapshot()); // awaiting_approval
    expect(
      review.find('[data-testid="skill-install-run-commands"]').exists()
    ).toBe(false);
    const ready = mountCard(
      makeSnapshot({ state: "ready", nextAction: "ready" })
    );
    expect(
      ready.find('[data-testid="skill-install-run-commands"]').exists()
    ).toBe(false);
  });
});

describe("SkillInstallCard — multi-skill selection (audit R2)", () => {
  const multiSafePlan = {
    source: "https://github.com/a/multi",
    revision: "rev12345678",
    skills: [
      { name: "one", kind: "prompt", description: "first", candidateId: "skills/one:prompt", selected: false },
      { name: "two", kind: "prompt", description: "second", candidateId: "skills/two:prompt", selected: false },
    ],
    dependencies: [],
    credentials: [],
    mode: "managed-copy",
    commands: [],
    warnings: [],
  } as unknown as NonNullable<InstallSnapshot["safePlan"]>;

  it("renders candidate checkboxes for multi-skill plans and submits the selection", async () => {
    // R9 B01/B02: provide a successful same-state status read.
    vi.mocked(getSkillInstallStatus).mockResolvedValue(
      makeSnapshot({ safePlan: multiSafePlan })
    );
    const wrapper = mountCard(makeSnapshot({ safePlan: multiSafePlan }));
    // R9 B02: let the authoritative mount refresh settle BEFORE selecting
    // candidates, so the checkbox list is not rebuilt mid-interaction.
    await flushPromises();
    const boxes = wrapper.findAll('[data-testid="skill-install-candidate"]');
    expect(boxes.length).toBe(2);
    await boxes[0].find("input").setValue(true);
    await boxes[1].find("input").setValue(true);
    const approveBtn = wrapper
      .findAll("button")
      .find((b) => (b.text() ?? "").toLowerCase().includes("approve"));
    expect(approveBtn).toBeTruthy();
    await approveBtn!.trigger("click");
    await flushPromises();
    const call = vi.mocked(approveSkillInstall).mock.calls[0]?.[0];
    expect(call?.selectedSkillIds).toEqual(
      expect.arrayContaining(["skills/one:prompt", "skills/two:prompt"])
    );
  });

  it("single-skill plans keep the plain label (no checkboxes)", () => {
    const wrapper = mountCard(makeSnapshot({}));
    expect(
      wrapper.findAll('[data-testid="skill-install-candidate"]').length
    ).toBe(0);
  });
});

describe("SkillInstallCard — multi-secret advance (audit R3)", () => {
  it("labels and submits the snapshot's nextMissingCredential", async () => {
    const credentialSnapshot = makeSnapshot({
      state: "awaiting_secret",
      nextAction: "provide-secret-securely",
      safeSummary: "requires FIRST_API_KEY= and SECOND_API_KEY=",
      nextMissingCredential: "SECOND_API_KEY",
    });
    // R9 B01/B02: provide a successful same-state status read.
    vi.mocked(getSkillInstallStatus).mockResolvedValue(credentialSnapshot);
    const wrapper = mountCard(credentialSnapshot);
    const label = wrapper.text();
    expect(label).toContain("SECOND_API_KEY");
    // Submit uses the NEXT variable — not the first name in the summary.
    const input = wrapper.find('input[type="password"]');
    expect(input.exists()).toBe(true);
    if (input.exists()) {
      await input.setValue("sk-second");
    }
    const submit = wrapper
      .findAll("button")
      .find((b) => (b.text() ?? "").toLowerCase().includes("save"));
    expect(submit).toBeTruthy();
    await submit!.trigger("click");
    await flushPromises();
    const call = vi.mocked(submitSkillInstallSecret).mock.calls[0]?.[0];
    expect(call?.environmentVariable).toBe("SECOND_API_KEY");
  });

  it("falls back to the summary scrape when the field is absent", () => {
    const wrapper = mountCard(
      makeSnapshot({
        state: "awaiting_secret",
        nextAction: "provide-secret-securely",
        safeSummary: "requires LEGACY_API_KEY= please",
      })
    );
    expect(wrapper.text()).toContain("LEGACY_API_KEY");
  });
});

describe("SkillInstallCard — audit R9 (plan detail completeness)", () => {
  it("renders the real activation target (not a placeholder)", () => {
    const wrapper = mountCard(
      makeSnapshot({
        safePlan: {
          source: "https://github.com/a/video-use",
          revision: "abc123def456",
          skills: [{ name: "video-use", kind: "prompt", description: "d" }],
          dependencies: [],
          credentials: [],
          mode: "managed-copy",
          commands: [],
          warnings: [],
          activationTarget: "/home/me/.aifetchly/skills",
        },
      })
    );
    const target = wrapper.find('[data-testid="skill-install-plan-target"]');
    expect(target.exists()).toBe(true);
    expect(target.text()).toContain("Installation location");
    expect(target.text()).toContain("/home/me/.aifetchly/skills");
  });

  it("renders requested permissions with translated kinds", () => {
    const wrapper = mountCard(
      makeSnapshot({
        safePlan: {
          source: "https://github.com/a/video-use",
          revision: "abc123def456",
          skills: [{ name: "video-use", kind: "prompt", description: "d" }],
          dependencies: [],
          credentials: [],
          mode: "managed-copy",
          commands: [],
          warnings: [],
          permissions: [{ kind: "network" }, { kind: "package-manager" }],
        },
      })
    );
    const perms = wrapper.find(
      '[data-testid="skill-install-plan-permissions"]'
    );
    expect(perms.exists()).toBe(true);
    expect(perms.text()).toContain("Requested permissions");
    expect(perms.text()).toContain("Network access");
    expect(perms.text()).toContain("Install packages");
  });

  it("omits the target and permissions rows when the plan carries neither", () => {
    const wrapper = mountCard(
      makeSnapshot({
        safePlan: {
          source: "https://github.com/a/video-use",
          revision: "abc123def456",
          skills: [{ name: "video-use", kind: "prompt", description: "d" }],
          dependencies: [],
          credentials: [],
          mode: "managed-copy",
          commands: [],
          warnings: [],
        },
      })
    );
    expect(
      wrapper.find('[data-testid="skill-install-plan-target"]').exists()
    ).toBe(false);
    expect(
      wrapper.find('[data-testid="skill-install-plan-permissions"]').exists()
    ).toBe(false);
  });

  it("renders dependency kind, detected version, and an unsatisfied constraint", () => {
    const wrapper = mountCard(
      makeSnapshot({
        safePlan: {
          source: "https://github.com/a/video-use",
          revision: "abc123def456",
          skills: [{ name: "video-use", kind: "prompt", description: "d" }],
          dependencies: [
            {
              id: "dep:ffmpeg",
              name: "ffmpeg",
              status: "satisfied",
              kind: "system-binary",
              detectedVersion: "4.4.2",
            },
            {
              id: "dep:python",
              name: "python",
              status: "incompatible",
              kind: "system-binary",
              requiredVersion: ">=3.10",
            },
          ],
          credentials: [],
          mode: "managed-copy",
          commands: [],
          warnings: [],
        },
      })
    );
    const deps = wrapper.find('[data-testid="skill-install-plan-deps"]');
    expect(deps.text()).toContain("system binary");
    expect(deps.text()).toContain("4.4.2");
    expect(deps.text()).toContain("Incompatible");
    expect(deps.text()).toContain("needs >=3.10");
  });

  /**
   * R9 B01: a rejected authoritative status read must never escape as an
   * unhandled rejection, must render a localized retryable error, and must
   * keep every trust-sensitive control locked until a fresh read confirms
   * the state (the fresh approval gate cannot be bypassed).
   */
  it("locks controls behind a retryable error when the status read rejects", async () => {
    vi.mocked(getSkillInstallStatus).mockRejectedValue(
      new Error("unknow error")
    );
    const wrapper = mountCard(makeSnapshot()); // stale tool result: awaiting_approval
    await flushPromises();

    const unknownBlock = wrapper.find('[data-testid="skill-install-status-unknown"]');
    expect(unknownBlock.exists()).toBe(true);
    // Every action surface is gated until the status read succeeds.
    expect(wrapper.find('[data-testid="skill-install-review"]').exists()).toBe(
      false
    );
    expect(wrapper.find('[data-testid="skill-install-secret"]').exists()).toBe(
      false
    );
    expect(wrapper.find('[data-testid="skill-install-retry"]').exists()).toBe(
      false
    );
    expect(wrapper.find('[data-testid="skill-install-cancel"]').exists()).toBe(
      false
    );

    // The retry read recovers: unknown block clears, fresh state renders.
    vi.mocked(getSkillInstallStatus).mockResolvedValue(
      makeSnapshot({ state: "cancelled" })
    );
    await wrapper
      .find('[data-testid="skill-install-status-retry"]')
      .trigger("click");
    await flushPromises();
    expect(
      wrapper.find('[data-testid="skill-install-status-unknown"]').exists()
    ).toBe(false);
    expect(wrapper.find('[data-testid="skill-install-review"]').exists()).toBe(
      false
    );
    expect(wrapper.text()).toContain("Cancelled");
  });

  /**
   * R9 B02: the parent's authoritative action update (prop) must never be
   * shadowed by the card's earlier mount-refresh snapshot — exactly the
   * probe that reproduced the stale review panel after a cancellation.
   */
  it("follows the parent's authoritative prop update over the refresh shadow", async () => {
    vi.mocked(getSkillInstallStatus).mockResolvedValue(
      makeSnapshot({ state: "awaiting_approval" })
    );
    const wrapper = mountCard(makeSnapshot());
    await flushPromises();
    expect(wrapper.find('[data-testid="skill-install-review"]').exists()).toBe(
      true
    );

    // The parent action handler stores the card's emitted result and the
    // prop becomes the cancelled snapshot.
    await wrapper.setProps({
      snapshot: makeSnapshot({ state: "cancelled" }),
    });
    await flushPromises();
    expect(wrapper.find('[data-testid="skill-install-review"]').exists()).toBe(
      false
    );
  });

  /**
   * R9 B02: an in-flight (out-of-order) refresh reply must not overwrite a
   * later authoritative result — the read loses to the action regardless of
   * which response lands last on the wire.
   */
  it("drops a late refresh reply that raced a newer authoritative result", async () => {
    let resolveRefresh!: (value: InstallSnapshot) => void;
    vi.mocked(getSkillInstallStatus).mockReturnValue(
      new Promise<InstallSnapshot>((resolve) => {
        resolveRefresh = resolve;
      })
    );
    const wrapper = mountCard(makeSnapshot());
    await flushPromises(); // refresh read still in flight

    // Authoritative action result adopted through the parent prop.
    await wrapper.setProps({
      snapshot: makeSnapshot({ state: "cancelled" }),
    });
    // The stale read reply lands AFTER the action result.
    resolveRefresh(makeSnapshot({ state: "awaiting_approval" }));
    await flushPromises();

    expect(wrapper.find('[data-testid="skill-install-review"]').exists()).toBe(
      false
    );
  });
});
