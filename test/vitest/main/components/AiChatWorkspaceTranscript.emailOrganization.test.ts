import { beforeEach, describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createI18n } from "vue-i18n";
import { MessageType } from "@/entityTypes/commonType";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import AiChatWorkspaceTranscript from "@/views/components/aiChatWorkspace/AiChatWorkspaceTranscript.vue";
import en from "@/views/lang/en";

/**
 * Email-organization cards in the workspace transcript (R12 / T14).
 *
 * A send_email_forward / move_email_to_trash / restore_email tool result
 * carries an operation id, and that result must surface the shared
 * EmailOrganizationOperationCard (progress, recipient outcomes, Undo/Restore)
 * beside its execution group — never a collapsed receipt. Every interactive
 * tool item is classified by projectInteractiveToolItem(), so the card has to
 * be reachable for the group anchor, for later results of the same group, and
 * for a solo historical result, and it has to travel with its group when the
 * group is deferred below the owning AI response (persisted history order).
 */

const i18n = createI18n({
  legacy: false,
  locale: "en",
  missingWarn: false,
  fallbackWarn: false,
  messages: { en },
});

/** Stands in for the shared card and exposes the operation id it mounted with. */
const ORGANIZATION_CARD_STUB = {
  props: ["operationId"],
  template:
    '<article data-testid="organization-card" :data-operation-id="operationId"></article>',
};

type Role = "user" | "assistant";

let idCounter = 0;

function row(
  messageType: MessageType,
  role: Role,
  metadata: Record<string, unknown> = {},
  content = ""
): ChatV2MessageView {
  idCounter += 1;
  return {
    id: `org-${idCounter}`,
    conversationId: "v2-org",
    role,
    content,
    timestamp: new Date(2026, 10, 24, 9, 0, idCounter).toISOString(),
    messageType,
    metadata: { source: "chat-v2", ...metadata },
  };
}

function toolCall(toolCallId: string, toolName: string): ChatV2MessageView {
  return row(MessageType.TOOL_CALL, "assistant", { toolCallId, toolName }, toolName);
}

function organizationResult(
  toolCallId: string,
  toolName: string,
  toolResult: Record<string, unknown>
): ChatV2MessageView {
  return row(
    MessageType.TOOL_RESULT,
    "assistant",
    { toolCallId, toolName, toolResult, toolResultStatus: "success" },
    JSON.stringify(toolResult)
  );
}

function mountTranscript(
  messages: readonly ChatV2MessageView[]
): ReturnType<typeof mount> {
  return mount(AiChatWorkspaceTranscript, {
    props: { messages, activeAssistantMessageId: null, streamStatus: "idle" },
    global: {
      plugins: [i18n],
      stubs: { EmailOrganizationOperationCard: ORGANIZATION_CARD_STUB },
    },
  });
}

function organizationCardIds(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper
    .findAll('[data-testid="organization-card"]')
    .map((card) => card.attributes("data-operation-id") ?? "");
}

type Surface = "user" | "assistant" | "group" | "organization-card" | "other";

/** Ordered identities of the transcript's top-level surfaces. */
function surfaceOrder(wrapper: ReturnType<typeof mount>): Surface[] {
  const root = wrapper.find('[data-testid="workspace-transcript"]').element;
  return Array.from(root.children).map((el): Surface => {
    if (el.classList.contains("execution-group")) return "group";
    if (el.classList.contains("v2-message--assistant")) return "assistant";
    if (el.classList.contains("v2-message--user")) return "user";
    if (el.querySelector('[data-testid="organization-card"]')) {
      return "organization-card";
    }
    return "other";
  });
}

