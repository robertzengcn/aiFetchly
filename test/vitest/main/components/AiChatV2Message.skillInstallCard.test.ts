/**
 * Component tests for the AiChatV2Message ↔ SkillInstallCard hookup
 * (PRD §22.1): installer tool results render the install card, other tool
 * results do not, and in-card actions update the local snapshot view.
 */
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AiChatV2Message from "@/views/components/aiChatV2/AiChatV2Message.vue";
import SkillInstallCard from "@/views/components/aiChatV2/SkillInstallCard.vue";
import en from "@/views/lang/en";
import { MessageType } from "@/entityTypes/commonType";
import type { InstallSnapshot } from "@/entityTypes/skillInstallationTypes";

vi.mock("@/views/api/skillInstallation", () => ({
  approveSkillInstall: vi.fn(),
  cancelSkillInstall: vi.fn(),
  submitSkillInstallSecret: vi.fn(),
  getSkillInstallStatus: vi.fn(),
}));

import { approveSkillInstall } from "@/views/api/skillInstallation";

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
    sessionId: "sess-9",
    installationId: null,
    state: "awaiting_approval",
    nextAction: "review-plan",
    planRevision: "rev-9",
    safeSummary: "source verified; discovered: video-use",
    recoverable: true,
    ...overrides,
  };
}

function mountMessage(toolName: string, snapshot: InstallSnapshot) {
  return mount(AiChatV2Message, {
    props: {
      message: {
        id: "m1",
        conversationId: "c1",
        role: "tool",
        content: "",
        messageType: MessageType.TOOL_RESULT,
        timestamp: new Date().toISOString(),
        metadata: {
          source: "chat-v2",
          toolName,
          toolResult: { ...snapshot },
          success: true,
        },
      },
      disabled: false,
    },
    global: {
      plugins: [i18n],
      stubs: {
        SkillApprovalCard: true,
        AiArtifactCard: true,
        AiChatV2StreamStatus: true,
        VIcon: true,
        VProgressLinear: true,
        VBtn: {
          template:
            '<button :data-testid="$attrs[\'data-testid\']" @click="$emit(\'click\')"><slot /></button>',
        },
        VCard: { template: "<div><slot /></div>" },
        VCardTitle: { template: "<div><slot /></div>" },
        VCardText: { template: "<div><slot /></div>" },
        VChip: { template: "<span><slot /></span>" },
        VSpacer: { template: "<span />" },
        VTextField: true,
      },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AiChatV2Message skill install card", () => {
  it("renders the install card for skill_install_prepare results", () => {
    const wrapper = mountMessage("skill_install_prepare", makeSnapshot());
    const card = wrapper.findComponent(SkillInstallCard);
    expect(card.exists()).toBe(true);
    expect(card.props("snapshot").sessionId).toBe("sess-9");
    expect(card.props("snapshot").state).toBe("awaiting_approval");
  });

  it("renders the install card for skill_install_approve results", () => {
    const wrapper = mountMessage(
      "skill_install_approve",
      makeSnapshot({ state: "ready", nextAction: "ready" })
    );
    expect(wrapper.findComponent(SkillInstallCard).exists()).toBe(true);
  });

  it("does NOT render the card for unrelated tool results", () => {
    const wrapper = mountMessage("file_read", makeSnapshot());
    expect(wrapper.findComponent(SkillInstallCard).exists()).toBe(false);
  });

  it("in-card approve updates the locally rendered snapshot", async () => {
    vi.mocked(approveSkillInstall).mockResolvedValue(
      makeSnapshot({ state: "ready", nextAction: "ready" })
    );
    const wrapper = mountMessage("skill_install_prepare", makeSnapshot());
    const card = wrapper.findComponent(SkillInstallCard);
    await card.find('[data-testid="skill-install-approve"]').trigger("click");
    await flushPromises();

    expect(approveSkillInstall).toHaveBeenCalledWith({
      sessionId: "sess-9",
      planRevision: "rev-9",
      approve: true,
    });
    // The message-level card now reflects the ready state locally.
    const updated = wrapper.findComponent(SkillInstallCard);
    expect(updated.props("snapshot").state).toBe("ready");
  });
});
