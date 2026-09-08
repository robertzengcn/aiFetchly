import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AiChatV2Message from "@/views/components/aiChatV2/AiChatV2Message.vue";
import { MessageType } from "@/entityTypes/commonType";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import { readPasteCache } from "@/views/api/aiChatV2";

vi.mock("@/views/api/aiChatV2", () => ({
  readPasteCache: vi.fn(),
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      aiChatV2: {
        pastedText: {
          chip_label: "Pasted text #{id} · {lines} lines",
          truncated_chip_label: "Truncated pasted text #{id} · {lines} lines",
          view_content: "View pasted content",
          hide_content: "Hide pasted content",
          loading: "Loading pasted content...",
        },
      },
    },
  },
});

function makeUserMessage(
  content: string,
  metadata?: ChatV2MessageView["metadata"]
): ChatV2MessageView {
  return {
    id: "u1",
    conversationId: "c1",
    role: "user",
    content,
    timestamp: new Date().toISOString(),
    messageType: MessageType.MESSAGE,
    metadata: metadata ?? { source: "chat-v2" },
  };
}

function mountWith(message: ChatV2MessageView) {
  return mount(AiChatV2Message, {
    props: { message },
    global: {
      plugins: [i18n],
      stubs: {
        SkillApprovalCard: true,
        AiChatV2StreamStatus: true,
        AiChatV2PlanApprovalCard: true,
        AiArtifactCard: true,
        OutboundEmailBatchCard: true,
        OutboundEmailReviewDialog: true,
        AIContentReportButton: true,
        VIcon: true,
      },
    },
  });
}

describe("AiChatV2Message pasted text display", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows expanded pasted content instead of the placeholder", async () => {
    const wrapper = mountWith(
      makeUserMessage("[Pasted text #1 +2 lines]", {
        source: "chat-v2",
        pastedBlocks: [
          {
            id: 1,
            lineCount: 2,
            charCount: 8,
            kind: "full",
            inlineContent: "alpha\nbeta\ngamma",
          },
        ],
      })
    );
    await flushPromises();
    expect(wrapper.find(".v2-message__content").text()).toBe(
      "alpha\nbeta\ngamma"
    );
    expect(wrapper.text()).not.toContain("[Pasted text #1");
  });

  it("loads hashed paste bodies and expands them into the bubble", async () => {
    vi.mocked(readPasteCache).mockResolvedValue("cached paste body");
    const wrapper = mountWith(
      makeUserMessage("[Pasted text #1]", {
        source: "chat-v2",
        pastedBlocks: [
          {
            id: 1,
            lineCount: 0,
            charCount: 18,
            kind: "full",
            contentHash: "hash-1",
          },
        ],
      })
    );
    await flushPromises();
    expect(readPasteCache).toHaveBeenCalledWith("hash-1");
    expect(wrapper.find(".v2-message__content").text()).toBe(
      "cached paste body"
    );
  });
});