describe("AiChatWorkspaceTranscript email-organization operation card (R12/T14)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    idCounter = 0;
  });

  it("renders the operation card beside the execution group of a grouped mutation result", async () => {
    const messages = [
      row(MessageType.MESSAGE, "assistant", {}, "Moving the message to Trash."),
      toolCall("tc-trash", "move_email_to_trash"),
      organizationResult("tc-trash", "move_email_to_trash", {
        success: true,
        operationId: "op-20261124-trash01",
      }),
    ];
    const wrapper = mountTranscript(messages);
    await flushPromises();

    // The paired call/result still collapses into its execution group…
    expect(
      wrapper.findAllComponents({ name: "AiChatExecutionGroup" }).length
    ).toBe(1);
    // …and the mutation result renders the shared operation card with the
    // operation id carried on the result — once, not once per tool row.
    expect(organizationCardIds(wrapper)).toEqual(["op-20261124-trash01"]);
  });

  it("renders one card per organization result among the later results of a group (T14)", async () => {
    const messages = [
      row(MessageType.MESSAGE, "assistant", {}, "Forwarding, then restoring."),
      toolCall("tc-search", "web_search"),
      row(
        MessageType.TOOL_RESULT,
        "assistant",
        {
          toolCallId: "tc-search",
          toolName: "web_search",
          toolResult: { success: true },
          toolResultSummary: "3 results",
        },
        "ok"
      ),
      toolCall("tc-forward", "send_email_forward"),
      organizationResult("tc-forward", "send_email_forward", {
        success: true,
        operationId: "op-20261124-forward1",
      }),
      toolCall("tc-restore", "restore_email"),
      organizationResult("tc-restore", "restore_email", {
        success: true,
        operationId: "op-20261124-restore1",
      }),
    ];
    const wrapper = mountTranscript(messages);
    await flushPromises();

    // Results after the group anchor are reached too, in message order; the
    // unrelated web_search result contributes no card.
    expect(organizationCardIds(wrapper)).toEqual([
      "op-20261124-forward1",
      "op-20261124-restore1",
    ]);
    expect(
      wrapper.findAllComponents({ name: "AiChatExecutionGroup" }).length
    ).toBe(1);
  });

  it("keeps the card with its group below the AI response when loaded from persisted history order", async () => {
    // Tool rows are persisted before the final assistant MESSAGE row; the
    // group is deferred until after its owning response, and the operation
    // card must make the same journey instead of floating above the reply.
    const messages = [
      row(MessageType.MESSAGE, "user", {}, "Clean up the inbox."),
      toolCall("tc-history", "move_email_to_trash"),
      organizationResult("tc-history", "move_email_to_trash", {
        success: true,
        operationId: "op-20261124-history1",
      }),
      row(
        MessageType.MESSAGE,
        "assistant",
        {},
        "Moved 1 message to Trash. You can undo it."
      ),
    ];
    const wrapper = mountTranscript(messages);
    await flushPromises();

    expect(surfaceOrder(wrapper)).toEqual([
      "user",
      "assistant",
      "group",
      "organization-card",
    ]);
  });

  it("renders the card for a solo historical result that anchors its own legacy group (R12 anchor)", async () => {
    const messages = [
      organizationResult("tc-solo", "restore_email", {
        success: true,
        operationId: "op-20261124-solo0001",
      }),
    ];
    const wrapper = mountTranscript(messages);
    await flushPromises();

    expect(organizationCardIds(wrapper)).toEqual(["op-20261124-solo0001"]);
    expect(surfaceOrder(wrapper)).toEqual(["group", "organization-card"]);
  });

  it("renders no operation card for results of other tools", async () => {
    const messages = [
      row(MessageType.MESSAGE, "assistant", {}, "Searching."),
      toolCall("tc-plain", "web_search"),
      row(
        MessageType.TOOL_RESULT,
        "assistant",
        {
          toolCallId: "tc-plain",
          toolName: "web_search",
          toolResult: { success: true, operationId: "op-not-an-email-op" },
          toolResultStatus: "success",
        },
        "ok"
      ),
    ];
    const wrapper = mountTranscript(messages);
    await flushPromises();

    expect(organizationCardIds(wrapper)).toEqual([]);
    expect(
      wrapper.findAllComponents({ name: "AiChatExecutionGroup" }).length
    ).toBe(1);
  });

  it("renders no operation card for a failed mutation that carries no operation id", async () => {
    const messages = [
      row(MessageType.MESSAGE, "assistant", {}, "Moving the message."),
      toolCall("tc-failed", "move_email_to_trash"),
      row(
        MessageType.TOOL_RESULT,
        "assistant",
        {
          toolCallId: "tc-failed",
          toolName: "move_email_to_trash",
          toolResult: { success: false, error: "imap unavailable" },
          toolResultStatus: "error",
        },
        "imap unavailable"
      ),
    ];
    const wrapper = mountTranscript(messages);
    await flushPromises();

    expect(organizationCardIds(wrapper)).toEqual([]);
    expect(
      wrapper.findAllComponents({ name: "AiChatExecutionGroup" }).length
    ).toBe(1);
  });
});
