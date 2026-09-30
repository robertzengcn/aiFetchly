import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AiChatV2Messages from "@/views/components/aiChatV2/AiChatV2Messages.vue";
import { MessageType } from "@/entityTypes/commonType";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: { aiChatV2: {} } },
});

/**
 * Build a minimal ChatV2MessageView for tests. Only the fields the template
 * touches are populated; the rest default to whatever the type allows.
 */
function makeMessage(id: string, content: string): ChatV2MessageView {
  return {
    id,
    conversationId: "conv-test",
    role: "assistant",
    content,
    timestamp: new Date().toISOString(),
    messageType: MessageType.MESSAGE,
    metadata: { source: "chat-v2" },
  };
}

/**
 * AiChatV2Messages scrolls via a ref'd scroller div (scrollTop = scrollHeight).
 * happy-dom lays out elements with zero dimensions, so to observe a real
 * scrollTop change we have to stub the scroll geometry on the element. This
 * helper installs getters/setters so the component's onScroll + scrollToBottom
 * logic behaves like a real scrollable container.
 */
function stubScrollGeometry(el: HTMLElement, height: number): void {
  let top = 0;
  Object.defineProperty(el, "scrollHeight", {
    get: () => height,
    configurable: true,
  });
  Object.defineProperty(el, "clientHeight", {
    get: () => 100,
    configurable: true,
  });
  Object.defineProperty(el, "scrollTop", {
    get: () => top,
    set: (v: number) => {
      top = v;
    },
    configurable: true,
  });
}

function mountMessages(messages: ChatV2MessageView[]) {
  return mount(AiChatV2Messages, {
    global: {
      plugins: [i18n],
      stubs: {
        AiChatV2Message: { template: "<div class=\"msg\" />" },
        AiChatV2RecoveryStatus: true,
      },
    },
    props: {
      messages,
      activeAssistantMessageId: null,
      streamStatus: "idle" as const,
      reportedMessageIds: new Set<string>(),
    },
  });
}

describe("AiChatV2Messages auto-scroll on history load", () => {
  it("scrollToBottomForce jumps to the bottom even when the user had scrolled up", async () => {
    // Enough messages that the virtual scrollHeight (1000) exceeds the
    // clientHeight (100) — i.e. the list is actually scrollable.
    const messages = Array.from({ length: 5 }, (_, i) =>
      makeMessage(`m-${i}`, `message ${i}`)
    );
    const wrapper = mountMessages(messages);
    await wrapper.vm.$nextTick();

    const scroller = wrapper.find(".v2-messages").element as HTMLElement;
    stubScrollGeometry(scroller, 1000);

    // Simulate the user scrolling up in a previous conversation: move the
    // scrollTop to the top and dispatch a scroll event so the component's
    // onScroll handler flips pinnedToBottom to false. The normal
    // scrollToBottom() should now be a no-op.
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event("scroll"));
    expect(scroller.scrollTop).toBe(0);

    // The force variant ignores pinnedToBottom and pins back to the bottom.
    const exposed = wrapper.vm as unknown as {
      scrollToBottomForce: () => Promise<void>;
    };
    await exposed.scrollToBottomForce();
    expect(scroller.scrollTop).toBe(1000);

    wrapper.unmount();
  });

  it("does not force-scroll while the user is interacting (regression: force is opt-in)", async () => {
    // Confirms the watch-driven scrollToBottom still respects pinnedToBottom:
    // pushing a new message while scrolled up should NOT auto-scroll.
    const messages = [makeMessage("m-0", "first")];
    const wrapper = mountMessages(messages);
    await wrapper.vm.$nextTick();

    const scroller = wrapper.find(".v2-messages").element as HTMLElement;
    stubScrollGeometry(scroller, 1000);

    // User scrolled up.
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event("scroll"));

    // Append a message via the messages prop (drives the length watcher).
    await wrapper.setProps({ messages: [makeMessage("m-0", "first"), makeMessage("m-1", "second")] });
    await wrapper.vm.$nextTick();

    // Watch-driven scrollToBottom respects pinnedToBottom=false → stays put.
    expect(scroller.scrollTop).toBe(0);

    wrapper.unmount();
  });
});
